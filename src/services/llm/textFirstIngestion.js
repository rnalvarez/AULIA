import { readStudioRecord, writeStudioRecord } from "../../core/studioPersistence.js";

const MODEL = "qwen/qwen3.8-27b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const CACHE_PREFIX = "aulia:text-first-ingestion:v1:";
const MIN_TEXT_CHARS = 100;
const MAX_COMPACT_CHARS_PER_PAGE = 1300;
const MAX_BATCH_PAGES = 8;
const MAX_BATCH_CHARS = 9000;
const MAX_OUTPUT_TOKENS = 1200;

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normaliseWhitespace(value) {
  return String(value || "").replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function looksLikeHeading(line) {
  const value = String(line || "").trim();
  if (value.length < 3 || value.length > 120) return false;
  return /^(?:cap[ií]tulo|parte|secci[oó]n|unidad|introducci[oó]n|conclusi[oó]n|bibliograf[ií]a|referencias|anexo|ap[eé]ndice|índice|indice)\b/i.test(value) ||
    /^\d+(?:\.\d+){0,4}[.)]?\s+\S/.test(value) ||
    /^[IVXLCDM]+[.)]?\s+[A-ZÁÉÍÓÚÜÑ]/.test(value) ||
    (/[A-ZÁÉÍÓÚÜÑ]/.test(value) && value === value.toLocaleUpperCase("es") && /[A-ZÁÉÍÓÚÜÑ]/.test(value.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "")));
}

function compactPageText(rawText) {
  const text = normaliseWhitespace(rawText);
  if (text.length <= MAX_COMPACT_CHARS_PER_PAGE) return text;

  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const headings = [];
  const seen = new Set();
  for (const line of lines) {
    if (!looksLikeHeading(line)) continue;
    const key = line.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    headings.push(line);
    if (headings.join("\n").length > 380) break;
  }

  const beginning = text.slice(0, 560);
  const ending = text.slice(-180);
  const compacted = [
    headings.length ? "TÍTULOS POSIBLES DETECTADOS LOCALMENTE:\n" + headings.join("\n") : "",
    "INICIO DE PÁGINA:\n" + beginning,
    "FINAL DE PÁGINA:\n" + ending,
    "[Se conserva todo el texto original localmente; este extracto compacto se usa solo para identificar la estructura.]",
  ].filter(Boolean).join("\n\n");
  return compacted.length <= MAX_COMPACT_CHARS_PER_PAGE
    ? compacted
    : compacted.slice(0, MAX_COMPACT_CHARS_PER_PAGE);
}

