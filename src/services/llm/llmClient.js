export function createLLMClient({ endpoint, getToken, defaultModel = "" }) {
  async function generate({
    course,
    assistant,
    mode,
    messages,
    retrieved = [],
    model = defaultModel,
    signal,
  }) {
    if (!endpoint) {
      throw new Error("No hay un backend de IA configurado para esta instancia.");
    }

    const token = await getToken?.();

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "chat",
        courseId: course?.id,
        token: token || "",
        assistant,
        mode,
        messages,
        retrieved,
        model,
      }),
      signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error?.message ||
        data?.error ||
        data?.message ||
        "El backend de IA rechazó la solicitud."
      );
    }

    const reply =
      data?.reply ||
      data?.choices?.[0]?.message?.content ||
      data?.output ||
      "";

    return {
      ...data,
      reply,
      model: data?.model || model || "",
    };
  }

  return { generate };
}
