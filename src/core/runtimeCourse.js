import { STUDIO_API_ENDPOINT } from "./studioConfig.js";
import { validateCourse } from "./courseContract.js";

export function getRequestedCourseId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("course") || "";
}

async function staticDevFallback(courseRef) {
  if (!import.meta.env.DEV) return null;
  try {
    const module = await import("./courseRegistry.js");
    return module.COURSE_REGISTRY.find(course => course.id === courseRef) || null;
  } catch {
    return null;
  }
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
    throw new Error(
      "La versión publicada no cumple el contrato de AULIA: " +
      validation.errors.join(" ")
    );
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
    // Solo durante desarrollo se permite probar course packs estáticos.
    const fallback = await staticDevFallback(ref);
    if (fallback) return { course: fallback, status: "static-dev" };
    return { course: null, status: "error", error };
  }
}
