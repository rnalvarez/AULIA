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

// Keep the teacher review comfortably inside Groq's current free-plan token
// budget. The complete book never goes to the model: AULIA sends a compact
// structural dossier plus short excerpts from representative sections.
const MAX_CONTEXT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 1800;
const MAX_REPRESENTATIVE_UNITS = 24;

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    pedagogicalSummary: { type: "string" },
    pedagogicalUnits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          learningGoal: { type: "string" },
          phase: { type: "string" },
          sequence: { type: "integer" },
          prerequisiteTitles: { type: "array", items: { type: "string" } },
          conceptTitles: { type: "array", items: { type: "string" } },
          sourceIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "rationale", "learningGoal", "phase", "sequence", "prerequisiteTitles", "conceptTitles", "sourceIds"],
        additionalProperties: false,
      },
    },
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
  },
  required: ["pedagogicalSummary", "pedagogicalUnits", "concepts"],
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

    const middleSource = ordered.length > 2
      ? String(ordered[Math.floor(ordered.length / 2)]?.content || "")
      : content;
    const representative = content.length > 520
      ? content.slice(0, 220) +
        " … " +
        middleSource.slice(Math.max(0, Math.floor((middleSource.length - 150) / 2)), Math.floor((middleSource.length + 150) / 2)) +
        " … " +
        tailContent.slice(Math.max(0, tailContent.length - 180))
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
  let outlineChars = 0;
  for (const unit of units) {
    const path = unit.path.join(" › ");
    const key = unit.source + "::" + path;
    if (outlineSeen.has(key)) continue;
    const line =
      "- " + compact(unit.source, 80) + " · " + compact(path, 150) +
      (unit.pageStart ? " · pp. " + unit.pageStart + (unit.pageEnd && unit.pageEnd !== unit.pageStart ? "-" + unit.pageEnd : "") : "");
    if (outlineChars + line.length + 1 > 5000) break;
    outlineSeen.add(key);
    outline.push(line);
    outlineChars += line.length + 1;
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
      unit.ids.map((id) => "[ID:" + id + "]").join(" "),
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
    "NO resumas cada página y NO conviertas cada fragmento técnico en una unidad pedagógica. Las secciones entregadas ya representan la estructura documental detectada por AULIA.",
    "Primero diseñá un mapa pedagógico de 8 a 12 unidades conceptuales coherentes, cuando la evidencia lo permita. Cada unidad debe agrupar varias secciones o un núcleo de contenido que pueda enseñarse como un bloque. No uses como nombre simplemente 'página X', 'parte 1' o el título mecánico de un fragmento.",
    "Para cada unidad explicá brevemente por qué conviene agrupar ese material y qué debería comprender o poder hacer el estudiante. Una unidad puede reunir varias secciones de un mismo documento.",
    "Después identificá solo los conceptos centrales que sean necesarios para recuperar y trabajar el material. No generes ejemplos ni actividades en esta pasada: los dejaremos para una etapa posterior y así evitamos gastar la cuota de Groq en una salida excesivamente grande.",
    "Además construí un mapa curricular: sequence único empezando en 1, phase breve y prerequisiteTitles solo con títulos EXACTOS de otras unidades de esta misma propuesta. No inventes dependencias ni generes ciclos.",
    "Trabajá exclusivamente con la evidencia suministrada. No inventes autores, obras, conceptos ni afirmaciones.",
    "Los sourceIds deben copiar EXACTAMENTE IDs que aparezcan en [ID:...].",
    "sourceBibliographyIds solo puede usar los [BIB-ID:...] declarados y debe corresponder a una fuente realmente relacionada.",
    "confusionCriteria debe describir errores o confusiones plausibles y fundamentados por la evidencia.",
    "Priorizá precisión sobre cantidad. Proponé 8 a 12 unidades y 6 a 10 conceptos cuando el material lo permita. Si la evidencia no alcanza, proponé menos antes que inventar.",
    "Curso: " + String(course?.title || ""),
    "Descripción: " + String(course?.description || ""),
    refs ? "Bibliografía declarada:\n" + refs : "",
    "MATERIAL ESTRUCTURADO:\n" + materialText,
  ].filter(Boolean).join("\n\n");
}

function simpleHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value || "").length; i += 1) {
    hash ^= String(value)[i].charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function analysisCacheKey(course, corpus, bibliography) {
  const materialSignature = (corpus || []).map((item) => [
    item?.id,
    item?.documentId,
    item?.sourcePageStart,
    item?.sourcePageEnd,
    item?.title,
    item?.content,
  ]);
  const bibliographySignature = (bibliography || []).map((item) => [
    item?.id,
    item?.title,
    item?.author,
    item?.year,
  ]);
  return "aulia:teacher-analysis:" + String(course?.id || "course") + ":" +
    simpleHash(JSON.stringify({ materialSignature, bibliographySignature }));
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

  const choice = data?.choices?.[0] || {};
  const content = choice?.message?.content || "";
  if (!content) throw new Error("El proveedor de IA devolvió una respuesta vacía.");

  if (choice?.finish_reason === "length") {
    throw new Error("Groq alcanzó el límite de salida de esta revisión antes de completar la propuesta. AULIA ya limita la entrada y la cantidad de campos para evitar este problema.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("La IA devolvió una propuesta que no pudo convertirse en JSON.");
  }

  return {
    proposal: parsed || {
      pedagogicalSummary: "",
      pedagogicalUnits: [],
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

  const cacheKey = analysisCacheKey(course, corpus, bibliography);
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.proposal) {
        return {
          ...parsed,
          cached: true,
          requestCount: 0,
          warning: "Se reutilizó la revisión de esta bibliografía guardada en esta sesión.",
        };
      }
    }
  } catch {}

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
        !Array.isArray(proposal.pedagogicalUnits) ||
        !Array.isArray(proposal.concepts)
      ) {
        throw new Error("La propuesta de IA no tiene la estructura esperada.");
      }

      const cacheResult = {
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
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(cacheResult));
      } catch {}
      return cacheResult;
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
