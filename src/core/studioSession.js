const SESSION_KEY = "aulia:studio-session";

export function saveStudioSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function loadStudioSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearStudioSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}
