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
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        courseId: course?.id,
        assistant,
        mode,
        messages,
        retrieved,
        model,
      }),
      signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data?.error?.message || data?.message || "El backend de IA rechazó la solicitud."
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
