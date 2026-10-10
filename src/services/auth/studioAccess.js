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


const ORIGINAL_PDF_CHUNK_BYTES = 2 * 1024 * 1024;

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const stride = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + stride, bytes.length)));
  }
  return btoa(binary);
}

/**
 * Persists the teacher's original PDF to the course's private Google Drive
 * folder before spending any LLM quota. The backend stores it in chunks and
 * deduplicates repeated attempts by file name, size and modification time.
 */
export async function storeOriginalPdfInDrive(courseId, file, onProgress = () => {}) {
  const session = loadStudioSession();
  if (!session?.token) throw new StudioApiError("La sesión docente venció. Volvé a ingresar a Studio para guardar el PDF en Drive.");
  if (!(file instanceof File) || !/\.pdf$/i.test(String(file.name || ""))) {
    throw new StudioApiError("El almacenamiento en Drive admite archivos PDF originales.");
  }
  if (!file.size) throw new StudioApiError("El PDF original está vacío.");

  const chunkCount = Math.ceil(file.size / ORIGINAL_PDF_CHUNK_BYTES);
  const metadata = {
    token: session.token,
    courseId: String(courseId || ""),
    fileName: file.name,
    fileSize: file.size,
    mimeType: "application/pdf",
    lastModified: Number(file.lastModified || 0),
    chunkCount,
  };
  let started;
  try {
    started = await request({ action: "start-original-pdf-upload", ...metadata });
  } catch (error) {
    if (/acción no reconocida|accion no reconocida|handleStartOriginalPdfUpload is not defined/i.test(String(error?.message || ""))) {
      throw new StudioApiError(
        "El backend de Apps Script todavía no tiene habilitado el almacenamiento de PDF originales. Actualizá Code.gs y studio-data.gs de AULIA en Apps Script y volvé a implementar el Web App."
      );
    }
    throw error;
  }
  if (started.alreadyStored && started.fileId) {
    onProgress({ processed: chunkCount, total: chunkCount, alreadyStored: true });
    return started;
  }

  if (!started.uploadId) {
    throw new StudioApiError("El backend no inició la carga del PDF original en Drive.");
  }

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * ORIGINAL_PDF_CHUNK_BYTES;
    const end = Math.min(file.size, start + ORIGINAL_PDF_CHUNK_BYTES);
    const chunk = await file.slice(start, end).arrayBuffer();
    await request({
      action: "upload-original-pdf-chunk",
      token: session.token,
      courseId: String(courseId || ""),
      uploadId: started.uploadId,
      chunkIndex: index,
      chunkCount,
      chunkBase64: bufferToBase64(chunk),
    });
    onProgress({ processed: index + 1, total: chunkCount, chunkIndex: index });
  }

  const finalized = await request({
    action: "finalize-original-pdf-upload",
    token: session.token,
    courseId: String(courseId || ""),
    uploadId: started.uploadId,
    chunkCount,
  });
  if (!finalized.fileId || !finalized.fileUrl) {
    throw new StudioApiError("Drive no confirmó la conservación del PDF original.");
  }
  onProgress({ processed: chunkCount, total: chunkCount, complete: true });
  return finalized;
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

export async function prepareTeacherCourseDeletion(token, courseId) {
  return request({
    action: "prepare-delete-course",
    token,
    courseId,
    acknowledgeDelete: true,
  });
}

export async function deleteTeacherCourse(token, courseId, confirmation = {}) {
  return request({
    action: "delete-course",
    token,
    courseId,
    confirmationToken: confirmation.confirmationToken || "",
    confirmationTitle: confirmation.confirmationTitle || "",
    confirmPublished: confirmation.confirmPublished === true,
  });
}
