import { COURSE_REGISTRY } from "./courseRegistry.js";

export function getRequestedCourseId() {
  const configured = import.meta.env.VITE_AULIA_COURSE_ID;
  if (configured) return configured;

  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    return params.get("course") || "chion";
  }

  return "chion";
}

export function resolveRuntimeCourse() {
  const id = getRequestedCourseId();
  return COURSE_REGISTRY.find(course => course.id === id) || null;
}
