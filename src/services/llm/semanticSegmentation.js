import { readStudioRecord, writeStudioRecord } from "../../core/studioPersistence.js";
import {
  estimateGroqRequestTokens,
  waitForGroqCapacity,
  recordGroqUsage,
  MAX_GROQ_REQUEST_TOKENS,
} from "./groqRateLimiter.js";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"];
const CACHE_PREFIX = "aulia:semantic-segmentation:v1:";
const MAX_TASK_CHARS = 4700;
const MAX_TASK_LINES = 68;
const OUTLINE_MAX_TOKENS = 1050;
const BOUNDARY_MAX_TOKENS = 1050;

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clean(value, max = 500) {
  return String(value || "").replace(/\u00ad/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

function norm(value) {
  return clean(value, 1000).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function contentLines(text) {
  return String(text || "").replace(/\r/g, "").split("\n")
    .map((text, index) => ({ lineNumber: index + 1, text: clean(text, 1800), logicalSide: "" }))
    .filter(line => line.text);
}

function normalizeSourcePages(pages, visionPages = []) {
  const visionByPage = new Map((visionPages || []).map(page => [Number(page.pageNumber), page]));
  return (pages || []).map(page => {
    const pageNumber = Number(page?.pageNumber);
    const vision = visionByPage.get(pageNumber);
    const raw = String(page?.extractedText || "").trim();
    const transcription = String(vision?.transcription || "").trim();
    const useTranscription = transcription.length >= 80 &&
      (raw.length < 100 || transcription.length > raw.length * 1.35);
    let lines = Array.isArray(page?.lineItems) && page.lineItems.length
      ? page.lineItems.map((line, index) => ({
          lineNumber: Number(line?.lineNumber) || index + 1,
          text: clean(line?.text, 1800),
          logicalSide: String(line?.logicalSide || ""),
          bold: Boolean(line?.bold),
          fontSize: Number(line?.fontSize || 0),
          xMin: Number(line?.xMin || 0),
          width: Number(line?.width || 0),
        })).filter(line => line.text)
      : contentLines(useTranscription ? transcription : raw);
    if (useTranscription) {
      lines = contentLines(transcription);
    }
    return {
      pageNumber,
      layoutKind: String(page?.layoutKind || "unknown"),
      layoutConfidence: Number(page?.layoutConfidence || 0),
      lines,
      sourceText: useTranscription ? transcription : raw,
      usedVisualTranscription: useTranscription,
    };
  }).filter(page => Number.isInteger(page.pageNumber) && page.pageNumber > 0);
}

function makeTasks(pages) {
  const tasks = [];
  let current = [];
  let chars = 0;
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    const pageNumbers = Array.from(new Set(current.map(line => line.pageNumber)));
    tasks.push({
      key: first.pageNumber + ":" + first.lineNumber + "-" + last.pageNumber + ":" + last.lineNumber,
      pageNumber: first.pageNumber,
      pageNumbers,
      layoutKinds: Array.from(new Set(current.map(line => line.layoutKind).filter(Boolean))),
      startLine: first.lineNumber,
      endLine: last.lineNumber,
      lines: current,
    });
    current = [];
    chars = 0;
  };
  for (const page of pages) {
    for (const sourceLine of page.lines) {
      const line = {
        ...sourceLine,
        pageNumber: page.pageNumber,
        layoutKind: page.layoutKind,
        layoutConfidence: page.layoutConfidence,
      };
      const lineChars = line.text.length + 36;
      if (current.length && (chars + lineChars > MAX_TASK_CHARS || current.length >= MAX_TASK_LINES)) flush();
      current.push(line);
      chars += lineChars;
    }
  }
  flush();
  return tasks;
}

function samplePages(pages) {
  if (!pages.length) return [];
  const count = Math.min(10, pages.length);
  const indices = new Set();
  if (count === 1) indices.add(0);
  else for (let i = 0; i < count; i += 1) {
    indices.add(Math.round(i * (pages.length - 1) / (count - 1)));
  }
  return Array.from(indices).sort((a, b) => a - b).map(index => {
    const page = pages[index];
    const excerpt = page.lines.map(line => line.text).join(" ").slice(0, 390);
    return {
      pageNumber: page.pageNumber,
      layoutKind: page.layoutKind,
      excerpt,
    };
  });
}

function structureHints(sections) {
  return (sections || []).slice(0, 35).map(section => ({
    title: clean(section?.title, 100),
    level: Number(section?.level || 1),
    page: Number(section?.sourcePageStart || 0) || null,
    evidence: Array.isArray(section?.evidence) ? section.evidence.slice(0, 2) : [],
  })).filter(section => section.title);
}

function buildOutlinePrompt({ title, pageCount, samples, hints }) {
  return [
    "Vas a reconstruir la organización de un material académico. El texto fue extraído automáticamente y puede contener errores.",
    "Todavía NO segmentes el libro. Inferí un mapa global tentativo a partir de la evidencia distribuida en varias páginas.",
    "Distingue capítulos, partes, introducción, conclusión y apartados solo cuando la evidencia textual lo sostenga. No conviertas ejemplos, encabezados corrientes ni títulos de página repetidos en capítulos.",
    "Los indicios estructurales locales son orientativos y pueden estar equivocados: corregilos cuando contradigan el contenido.",
    "No agregues capítulos que no tengan apoyo visible. Si no se puede inferir un mapa, devolvé outline vacío y explicá la incertidumbre en notes.",
    "Documento: " + clean(title, 180),
    "Páginas físicas del PDF: " + pageCount,
    "INDICIOS LOCALES (no asumir que son correctos):\n" + JSON.stringify(hints),
    "MUESTRA DISTRIBUIDA DEL DOCUMENTO:\n" + JSON.stringify(samples),
    'Devolvé solo JSON: {"documentType":"libro|articulo|apunte|manual|otro","outline":[{"title":"título respaldado","level":1,"parentTitle":"","purpose":"función del apartado en una frase"}],"notes":"incertidumbres relevantes"}.',
    "Máximo 25 entradas. level debe estar entre 1 y 4. No inventes números de página ni autores.",
  ].join("\n\n");
}

function currentPathFromBoundaries(boundaries) {
  const stack = [];
  const ordered = (boundaries || []).slice().sort((a, b) => a.pageNumber - b.pageNumber || a.lineNumber - b.lineNumber);
  for (const boundary of ordered) {
    const level = Math.max(1, Math.min(4, Number(boundary.level || 1)));
    stack.length = level - 1;
    stack[level - 1] = boundary.title;
  }
  return stack.filter(Boolean);
}

function buildBoundaryPrompt({ title, outline, task, currentPath }) {
  const lines = task.lines.map(line => {
    const cues = [];
    if (line.logicalSide) cues.push("zona-" + line.logicalSide);
    if (line.bold) cues.push("negrita");
    return "P" + line.pageNumber + "L" + line.lineNumber + (cues.length ? " [" + cues.join(",") + "]" : "") + ": " + line.text;
  }).join("\n");
  return [
    "Sos un especialista en análisis de libros académicos. Detectá encabezados reales en el fragmento, apoyándote en el mapa global y el contexto previo.",
    "Documento: " + clean(title, 180),
    "Mapa global tentativo: " + JSON.stringify((outline || []).slice(0, 20)),
    "Sección abierta al comenzar esta tanda: " + JSON.stringify(currentPath || []),
    "Páginas físicas del PDF incluidas: " + (task.pageNumbers || [task.pageNumber]).join(", ") + ". Disposiciones detectadas: " + (task.layoutKinds || []).join(", ") + ".",
    "REGLAS",
    "1. Devolvé un límite solo cuando una línea sea un título o encabezado de capítulo/apartado que cambie la organización temática. No crees límites por cambios normales de párrafo, listas, ejemplos o palabras destacadas en el cuerpo.",
    "2. pageNumber y lineNumber deben corresponder exactamente a una marca PnLm que aparece en el fragmento. title debe reflejar el encabezado visible de esa misma línea, sin inventar formulaciones conceptuales.",
    "3. level 1 = parte/capítulo principal; 2 = sección dentro del capítulo; 3 = subsección; 4 = subapartado. Usá la jerarquía del mapa global cuando corresponda, pero no fuerces todos los títulos a pertenecer al índice.",
    "4. No repitas encabezados corrientes de página ni el título del libro salvo que realmente inauguren una sección. No crees límites de capítulo a partir de una página de índice/tabla de contenidos; las líneas con puntos guía y número de página al final son referencias del índice, no encabezados del cuerpo. Si hay un pliego horizontal, las líneas se presentan de izquierda a derecha; los marcadores de zona ayudan a evitar mezclar páginas enfrentadas.",
    "5. Si la lectura no permite decidir, omití el límite y registrá la incertidumbre en notes. No resumas el texto ni inventes contenido.",
    "LÍNEAS DEL FRAGMENTO:\n" + lines,
    'Devolvé solo JSON: {"boundaries":[{"pageNumber":1,"lineNumber":1,"title":"título visible","level":1,"confidence":0.9,"evidence":"por qué es encabezado"}],"notes":""}.',
    "boundaries puede estar vacío. confidence debe estar entre 0 y 1. Máximo 12 límites por tanda.",
  ].join("\n\n");
}

function parseRetryDelay(response, message = "") {
  const retryHeader = String(response?.headers?.get("retry-after") || "").trim();
  if (retryHeader) {
    const seconds = Number(retryHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryHeader);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const match = String(message || "").match(/(?:try again in|retry after)\s+((?:\d+(?:\.\d+)?\s*(?:ms|d|h|m|s)\s*)+)/i);
  if (match) {
    let total = 0;
    const parts = /([\d.]+)\s*(ms|d|h|m|s)/gi;
    let part;
    while ((part = parts.exec(match[1]))) {
      const value = Number(part[1]);
      const unit = part[2].toLowerCase();
      total += value * (unit === "d" ? 86400000 : unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "s" ? 1000 : 1);
    }
    if (total > 0) return total;
  }
  const reset = String(response?.headers?.get("x-ratelimit-reset-tokens") || "").trim();
  if (/^\\d+(?:\\.\\d+)?$/.test(reset)) return Number(reset) * 1000;
  return 0;
}

function responseTokens(prompt, reserve) {
  const estimated = estimateGroqRequestTokens({ promptText: prompt, maxCompletionTokens: reserve });
  if (estimated > MAX_GROQ_REQUEST_TOKENS) {
    const error = new Error("La tanda de segmentación supera el presupuesto seguro de Groq. AULIA la dividirá en fragmentos menores.");
    error.code = "AULIA_SEMANTIC_BATCH_TOO_LARGE";
    throw error;
  }
  return estimated;
}

async function postJson({ apiKey, prompt, maxTokens, signal, onProgress, progress }) {
  const orderedModels = MODELS.slice();
  let lastError = null;
  for (const model of orderedModels) {
    const estimatedTokens = responseTokens(prompt, maxTokens);
    await waitForGroqCapacity({ model, estimatedTokens, onProgress, progress: { ...progress, model } });
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "Analizá exclusivamente la evidencia suministrada. Devolvé un objeto JSON válido y no agregues texto fuera del JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          top_p: 0.9,
          max_completion_tokens: maxTokens,
          reasoning_effort: "low",
          response_format: { type: "json_object" },
          stream: false,
        }),
        signal,
      });
    } catch (error) {
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    const message = data?.error?.message || data?.message || "";
    if (response.status === 404) {
      lastError = new Error("El modelo de segmentación " + model + " no está disponible.");
      continue;
    }
    if (!response.ok) {
      const error = new Error("Groq no pudo interpretar la estructura (" + response.status + ")" + (message ? ": " + message : "."));
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after") || "";
      error.retryAfterMs = parseRetryDelay(response, message);
      error.isDailyLimit = response.status === 429 && /tokens per day|requests per day|daily limit|daily quota|per day \(t[dp]d\)|limit.*per day/i.test(message);
      if (response.status === 401) error.message = "La API key de Groq no es válida. Revisá la clave docente en Studio.";
      if (response.status === 413) error.message = "Groq rechazó una tanda por su tamaño. La segmentación se puede reanudar sin rehacer las tandas anteriores.";
      if (response.status === 429) error.message = "Groq alcanzó un límite de uso durante la segmentación. El avance se guardó; reanudá cuando la cuota vuelva a estar disponible. Detalle: " + message;
      throw error;
    }
    recordGroqUsage(model, estimatedTokens, data?.usage?.total_tokens || 0);
    const choice = data?.choices?.[0] || {};
    const raw = String(choice?.message?.content || "").trim();
    if (!raw || choice?.finish_reason === "length") {
      const error = new Error("La respuesta de Groq quedó vacía o truncada. La tanda no se marcará como completada.");
      error.code = "AULIA_SEMANTIC_OUTPUT_TRUNCATED";
      throw error;
    }
    try {
      return { parsed: JSON.parse(raw), model: data?.model || model };
    } catch {
      const error = new Error("Groq devolvió JSON inválido durante la segmentación. El avance anterior se conservó.");
      error.code = "AULIA_SEMANTIC_INVALID_JSON";
      throw error;
    }
  }
  throw lastError || new Error("Ningún modelo configurado pudo interpretar la segmentación.");
}

