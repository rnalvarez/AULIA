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

const MAX_CONTEXT_CHARS = 13000;
const MAX_OUTPUT_TOKENS = 1500;
const MAX_REPRESENTATIVE_UNITS = 36;

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

function compact(value, max) {
  const clean = String(value || "").replace(/\\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function logicalUnits(corpus) {
  const groups = new Map();

  for (const chunk of corpus || []) {
    const key = String(chunk?.unitId || chunk?.id || "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chunk);
  }

  return Array.from(groups.values()).map((parts) => {
    const ordered = parts.slice().sort((a, b) =>
      Number(a?.sourcePageStart || a?.sourcePage || 0) -
      Number(b?.sourcePageStart || b?.sourcePage || 0)
    );

    const first = ordered[0] || {};
    const last = ordered[ordered.length - 1] || first;
    const title = String(first.title || first.chapter || "Unidad").replace(/ · parte \\d+$/i, "");
    const content = String(first.content || "");
    const tailContent = ordered.length > 1
      ? String(last.content || "")
      : content;

    const representative = content.length > 500
      ? content.slice(0, 300) + " … " + tailContent.slice(Math.max(0, tailContent.length - 170))
      : content;

    return {
      id: String(first.unitId || first.id || ""),
      source: String(first.source || "Material general"),
      title,
      path: Array.isArray(first.sectionPath) && first.sectionPath.length
        ? first.sectionPath
        : (first.chapter ? [first.chapter] : [title]),
      pageStart: first.sourcePageStart || first.sourcePage || null,
      pageEnd: last.sourcePageEnd || last.sourcePage || first.sourcePageEnd || first.sourcePage || null,
      content: representative,
      ids: ordered.map((item) => item.id).filter(Boolean),
    };
  });
}

function selectRepresentatives(units, maxUnits = MAX_REPRESENTATIVE_UNITS) {
  if (units.length <= maxUnits) {
    return { units, sampled: false };
  }

  const bySource = new Map();
  for (const unit of units) {
    if (!bySource.has(unit.source)) bySource.set(unit.source, []);
    bySource.get(unit.source).push(unit);
  }

  const sources = Array.from(bySource.values());
  const selected = [];
  let round = 0;

  while (selected.length < maxUnits) {
    let added = false;
    for (const sourceUnits of sources) {
      if (round >= sourceUnits.length) continue;
      selected.push(sourceUnits[round]);
      added = true;
      if (selected.length >= maxUnits) break;
    }
    if (!added) break;
    round += 1;
  }

  return { units: selected, sampled: true };
}

function buildMaterialContext(corpus) {
  const units = logicalUnits(corpus);
  const selected = selectRepresentatives(units);

  const outlineSeen = new Set();
  const outline = [];
  for (const unit of units) {
    const path = unit.path.join(" › ");
    const key = unit.source + "::" + path;
    if (outlineSeen.has(key)) continue;
    outlineSeen.add(key);
    outline.push(
      "- " + compact(unit.source, 90) + " · " + compact(path, 180) +
      (unit.pageStart ? " · pp. " + unit.pageStart + (unit.pageEnd && unit.pageEnd !== unit.pageStart ? "-" + unit.pageEnd : "") : "")
    );
  }

  const header = [
    "MAPA DE DOCUMENTOS Y SECCIONES:",
    outline.join("\n"),
    "",
    "EXTRACTOS REPRESENTATIVOS:",
  ].join("\n");

  const lines = [];
  let total = header.length;

  for (const unit of selected.units) {
    const line = [
      "[ID:" + unit.ids.join(",") + "]",
      "FUENTE: " + compact(unit.source, 100),
      "SECCIÓN: " + compact(unit.path.join(" › "), 190),
      unit.pageStart ? "PÁGINAS: " + unit.pageStart + (unit.pageEnd && unit.pageEnd !== unit.pageStart ? "-" + unit.pageEnd : "") : "",
      "TEXTO: " + compact(unit.content, 500),
    ].filter(Boolean).join(" | ");

    if (total + line.length + 1 > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    total += line.length + 1;
  }

  return {
    text: header + "\n" + lines.join("\n"),
    selectedUnits: selected.units.length,
    totalUnits: units.length,
    sampled: selected.sampled || lines.length < selected.units.length,
  };
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

function buildPrompt({ course, bibliography, materialText, sampled }) {
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
    "Construí una primera propuesta pedagógica para una cátedra universitaria a partir de los materiales suministrados.",
    "La extracción y organización documental se hicieron localmente antes de esta consulta.",
    sampled
      ? "La biblioteca completa está disponible en AULIA, pero para esta consulta se usa una muestra representativa de unidades para respetar los límites de una cuenta gratuita. No infieras contenido que no aparezca en los extractos."
      : "El conjunto de unidades relevantes entra en esta consulta.",
    "NO resumas cada página. Detectá una organización docente útil: conceptos centrales, relaciones claras entre ideas, ejemplos/casos explícitos y actividades de aprendizaje.",
    "Un concepto debe ser una idea enseñable y reutilizable, no simplemente un título de sección.",
    "Trabajá exclusivamente con la evidencia suministrada. No inventes autores, obras, conceptos, ejemplos ni afirmaciones.",
    "Los sourceIds deben copiar EXACTAMENTE IDs que aparezcan en [ID:...].",
    "sourceBibliographyIds solo puede usar los [BIB-ID:...] declarados y debe corresponder a una fuente realmente relacionada.",
    "confusionCriteria debe describir entre 2 y 5 errores o confusiones plausibles y fundamentados por la evidencia.",
    "Priorizá precisión y utilidad docente. Proponé hasta 14 conceptos, 8 ejemplos y 6 actividades.",
    "Curso: " + String(course?.title || ""),
    "Descripción: " + String(course?.description || ""),
    refs ? "Bibliografía declarada:\n" + refs : "",
    "MATERIAL ESTRUCTURADO:\n" + materialText,
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
            "Sos diseñador curricular y especialista en educación superior. Devolvé únicamente el objeto estructurado solicitado y no agregues información ausente de la evidencia.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.15,
      top_p: 0.9,
      max_tokens: MAX_OUTPUT_TOKENS,
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
    proposal: parsed || {
      pedagogicalSummary: "",
      concepts: [],
      examples: [],
      activities: [],
    },
    model: data?.model || model,
    usage: data?.usage || null,
  };
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
        buildPrompt({
          course,
          bibliography,
          materialText: context.text,
          sampled: context.sampled,
        }),
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
        model: result.model || model,
        usedFragments: context.selectedUnits,
        totalFragments: context.totalUnits,
        truncated: context.sampled,
        partial: false,
        batches: 1,
        requestCount: 1,
        synthesisUsed: false,
        usage: result.usage || null,
        warning: "",
      };
    } catch (error) {
      lastError = error;
      if (error?.status !== 404) break;
    }
  }

  if (lastError?.status === 429) {
    throw new Error(
      "La cuenta gratuita de Groq alcanzó su límite de uso. AULIA no realizó reintentos automáticos para no consumir más cuota."
    );
  }

  throw lastError || new Error("Ningún modelo configurado está disponible.");
}
