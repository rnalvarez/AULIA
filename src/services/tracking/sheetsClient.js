import {
  queuePendingInteraction,
  readPendingInteractions,
  removePendingInteractions,
  getSessionId,
} from "../../core/studentSession.js";

export function createSheetsClient(course, student = null) {
  const endpoint = course?.tracking?.endpoint || "";
  const actions = course?.tracking?.actions || {};

  async function request(payload, { read = true } = {}) {
    if (!endpoint) throw new Error("El tracking remoto no está configurado para esta cátedra.");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ courseId: course.id, ...payload }),
      ...(read ? {} : { mode: "no-cors" }),
    });

    if (!read) return { ok: true };
    if (!response.ok) throw new Error(`Tracking HTTP ${response.status}`);
    return response.json();
  }

  async function logInteraction(event) {
    if (!endpoint) return { ok: false, disabled: true };

    const payload = {
      action: actions.logInteraction || "log",
      ts: event.ts || new Date().toISOString(),
      sid: event.sessionId || getSessionId(),
      dni: student?.dni || "",
      nombre: student?.nombre || "",
      apellido: student?.apellido || "",
      comision: student?.comision || "",
      q: event.question || "",
      r: event.response || "",
      model: event.model || "",
      modeId: event.modeId || "",
      activityId: event.activityId || "",
      retrievedIds: event.retrievedIds || [],
    };

    try {
      await request(payload, { read: false });
      return { ok: true };
    } catch (error) {
      queuePendingInteraction({ ...event, studentId: student?.dni || null });
      return { ok: false, error: error.message, queued: true };
    }
  }

  async function flushPending() {
    const pending = readPendingInteractions(course.id);
    if (!pending.length || !endpoint) return { sent: 0 };

    const sentIds = [];
    for (const event of pending) {
      const result = await logInteraction(event);
      if (result.ok) sentIds.push(event.eventId);
    }

    if (sentIds.length) removePendingInteractions(sentIds);
    return { sent: sentIds.length };
  }

  return {
    checkStudent: (dni) => request({ action: actions.check || "check", dni }),
    registerStudent: (dni, pin) => request({ action: actions.register || "registrar", dni, pin }),
    verifyStudent: (dni, pin) => request({ action: actions.verify || "verificar", dni, pin }),
    logInteraction,
    flushPending,
  };
}
