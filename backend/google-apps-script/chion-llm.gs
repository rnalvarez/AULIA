// AULIA — CHIONIA pilot server-side LLM proxy

function handleChat(body) {
  const auth = requireSession(body);
  const props = PropertiesService.getScriptProperties();
  const endpoint = requiredProperty("LLM_ENDPOINT");
  const apiKey = requiredProperty("LLM_API_KEY");
  const model = requiredProperty("LLM_MODEL");

  const assistant = body.assistant || {};
  const mode = body.mode || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const retrieved = Array.isArray(body.retrieved) ? body.retrieved.slice(0, 12) : [];
  const context = retrieved.map(item => {
    const title = String(item.title || item.id || "Unidad");
    const text = String(item.explanation || item.summary || item.content || "");
    return title + ": " + text;
  }).join("\n\n");

  const system = [
    String(assistant.instructions || "Sos el asistente pedagógico de la cátedra."),
    "",
    "Curso autorizado: " + auth.courseId,
    "Modo activo: " + String(mode.title || MODE_LABELS[mode.id] || ""),
    "Objetivo pedagógico: " + String(mode.pedagogicalGoal || ""),
    "Estrategia: " + String(mode.strategy || ""),
    "Instrucciones del modo: " + String(mode.instructions || ""),
    "",
    "Trabajá únicamente con el corpus autorizado proporcionado por AULIA.",
    "Unidades recuperadas:",
    context || "No se recuperaron unidades específicas.",
  ].join("\n");

  const requestMessages = [{ role: "system", content: system }]
    .concat(messages.slice(-12));

  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify({ model, messages: requestMessages }),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const raw = response.getContentText() || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error("El proveedor LLM devolvió una respuesta no válida.");
  }

  if (status >= 400) {
    throw new Error(
      (data.error && data.error.message) || data.message ||
      "El proveedor LLM rechazó la solicitud."
    );
  }

  const reply = data.reply ||
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
    data.output || "";

  if (!reply) throw new Error("El proveedor LLM devolvió una respuesta vacía.");

  let tracking = { ok: false };
  try {
    tracking = handleLog({
      courseId: auth.courseId,
      token: auth.token,
      sid: body.sid || "",
      q: extractLastUserMessage(messages),
      r: reply,
      model: data.model || model,
      modeId: mode.id || "",
    });
  } catch (error) {
    console.error("AULIA chat tracking:", error);
  }

  return {
    ok: true,
    reply,
    model: data.model || model,
    tracked: Boolean(tracking && tracking.tracked),
  };
}

function extractLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] && messages[i].role === "user") {
      return String(messages[i].content || "").trim();
    }
  }
  return "";
}

function testChatConfiguration() {
  console.log("✓ COURSE_ID: " + requiredProperty("COURSE_ID"));
  console.log("✓ LLM_ENDPOINT configurado: " + Boolean(requiredProperty("LLM_ENDPOINT")));
  console.log("✓ LLM_MODEL: " + requiredProperty("LLM_MODEL"));
}
