import { COURSE_REGISTRY } from "./courseRegistry.js";
import { STUDIO_API_ENDPOINT } from "./studioConfig.js";
import { validateCourse } from "./courseContract.js";

export function getRequestedCourseId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("course") || "";
}

async function requestPublishedCourse(courseRef) {
  if (!STUDIO_API_ENDPOINT) return { status: "unavailable" };

  const response = await fetch(STUDIO_API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "public-course",
      course: courseRef,
    }),
  });

  if (!response.ok) throw new Error("Backend HTTP " + response.status + ".");
  const data = await response.json().catch(() => null);
  if (!data) throw new Error("Respuesta inválida del backend.");

  if (data.success === false) {
    if (data.notPublished) return { status: "not-published" };
    throw new Error(data.msg || data.error || "No se pudo cargar la cátedra.");
  }

  const course = data.course || null;
  if (!course) return { status: "invalid" };

  const validation = validateCourse(course);
  if (!validation.valid) {
    throw new Error("La versión publicada no cumple el contrato de AULIA: " + validation.errors.join(" "));
  }

  return { status: "published", course };
}

export async function loadRuntimeCourse() {
  const ref = getRequestedCourseId();
  if (!ref) return { course: null, status: "missing" };

  try {
    const result = await requestPublishedCourse(ref);
    if (result.status === "not-published") {
      return { course: null, status: "not-published" };
    }
    return { course: result.course, status: "published" };
  } catch (error) {
    // Compatibilidad con los cursos estáticos existentes durante la transición.
    const fallback = COURSE_REGISTRY.find(course => course.id === ref);
    if (fallback) return { course: fallback, status: "static-fallback" };
    return { course: null, status: "error", error };
  }
}

export function resolveRuntimeCourse() {
  const ref = getRequestedCourseId();
  return ref ? COURSE_REGISTRY.find(course => course.id === ref) || null : null;
}
