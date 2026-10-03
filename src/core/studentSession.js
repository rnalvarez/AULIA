const SESSION_PREFIX = "aulia:student:";
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
    localStorage.setItem(
      SESSION_PREFIX + courseId,
      JSON.stringify({ ...student, courseId, verifiedAt: Date.now(), authToken: student.authToken || null })
    );
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
    return { ...student, courseId, authToken: student.authToken || null };
  } catch {
    return null;
  }
}

export function clearStudent(courseId) {
  try {
    localStorage.removeItem(SESSION_PREFIX + courseId);
    sessionStorage.removeItem(SID_KEY_PREFIX + courseId);
  } catch {}
}

export function getAuthToken(courseId) {
  try {
    const student = loadStudent(courseId);
    return student && student.authToken ? student.authToken : null;
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
