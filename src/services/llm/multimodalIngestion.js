import { readStudioRecord, writeStudioRecord } from "../../core/studioPersistence.js";

const DEFAULT_MODELS = ["qwen/qwen3.8-27b"];
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const CACHE_PREFIX = "aulia:multimodal-ingestion:v1:";
const DIGITAL_BATCH_SIZE = 2;
const MAX_DIGITAL_OUTPUT_TOKENS = 1500;
const MAX_OCR_OUTPUT_TOKENS = 4500;

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cleanText(value, max = 6000) {
  const text = String(value || "").replace(/\r/g, "").trim();
  return text.length <= max ? text : text.slice(0, max) + "\n[Texto extraído truncado para el análisis visual]";
}

function parseRateReset(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
  const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/);
  if (clock) {
    if (clock[3] !== undefined) return (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000;
    return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  }
  let milliseconds = 0;
  const parts = /([\d.]+)\s*(ms|d|h|m|s)/gi;
  let match;
  while ((match = parts.exec(text))) {
    const unit = match[2].toLowerCase();
    milliseconds += Number(match[1]) * (unit === "d" ? 86400000 : unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "s" ? 1000 : 1);
  }
  return milliseconds;
}

function retryFromMessage(message) {
  const match = String(message || "").match(/(?:try again in|retry after)\s+((?:\d+(?:\.\d+)?\s*(?:ms|d|h|m|s)\s*)+)/i);
  return match ? parseRateReset(match[1]) : 0;
}


