const API_KEY_PREFIX = "aulia:api-key:";

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
