const MODEL_KEY_PREFIX = "aulia:model:";

function loadSavedModel(courseId) {
  try { return sessionStorage.getItem(MODEL_KEY_PREFIX + courseId) || ""; } catch { return ""; }
}
function saveModel(courseId, model) {
  try { if (model) sessionStorage.setItem(MODEL_KEY_PREFIX + courseId, model); } catch {}
}

function buildSystemPrompt({ course, assistant, mode, retrieved }) {
  const bibliography = new Map((course?.bibliography || []).map(item => [String(item?.id || ""), item]));
  const pedagogicalUnits = new Map((course?.pedagogicalUnits || []).map(unit => [String(unit?.id || ""), unit]));
  const curriculumSequence = Array.isArray(course?.curriculumMap?.sequence)
    ? course.curriculumMap.sequence.filter((id) => pedagogicalUnits.has(String(id)))
    : [];
  const curriculumOrder = new Map(curriculumSequence.map((id, index) => [String(id), index + 1]));
  const unitsForCorpus = new Map();
  for (const unit of pedagogicalUnits.values()) {
    for (const sourceId of unit?.sourceCorpusIds || []) {
      if (!unitsForCorpus.has(String(sourceId))) unitsForCorpus.set(String(sourceId), []);
      unitsForCorpus.get(String(sourceId)).push(unit);
    }
  }
  const unitLabel = (unit) => {
    if (!unit) return "";
    const order = curriculumOrder.get(String(unit.id));
    const prefix = order ? "UNIDAD CURRICULAR " + order : "UNIDAD PEDAGÓGICA";
    const prerequisites = (unit?.prerequisiteUnitIds || [])
      .map((id) => pedagogicalUnits.get(String(id)))
      .filter(Boolean)
      .map((item) => item.title)
      .filter(Boolean);
    return [
      prefix + ": " + String(unit.title || ""),
      unit.phase ? "ETAPA: " + unit.phase : "",
      prerequisites.length ? "PRERREQUISITOS: " + prerequisites.join(" | ") : "",
    ].filter(Boolean).join(" · ");
  };
  const conceptItems = (retrieved || [])
    .filter(item => (course?.concepts || []).some(concept => concept?.id === item?.id))
    .map(item => {
      const sourceIds = Array.isArray(item?.sourceBibliographyIds) ? item.sourceBibliographyIds : [];
      const sources = sourceIds
        .map(id => bibliography.get(String(id)))
        .filter(Boolean)
        .map(ref => [ref?.title, ref?.author, ref?.year].filter(Boolean).join(" · "));
      const relatedUnits = (item?.pedagogicalUnitIds || [])
        .map((id) => pedagogicalUnits.get(String(id)))
        .filter(Boolean)
        .map(unitLabel);
      return [
        "ID: " + String(item?.id || ""),
        "CONCEPTO: " + String(item?.title || ""),
        relatedUnits.length ? relatedUnits.join("\n") : "",
        "DEFINICIÓN/RESUMEN: " + String(item?.explanation || item?.summary || ""),
        sources.length ? "BIBLIOGRAFÍA: " + sources.join(" | ") : "",
        Array.isArray(item?.confusionCriteria) && item.confusionCriteria.length
          ? "CRITERIOS DE POSIBLE CONFUSIÓN: " + item.confusionCriteria.join(" | ")
          : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n");

  const context = (retrieved || []).map(item => {
    const title = String(item?.title || item?.id || "Unidad");
    const section = Array.isArray(item?.sectionPath) && item.sectionPath.length
      ? "SECCIÓN: " + item.sectionPath.join(" › ")
      : (item?.chapter ? "SECCIÓN: " + item.chapter : "");
    const pages = item?.sourcePageStart
      ? "PÁGINAS: " + item.sourcePageStart + (item?.sourcePageEnd && item.sourcePageEnd !== item.sourcePageStart ? "-" + item.sourcePageEnd : "")
      : "";
    const source = item?.source ? "FUENTE: " + item.source : "";
    const linkedUnits = unitsForCorpus.get(String(item?.id || "")) || [];
    const curricularUnits = linkedUnits.length
      ? linkedUnits.map(unitLabel)
      : (item?.pedagogicalUnitIds || [])
          .map((id) => pedagogicalUnits.get(String(id)))
          .filter(Boolean)
          .map(unitLabel);
    const text = String(item?.explanation || item?.summary || item?.content || "");
    return [
      title,
      curricularUnits.length ? curricularUnits.join("\n") : "",
      section,
      pages,
      source,
      text,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const curriculumContext = curriculumSequence.length
    ? "MAPA CURRICULAR DE LA CÁTEDRA:\n" +
      curriculumSequence.map((id, index) => {
        const unit = pedagogicalUnits.get(String(id));
        return (index + 1) + ". " + String(unit?.title || "");
      }).join("\n")
    : "";

  return [
    String(assistant?.instructions || "Sos un asistente pedagógico. Respondé en español y trabajá con el corpus autorizado."),
    "Curso: " + String(course?.title || course?.id || ""),
    "Modo: " + String(mode?.title || ""),
    "Objetivo: " + String(mode?.pedagogicalGoal || ""),
    curriculumContext,
    "El mapa curricular es una guía pedagógica de la cátedra, no una fuente factual adicional. Usalo para orientar la progresión y los prerrequisitos, pero basá las respuestas sobre contenidos únicamente en el corpus y las fuentes autorizadas.",

    "Instrucciones: " + String(mode?.instructions || ""),
    conceptItems
      ? "CONCEPTOS AUTORIZADOS PARA EL ANÁLISIS DE ESTA INTERACCIÓN:\n" + conceptItems
      : "No hay conceptos recuperados para clasificar esta interacción.",
    "Corpus recuperado:",
    context || "Sin fragmentos específicos recuperados.",
    "",
    "IMPORTANTE — SALIDA ESTRUCTURADA:",
    "Respondé únicamente como JSON válido con estas claves:",
    '{"reply":"respuesta para el estudiante","conceptIds":["id-de-concepto"],"confusionLevel":0}',
    "reply debe contener solamente la respuesta pedagógica que verá el estudiante.",
    "conceptIds debe incluir únicamente IDs de los conceptos autorizados arriba que realmente fueron tratados en la pregunta o respuesta. Si ninguno, usá [].",
    "confusionLevel debe ser 0, 1 o 2. 0 = no hay indicio de confusión; 1 = posible dificultad, comprensión incompleta o pedido de aclaración; 2 = confusión clara o reiterada respecto de un concepto.",
    "La clasificación de conceptos y confusión debe basarse exclusivamente en las definiciones, criterios y bibliografía de la cátedra proporcionados arriba. No diagnostiques al estudiante ni inventes conceptos.",
  ].join("\n");
}

function modeGeneration(mode, generation) {
  const base = {
    temperature: Number(generation.temperature ?? 0.4),
    max_tokens: Number(generation.max_tokens ?? 800),
    top_p: Number(generation.top_p ?? 0.9),
  };
  const overrides = generation.modeOverrides?.[mode?.id] || {};
  return {
    temperature: Number(overrides.temperature ?? base.temperature),
    max_tokens: Number(overrides.max_tokens ?? base.max_tokens),
    top_p: Number(overrides.top_p ?? base.top_p),
  };
}

export function createLLMClient({ courseId, apiKey, endpoint, models = [], generation = {} }) {
  async function generate({ course, assistant, mode, messages, retrieved = [], signal }) {
    if (!apiKey) throw new Error("Falta la API key de IA. Configurala para comenzar.");
    if (!endpoint) throw new Error("Esta instancia no tiene configurado el proveedor de IA.");
    if (!Array.isArray(models) || models.length === 0) throw new Error("Esta instancia no tiene modelos de IA configurados.");

    const saved = loadSavedModel(courseId);
    const orderedModels = saved ? [saved, ...models.filter(model => model !== saved)] : models.slice();
    const limits = modeGeneration(mode, generation);
    const requestMessages = [
      { role: "system", content: buildSystemPrompt({ course, assistant, mode, retrieved }) },
      ...messages.slice(-6),
    ];

    let lastModelError = null;
    for (const model of orderedModels) {
      const requestBody = {
        model,
        messages: requestMessages,
        temperature: limits.temperature,
        max_tokens: limits.max_tokens,
        top_p: limits.top_p,
        stream: false,
        response_format: { type: "json_object" },
      };

      let response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal,
      });

      // JSON Object Mode is supported by Groq's Chat Completions API. If a provider
      // compatibility layer rejects response_format, retry once in plain-text mode
      // rather than blocking the student.
      if (response.status === 400 || response.status === 422) {
        const retryData = await response.clone().json().catch(() => ({}));
        const retryMessage = retryData?.error?.message || retryData?.message || "";
        if (/response_format|json/i.test(retryMessage)) {
          const fallbackBody = { ...requestBody };
          delete fallbackBody.response_format;
          response = await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
            body: JSON.stringify(fallbackBody),
            signal,
          });
        }
      }

      if (response.status === 404) {
        lastModelError = new Error("El modelo " + model + " no está disponible.");
        continue;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const providerMessage = data?.error?.message || data?.message || "";
        if (response.status === 401) throw new Error("API key inválida. Usá el botón 🔑 para cambiarla.");
        if (response.status === 429) throw new Error("Se alcanzó el límite de uso de tu cuenta. Esperá y probá nuevamente.");
        throw new Error("Error " + response.status + (providerMessage ? ": " + providerMessage : "."));
      }

      const rawContent = data?.choices?.[0]?.message?.content || data?.reply || data?.output || "";
      if (!rawContent) throw new Error("El proveedor de IA devolvió una respuesta vacía.");

      let parsed = null;
      try { parsed = JSON.parse(rawContent); } catch {}

      const reply = parsed?.reply || rawContent;
      const analytics = {
        conceptIds: Array.isArray(parsed?.conceptIds) ? parsed.conceptIds.filter(Boolean) : [],
        confusionLevel: Math.max(0, Math.min(2, Number(parsed?.confusionLevel) || 0)),
      };

      saveModel(courseId, model);
      return { ...data, reply, analytics, model: data?.model || model };
    }
    throw lastModelError || new Error("Ningún modelo configurado está disponible.");
  }
  return { generate };
}
