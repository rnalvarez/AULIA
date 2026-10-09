const DEFAULT_MODELS = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"];
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const CACHE_PREFIX = "aulia:multimodal-ingestion:v1:";
const DIGITAL_BATCH_SIZE = 2;
const MAX_DIGITAL_OUTPUT_TOKENS = 2400;
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

function readCache(key, signature) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || parsed?.signature !== signature || !parsed?.pages) return {};
    return parsed.pages;
  } catch {
    return {};
  }
}

function saveCache(key, signature, pages) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      signature,
      updatedAt: new Date().toISOString(),
      pages,
    }));
  } catch {
    // Analysis must continue even when the browser's local storage quota is full.
  }
}

function pagePrompt(courseTitle, pages, batchNumber) {
  const details = pages.map(page => [
    "PÁGINA " + page.pageNumber,
    "TEXTO EXTRAÍDO AUTOMÁTICAMENTE (puede estar desordenado o incompleto):",
    cleanText(page.extractedText, 6000) || "[No se extrajo texto; la imagen requiere lectura/OCR]",
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
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after") || "";
      if (response.status === 401) error.message = "La API key de Groq no es válida. Revisá la clave docente en Studio.";
      if (response.status === 413) error.message = "La tanda de imágenes supera el tamaño admitido por Groq. Volvé a cargar el archivo para reintentar con el avance conservado.";
      if (response.status === 429) {
        error.message = "Groq alcanzó un límite temporal o de cuota durante el análisis multimodal. Se conservó el avance de las páginas terminadas; volvé a cargar el mismo PDF para reanudar cuando se restablezca el límite.";
      }
      throw error;
    }

    const choice = data?.choices?.[0] || {};
    const raw = String(choice?.message?.content || "").trim();
    if (!raw) throw new Error("Groq devolvió una respuesta vacía para las páginas " + pages.map(page => page.pageNumber).join(", ") + ".");
    if (choice?.finish_reason === "length") {
      throw new Error("La respuesta visual quedó truncada. El avance de las tandas anteriores se conservó; volvé a cargar el PDF para continuar.");
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
      throw new Error("La IA no analizó todas las páginas de la tanda. No se marcó el lote como completado; volvé a cargar el PDF para reintentar.");
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
  const pageResults = readCache(cacheKey, signature);
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

    const result = await requestBatch({
      apiKey,
      courseTitle,
      pages: batch,
      batchNumber: Math.floor(Object.keys(pageResults).length / DIGITAL_BATCH_SIZE) + 1,
      signal,
    });
    model = result.model || model;
    for (const page of result.pages) pageResults[String(page.pageNumber)] = page;
    saveCache(cacheKey, signature, pageResults);
    onProgress({
      processed: Object.keys(pageResults).length,
      total,
      model,
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
