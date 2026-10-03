import { saveStudent, clearStudent } from "../../core/studentSession.js";

function cleanId(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function endpointFor(course) {
  return course?.tracking?.endpoint || "";
}

async function request(course, payload) {
  const endpoint = endpointFor(course);
  if (!endpoint) {
    throw new Error("Esta instancia de la cátedra no tiene configurado su padrón.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ courseId: course.id, ...payload }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo contactar al sistema de acceso (HTTP ${response.status}).`);
  }

  const data = await response.json().catch(() => null);
  if (!data) throw new Error("El sistema de acceso devolvió una respuesta inválida.");
  return data;
}

function displayName(student) {
  return `${student.apellido || ""}, ${student.nombre || ""}`
    .replace(/^, |, $/g, "")
    .trim();
}

export async function checkStudent(course, dni) {
  return request(course, {
    action: course.tracking.actions?.check || "check",
    dni: cleanId(dni),
  });
}

export async function createStudentPin(course, dni, pin) {
  return request(course, {
    action: course.tracking.actions?.register || "registrar",
    dni: cleanId(dni),
    pin,
  });
}

export async function verifyStudentPin(course, dni, pin) {
  return request(course, {
    action: course.tracking.actions?.verify || "verificar",
    dni: cleanId(dni),
    pin,
  });
}

export function saveVerifiedStudent(course, student) {
  const normalized = {
    ...student,
    dni: cleanId(student.dni),
    displayName: displayName(student) || cleanId(student.dni),
  };
  saveStudent(course.id, normalized);
  return normalized;
}

export function logoutStudent(courseId) {
  clearStudent(courseId);
}