function normalisePage(page, expectedNumber) {
  const number = Number(page?.pageNumber);
  if (!Number.isFinite(number) || number !== expectedNumber) {
    throw new Error("La IA devolvió una página con número incorrecto. Esta tanda no se marcó como procesada.");
  }
  const visuals = Array.isArray(page.visualElements) ? page.visualElements : [];
  return {
    pageNumber: number,
    sectionTitle: String(page.sectionTitle || "").trim().slice(0, 180),
    sectionPath: Array.isArray(page.sectionPath)
      ? page.sectionPath.map(value => String(value || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    transcription: String(page.transcription || "").trim(),
    visualElements: visuals.slice(0, 12).map(item => ({
      kind: String(item?.kind || "other").trim().slice(0, 40),
      title: String(item?.title || "").trim().slice(0, 180),
      description: String(item?.description || "").trim().slice(0, 1600),
      tableMarkdown: String(item?.tableMarkdown || "").trim().slice(0, 6000),
      transcribedText: String(item?.transcribedText || "").trim().slice(0, 1800),
    })).filter(item => item.description || item.tableMarkdown || item.transcribedText),
    confidence: Math.max(0, Math.min(1, Number(page.confidence ?? 0.5) || 0)),
    needsReview: Boolean(page.needsReview),
    reviewNotes: String(page.reviewNotes || "").trim().slice(0, 700),
  };
}

async function readCache(key, signature) {
  try {
    const parsed = await readStudioRecord(key);
    if (parsed?.version === 1 && parsed?.signature === signature && parsed?.pages) {
      return parsed.pages;
    }
  } catch {}

  // Migrate page results created by the previous version, which stored progress in localStorage.
  try {
    const legacy = JSON.parse(localStorage.getItem(key) || "null");
    if (legacy?.version === 1 && legacy?.signature === signature && legacy?.pages) {
      await writeStudioRecord({
        id: key,
        kind: "multimodal-page-cache",
        version: 1,
        signature,
        updatedAt: legacy.updatedAt || new Date().toISOString(),
        pages: legacy.pages,
      });
      return legacy.pages;
    }
  } catch {}
  return {};
}

async function saveCache(key, signature, pages) {
  try {
    await writeStudioRecord({
      id: key,
      kind: "multimodal-page-cache",
      version: 1,
      signature,
      updatedAt: new Date().toISOString(),
      pages,
    });
  } catch {
    // The pending PDF itself is stored separately so the user can resume even if cache persistence fails.
  }
}

function pagePrompt(courseTitle, pages, batchNumber) {
  const details = pages.map(page => [
    "PÁGINA " + page.pageNumber,
    "TEXTO EXTRAÍDO AUTOMÁTICAMENTE (puede estar desordenado o incompleto):",
    cleanText(page.extractedText, 2400) || "[No se extrajo texto; la imagen requiere lectura/OCR]",
  ].join("\n")).join("\n\n----------------\n\n");

  return [
    "Sos especialista en análisis documental académico, OCR y comprensión visual. Analizá las páginas originales adjuntas de un documento universitario para preparar un corpus de conocimiento fiel y consultable.",
    "CÁTEDRA: " + String(courseTitle || "No especificada"),
    "TANDA: " + batchNumber,
    "",
    "OBJETIVO",
    "1. Interpretá las imágenes de las páginas, no dependas únicamente del texto extraído. Contrastá el texto con lo que realmente se ve.",
    "2. Proponé una segmentación semántica: identificá el título de sección o capítulo al que pertenece cada página y su ruta jerárquica. No crees una unidad nueva por cada página si el contenido continúa una sección.",
    "3. Identificá tablas, gráficos, diagramas, fórmulas, mapas, imágenes anotadas y otros elementos que aporten conocimiento. En tablas, conservá encabezados, columnas, filas, unidades y valores cuando sean legibles; devolvé tableMarkdown con una tabla Markdown. En gráficos, describí ejes, leyendas, variables, tendencias y valores visibles sin inventar cifras.",
    "4. Si el texto extraído está vacío porque la página parece escaneada, transcribí el contenido textual legible en transcription, conservando títulos, párrafos, listas, ecuaciones y tablas tanto como sea posible. Si ya hay texto extraído correcto, dejá transcription vacío para evitar duplicarlo.",
    "5. Si el texto está claramente dañado o contradice la página, registrá una transcripción corregida en transcription solo cuando puedas reconstruirla con suficiente seguridad; incluí el texto original en el análisis de forma conservadora y marcá needsReview=true cuando no sea verificable.",
    "6. No agregues conocimiento externo ni completes valores que no se vean. No inventes encabezados, autores, citas, páginas ni relaciones. Si hay ambigüedad, explicitála en reviewNotes y marcá needsReview=true.",
    "7. Conservá todos los elementos de conocimiento detectados aunque no sean texto corrido. La descripción visual se incorporará al contenido consultable con referencia a la página.",
    "",
    "SALIDA: devolvé solo un objeto JSON válido con esta estructura:",
    '{"pages":[{"pageNumber":1,"sectionTitle":"Título de sección o capítulo","sectionPath":["Parte","Capítulo","Sección"],"transcription":"","visualElements":[{"kind":"table|chart|diagram|formula|map|image|other","title":"Nombre breve","description":"Qué representa y cómo interpretarlo según lo visible","tableMarkdown":"Tabla Markdown con valores legibles, o cadena vacía","transcribedText":"Etiquetas, cifras o leyendas legibles que no queden reflejadas en otra parte"}],"confidence":0.0,"needsReview":false,"reviewNotes":""}]}',
    "Incluí exactamente una entrada por cada página indicada abajo. pageNumber debe coincidir exactamente. visualElements puede ser una lista vacía. Usa strings vacíos si no hay contenido y confidence entre 0 y 1.",
    "",
    details,
  ].join("\n\n");
}

async function requestBatch({ apiKey, courseTitle, pages, batchNumber, signal }) {
  const content = [{ type: "text", text: pagePrompt(courseTitle, pages, batchNumber) }];
  for (const page of pages) {
    content.push({ type: "text", text: "La siguiente imagen corresponde a la página " + page.pageNumber + " del documento." });
    content.push({
      type: "image_url",
      image_url: { url: page.imageDataUrl },
    });
  }

  const containsScannedPage = pages.some(page => String(page.extractedText || "").trim().length < 100);
  const outputTokens = containsScannedPage ? MAX_OCR_OUTPUT_TOKENS : MAX_DIGITAL_OUTPUT_TOKENS;
  let lastError = null;

  for (const model of DEFAULT_MODELS) {
    const response = await fetch(ENDPOINT, {
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
            content: "Devolvé únicamente JSON válido. Leé visualmente las páginas adjuntas y fundamentá el análisis en lo que aparece en esas páginas. No inventes contenido.",
          },
          { role: "user", content },
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_completion_tokens: outputTokens,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal,
    });

    const data = await response.json().catch(() => ({}));
    const message = data?.error?.message || data?.message || "";
    if (response.status === 404) {
      lastError = new Error("El modelo multimodal " + model + " no está disponible para esta cuenta.");
      continue;
    }
    if (!response.ok) {
      const error = new Error("Groq no pudo analizar las páginas (" + response.status + ")" + (message ? ": " + message : "."));
      const combined = (message + " " + String(data?.error?.code || "")).toLowerCase();
      error.status = response.status;
      error.isDailyLimit = /tokens per day|requests per day|daily limit|daily quota|per day \(t[dp]d\)|limit.*per day/.test(combined);
      const resetRequestsMs = parseRateReset(response.headers.get("x-ratelimit-reset-requests"));
      const resetTokensMs = parseRateReset(response.headers.get("x-ratelimit-reset-tokens"));
      error.retryAfterMs = error.isDailyLimit
        ? (retryFromMessage(message) || parseRateReset(response.headers.get("retry-after")) || resetRequestsMs)
        : (parseRateReset(response.headers.get("retry-after")) || resetTokensMs || retryFromMessage(message));
      error.retryAfter = response.headers.get("retry-after") || "";
      if (response.status === 401) error.message = "La API key de Groq no es válida. Revisá la clave docente en Studio.";
      if (response.status === 413) error.message = "La tanda de imágenes supera el tamaño admitido por Groq. El archivo queda guardado; usá «Reanudar análisis» para continuar.";
      if (response.status === 429 && error.isDailyLimit) {
        error.message = "Groq agotó la cuota diaria para este modelo. Se conserva la preparación y el avance; no hace falta volver a leer el PDF. Reintentá cuando se restablezca el límite indicado.";
      } else if (response.status === 429) {
        error.message = "Groq alcanzó un límite temporal de solicitudes o tokens por minuto. AULIA conservará la preparación y el avance.";
      }
      throw error;
    }

    const choice = data?.choices?.[0] || {};
    const raw = String(choice?.message?.content || "").trim();
    if (!raw) throw new Error("Groq devolvió una respuesta vacía para las páginas " + pages.map(page => page.pageNumber).join(", ") + ".");
    if (choice?.finish_reason === "length") {
      const error = new Error("La respuesta visual quedó truncada. El avance de las tandas anteriores se conservó; usá «Reanudar análisis» para continuar.");
      error.code = "AULIA_OUTPUT_TRUNCATED";
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, ""));
    } catch {
      throw new Error("La IA no devolvió JSON válido para las páginas " + pages.map(page => page.pageNumber).join(", ") + ". El lote no se marcó como completado.");
    }

    if (!Array.isArray(parsed?.pages)) {
      throw new Error("La respuesta de IA no contiene la lista pages esperada.");
    }
    const expected = new Set(pages.map(page => page.pageNumber));
    const received = new Set();
    const normalized = [];
    for (const page of parsed.pages) {
      const number = Number(page?.pageNumber);
      if (!expected.has(number) || received.has(number)) {
        throw new Error("La IA repitió o inventó un número de página. El lote no se marcó como completado.");
      }
      received.add(number);
      normalized.push(normalisePage(page, number));
    }
    if (received.size !== expected.size) {
      throw new Error("La IA no analizó todas las páginas de la tanda. No se marcó el lote como completado; usá «Reanudar análisis» para reintentar esa tanda.");
    }
    return { pages: normalized, model: data?.model || model };
  }

  throw lastError || new Error("Ningún modelo multimodal de Groq está disponible.");
}

