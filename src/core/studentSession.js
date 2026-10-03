const SESSION_PREFIX = "aulia:student:";
const SID_KEY = "aulia:sid";
const PENDING_KEY = "aulia:pending";

export function getSessionId() {
  try {
    let sid = sessionStorage.getItem(SID_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return "session-" + Date.now();
  }
}

export function saveStudent(courseId, student) {
  try {
    localStorage.setItem(
      SESSION_PREFIX + courseId,
      JSON.stringify({ ...student, courseId, verifiedAt: Date.now() })
    );
  } catch {}
}

export function loadStudent(courseId) {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + courseId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearStudent(courseId) {
  try {
    localStorage.removeItem(SESSION_PREFIX + courseId);
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
    const remaining = all.filter(event => !ids.has(event.eventId));
    localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
  } catch {}
}
