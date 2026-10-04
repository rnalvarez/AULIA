const API_KEY_PREFIX = "aulia:api-key:";
const PENDING_KEY = "aulia:pending";

export function saveApiKey(courseId, key) {
  try {
    localStorage.setItem(API_KEY_PREFIX + courseId, String(key || "").trim());
  } catch {}
}

export function loadApiKey(courseId) {
  try {
    return localStorage.getItem(API_KEY_PREFIX + courseId) || "";
  } catch {
    return "";
  }
}

export function clearApiKey(courseId) {
  try {
    localStorage.removeItem(API_KEY_PREFIX + courseId);
  } catch {}
}

export function queuePendingInteraction(event) {
  try {
    const current = readPendingInteractions();
    current.push(event);
    localStorage.setItem(PENDING_KEY, JSON.stringify(current.slice(-100)));
  } catch {}
}

export function readPendingInteractions(courseId = null) {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return courseId ? all.filter(event => event.courseId === courseId) : all;
  } catch {
    return [];
  }
}

export function removePendingInteractions(eventIds) {
  try {
    const ids = new Set(eventIds);
    const all = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    localStorage.setItem(PENDING_KEY, JSON.stringify(all.filter(event => !ids.has(event.eventId))));
  } catch {}
}
