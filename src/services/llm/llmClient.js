const MODEL_KEY_PREFIX = "aulia:model:";

function loadSavedModel(courseId) {
  try {
    return sessionStorage.getItem(MODEL_KEY_PREFIX + courseId) || "";
  } catch {
    return "";
  }
}

function saveModel(courseId, model) {
  try {
    if (model) sessionStorage.setItem(MODEL_KEY_PREFIX + courseId, model);
  } catch {}
}

function buildSystemPrompt({ course, assistant, mode, retrieved }) {
  const context = (retrieved || []).map(item => {
    const title = String(item?.title || item?.id || "Unidad");
    const text = String(item?.explanation || item?.summary || item?.content || "");
    return title + ": " + text;
  }).join("\n\n");

  return [
    String(assistant?.instructions || "Sos el asistente pedagógico de la cátedra."),
    "",
    "Curso autorizado: " + String(course?.title || course?.id || ""),
    "Modo activo: " + String(mode?.title || ""),
    "Objetivo pedagógico: " + String(mode?.pedagogicalGoal || ""),
    "Estrategia: " + String(mode?.strategy || ""),
    "Instrucciones del modo: " + String(mode?.instructions || ""),
    "",
    "Trabajá únicamente con el corpus autorizado proporcionado por AULIA.",
    "Unidades recuperadas:",
    context || "No se recuperaron unidades específicas.",
  ].join("\n");
}

export function createLLMClient({ courseId, apiKey, endpoint, models = [], generation = {} }) {
  async function generate({
    course,
    assistant,
    mode,
    messages,
    retrieved = [],
    signal,
  }) {
    if (!apiKey) throw new Error("Falta la API key de IA. Configurala para comenzar.");
    if (!endpoint) throw new Error("Esta instancia no tiene configurado el proveedor de IA.");
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error("Esta instancia no tiene modelos de IA configurados.");
    }

    const saved = loadSavedModel(courseId);
    const orderedModels = saved
      ? [saved, ...models.filter(model => model !== saved)]
      : models.slice();

    const requestMessages = [
      {
        role: "system",
        content: buildSystemPrompt({ course, assistant, mode, retrieved }),
      },
      ...messages.slice(-10),
    ];

    let lastModelError = null;

    for (const model of orderedModels) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: requestMessages,
          temperature: Number(generation.temperature ?? 0.4),
          max_tokens: Number(generation.max_tokens ?? 1200),
          top_p: Number(generation.top_p ?? 0.9),
          stream: false,
        }),
        signal,
      });

      if (response.status === 404) {
        lastModelError = new Error("El modelo " + model + " no está disponible.");
        continue;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const providerMessage =
          data?.error?.message ||
          data?.message ||
          "";

        if (response.status === 401) {
          throw new Error("API key inválida. Usá el botón 🔑 para cambiarla.");
        }

        if (response.status === 429) {
          throw new Error("Se alcanzó el límite de uso de tu cuenta. Esperá y probá nuevamente.");
        }

        throw new Error(
          "Error " + response.status + (providerMessage ? ": " + providerMessage : ".")
        );
      }

      const reply =
        data?.choices?.[0]?.message?.content ||
        data?.reply ||
        data?.output ||
        "";

      if (!reply) throw new Error("El proveedor de IA devolvió una respuesta vacía.");

      saveModel(courseId, model);

      return {
        ...data,
        reply,
        model: data?.model || model,
      };
    }

    throw lastModelError || new Error("Ningún modelo configurado está disponible.");
  }

  return { generate };
}
