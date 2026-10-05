import { STUDIO_API_ENDPOINT } from "../../core/studioConfig.js";
import { clearStudioSession, loadStudioSession, saveStudioSession } from "../../core/studioSession.js";

export class StudioApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "StudioApiError";
    Object.assign(this, options);
  }
}

async function request(payload) {
  if (!STUDIO_API_ENDPOINT) {
    throw new StudioApiError(
      "El backend de AULIA Studio todavía no está configurado. Definí STUDIO_API_ENDPOINT en src/core/studioConfig.js."
    );
  }

  let response;
  try {
    response = await fetch(STUDIO_API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new StudioApiError("No se pudo contactar al backend de AULIA Studio.");
  }

  if (!response.ok) {
    throw new StudioApiError("El backend de AULIA Studio respondió HTTP " + response.status + ".");
  }

  const data = await response.json().catch(() => null);
  if (!data) throw new StudioApiError("El backend devolvió una respuesta inválida.");
  if (data.success === false) {
    throw new StudioApiError(
      data.msg || data.error || "El backend rechazó la operación.",
      {
        conflict: Boolean(data.conflict),
        remoteUpdatedAt: data.remoteUpdatedAt || "",
        validation: data.validation || null,
      }
    );
  }
  return data;
}

export async function loginTeacher(email, password) {
  const data = await request({ action: "login", email, password });
  saveStudioSession(data);
  return data;
}

export async function resumeTeacherSession() {
  const stored = loadStudioSession();
  if (!stored?.token) return null;

  try {
    const data = await request({ action: "session", token: stored.token });
    const session = { ...stored, ...data };
    saveStudioSession(session);
    return session;
  } catch {
    clearStudioSession();
    return null;
  }
}

export async function logoutTeacher() {
  const stored = loadStudioSession();
  try {
    if (stored?.token) {
      await request({ action: "logout", token: stored.token });
    }
  } catch {}
  clearStudioSession();
}

export async function listTeacherCourses(token) {
  return request({ action: "list-courses", token });
}

export async function getTeacherCourse(token, courseId) {
  return request({ action: "get-course", token, courseId });
}

export async function createTeacherCourse(token, title = "Nueva cátedra", description = "") {
  return request({
    action: "create-course",
    token,
    title,
    description,
  });
}

export async function saveTeacherCourse(token, courseId, course, expectedUpdatedAt = "") {
  return request({
    action: "save-course",
    token,
    courseId,
    expectedUpdatedAt,
    course,
  });
}

export async function publishTeacherCourse(token, courseId, course, expectedUpdatedAt = "") {
  return request({
    action: "publish-course",
    token,
    courseId,
    expectedUpdatedAt,
    course,
  });
}

export async function deleteTeacherCourse(token, courseId) {
  return request({
    action: "delete-course",
    token,
    courseId,
  });
}
