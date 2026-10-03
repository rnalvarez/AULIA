import { COURSE_REGISTRY } from "./courseRegistry.js";

export function getRequestedCourseId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("course") || import.meta.env.VITE_AULIA_COURSE_ID || "chion";
}

export function resolveRuntimeCourse() {
  const id = getRequestedCourseId();
  return COURSE_REGISTRY.find(course => course.id === id) || null;
}