const STUDIO_API_KEY_PREFIX = "aulia:studio-api-key:";

export function saveStudioApiKey(courseId, key) {
  try {
    sessionStorage.setItem(STUDIO_API_KEY_PREFIX + courseId, String(key || "").trim());
  } catch {}
}

export function loadStudioApiKey(courseId) {
  try {
    return sessionStorage.getItem(STUDIO_API_KEY_PREFIX + courseId) || "";
  } catch {
    return "";
  }
}

export function clearStudioApiKey(courseId) {
  try {
    sessionStorage.removeItem(STUDIO_API_KEY_PREFIX + courseId);
  } catch {}
}

export function isGroqApiKey(value) {
  return /^gsk_[A-Za-z0-9_-]{20,}$/.test(String(value || "").trim());
}
