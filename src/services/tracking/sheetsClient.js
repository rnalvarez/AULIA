export function createSheetsClient({ endpoint, courseId }) {
  async function post(action, payload = {}) {
    if (!endpoint) return { ok: false, disabled: true };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action, courseId, ...payload }),
      });

      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, data };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  return {
    checkStudent: (studentId) => post("check", { studentId }),
    registerStudent: (payload) => post("register", payload),
    verifyStudent: (payload) => post("verify", payload),
    logInteraction: (event) => post("logInteraction", { event }),
  };
}
