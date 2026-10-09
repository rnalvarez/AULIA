const MODEL_KEY_PREFIX = "aulia:model:";

function loadSavedModel(courseId) {
  try { return sessionStorage.getItem(MODEL_KEY_PREFIX + courseId) || ""; } catch { return ""; }
}
function saveModel(courseId, model) {
  try { if (model) sessionStorage.setItem(MODEL_KEY_PREFIX + courseId, model); } catch {}
}

const MAX_RESPONSE_TOKENS = 800;
const MAX_ASSISTANT_INSTRUCTIONS_CHARS = 1000;
const MAX_MODE_INSTRUCTIONS_CHARS = 650;
const MAX_CONCEPT_SUMMARY_CHARS = 420;
const MAX_CORPUS_EXCERPT_CHARS = 1400;
const MAX_CONVERSATION_CHARS = 3600;
const MAX_LATEST_MESSAGE_CHARS = 1800;

function normalizePromptValue(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function promptText(value, maxChars) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function compactConversation(messages) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-6);
  const selected = [];
  let remaining = MAX_CONVERSATION_CHARS;

  for (let index = recent.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = recent[index] || {};
    const limit = Math.min(
      index === recent.length - 1 ? MAX_LATEST_MESSAGE_CHARS : 650,
      remaining
    );
    const content = promptText(message.content, limit);
    if (!content) continue;
    selected.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content,
    });
    remaining -= content.length;
  }

  return selected.reverse();
}