function normalisePage(page, expectedNumber) {
  const number = Number(page?.pageNumber);
  if (!Number.isInteger(number) || number !== expectedNumber) {
    throw new Error("Groq devolvió un número de página inesperado. La tanda no se marcó como completada.");
  }
  const sectionTitle = String(page.sectionTitle || page.sectionPath?.slice(-1)?.[0] || "").trim().slice(0, 180);
  const sectionPath = Array.isArray(page.sectionPath)
    ? page.sectionPath.map(value => String(value || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const confidenceValue = Number(page.confidence);
  return {
    pageNumber: number,
    sectionTitle,
    sectionPath: sectionPath.length ? sectionPath : (sectionTitle ? [sectionTitle] : []),
    // The full text is kept locally from PDF.js. Do not ask the model to repeat it.
    transcription: "",
    // Text-only analysis cannot reliably interpret the contents of diagrams/graphs.
    visualElements: [],
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : (sectionTitle ? 0.62 : 0.35),
    needsReview: Boolean(page.needsReview) || !sectionTitle || !sectionPath.length,
    reviewNotes: String(page.reviewNotes || (!sectionTitle ? "La IA no pudo identificar con suficiente seguridad la sección de esta página." : "")).trim().slice(0, 700),
  };
}

function makeBatches(pages) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const page of pages) {
    const compact = compactPageText(page.extractedText);
    const pageChars = compact.length;
    if (current.length && (current.length >= MAX_BATCH_PAGES || chars + pageChars > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push({ ...page, compactText: compact });
    chars += pageChars;
    if (current.length >= MAX_BATCH_PAGES) {
      batches.push(current);
      current = [];
      chars = 0;
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

async function readCache(key, signature) {
  try {
    const cached = await readStudioRecord(key);
    if (cached?.kind === "text-first-page-cache" && cached?.version === 1 && cached.signature === signature && cached.pages) {
      return cached.pages;
    }
  } catch {}
  return {};
}

async function saveCache(key, signature, pages) {
  await writeStudioRecord({
    id: key,
    kind: "text-first-page-cache",
    version: 1,
    signature,
    updatedAt: new Date().toISOString(),
    pages,
  });
}

function promptForBatch(courseTitle, pages, batchNumber, previousPages) {
  const continuity = previousPages.length
    ? "CONTINUIDAD IDENTIFICADA EN PÁGINAS ANTERIORES (orientativa; corregila si el texto actual lo contradice):\n" +
      previousPages.map(page => "Página " + page.pageNumber + ": " + (page.sectionPath || []).join(" › ")).join("\n")
    : "Todavía no hay una ruta temática anterior confirmada.";
  const details = pages.map(page =>
    "PÁGINA PDF " + page.pageNumber + "\n" + (page.compactText || "[Sin texto extraíble]")
  ).join("\n\n--------------------\n\n");

  return [
    "Analizá un fragmento de bibliografía académica para organizarlo en el corpus consultable de AULIA. Respondé solo JSON válido.",
    "CÁTEDRA: " + String(courseTitle || "No especificada"),
    "TANDA: " + batchNumber,
    "",
    "TAREA",
    "Para cada página, identificá el título de capítulo/sección y la ruta jerárquica más probable usando solo el texto suministrado. Conservá continuidad entre páginas: no crees una sección distinta en cada página si el capítulo continúa. Si una página comienza una sección nueva, detectalo. La estructura global puede ser jerárquica, pero no inventes títulos.",
    "El texto íntegro ya se conserva localmente en AULIA. El extracto adjunto es una muestra compacta para inferir estructura: NO lo transcribas, no lo resumas y no lo repitas en la salida.",
    "No se adjuntaron imágenes. No infieras la existencia ni el contenido de gráficos, imágenes o tablas que no estén expresados en el texto extraído. Si hay señales de extracción defectuosa, incertidumbre o una página sin contexto, marcá needsReview=true y explicá brevemente por qué.",
    "Usá sectionPath desde la jerarquía más general hasta la más específica. Reutilizá la ruta previa cuando el fragmento indica que la sección continúa. Si no hay evidencia, dejá sectionTitle vacío, sectionPath vacío, confidence bajo y needsReview=true.",
    "",
    continuity,
    "",
    "FORMATO EXACTO:",
    '{"pages":[{"pageNumber":1,"sectionTitle":"Título detectado o cadena vacía","sectionPath":["Capítulo","Sección"],"confidence":0.0,"needsReview":false,"reviewNotes":""}]}',
    "Devolvé exactamente una entrada por cada número de página listado, sin repetir ni omitir números. No agregues texto fuera del objeto JSON.",
    "",
    details,
  ].join("\n\n");
}

function parseWaitMs(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
  let milliseconds = 0;
  const minute = text.match(/([\d.]+)\s*m(?!s)/i);
  const second = text.match(/([\d.]+)\s*s/i);
  const millis = text.match(/([\d.]+)\s*ms/i);
  if (minute) milliseconds += Number(minute[1]) * 60000;
  if (second) milliseconds += Number(second[1]) * 1000;
  if (millis) milliseconds += Number(millis[1]);
  return milliseconds;
}

function waitFromMessage(message) {
  const match = String(message || "").match(/(?:try again in|retry after)\s+(\d+(?:\.\d+)?)\s*(ms|s|m)/i);
  if (!match) return 0;
  return Number(match[1]) * (match[2].toLowerCase() === "m" ? 60000 : match[2].toLowerCase() === "s" ? 1000 : 1);
}

function makeApiError(status, message, response, errorCode = "") {
  const text = String(message || "");
  const combined = (text + " " + errorCode).toLowerCase();
  const error = new Error("Groq no pudo analizar el texto (" + status + ")" + (text ? ": " + text : "."));
  error.status = status;
  error.isDailyLimit = /tokens per day|requests per day|daily limit|daily quota|per day \(t[dp]d\)|limit.*per day/.test(combined);
  const resetRequestsMs = parseWaitMs(response?.headers?.get("x-ratelimit-reset-requests"));
  const resetTokensMs = parseWaitMs(response?.headers?.get("x-ratelimit-reset-tokens"));
  error.retryAfterMs = error.isDailyLimit
    ? (resetRequestsMs || parseWaitMs(response?.headers?.get("retry-after")) || waitFromMessage(text))
    : (parseWaitMs(response?.headers?.get("retry-after")) || resetTokensMs || waitFromMessage(text));
  if (status === 401) error.message = "La clave de Groq no es válida. Revisá la clave docente en Studio.";
  if (status === 413) error.message = "La tanda de texto superó el tamaño admitido. AULIA conservó el avance; reanudá para continuar con tandas más pequeñas.";
  if (status === 429 && error.isDailyLimit) {
    error.message = "Groq alcanzó el límite diario de esta cuenta. AULIA conservó las tandas terminadas y la preparación del PDF; no vuelvas a intentar hasta que venza el bloqueo indicado.";
  } else if (status === 429) {
    error.message = "Groq alcanzó temporalmente el límite de solicitudes o tokens por minuto.";
  }
  return error;
}

async function requestBatch({ apiKey, courseTitle, pages, batchNumber, previousPages, signal, onRateWait = () => {}, processed = 0, total = 0 }) {
  const prompt = promptForBatch(courseTitle, pages, batchNumber, previousPages);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Sos un analista documental conservador. Respondé únicamente JSON válido y no inventes contenido." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        top_p: 0.8,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = makeApiError(response.status, data?.error?.message || data?.message || "", response, data?.error?.code || "");
      if (response.status === 429 && !error.isDailyLimit && attempt < 3) {
        lastError = error;
        const waitMs = Math.max(1000, Math.min(error.retryAfterMs || (4000 * (attempt + 1)), 60000));
        onRateWait({
          phase: "rate-wait",
          processed,
          total,
          model: MODEL,
          activePageNumbers: pages.map(page => Number(page.pageNumber)),
          message: "Límite temporal de Groq. Reintentando esta misma tanda en " + Math.ceil(waitMs / 1000) + " segundos; las páginas anteriores están guardadas.",
        });
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw error;
    }

    const choice = data?.choices?.[0] || {};
    const raw = String(choice?.message?.content || "").trim();
    if (!raw || choice?.finish_reason === "length") {
      const error = new Error("La respuesta JSON quedó vacía o truncada.");
      error.code = "AULIA_INVALID_BATCH";
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, ""));
    } catch {
      const error = new Error("Groq no devolvió JSON válido para esta tanda.");
      error.code = "AULIA_INVALID_BATCH";
      throw error;
    }
    if (!Array.isArray(parsed?.pages)) {
      const error = new Error("La respuesta no contiene la lista de páginas esperada.");
      error.code = "AULIA_INVALID_BATCH";
      throw error;
    }

    const expected = new Set(pages.map(page => Number(page.pageNumber)));
    const received = new Set();
    const normalized = [];
    for (const page of parsed.pages) {
      const number = Number(page?.pageNumber);
      if (!expected.has(number) || received.has(number)) {
        const error = new Error("Groq repitió o inventó números de página.");
        error.code = "AULIA_INVALID_BATCH";
        throw error;
      }
      received.add(number);
      normalized.push(normalisePage(page, number));
    }
    if (received.size !== expected.size) {
      const error = new Error("Groq omitió páginas de la tanda.");
      error.code = "AULIA_INVALID_BATCH";
      throw error;
    }

    return {
      pages: normalized,
      model: data?.model || MODEL,
      remainingTokens: Number(response.headers.get("x-ratelimit-remaining-tokens")),
      resetTokensMs: parseWaitMs(response.headers.get("x-ratelimit-reset-tokens")),
      usage: data?.usage || null,
    };
  }
  throw lastError || new Error("Groq no pudo completar la tanda.");
}

async function emitQuotaWait(onProgress, pageResults, total, activePageNumbers, model, waitMs, message) {
  onProgress({
    phase: "rate-wait",
    processed: Object.keys(pageResults).length,
    total,
    model,
    activePageNumbers,
    message: message || "Esperando la renovación de la ventana de cuota de Groq; el avance guardado se conserva.",
  });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, waitMs)));
}

