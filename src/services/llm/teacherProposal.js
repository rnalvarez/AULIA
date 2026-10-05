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
        required: [
          "title",
          "director",
          "description",
          "conceptTitles",
          "sourceIds",
        ],
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

function compactText(value, max = 1500) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function buildMaterialContext(corpus, maxChars = 26000) {
  const groups = new Map();
  for (const chunk of corpus || []) {
    const key = String(chunk?.chapter || chunk?.title || "Material general").trim() || "Material general";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chunk);
  }

  const ordered = [];
  for (const [chapter, chunks] of groups) {
    for (const chunk of chunks.slice(0, 8)) {
      ordered.push({ chapter, chunk });
    }
  }

  const lines = [];
  let total = 0;
  let usedFragments = 0;

  for (const { chapter, chunk } of ordered) {
    const line = [
      "[ID:" + String(chunk.id || "") + "]",
      "UNIDAD: " + compactText(chapter, 160),
      "TÍTULO: " + compactText(chunk.title, 180),
      chunk.source ? "FUENTE: " + compactText(chunk.source, 120) : "",
      chunk.sourcePage ? "PÁGINA: " + chunk.sourcePage : "",
      "TEXTO: " + compactText(chunk.content, 1500),
    ].filter(Boolean).join(" | ");

    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
    usedFragments += 1;
  }

  return {
    text: lines.join("\n"),
    usedFragments,
    totalFragments: (corpus || []).length,
    truncated: usedFragments < (corpus || []).length,
  };
}

function buildPrompt({ course, bibliography, materialText, truncated }) {
  const refs = (bibliography || [])
    .slice(0, 20)
    .map((item) => [
      "[BIB-ID:" + String(item?.id || "") + "]",
      String(item?.title || ""),
      item?.author,
      item?.year
    ].filter(Boolean).join(" · "))
    .filter(Boolean)
    .join("\n");

  return [
    "Diseñá una primera propuesta pedagógica para una cátedra universitaria.",
    "Trabajá exclusivamente con el material incluido en este pedido. No inventes autores, obras, conceptos ni afirmaciones que no puedan sostenerse con el corpus.",
    "Tu tarea NO es resumir cada fragmento. Detectá una organización docente útil: conceptos centrales, unidades o capítulos a los que pertenecen, ejemplos/casos que el propio material permita relacionar y actividades de aprendizaje.",
    "Los sourceIds deben copiar EXACTAMENTE los IDs [ID:...] del material. No inventes IDs.",
    "La bibliografía declarada aparece identificada con [BIB-ID:...]. sourceBibliographyIds debe copiar EXACTAMENTE esos IDs y solo incluir fuentes que realmente sostengan el concepto.",
    "Cada concepto debe incluir confusionCriteria: entre 2 y 5 descripciones breves de errores, confusiones o comprensiones insuficientes que podrían indicar dificultad con ese concepto. Deben estar fundamentadas exclusivamente en la bibliografía y el corpus disponibles; no inventes criterios generales.",
    "Un concepto debe ser una idea enseñable y reutilizable, no una frase cualquiera del texto.",
    "La explicación debe ayudar al docente a revisar la propuesta, no reemplazar su criterio.",
    "Las actividades deben poder implementarse con alguno de los modos disponibles y usar la estrategia indicada.",
    "Priorizá calidad y relevancia. Proponé hasta 12 conceptos, 6 ejemplos y 6 actividades.",
    "Curso: " + String(course?.title || ""),
    "Descripción: " + String(course?.description || ""),
    refs ? "Bibliografía declarada:\n" + refs : "",
    truncated ? "ATENCIÓN: el corpus fue recortado para esta primera propuesta; trabajá con los fragmentos disponibles y no supongas contenido ausente." : "",
    "MATERIAL:",
    materialText,
  ].filter(Boolean).join("\n\n");
}

async function request(endpoint, apiKey, model, prompt, responseFormat, signal) {
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
            "Sos diseñador curricular y especialista en educación superior. Devolvé solamente el objeto estructurado solicitado.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 2600,
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
  return { proposal: parsed, model: data?.model || model };
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

  const context = buildMaterialContext(corpus);
  const prompt = buildPrompt({
    course,
    bibliography,
    materialText: context.text,
    truncated: context.truncated,
  });

  const orderedModels = Array.from(
    new Set((Array.isArray(models) && models.length ? models : DEFAULT_MODELS).filter(Boolean))
  );

  let lastError = null;
  for (const model of orderedModels) {
    try {
      const result = await request(
        endpoint,
        apiKey,
        model,
        prompt,
        responseFormatFor(model),
        signal
      );
      const proposal = result.proposal || {};
      if (
        !Array.isArray(proposal.concepts) ||
        !Array.isArray(proposal.examples) ||
        !Array.isArray(proposal.activities)
      ) {
        throw new Error("La propuesta de IA no tiene la estructura esperada.");
      }
      return {
        ...result,
        proposal,
        usedFragments: context.usedFragments,
        totalFragments: context.totalFragments,
        truncated: context.truncated,
      };
    } catch (error) {
      lastError = error;
      if (error?.status !== 404) throw error;
    }
  }

  throw lastError || new Error("Ningún modelo configurado está disponible.");
}