export async function analyzePdfWithVision(material, {
  apiKey,
  courseTitle = "",
  onProgress = () => {},
  signal,
} = {}) {
  if (!apiKey) throw new Error("Para analizar gráficamente el PDF desde la carga, configurá primero tu clave personal de Groq.");
  const sourcePages = (material?.aiPages || []).slice().sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
  if (!sourcePages.length) throw new Error("No hay imágenes de páginas para analizar.");
  if (sourcePages.some(page => !String(page.imageDataUrl || "").startsWith("data:image/"))) {
    throw new Error("AULIA no pudo preparar las imágenes de todas las páginas. Probá con otro PDF o con una versión de menor resolución.");
  }

  const signature = hashString(sourcePages.map(page => [
    page.pageNumber,
    hashString(page.extractedText || ""),
    hashString(page.imageDataUrl || ""),
  ].join("|")).join("::"));
  const cacheKey = CACHE_PREFIX + String(material?.document?.id || material?.sourceName || "pdf") + ":" + signature;
  const pageResults = await readCache(cacheKey, signature);
  let model = "qwen/qwen3.8-27b";
  const total = sourcePages.length;

  const remaining = () => sourcePages.filter(page => !pageResults[String(page.pageNumber)]);
  while (remaining().length) {
    const pending = remaining();
    const first = pending[0];
    const batch = [first];
    if (String(first.extractedText || "").trim().length >= 100) {
      const next = pending[1];
      if (next && Number(next.pageNumber) === Number(first.pageNumber) + 1 &&
          String(next.extractedText || "").trim().length >= 100) {
        batch.push(next);
      }
    }

    onProgress({
      processed: Object.keys(pageResults).length,
      total,
      model,
      phase: "processing-batch",
      activePageNumbers: batch.map(page => page.pageNumber),
    });

    let result;
    try {
      result = await requestBatch({
        apiKey,
        courseTitle,
        pages: batch,
        batchNumber: Math.floor(Object.keys(pageResults).length / DIGITAL_BATCH_SIZE) + 1,
        signal,
      });
    } catch (error) {
      // If a pair of rich pages overflows the JSON response, retry the pages separately.
      if (error?.code !== "AULIA_OUTPUT_TRUNCATED" || batch.length < 2) throw error;
      for (const singlePage of batch) {
        const singleResult = await requestBatch({
          apiKey,
          courseTitle,
          pages: [singlePage],
          batchNumber: Math.floor(Object.keys(pageResults).length / DIGITAL_BATCH_SIZE) + 1,
          signal,
        });
        model = singleResult.model || model;
        for (const page of singleResult.pages) pageResults[String(page.pageNumber)] = page;
        await saveCache(cacheKey, signature, pageResults);
        onProgress({
          processed: Object.keys(pageResults).length,
          total,
          model,
          pageNumbers: [singlePage.pageNumber],
        });
      }
      continue;
    }
    model = result.model || model;
    for (const page of result.pages) pageResults[String(page.pageNumber)] = page;
    await saveCache(cacheKey, signature, pageResults);
    onProgress({
      processed: Object.keys(pageResults).length,
      total,
      model,
      phase: "processing",
      pageNumbers: batch.map(page => page.pageNumber),
    });
  }

  return {
    model,
    sourceSignature: signature,
    pages: sourcePages.map(page => pageResults[String(page.pageNumber)]),
    processed: total,
    total,
  };
}