function buildSystemPrompt({ course, assistant, mode, retrieved }) {
  const bibliography = new Map((course?.bibliography || []).map(item => [String(item?.id || ""), item]));
  const pedagogicalUnits = new Map((course?.pedagogicalUnits || []).map(unit => [String(unit?.id || ""), unit]));
  const curriculumSequence = Array.isArray(course?.curriculumMap?.sequence)
    ? course.curriculumMap.sequence.filter(id => pedagogicalUnits.has(String(id)))
    : [];
  const curriculumOrder = new Map(curriculumSequence.map((id, index) => [String(id), index + 1]));
  const unitsForCorpus = new Map();

  for (const unit of pedagogicalUnits.values()) {
    for (const sourceId of unit?.sourceCorpusIds || []) {
      if (!unitsForCorpus.has(String(sourceId))) unitsForCorpus.set(String(sourceId), []);
      unitsForCorpus.get(String(sourceId)).push(unit);
    }
  }

  const unitLabel = unit => {
    if (!unit) return "";
    const order = curriculumOrder.get(String(unit.id));
    const prefix = order ? "UNIDAD CURRICULAR " + order : "UNIDAD PEDAGÓGICA";
    const prerequisites = (unit?.prerequisiteUnitIds || [])
      .slice(0, 2)
      .map(id => pedagogicalUnits.get(String(id)))
      .filter(Boolean)
      .map(item => promptText(item.title, 80))
      .filter(Boolean);
    return promptText([
      prefix + ": " + promptText(unit.title, 100),
      unit.phase ? "ETAPA: " + promptText(unit.phase, 60) : "",
      prerequisites.length ? "PRERREQUISITOS: " + prerequisites.join(" | ") : "",
    ].filter(Boolean).join(" · "), 220);
  };

  const indexedKnowledge = (retrieved || [])
    .filter(item => item?._retrievalKind === "knowledge" && item?.knowledgeEntry)
    .slice(0, 4);
  const knowledgeContext = indexedKnowledge.map(item => {
    const entry = item.knowledgeEntry || {};
    const evidence = (Array.isArray(entry.evidence) ? entry.evidence : []).slice(0, 2);
    const evidenceText = evidence.map(ref => [
      "FUENTE: " + promptText(ref.sourceName || ref.title || "", 120),
      ref.sectionPath?.length ? "SECCIÓN: " + promptText(ref.sectionPath.join(" › "), 150) : "",
      ref.pageStart ? "PÁGINAS: " + ref.pageStart + (ref.pageEnd && ref.pageEnd !== ref.pageStart ? "-" + ref.pageEnd : "") : "",
      ref.printedPageStart ? "PÁGINAS IMPRESAS: " + ref.printedPageStart + (ref.printedPageEnd && ref.printedPageEnd !== ref.printedPageStart ? "-" + ref.printedPageEnd : "") : "",
      "PASO DE EVIDENCIA: " + promptText(ref.excerpt || "", 210),
    ].filter(Boolean).join(" · ")).join("\\n");
    return [
      "CONCEPTO INDEXADO: " + promptText(entry.term || item.title || "", 120),
      entry.aliases?.length ? "OTROS NOMBRES: " + entry.aliases.slice(0, 6).map(value => promptText(value, 80)).join(" | ") : "",
      entry.category ? "TIPO: " + promptText(entry.category, 70) : "",
      entry.definition ? "DEFINICIÓN: " + promptText(entry.definition, 480) : "",
      (entry.definitionVariants || []).filter(value => normalizePromptValue(value) !== normalizePromptValue(entry.definition)).slice(0, 2).length
        ? "OTRAS FORMULACIONES EN EL TEXTO: " + (entry.definitionVariants || []).filter(value => normalizePromptValue(value) !== normalizePromptValue(entry.definition)).slice(0, 2).map(value => promptText(value, 240)).join(" | ") : "",
      entry.explanation ? "DESARROLLO: " + promptText(entry.explanation, 420) : "",
      (entry.explanationVariants || []).filter(value => normalizePromptValue(value) !== normalizePromptValue(entry.explanation)).slice(0, 2).length
        ? "OTROS DESARROLLOS: " + (entry.explanationVariants || []).filter(value => normalizePromptValue(value) !== normalizePromptValue(entry.explanation)).slice(0, 2).map(value => promptText(value, 220)).join(" | ") : "",
      entry.distinctions?.length ? "DISTINCIONES: " + entry.distinctions.slice(0, 2).map(value => promptText(value, 150)).join(" | ") : "",
      entry.relatedTerms?.length ? "RELACIONES: " + entry.relatedTerms.slice(0, 5).map(value => promptText(value, 70)).join(" | ") : "",
      entry.examples?.length ? "EJEMPLOS: " + entry.examples.slice(0, 2).map(value => promptText(value, 140)).join(" | ") : "",
      evidenceText ? "TRAZABILIDAD AL MATERIAL ORIGINAL:\\n" + evidenceText : "",
    ].filter(Boolean).join("\\n");
  }).join("\\n\\n");

  const conceptIds = new Set((course?.concepts || []).map(concept => String(concept?.id || "")));
  const retrievedConcepts = (retrieved || [])
    .filter(item => conceptIds.has(String(item?.id || "")))
    .slice(0, 3);

  const conceptItems = retrievedConcepts.map(item => {
    const sourceIds = Array.isArray(item?.sourceBibliographyIds) ? item.sourceBibliographyIds : [];
    const sources = sourceIds
      .slice(0, 2)
      .map(id => bibliography.get(String(id)))
      .filter(Boolean)
      .map(ref => promptText([ref?.title, ref?.author, ref?.year].filter(Boolean).join(" · "), 130));

    const relatedUnits = (item?.pedagogicalUnitIds || [])
      .slice(0, 1)
      .map(id => pedagogicalUnits.get(String(id)))
      .filter(Boolean)
      .map(unitLabel);

    const confusionCriteria = (Array.isArray(item?.confusionCriteria) ? item.confusionCriteria : [])
      .slice(0, 2)
      .map(value => promptText(value, 110));

    return [
      "ID: " + promptText(item?.id, 80),
      "CONCEPTO: " + promptText(item?.title, 120),
      relatedUnits.length ? relatedUnits.join("\\n") : "",
      "DEFINICIÓN/RESUMEN: " + promptText(item?.explanation || item?.summary || "", MAX_CONCEPT_SUMMARY_CHARS),
      sources.length ? "BIBLIOGRAFÍA: " + sources.join(" | ") : "",
      confusionCriteria.length ? "CRITERIOS DE POSIBLE CONFUSIÓN: " + confusionCriteria.join(" | ") : "",
    ].filter(Boolean).join("\\n");
  }).join("\\n\\n");

  // Conceptos ya se incluyen arriba, con un formato específico y compacto.
  // No volver a incluirlos dentro del corpus: duplicaba tokens sin sumar evidencia.
  const retrievedCorpus = (retrieved || [])
    .filter(item => item?._retrievalKind !== "knowledge" && !conceptIds.has(String(item?.id || "")))
    .slice(0, 4);

  const context = retrievedCorpus.map(item => {
    const title = promptText(item?.title || item?.id || "Unidad", 140);
    const section = Array.isArray(item?.sectionPath) && item.sectionPath.length
      ? "SECCIÓN: " + promptText(item.sectionPath.join(" › "), 180)
      : (item?.chapter ? "SECCIÓN: " + promptText(item.chapter, 180) : "");
    const pages = item?.sourcePageStart
      ? "PÁGINAS: " + item.sourcePageStart + (item?.sourcePageEnd && item.sourcePageEnd !== item.sourcePageStart ? "-" + item.sourcePageEnd : "")
      : "";
    const source = item?.source ? "FUENTE: " + promptText(item.source, 150) : "";
    const linkedUnits = unitsForCorpus.get(String(item?.id || "")) || [];
    const curricularUnits = linkedUnits.length
      ? linkedUnits.slice(0, 1).map(unitLabel)
      : (item?.pedagogicalUnitIds || [])
          .slice(0, 1)
          .map(id => pedagogicalUnits.get(String(id)))
          .filter(Boolean)
          .map(unitLabel);
    const text = promptText(item?.explanation || item?.summary || item?.content || "", MAX_CORPUS_EXCERPT_CHARS);

    return [
      title,
      curricularUnits.length ? curricularUnits.join("\\n") : "",
      section,
      pages,
      source,
      text,
    ].filter(Boolean).join("\\n");
  }).join("\\n\\n");

  const curriculumContext = curriculumSequence.length
    ? "MAPA CURRICULAR DE LA CÁTEDRA:\\n" +
      curriculumSequence.slice(0, 12).map((id, index) => {
        const unit = pedagogicalUnits.get(String(id));
        return (index + 1) + ". " + promptText(unit?.title, 90);
      }).join("\\n") +
      (curriculumSequence.length > 12 ? "\\n… y " + (curriculumSequence.length - 12) + " unidades más." : "")
    : "";

  return [
    promptText(assistant?.instructions || "Sos un asistente pedagógico. Respondé en español y trabajá con el corpus autorizado.", MAX_ASSISTANT_INSTRUCTIONS_CHARS),
    "Curso: " + promptText(course?.title || course?.id || "", 160),
    "Modo: " + promptText(mode?.title || "", 120),
    "Objetivo: " + promptText(mode?.pedagogicalGoal || "", 400),
    curriculumContext,
    "El mapa curricular es una guía pedagógica de la cátedra, no una fuente factual adicional. Usalo para orientar la progresión y los prerrequisitos, pero basá las respuestas sobre contenidos únicamente en el corpus y las fuentes autorizadas.",
    "Interpretá los textos con libertad académica razonable: relacioná ideas, conceptos y términos equivalentes cuando el material dé sustento para hacerlo. Podés formular inferencias, pero no las presentes como citas o afirmaciones explícitas del autor si son interpretaciones tuyas.",
    "No afirmes que un concepto no está en la bibliografía solo porque no aparezca literalmente en los fragmentos recuperados. Si la evidencia seleccionada no alcanza, decí que no localizaste evidencia suficiente en los pasajes consultados; no concluyas que el libro completo no lo trata. No uses conocimiento externo como evidencia factual.",
    "Instrucciones: " + promptText(mode?.instructions || "", MAX_MODE_INSTRUCTIONS_CHARS),
    knowledgeContext ? "BASE DE CONOCIMIENTO CONSTRUIDA A PARTIR DE LA BIBLIOGRAFÍA:\\n" + knowledgeContext : "",
    "Las entradas de la base conceptual se extrajeron de la bibliografía de esta cátedra. Usalas para reconocer conceptos aunque el estudiante emplee sinónimos o paráfrasis; verificá sus evidencias y páginas antes de afirmar que un tema no aparece.",
    "Cuando sea relevante y la referencia esté disponible, indicá el capítulo, la sección o la página que respalda la explicación. No inventes referencias ni presentes una paráfrasis del índice como cita textual.",
    conceptItems
      ? "CONCEPTOS AUTORIZADOS PARA EL ANÁLISIS DE ESTA INTERACCIÓN:\\n" + conceptItems
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
  ].filter(Boolean).join("\\n");
}

function modeGeneration(mode, generation) {
  const base = {
    temperature: Number(generation.temperature ?? 0.4),
    max_tokens: Math.max(1, Math.min(Number(generation.max_tokens ?? MAX_RESPONSE_TOKENS) || MAX_RESPONSE_TOKENS, MAX_RESPONSE_TOKENS)),
    top_p: Number(generation.top_p ?? 0.9),
  };
  const overrides = generation.modeOverrides?.[mode?.id] || {};
  return {
    temperature: Number(overrides.temperature ?? base.temperature),
    max_tokens: Math.max(1, Math.min(Number(overrides.max_tokens ?? base.max_tokens) || base.max_tokens, MAX_RESPONSE_TOKENS)),
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
      ...compactConversation(messages),
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
        if (response.status === 413 && /tokens per minute|request too large|requested \\d+/i.test(providerMessage)) {
          throw new Error("La consulta superó el límite de tokens por minuto de Groq. AULIA ya reduce el material y el historial enviados; esperá un momento y probá de nuevo. Si continúa, revisá la cantidad de consultas simultáneas en la cuenta.");
        }
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
