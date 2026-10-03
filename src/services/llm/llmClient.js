export function createLLMClient({ endpoint, getToken, defaultModel = "" }) {
  async function generate({ messages, model = defaultModel, signal }) {
    if (!endpoint) {
      throw new Error("No hay proveedor LLM configurado.");
    }

    const token = await getToken?.();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages }),
      signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data?.error?.message || "El proveedor LLM rechazó la solicitud."
      );
    }

    return data;
  }

  return { generate };
}
