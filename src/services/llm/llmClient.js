const MODEL_KEY_PREFIX = "aulia:model:";

function loadSavedModel(courseId) {
  try { return sessionStorage.getItem(MODEL_KEY_PREFIX + courseId) || ""; } catch { return ""; }
}
function saveModel(courseId, model) {
  try { if (model) sessionStorage.setItem(MODEL_KEY_PREFIX + courseId, model); } catch {}
}

function buildSystemPrompt({ course, assistant, mode, retrieved }) {
  const context = (retrieved || []).map(item => {
    const title = String(item?.title || item?.id || "Unidad");
    const text = String(item?.explanation || item?.summary || item?.content || "");
    return title + ": " + text;
  }).join("\n\n");

  return [
    String(assistant?.instructions || "Sos un asistente pedagógico. Respondé en español y trabajá con el corpus autorizado."),
    "Curso: " + String(course?.title || course?.id || ""),
    "Modo: " + String(mode?.title || ""),
    "Objetivo: " + String(mode?.pedagogicalGoal || ""),
    "Instrucciones: " + String(mode?.instructions || ""),
    "Corpus recuperado:",
    context || "Sin fragmentos específicos recuperados.",
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
