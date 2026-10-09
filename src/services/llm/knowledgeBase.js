import { KNOWLEDGE_BASE_VERSION, knowledgeCorpusSignature, isKnowledgeBaseCurrent } from "../../core/knowledgeBase.js";

const DEFAULT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
];
const STRICT_MODELS = new Set(DEFAULT_MODELS);
const MAX_PASSAGE_CHARS = 1700;
const PASSAGE_OVERLAP_CHARS = 150;
const MAX_BATCH_CHARS = 4600;
const MAX_ENTRIES_PER_BATCH = 6;
const MAX_OUTPUT_TOKENS = 1200;
const INTER_BATCH_WAIT_MS = 30000;

const INDEX_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      maxItems: MAX_ENTRIES_PER_BATCH,
      items: {
        type: "object",
        properties: {
          term: { type: "string", maxLength: 120 },
          aliases: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
          category: { type: "string", maxLength: 80 },
          definition: { type: "string", maxLength: 650 },
          explanation: { type: "string", maxLength: 1000 },
          distinctions: { type: "array", maxItems: 4, items: { type: "string", maxLength: 260 } },
          relatedTerms: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 } },
          examples: { type: "array", maxItems: 4, items: { type: "string", maxLength: 260 } },
          evidence: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                passageId: { type: "string", maxLength: 180 },
                excerpt: { type: "string", maxLength: 260 },
              },
              required: ["passageId", "excerpt"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "term", "aliases", "category", "definition", "explanation",
          "distinctions", "relatedTerms", "examples", "evidence"
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

function cleanText(value, max = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalizeText(value).replace(/\s+/g, "-").slice(0, 100);
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function findBoundary(text, start, proposedEnd) {
  const minimum = start + Math.floor((proposedEnd - start) * 0.68);
  const window = text.slice(minimum, proposedEnd);
  const newline = window.lastIndexOf("\n");
  const sentences = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf("; ")
  );
  const boundary = Math.max(newline, sentences);
  return boundary >= 0 ? minimum + boundary + 1 : proposedEnd;
}

export function buildKnowledgePassages(corpus = []) {
  const passages = [];
  for (const [sourceIndex, item] of (Array.isArray(corpus) ? corpus : []).entries()) {
    if ((item?.scope || "included") === "excluded") continue;
    const text = String(item?.content || item?.explanation || item?.summary || "").trim();
    if (!text) continue;

    const sourceId = String(item?.id || "fragmento-" + (sourceIndex + 1));
    const sourceName = String(item?.source || item?.sourceName || item?.documentTitle || "Bibliografía de la cátedra");
    const sectionPath = Array.isArray(item?.sectionPath)
      ? item.sectionPath.filter(Boolean).map(value => String(value))
      : String(item?.chapter || item?.title || "").split(" › ").filter(Boolean);
    let start = 0;
    let part = 1;

    while (start < text.length) {
      let end = Math.min(start + MAX_PASSAGE_CHARS, text.length);
      if (end < text.length) end = findBoundary(text, start, end);
      if (end <= start) end = Math.min(start + MAX_PASSAGE_CHARS, text.length);
      const passageText = text.slice(start, end).trim();

      if (passageText) {
        passages.push({
          passageId: sourceId + "::kb-" + part,
          sourceId,
          sourceName,
          title: String(item?.title || item?.chapter || sourceName),
          sectionPath,
          pageStart: item?.sourcePageStart || item?.sourcePage || null,
          pageEnd: item?.sourcePageEnd || item?.sourcePageStart || item?.sourcePage || null,
          printedPageStart: item?.printedPageStart || null,
          printedPageEnd: item?.printedPageEnd || null,
          scope: item?.scope || "included",
          priority: item?.priority || "normal",
          text: passageText,
        });
      }

      if (end >= text.length) break;
      start = Math.max(start + 1, end - PASSAGE_OVERLAP_CHARS);
      part += 1;
    }
  }
  return passages;
}

function makeBatches(passages) {
  const batches = [];
  let current = [];
  let charCount = 0;
  for (const passage of passages) {
    const formattedLength = passage.text.length + passage.title.length +
      passage.sourceName.length + passage.sectionPath.join(" › ").length + 180;
    if (current.length && charCount + formattedLength > MAX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      charCount = 0;
    }
    current.push(passage);
    charCount += formattedLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

function buildIndexPrompt(course, batch, batchNumber, totalBatches) {
  const material = batch.map(passage => [
    "[PASSAGE_ID:" + passage.passageId + "]",
    "FUENTE: " + cleanText(passage.sourceName, 140),
    "SECCIÓN: " + cleanText(passage.sectionPath.join(" › ") || passage.title, 220),
    passage.pageStart ? "PÁGINAS IMPRESAS: " + passage.pageStart +
      (passage.pageEnd && passage.pageEnd !== passage.pageStart ? "-" + passage.pageEnd : "") : "",
    "TEXTO ORIGINAL:",
    passage.text,
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  return [
    "Construí un índice conceptual exhaustivo de los pasajes proporcionados para un asistente universitario que debe responder preguntas sobre esta bibliografía.",
    "Cátedra: " + cleanText(course?.title || "", 150),
    "Lote " + batchNumber + " de " + totalBatches + ". Cada pasaje tiene un PASSAGE_ID único.",
    "No estás diseñando el programa de la materia. Estás registrando el conocimiento que realmente aparece en el texto.",
    "Identificá los conceptos técnicos, términos definidos, categorías, distinciones, principios, métodos, argumentos, fenómenos, relaciones entre ideas y ejemplos relevantes que estén sustentados por estos pasajes. No te limites a los nombres que el docente ya haya cargado.",
    "Incluí también conceptos secundarios o términos que aparezcan explicados sin una definición formal. Si un pasaje contiene varias ideas diferentes, creá una entrada por idea siempre que sean claramente distinguibles. No fuerces una entrada para frases triviales.",
    "Para cada entrada, expresá una definición fiel al texto cuando exista y una explicación que preserve los matices y el contexto del autor. Registrá sinónimos y variantes terminológicas en aliases; diferencias importantes en distinctions; términos relacionados en relatedTerms; ejemplos del texto en examples.",
    "No completes lagunas con conocimientos externos. No transformes una interpretación tuya en una afirmación explícita del autor. Si el pasaje sugiere una relación pero no la afirma, describila con cautela en explanation.",
    "Cada entrada DEBE citar uno o más pasajes de esta tanda mediante passageId. excerpt debe copiar literalmente una secuencia breve de TEXTO ORIGINAL. Nunca inventes IDs ni cites material de otro lote.",
    "Si un mismo término tiene sentidos diferentes según el contexto, conservá las diferencias en lugar de fusionarlas artificialmente.",
    "Devolvé hasta " + MAX_ENTRIES_PER_BATCH + " entradas sustantivas por lote. Priorizá cubrir todas las ideas específicas desarrolladas en estos textos, no repetir el mismo concepto con redacciones distintas.",
    "MATERIAL DE LA BIBLIOGRAFÍA:",
    material,
  ].join("\n\n");
}

function responseFormatFor(model) {
  return STRICT_MODELS.has(model)
    ? {
        type: "json_schema",
        json_schema: {
          name: "aulia_knowledge_index",
          strict: true,
          schema: INDEX_SCHEMA,
        },
      }
    : { type: "json_object" };
}

async function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestIndexBatch({ apiKey, endpoint, models, course, batch, batchNumber, totalBatches, signal }) {
  const prompt = buildIndexPrompt(course, batch, batchNumber, totalBatches);
  let lastError = null;
  for (const model of models) {
    const response = await fetch(endpoint, {
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
            content: "Sos un documentalista académico riguroso. Indexás conceptos únicamente a partir de los pasajes originales proporcionados. Tu salida debe ser JSON válido y cada entrada debe tener evidencia verificable.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: "low",
        response_format: responseFormatFor(model),
        stream: false,
      }),
      signal,
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 404) {
      lastError = new Error("El modelo " + model + " no está disponible.");
      continue;
    }
    if (!response.ok) {
      const message = data?.error?.message || data?.message || "";
      const error = new Error("Error " + response.status + (message ? ": " + message : "."));
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after") || "";
      if (response.status === 401) error.message = "La API key de Groq no es válida. Revisá la clave docente en Studio.";
      if (response.status === 429 || response.status === 413) {
        error.message = "Groq limitó el análisis por volumen o frecuencia de tokens. El avance ya quedó guardado en el borrador; esperá a que se restablezca el límite y volvé a ejecutar para continuar desde el último lote. Detalle: " + message;
      }
      throw error;
    }

    const choice = data?.choices?.[0] || {};
    const content = choice?.message?.content || "";
    if (!content) throw new Error("Groq devolvió una respuesta vacía al indexar el lote " + batchNumber + ".");
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new Error("El lote " + batchNumber + " no devolvió JSON válido. El avance anterior se conservó."); }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return { model: data?.model || model, entries, usage: data?.usage || null };
  }
  throw lastError || new Error("Ningún modelo configurado está disponible para el índice conceptual.");
}

function actualExcerpt(passage, candidate, term, aliases) {
  const quote = String(candidate || "").trim();
  const normalizedPassage = normalizeText(passage.text);
  const normalizedQuote = normalizeText(quote);
  if (normalizedQuote.length >= 32 && normalizedPassage.includes(normalizedQuote)) {
    const directIndex = passage.text.toLowerCase().indexOf(quote.toLowerCase());
    if (directIndex >= 0) return cleanText(passage.text.slice(directIndex, directIndex + 250), 250);
    return cleanText(quote, 250);
  }

  const terms = [term, ...(aliases || [])].filter(Boolean).sort((a, b) => String(b).length - String(a).length);
  for (const value of terms) {
    const needle = String(value || "").trim();
    if (needle.length < 4) continue;
    const index = passage.text.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) {
      const from = Math.max(0, index - 85);
      return cleanText(passage.text.slice(from, from + 250), 250);
    }
  }

  // Keep the full passage reference even when a model paraphrases an implicit concept.
  return cleanText(passage.text, 250);
}

function uniqueStrings(values, max, itemMax = 220) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value, itemMax);
    const key = normalizeText(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

function validateEntries(rawEntries, batch) {
  const passageMap = new Map(batch.map(passage => [passage.passageId, passage]));
  const result = [];
  for (const raw of rawEntries || []) {
    const term = cleanText(raw?.term, 120);
    if (!term) continue;
    const aliases = uniqueStrings(raw.aliases, 8, 100).filter(value => normalizeText(value) !== normalizeText(term));
    const evidence = [];
    for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) {
      const passage = passageMap.get(String(item?.passageId || ""));
      if (!passage) continue;
      const excerpt = actualExcerpt(passage, item?.excerpt, term, aliases);
      const key = passage.passageId + "::" + normalizeText(excerpt);
      if (evidence.some(ref => ref._key === key)) continue;
      evidence.push({
        passageId: passage.passageId,
        sourceId: passage.sourceId,
        sourceName: passage.sourceName,
        title: passage.title,
        sectionPath: passage.sectionPath,
        pageStart: passage.pageStart,
        pageEnd: passage.pageEnd,
        printedPageStart: passage.printedPageStart,
        printedPageEnd: passage.printedPageEnd,
        excerpt,
        _key: key,
      });
    }
    if (!evidence.length) continue;

    result.push({
      id: "kb-" + hashString(slug(term)),
      term,
      aliases,
      category: cleanText(raw.category, 80),
      definition: cleanText(raw.definition, 650),
      explanation: cleanText(raw.explanation, 1000),
      distinctions: uniqueStrings(raw.distinctions, 4, 260),
      relatedTerms: uniqueStrings(raw.relatedTerms, 8, 120),
      examples: uniqueStrings(raw.examples, 4, 260),
      evidence: evidence.slice(0, 6).map(({ _key, ...ref }) => ref),
    });
  }
  return result;
}

function mergeEntry(target, incoming) {
  const evidence = [...(target.evidence || []), ...(incoming.evidence || [])];
  const evidenceMap = new Map();
  for (const item of evidence) {
    const key = String(item.sourceId || "") + "::" + String(item.passageId || "");
    if (!evidenceMap.has(key)) evidenceMap.set(key, item);
  }
  const chooseText = (first, second, max) => {
    const a = cleanText(first, max);
    const b = cleanText(second, max);
    return b.length > a.length ? b : a;
  };
  return {
    ...target,
    aliases: uniqueStrings([...(target.aliases || []), ...(incoming.aliases || [])], 12, 100),
    category: target.category || incoming.category,
    definition: chooseText(target.definition, incoming.definition, 650),
    explanation: chooseText(target.explanation, incoming.explanation, 1000),
    distinctions: uniqueStrings([...(target.distinctions || []), ...(incoming.distinctions || [])], 8, 260),
    relatedTerms: uniqueStrings([...(target.relatedTerms || []), ...(incoming.relatedTerms || [])], 12, 120),
    examples: uniqueStrings([...(target.examples || []), ...(incoming.examples || [])], 8, 260),
    evidence: Array.from(evidenceMap.values()).slice(0, 10),
  };
}

function mergeEntries(existing, incoming) {
  const entries = (existing || []).map(item => ({ ...item }));
  const byName = new Map();
  for (const item of entries) {
    for (const value of [item.term, ...(item.aliases || [])]) {
      const key = normalizeText(value);
      if (key && !byName.has(key)) byName.set(key, item.id);
    }
  }

  for (const entry of incoming || []) {
    const keys = [entry.term, ...(entry.aliases || [])].map(normalizeText).filter(Boolean);
    const existingId = keys.map(key => byName.get(key)).find(Boolean);
    const index = existingId ? entries.findIndex(item => item.id === existingId) : -1;
    if (index >= 0) {
      entries[index] = mergeEntry(entries[index], entry);
      for (const value of [entries[index].term, ...(entries[index].aliases || [])]) {
        const key = normalizeText(value);
        if (key) byName.set(key, entries[index].id);
      }
    } else {
      entries.push(entry);
      for (const value of [entry.term, ...(entry.aliases || [])]) {
        const key = normalizeText(value);
        if (key) byName.set(key, entry.id);
      }
    }
  }
  return entries;
}

function makeIndex({ sourceSignature, totalPassages, processedPassageIds, entries, status, requestCount }) {
  return {
    version: KNOWLEDGE_BASE_VERSION,
    sourceSignature,
    status,
    totalPassages,
    processedPassageIds: Array.from(new Set(processedPassageIds)),
    entries,
    requestCount: Number(requestCount || 0),
    updatedAt: new Date().toISOString(),
  };
}

export async function buildKnowledgeBase({
  apiKey,
  course,
  corpus = [],
  endpoint = "https://api.groq.com/openai/v1/chat/completions",
  models = DEFAULT_MODELS,
  existingIndex = null,
  onProgress = () => {},
  signal,
}) {
  if (!apiKey) throw new Error("Configurá tu API key propia de Groq en Studio antes de analizar la bibliografía.");
  if (!endpoint) throw new Error("No hay un endpoint de Groq configurado.");
  const passages = buildKnowledgePassages(corpus);
  if (!passages.length) throw new Error("No hay pasajes activos para indexar. Revisá el material y el alcance de sus secciones.");

  const sourceSignature = knowledgeCorpusSignature(corpus);
  const current = existingIndex && existingIndex.sourceSignature === sourceSignature &&
    existingIndex.version === KNOWLEDGE_BASE_VERSION ? existingIndex : null;

  if (current && isKnowledgeBaseCurrent({ corpus, knowledgeBase: current })) {
    return { ...current, cached: true, requestCount: 0 };
  }

  const batches = makeBatches(passages);
  const passageIds = passages.map(item => item.passageId);
  const processed = new Set(
    current && Array.isArray(current.processedPassageIds) ? current.processedPassageIds.filter(id => passageIds.includes(id)) : []
  );
  let entries = current && Array.isArray(current.entries) ? current.entries : [];
  let requestCount = Number(current?.requestCount || 0);
  let model = current?.model || "";

  let progressIndex = makeIndex({
    sourceSignature,
    totalPassages: passages.length,
    processedPassageIds: Array.from(processed),
    entries,
    status: "processing",
    requestCount,
  });
  onProgress({ index: progressIndex, processed: processed.size, total: passages.length, entries: entries.length, requests: requestCount, model });

  const orderedModels = Array.from(new Set((Array.isArray(models) && models.length ? models : DEFAULT_MODELS).filter(Boolean)));
  let lastRequestAt = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    if (batch.every(passage => processed.has(passage.passageId))) continue;

    // The free plan is rate-limited by tokens per minute. Space requests so an
    // uninterrupted indexing run does not send a burst of large batches.
    const elapsed = Date.now() - lastRequestAt;
    if (lastRequestAt && elapsed < INTER_BATCH_WAIT_MS) {
      await wait(INTER_BATCH_WAIT_MS - elapsed);
    }

    try {
      const result = await requestIndexBatch({
        apiKey,
        endpoint,
        models: orderedModels,
        course,
        batch,
        batchNumber: i + 1,
        totalBatches: batches.length,
        signal,
      });
      model = result.model || model;
      requestCount += 1;
      const validated = validateEntries(result.entries, batch);
      entries = mergeEntries(entries, validated);
      batch.forEach(passage => processed.add(passage.passageId));
      lastRequestAt = Date.now();

      progressIndex = makeIndex({
        sourceSignature,
        totalPassages: passages.length,
        processedPassageIds: Array.from(processed),
        entries,
        status: "processing",
        requestCount,
      });
      progressIndex.model = model;
      onProgress({ index: progressIndex, processed: processed.size, total: passages.length, entries: entries.length, requests: requestCount, model });
    } catch (error) {
      progressIndex = makeIndex({
        sourceSignature,
        totalPassages: passages.length,
        processedPassageIds: Array.from(processed),
        entries,
        status: "partial",
        requestCount,
      });
      progressIndex.model = model;
      onProgress({ index: progressIndex, processed: processed.size, total: passages.length, entries: entries.length, requests: requestCount, model, error: error.message });
      throw error;
    }
  }

  const finalIndex = makeIndex({
    sourceSignature,
    totalPassages: passages.length,
    processedPassageIds: passageIds,
    entries,
    status: "complete",
    requestCount,
  });
  finalIndex.model = model;
  onProgress({ index: finalIndex, processed: passages.length, total: passages.length, entries: entries.length, requests: requestCount, model, complete: true });
  return finalIndex;
}