function normalizeBoundaries(raw, task) {
  const lineMap = new Map(task.lines.map(line => [line.pageNumber + ":" + line.lineNumber, line]));
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const lineNumber = Number(item?.lineNumber);
    const pageNumber = Number(item?.pageNumber);
    const line = lineMap.get(pageNumber + ":" + lineNumber);
    const title = clean(item?.title, 150);
    const key = pageNumber + ":" + lineNumber;
    if (!line || !title || seen.has(key)) continue;
    const lineText = norm(line.text);
    const titleText = norm(title);
    const sharesAnchor = lineText && titleText && (
      lineText.includes(titleText) ||
      titleText.includes(lineText) ||
      titleText.split(" ").filter(token => token.length > 3 && lineText.includes(token)).length /
        Math.max(1, titleText.split(" ").filter(token => token.length > 3).length) >= 0.55
    );
    if (!sharesAnchor || titleText.length < 3) continue;
    if (line.text.length > 170) continue;
    const level = Math.max(1, Math.min(4, Number(item?.level || 1)));
    const confidence = Math.max(0.2, Math.min(0.99, Number(item?.confidence ?? 0.65) || 0.65));
    seen.add(key);
    result.push({
      pageNumber,
      lineNumber,
      title,
      level,
      confidence,
      evidence: clean(item?.evidence, 180) || "encabezado semántico localizado en el texto original",
      layoutKind: task.layoutKind,
    });
  }
  return result.sort((a, b) => a.pageNumber - b.pageNumber || a.lineNumber - b.lineNumber);
}

