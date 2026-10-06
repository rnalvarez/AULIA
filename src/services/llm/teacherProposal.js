const STRICT_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
]);

const DEFAULT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
];

const MAX_BATCH_CHARS = 15000;
const MAX_BATCH_REQUESTS = 16;
const MAX_OUTPUT_TOKENS = 1200;
const MAX_EXCERPT_CHARS = 850;

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    pedagogicalSummary: { type: "string" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          chapter: { type: "string" },
          summary: { type: "string" },
          explanation: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
          sourceIds: { type: "array", items: { type: "string" } },
          sourceBibliographyIds: { type: "array", items: { type: "string" } },
          confusionCriteria: { type: "array", items: { type: "string" } },
        },
        required: [
          "title",
          "chapter",
          "summary",
          "explanation",
          "aliases",
          "keywords",
          "sourceIds",
          "sourceBibliographyIds",
          "confusionCriteria",
        ],
        additionalProperties: false,
      },
    },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          director: { type: "string" },
          description: { type: "string" },
          conceptTitles: { type: "array", items: { type: "string" } },
          sourceIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "director", "description", "conceptTitles", "sourceIds"],
        additionalProperties: false,
      },
    },
    activities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          goal: { type: "string" },
          strategy: {
            type: "string",
            enum: [
              "retrieve",
              "scene-analysis",
              "socratic",
              "guided-analysis",
              "diagnostic",
            ],
          },
        },
        required: ["title", "description", "goal", "strategy"],
        additionalProperties: false,
      },
    },
  },
  required: ["pedagogicalSummary", "concepts", "examples", "activities"],
  additionalProperties: false,
};

