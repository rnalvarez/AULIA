const SESSION_PREFIX = "aulia:student:";
const TOKEN_KEY_PREFIX = "aulia:token:";
const SID_KEY_PREFIX = "aulia:sid:";
const PENDING_KEY = "aulia:pending";
const VERIFY_TTL = 24 * 60 * 60 * 1000;

export function getSessionId(courseId = "default") {
  try {
    const key = SID_KEY_PREFIX + courseId;
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return "session-" + Date.now();
  }
}

export function saveStudent(courseId, student) {
  try {
    const authToken = student?.authToken || "";
    const profile = { ...student, courseId };
    delete profile.authToken;

    localStorage.setItem(
      SESSION_PREFIX + courseId,
      JSON.stringify({ ...profile, verifiedAt: Date.now() })
    );

    if (authToken) sessionStorage.setItem(TOKEN_KEY_PREFIX + courseId, authToken);
  } catch {}
}

export function loadStudent(courseId) {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + courseId);
    if (!raw) return null;

    const student = JSON.parse(raw);
    if (!student.verifiedAt || Date.now() - student.verifiedAt > VERIFY_TTL) {
      clearStudent(courseId);
      return null;
    }

    const authToken = sessionStorage.getItem(TOKEN_KEY_PREFIX + courseId);
    if (!authToken) {
      clearStudent(courseId);
      return null;
    }

    return { ...student, courseId, authToken };
  } catch {
    return null;
  }
}

export function clearStudent(courseId) {
  try {
    localStorage.removeItem(SESSION_PREFIX + courseId);
    sessionStorage.removeItem(TOKEN_KEY_PREFIX + courseId);
    sessionStorage.removeItem(SID_KEY_PREFIX + courseId);
  } catch {}
}

export function getAuthToken(courseId) {
  try {
    return sessionStorage.getItem(TOKEN_KEY_PREFIX + courseId) || null;
  } catch {
    return null;
  }
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