export async function analyzePdfTextFirst(material, {
  apiKey,
  courseTitle = "",
  onProgress = () => {},
  signal,
} = {}) {
  if (!apiKey) throw new Error("Para analizar el PDF con Groq, configurá primero la clave personal en Studio.");
  const sourcePages = (material?.aiPages || []).slice().sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
  const textPages = sourcePages.filter(page => normaliseWhitespace(page.extractedText).length >= MIN_TEXT_CHARS);
  if (!textPages.length) {
    return { model: MODEL, pages: [], processed: 0, total: 0, skippedForVision: sourcePages.length };
  }

  const signature = hashString(sourcePages.map(page => [
    page.pageNumber,
    hashString(page.extractedText || ""),
  ].join("|")).join("::"));
  const cacheKey = CACHE_PREFIX + String(material?.document?.id || material?.sourceName || "pdf") + ":" + signature;
  const pageResults = await readCache(cacheKey, signature);
  const missing = textPages.filter(page => !pageResults[String(page.pageNumber)]);
  const batches = makeBatches(missing);
  let previousBudget = null;
  let batchIndex = 0;

  while (batches.length) {
    const batch = batches.shift();
    batchIndex += 1;
    const activePageNumbers = batch.map(page => Number(page.pageNumber));
    const estimate = Math.ceil(promptForBatch(courseTitle, batch, batchIndex, []).length / 3) + 500;

    if (previousBudget &&
        Number.isFinite(previousBudget.remainingTokens) &&
        previousBudget.remainingTokens >= 0 &&
        previousBudget.remainingTokens < estimate &&
        previousBudget.resetTokensMs > 0) {
      const waitMs = Math.min(previousBudget.resetTokensMs + 350, 65000);
      await emitQuotaWait(
        onProgress, pageResults, textPages.length, activePageNumbers, MODEL, waitMs,
        "Esperando que se liberen tokens por minuto de Groq. El avance está guardado y la siguiente tanda continuará automáticamente."
      );
    }

    onProgress({
      phase: "processing-batch",
      processed: Object.keys(pageResults).length,
      total: textPages.length,
      model: MODEL,
      activePageNumbers,
      message: "Analizando estructura a partir del texto extraído; no se envían imágenes en esta etapa.",
    });

    const previousPages = Object.values(pageResults)
      .filter(page => Number(page.pageNumber) < Math.min(...activePageNumbers))
      .sort((a, b) => Number(b.pageNumber) - Number(a.pageNumber))
      .slice(0, 6)
      .reverse();
    let result;
    try {
      result = await requestBatch({
        apiKey, courseTitle, pages: batch, batchNumber: batchIndex, previousPages, signal,
        processed: Object.keys(pageResults).length,
        total: textPages.length,
        onRateWait: progress => onProgress(progress),
      });
    } catch (error) {
      if (error?.code === "AULIA_INVALID_BATCH" && batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        batches.unshift(batch.slice(0, middle), batch.slice(middle));
        batchIndex -= 1;
        continue;
      }
      throw error;
    }

    for (const page of result.pages) pageResults[String(page.pageNumber)] = page;
    await saveCache(cacheKey, signature, pageResults);
    previousBudget = {
      remainingTokens: result.remainingTokens,
      resetTokensMs: result.resetTokensMs,
    };
    onProgress({
      phase: "processing",
      processed: Object.keys(pageResults).length,
      total: textPages.length,
      model: result.model || MODEL,
      pageNumbers: result.pages.map(page => page.pageNumber),
      message: "Tanda validada y guardada. El texto íntegro permanece en el corpus local.",
    });
  }

  const ordered = textPages.map(page => pageResults[String(page.pageNumber)]).filter(Boolean);
  if (ordered.length !== textPages.length) {
    throw new Error("El análisis textual no cubrió todas las páginas con texto extraíble. AULIA no incorporará un corpus incompleto.");
  }
  return {
    model: MODEL,
    pages: ordered,
    processed: ordered.length,
    total: textPages.length,
    skippedForVision: sourcePages.length - textPages.length,
  };
}