function makeSections(pages, boundaries, title) {
  const flat = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.text) continue;
      flat.push({
        pageNumber: page.pageNumber,
        lineNumber: line.lineNumber,
        text: line.text,
      });
    }
  }
  if (!flat.length) throw new Error("No hay texto suficiente para construir una segmentación semántica.");

  const position = new Map(flat.map((line, index) => [line.pageNumber + ":" + line.lineNumber, index]));
  const validBoundaries = boundaries
    .map(boundary => ({ ...boundary, index: position.get(boundary.pageNumber + ":" + boundary.lineNumber) }))
    .filter(boundary => Number.isInteger(boundary.index))
    .sort((a, b) => a.index - b.index)
    .filter((boundary, index, list) => index === 0 || boundary.index !== list[index - 1].index)
    .map((boundary, index, list) => {
      const rawLevel = Math.max(1, Math.min(4, Number(boundary.level || 1)));
      if (index === 0) return { ...boundary, level: 1 };
      const previousLevel = Number(list[index - 1].level || 1);
      return { ...boundary, level: Math.min(rawLevel, previousLevel + 1) };
    });

  if (!validBoundaries.length) {
    return [{
      title: "Material general",
      level: 1,
      sectionPath: ["Material general"],
      content: flat.map(line => line.text).join("\n"),
      sourcePageStart: flat[0].pageNumber,
      sourcePageEnd: flat[flat.length - 1].pageNumber,
      segmentationSource: "ai-text-first",
      confidence: 0.35,
      evidence: ["no se detectaron encabezados semánticos con suficiente evidencia"],
      needsReview: true,
      reviewNotes: "La IA no encontró límites temáticos verificables. Revisá manualmente la segmentación.",
    }];
  }

  const sections = [];
  const firstBoundary = validBoundaries[0];
  if (firstBoundary.index > 0) {
    const introLines = flat.slice(0, firstBoundary.index);
    const introText = introLines.map(line => line.text).join("\n").trim();
    if (introText.length >= 90) {
      sections.push({
        title: "Material introductorio / sin encabezado detectado",
        level: 1,
        sectionPath: ["Material introductorio / sin encabezado detectado"],
        content: introText,
        sourcePageStart: introLines[0].pageNumber,
        sourcePageEnd: introLines[introLines.length - 1].pageNumber,
        segmentationSource: "ai-text-first",
        confidence: 0.48,
        evidence: ["contenido anterior al primer encabezado reconocido"],
        needsReview: true,
        reviewNotes: "Puede contener portada, índice, prólogo o introducción; verificá su alcance.",
      });
    }
  }

  let path = [];
  for (let index = 0; index < validBoundaries.length; index += 1) {
    const boundary = validBoundaries[index];
    const next = validBoundaries[index + 1];
    const startIndex = boundary.index + 1;
    const endIndex = next ? next.index : flat.length;
    const contentLines = flat.slice(startIndex, endIndex);
    const content = contentLines.map(line => line.text).join("\n").trim();
    const level = Math.max(1, Math.min(4, Number(boundary.level || 1)));
    path.length = level - 1;
    path[level - 1] = boundary.title;
    const sectionPath = path.filter(Boolean).slice();
    let directChildren = 0;
    for (let childIndex = index + 1; childIndex < validBoundaries.length; childIndex += 1) {
      const candidate = validBoundaries[childIndex];
      if (candidate.level <= level) break;
      if (candidate.level === level + 1) directChildren += 1;
    }
    sections.push({
      title: boundary.title,
      level,
      sectionPath,
      content,
      sourcePageStart: boundary.pageNumber,
      sourcePageEnd: contentLines.length ? contentLines[contentLines.length - 1].pageNumber : boundary.pageNumber,
      segmentationSource: "ai-text-first",
      confidence: Number(boundary.confidence || 0.65),
      evidence: [boundary.evidence || "encabezado localizado en el texto original", "mapa global contrastado por tandas"],
      childrenCount: directChildren,
      ...(content.length < 24 ? { structuralOnly: true } : {}),
      ...(Number(boundary.confidence || 0.65) < 0.62 ? {
        needsReview: true,
        reviewNotes: "El encabezado se interpretó con confianza limitada; revisá sus límites.",
      } : {}),
    });
  }

  return sections;
}