function compactText(value, max = MAX_EXCERPT_CHARS) {
  const clean = String(value || "").replace(/\\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function sectionLabel(chunk) {
  if (Array.isArray(chunk?.sectionPath) && chunk.sectionPath.length) {
    return chunk.sectionPath.join(" › ");
  }
  return String(chunk?.chapter || chunk?.title || "Material general").trim();
}

function buildMaterialBatches(corpus, maxChars = MAX_BATCH_CHARS) {
  const batches = [];
  let current = [];
  let total = 0;

  for (const chunk of corpus || []) {
    const excerpt = compactText(chunk?.content, MAX_EXCERPT_CHARS);
    const line = [
      "[ID:" + String(chunk?.id || "") + "]",
      "UNIDAD: " + compactText(sectionLabel(chunk), 180),
      chunk?.source ? "FUENTE: " + compactText(chunk.source, 100) : "",
      chunk?.sourcePageStart
        ? "PÁGINAS: " + chunk.sourcePageStart + (chunk?.sourcePageEnd && chunk.sourcePageEnd !== chunk.sourcePageStart ? "-" + chunk.sourcePageEnd : "")
        : "",
      "TEXTO: " + excerpt,
    ].filter(Boolean).join(" | ");

    if (current.length && total + line.length + 1 > maxChars) {
      batches.push(current.join("\n"));
      current = [];
      total = 0;
    }

    current.push(line);
    total += line.length + 1;
  }

  if (current.length) batches.push(current.join("\n"));
  return batches;
}

function buildIndexBatches(corpus, maxChars = MAX_BATCH_CHARS) {
  // Use the structured corpus rather than raw pages. Every unit contributes a
  // short beginning and ending excerpt so a long section keeps its context
  // without consuming the whole Groq free-tier context budget.
  return buildMaterialBatches((corpus || []).map((chunk) => {
    const content = String(chunk?.content || "");
    const excerpt = content.length > MAX_EXCERPT_CHARS
      ? content.slice(0, Math.floor(MAX_EXCERPT_CHARS * 0.62)) +
        " … " +
        content.slice(Math.max(0, content.length - Math.floor(MAX_EXCERPT_CHARS * 0.30)))
      : content;

    return { ...chunk, content: excerpt };
  }), maxChars);
}

function responseFormatFor(model) {
  if (STRICT_MODELS.has(model)) {
    return {
      type: "json_schema",
      json_schema: {
        name: "aulia_pedagogical_proposal",
        strict: true,
        schema: PROPOSAL_SCHEMA,
      },
    };
  }
  return { type: "json_object" };
}

async function request(endpoint, apiKey, model, prompt, responseFormat, maxTokens, signal) {
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
          content:
            "Sos diseñador curricular y especialista en educación superior. Devolvé solamente el objeto estructurado solicitado. Trabajá con extrema fidelidad al material recibido.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.15,
      top_p: 0.9,
      max_tokens: maxTokens,
      reasoning_effort: "low",
      response_format: responseFormat,
      stream: false,
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || data?.message || "";
    const error = new Error(
      "Error " + response.status + (message ? ": " + message : ".")
    );
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after") || "";
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content || "";
  if (!content) throw new Error("El proveedor de IA devolvió una respuesta vacía.");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("La IA devolvió una propuesta que no pudo convertirse en JSON.");
  }

  return {
    proposal: parsed || {},
    model: data?.model || model,
    usage: data?.usage || null,
  };
}

function buildBatchPrompt({ course, bibliography, materialText, batchNumber, totalBatches }) {
  const refs = (bibliography || [])
    .slice(0, 20)
    .map((item) => [
      "[BIB-ID:" + String(item?.id || "") + "]",
      String(item?.title || ""),
      item?.author,
      item?.year,
    ].filter(Boolean).join(" · "))
    .filter(Boolean)
    .join("\n");

  return [
    "Analizá este lote de una bibliografía universitaria para construir una primera propuesta docente.",
    "Este es el lote " + batchNumber + " de " + totalBatches + ". Puede existir material relacionado en otros lotes.",
    "NO resumas cada fragmento. Detectá solamente conceptos enseñables, ejemplos explícitos o claramente identificables y actividades razonables que puedan sostenerse con este lote.",
    "No inventes autores, obras, conceptos ni afirmaciones. No completes información ausente.",
    "Los sourceIds deben copiar exactamente IDs [ID:...] que aparecen en este lote.",
    "sourceBibliographyIds solo puede usar los [BIB-ID:...] declarados.",
    "Los conceptos deben ser ideas reutilizables y relativamente estables, no títulos de páginas ni frases accidentales.",
    "confusionCriteria debe describir posibles confusiones observables y debe poder justificarse con el material recibido.",
    "Cuando una relación no esté suficientemente respaldada, dejala fuera.",
    "Priorizá precisión sobre cantidad. Máximo 8 conceptos, 4 ejemplos y 3 actividades en este lote.",
    "Curso: " + String(course?.title || ""),
    "Descripción: " + String(course?.description || ""),
    refs ? "Bibliografía declarada:\n" + refs : "",
    "MATERIAL DEL LOTE:\n" + materialText,
  ].filter(Boolean).join("\n\n");
}

function compactProposalCandidates(proposals) {
  const concepts = [];
  const examples = [];
  const activities = [];

  for (const proposal of proposals) {
    for (const item of proposal?.concepts || []) {
      concepts.push({
        title: compactText(item.title, 100),
        chapter: compactText(item.chapter, 150),
        summary: compactText(item.summary, 320),
        explanation: compactText(item.explanation, 180),
        aliases: (item.aliases || []).slice(0, 4),
        keywords: (item.keywords || []).slice(0, 6),
        sourceIds: (item.sourceIds || []).slice(0, 6),
        sourceBibliographyIds: (item.sourceBibliographyIds || []).slice(0, 6),
        confusionCriteria: (item.confusionCriteria || []).slice(0, 3),
      });
    }
    for (const item of proposal?.examples || []) {
      examples.push({
        title: compactText(item.title, 120),
        director: compactText(item.director, 80),
        description: compactText(item.description, 300),
        conceptTitles: (item.conceptTitles || []).slice(0, 6),
        sourceIds: (item.sourceIds || []).slice(0, 6),
      });
    }
    for (const item of proposal?.activities || []) {
      activities.push({
        title: compactText(item.title, 120),
        description: compactText(item.description, 280),
        goal: compactText(item.goal, 200),
        strategy: item.strategy || "retrieve",
      });
    }
  }

  return {
    concepts: concepts.slice(0, 28),
    examples: examples.slice(0, 12),
    activities: activities.slice(0, 10),
  };
}

function buildSynthesisPrompt({ course, candidates, bibliography }) {
  const refs = (bibliography || [])
    .slice(0, 20)
    .map((item) => [
      "[BIB-ID:" + String(item?.id || "") + "]",
      String(item?.title || ""),
      item?.author,
      item?.year,
    ].filter(Boolean).join(" · "))
    .filter(Boolean)
    .join("\n");

  return [
    "Construí una propuesta pedagógica consolidada a partir de candidatos extraídos de la bibliografía de una cátedra universitaria.",
    "Los candidatos provienen de lotes diferentes del mismo corpus. Tu tarea es eliminar duplicados, unir formulaciones equivalentes, priorizar conceptos centrales y conservar solo afirmaciones respaldadas por los candidatos.",
    "NO agregues conceptos nuevos. NO inventes relaciones. Solo podés conservar, combinar o descartar candidatos.",
    "Conservá sourceIds y sourceBibliographyIds únicamente cuando pertenezcan a los candidatos correspondientes.",
    "Priorizá hasta 14 conceptos, 8 ejemplos y 6 actividades.",
    "La pedagogicalSummary debe explicar en pocas líneas cómo queda organizada la propuesta, sin inventar contenido.",
    "Curso: " + String(course?.title || ""),
    refs ? "Bibliografía declarada:\n" + refs : "",
    "CANDIDATOS:\n" + JSON.stringify(candidates),
  ].filter(Boolean).join("\n\n");
}

function emptyProposal() {
  return {
    pedagogicalSummary: "",
    concepts: [],
    examples: [],
    activities: [],
  };
}

function mergeCandidateProposals(proposals) {
  const result = emptyProposal();
  const seenConcepts = new Map();
  const seenExamples = new Map();
  const seenActivities = new Map();

  for (const proposal of proposals) {
    if (!result.pedagogicalSummary && proposal?.pedagogicalSummary) {
      result.pedagogicalSummary = proposal.pedagogicalSummary;
    }

    for (const item of proposal?.concepts || []) {
      const key = String(item?.title || "").toLowerCase().trim();
      if (!key) continue;
      const existing = seenConcepts.get(key);
      if (!existing) {
        seenConcepts.set(key, item);
        result.concepts.push(item);
      } else {
        existing.sourceIds = Array.from(new Set([...(existing.sourceIds || []), ...(item.sourceIds || [])])).slice(0, 8);
        existing.sourceBibliographyIds = Array.from(new Set([
          ...(existing.sourceBibliographyIds || []),
          ...(item.sourceBibliographyIds || []),
        ])).slice(0, 8);
      }
    }

    for (const item of proposal?.examples || []) {
      const key = String(item?.title || "").toLowerCase().trim();
      if (!key || seenExamples.has(key)) continue;
      seenExamples.set(key, item);
      result.examples.push(item);
    }

    for (const item of proposal?.activities || []) {
      const key = String(item?.title || "").toLowerCase().trim();
      if (!key || seenActivities.has(key)) continue;
      seenActivities.set(key, item);
      result.activities.push(item);
    }
  }

  return result;
}

export async function requestTeacherProposal({
  apiKey,
  course,
  corpus = [],
  bibliography = [],
  endpoint = "https://api.groq.com/openai/v1/chat/completions",
  models = DEFAULT_MODELS,
  signal,
}) {
  if (!apiKey) throw new Error("Falta la API key de IA docente.");
  if (!endpoint) throw new Error("No hay un endpoint de IA configurado.");
  if (!corpus.length) throw new Error("Primero cargá material.");

  const batches = buildIndexBatches(corpus);
  if (!batches.length) throw new Error("El material no contiene unidades analizables.");

  const selectedBatches = batches.slice(0, MAX_BATCH_REQUESTS);
  const truncated = selectedBatches.length < batches.length;
  const orderedModels = Array.from(
    new Set((Array.isArray(models) && models.length ? models : DEFAULT_MODELS).filter(Boolean))
  );

  const proposals = [];
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let requestCount = 0;
  let lastError = null;

  for (let index = 0; index < selectedBatches.length; index += 1) {
    const prompt = buildBatchPrompt({
      course,
      bibliography,
      materialText: selectedBatches[index],
      batchNumber: index + 1,
      totalBatches: selectedBatches.length,
    });

    let batchResult = null;

    for (const model of orderedModels) {
      try {
        batchResult = await request(
          endpoint,
          apiKey,
          model,
          prompt,
          responseFormatFor(model),
          MAX_OUTPUT_TOKENS,
          signal
        );
        requestCount += 1;
        break;
      } catch (error) {
        lastError = error;
        if (error?.status !== 404) break;
      }
    }

    if (!batchResult) {
      if (proposals.length) break;
      throw lastError || new Error("Ningún modelo configurado está disponible.");
    }

    proposals.push(batchResult.proposal || emptyProposal());
    if (batchResult.usage) {
      totalUsage.prompt_tokens += Number(batchResult.usage.prompt_tokens || 0);
      totalUsage.completion_tokens += Number(batchResult.usage.completion_tokens || 0);
      totalUsage.total_tokens += Number(batchResult.usage.total_tokens || 0);
    }

    if (lastError?.status === 429) break;
  }

  if (!proposals.length) {
    throw new Error(
      lastError?.status === 429
        ? "La cuenta de Groq alcanzó su límite gratuito. No se pudo generar la propuesta."
        : (lastError || new Error("No se pudo analizar el material."))
    );
  }

  let proposal = mergeCandidateProposals(proposals);
  let synthesisUsed = false;

  // One small consolidation call is far cheaper than sending the original
  // corpus again, and it makes concepts from different files cohere.
  if (proposals.length > 1 && proposal.concepts.length) {
    const candidates = compactProposalCandidates(proposals);
    const synthesisPrompt = buildSynthesisPrompt({
      course,
      candidates,
      bibliography,
    });

    for (const model of orderedModels) {
      try {
        const synthesized = await request(
          endpoint,
          apiKey,
          model,
          synthesisPrompt,
          responseFormatFor(model),
          MAX_OUTPUT_TOKENS,
          signal
        );
        requestCount += 1;
        const next = synthesized.proposal || emptyProposal();
        if (Array.isArray(next.concepts) || Array.isArray(next.examples) || Array.isArray(next.activities)) {
          proposal = {
            pedagogicalSummary: next.pedagogicalSummary || proposal.pedagogicalSummary,
            concepts: Array.isArray(next.concepts) ? next.concepts : proposal.concepts,
            examples: Array.isArray(next.examples) ? next.examples : proposal.examples,
            activities: Array.isArray(next.activities) ? next.activities : proposal.activities,
          };
          synthesisUsed = true;
        }
        if (synthesized.usage) {
          totalUsage.prompt_tokens += Number(synthesized.usage.prompt_tokens || 0);
          totalUsage.completion_tokens += Number(synthesized.usage.completion_tokens || 0);
          totalUsage.total_tokens += Number(synthesized.usage.total_tokens || 0);
        }
        break;
      } catch (error) {
        lastError = error;
        if (error?.status !== 404) break;
      }
    }
  }

  return {
    proposal,
    model: orderedModels[0],
    usedFragments: truncated ? Math.min(corpus.length, corpus.length) : corpus.length,
    totalFragments: corpus.length,
    truncated,
    partial: proposals.length < batches.length,
    batches: selectedBatches.length,
    requestCount,
    synthesisUsed,
    usage: totalUsage,
    warning: lastError?.status === 429
      ? "Se alcanzó un límite de Groq durante el análisis. Se conservaron las propuestas ya obtenidas."
      : "",
  };
}