async function readCache(cacheKey, signature) {
  try {
    const record = await readStudioRecord(cacheKey);
    if (record?.kind === "semantic-segmentation-cache" &&
        record?.version === 1 && record?.signature === signature) return record;
  } catch {}
  return null;
}

async function writeCache(cacheKey, signature, state) {
  await writeStudioRecord({
    id: cacheKey,
    kind: "semantic-segmentation-cache",
    version: 1,
    signature,
    updatedAt: new Date().toISOString(),
    ...state,
  });
}

export async function analyzeDocumentSemantics({
  apiKey,
  documentTitle = "Material",
  pages = [],
  visionPages = [],
  existingSections = [],
  sourceFingerprint = "",
  onProgress = () => {},
  signal,
} = {}) {
  if (!apiKey) throw new Error("Configurá una clave personal de Groq para reconstruir la estructura temática del documento.");
  const normalizedPages = normalizeSourcePages(pages, visionPages);
  const allLines = normalizedPages.reduce((sum, page) => sum + page.lines.length, 0);
  if (!normalizedPages.length || !allLines) {
    throw new Error("No hay texto recuperable en las páginas para interpretar la segmentación. Revisá el OCR o la lectura visual antes de continuar.");
  }
  const signature = hashString(JSON.stringify({
    title: documentTitle,
    pages: normalizedPages.map(page => [page.pageNumber, page.layoutKind, page.lines.map(line => [line.lineNumber, line.text])]),
  }));
  const cacheKey = CACHE_PREFIX + hashString(String(sourceFingerprint || documentTitle)) + ":" + signature;
  const tasks = makeTasks(normalizedPages);
  let cache = await readCache(cacheKey, signature);
  if (!cache) {
    cache = { outline: null, completedTasks: {} };
    await writeCache(cacheKey, signature, cache);
  }
  let model = String(cache.model || "");
  const hints = structureHints(existingSections);

  if (!cache.outline) {
    const prompt = buildOutlinePrompt({
      title: documentTitle,
      pageCount: normalizedPages.length,
      samples: samplePages(normalizedPages),
      hints,
    });
    const result = await postJson({
      apiKey,
      prompt,
      maxTokens: OUTLINE_MAX_TOKENS,
      signal,
      onProgress,
      progress: { phase: "semantic-outline", processed: 0, total: tasks.length, pageNumber: 1 },
    });
    cache.outline = Array.isArray(result.parsed?.outline) ? result.parsed.outline.slice(0, 25).map(item => ({
      title: clean(item?.title, 140),
      level: Math.max(1, Math.min(4, Number(item?.level || 1))),
      parentTitle: clean(item?.parentTitle, 140),
      purpose: clean(item?.purpose, 220),
    })).filter(item => item.title) : [];
    cache.documentType = clean(result.parsed?.documentType, 40) || "documento";
    cache.outlineNotes = clean(result.parsed?.notes, 600);
    cache.model = result.model;
    model = result.model;
    await writeCache(cacheKey, signature, cache);
  }

  let processed = 0;
  let currentBoundaries = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const saved = cache.completedTasks?.[task.key];
    if (saved) {
      currentBoundaries.push(...(saved.boundaries || []));
      processed += 1;
      continue;
    }

    const currentPath = currentPathFromBoundaries(currentBoundaries);
    const prompt = buildBoundaryPrompt({
      title: documentTitle,
      outline: cache.outline || [],
      task,
      currentPath,
    });
    let result;
    try {
      result = await postJson({
        apiKey,
        prompt,
        maxTokens: BOUNDARY_MAX_TOKENS,
        signal,
        onProgress,
        progress: {
          phase: "semantic-segmentation",
          processed,
          total: tasks.length,
          pageNumber: task.pageNumber,
          activePages: task.pageNumbers || [task.pageNumber],
          activeLines: [task.startLine, task.endLine],
        },
      });
    } catch (error) {
      if (error?.code === "AULIA_SEMANTIC_BATCH_TOO_LARGE" && task.lines.length > 1) {
        // A single task is already compact; if its line lengths still exceed the
        // safe budget, split it in memory and invalidate the old task key.
        const middle = Math.ceil(task.lines.length / 2);
        const smaller = [task.lines.slice(0, middle), task.lines.slice(middle)].filter(group => group.length).map(group => {
          const first = group[0];
          const last = group[group.length - 1];
          return {
            ...task,
            key: first.pageNumber + ":" + first.lineNumber + "-" + last.pageNumber + ":" + last.lineNumber,
            pageNumber: first.pageNumber,
            pageNumbers: Array.from(new Set(group.map(line => line.pageNumber))),
            startLine: first.lineNumber,
            endLine: last.lineNumber,
            lines: group,
          };
        });
        tasks.splice(index, 1, ...smaller);
        index -= 1;
        continue;
      }
      cache.lastError = clean(error?.message, 500);
      cache.model = model;
      await writeCache(cacheKey, signature, cache);
      throw error;
    }
    model = result.model || model;
    const boundaries = normalizeBoundaries(result.parsed?.boundaries, task);
    cache.completedTasks = {
      ...(cache.completedTasks || {}),
      [task.key]: {
        pageNumber: task.pageNumber,
        startLine: task.startLine,
        endLine: task.endLine,
        boundaries,
      },
    };
    cache.model = model;
    if (result.parsed?.notes) cache.lastNotes = clean(result.parsed.notes, 600);
    currentBoundaries.push(...boundaries);
    processed += 1;
    await writeCache(cacheKey, signature, cache);
    onProgress({
      phase: "semantic-segmentation",
      processed,
      total: tasks.length,
      pageNumber: task.pageNumber,
      activePages: task.pageNumbers || [task.pageNumber],
      model,
      boundaryCount: currentBoundaries.length,
      message: "Interpretación temática con IA · fragmento " + processed + " de " + tasks.length,
    });
  }

  const boundaries = Object.values(cache.completedTasks || {})
    .flatMap(item => item.boundaries || [])
    .sort((a, b) => a.pageNumber - b.pageNumber || a.lineNumber - b.lineNumber);
  const sections = makeSections(normalizedPages, boundaries, documentTitle);
  const warnings = [];
  if (!cache.outline?.length) warnings.push("La IA no pudo construir un índice global explícito; la segmentación se apoyó en encabezados localizados por tandas.");
  if (sections.length === 1 && sections[0].title === "Material general") {
    warnings.push("La IA no detectó límites de capítulo verificables. El texto se conserva completo en una sección general para no descartar contenido.");
  }
  if (normalizedPages.some(page => page.layoutKind === "landscape-ambiguous")) {
    warnings.push("El documento contiene páginas horizontales ambiguas. Se mantuvo el orden de lectura detectado, pero conviene revisar manualmente esas páginas.");
  }
  if (normalizedPages.some(page => page.usedVisualTranscription)) {
    warnings.push("La segmentación usó transcripciones visuales de IA donde la capa de texto era insuficiente; revisá especialmente esos límites.");
  }
  return {
    sections,
    outline: cache.outline || [],
    documentType: cache.documentType || "documento",
    model,
    tasksProcessed: tasks.length,
    boundariesFound: boundaries.length,
    warnings,
    outlineNotes: cache.outlineNotes || "",
  };
}
