// AULIA — Teacher Studio authentication

function studioLoginKey(email) {
  return "aulia:studio:login:" + normalizeStudioEmail(email);
}

function studioSessionKey(token) {
  return "aulia:studio:session:" + String(token || "");
}

function studioReadLoginState(email) {
  const raw = CacheService.getScriptCache().get(studioLoginKey(email));
  if (!raw) return { failures: 0, windowStart: 0, lockedUntil: 0 };
  try { return JSON.parse(raw); }
  catch (e) { return { failures: 0, windowStart: 0, lockedUntil: 0 }; }
}

function studioSaveLoginState(email, state, ttl) {
  CacheService.getScriptCache().put(
    studioLoginKey(email),
    JSON.stringify(state),
    Math.max(30, ttl || STUDIO_LOGIN_WINDOW_SECONDS)
  );
}

function studioLoginLocked(email) {
  const state = studioReadLoginState(email);
  return state.lockedUntil && Date.now() < state.lockedUntil;
}

function studioLoginFailure(email) {
  const now = Date.now();
  let state = studioReadLoginState(email);
  if (!state.windowStart || now - state.windowStart > STUDIO_LOGIN_WINDOW_SECONDS * 1000) {
    state = { failures: 0, windowStart: now, lockedUntil: 0 };
  }
  state.failures += 1;
  if (state.failures >= STUDIO_LOGIN_MAX_FAILURES) {
    state.lockedUntil = now + STUDIO_LOGIN_LOCK_SECONDS * 1000;
    studioSaveLoginState(email, state, STUDIO_LOGIN_LOCK_SECONDS);
    return true;
  }
  studioSaveLoginState(email, state, STUDIO_LOGIN_WINDOW_SECONDS);
  return false;
}

function issueTeacherSession(teacher) {
  const configured = Number(PropertiesService.getScriptProperties().getProperty("STUDIO_SESSION_TTL_SECONDS") || STUDIO_SESSION_TTL_SECONDS);
  const ttl = Math.max(900, Math.min(configured, 21600));
  const token = Utilities.getUuid() + "-" + Utilities.getUuid();
  CacheService.getScriptCache().put(
    studioSessionKey(token),
    JSON.stringify({
      email: teacher.email,
      name: teacher.name,
    }),
    ttl
  );
  return {
    success: true,
    token,
    expiresIn: ttl,
    teacher: {
      email: teacher.email,
      name: teacher.name,
    },
  };
}

function requireTeacherSession(body) {
  const token = String(body.token || "").trim();
  if (!token) throw new Error("Falta la sesión docente.");
  const raw = CacheService.getScriptCache().get(studioSessionKey(token));
  if (!raw) throw new Error("Sesión docente vencida o inválida.");

  let session;
  try { session = JSON.parse(raw); }
  catch (e) { throw new Error("Sesión docente inválida."); }

  const teacher = getActiveTeacher(session.email);
  if (!teacher) throw new Error("La cuenta docente ya no está habilitada.");

  return { token, teacher };
}

function handleTeacherLogin(body) {
  const email = normalizeStudioEmail(body.email);
  const password = String(body.password || "");
  if (!email || !password) throw new Error("Ingresá email y contraseña.");
  if (studioLoginLocked(email)) {
    return { success: false, locked: true, msg: "Demasiados intentos. Probá nuevamente en unos minutos." };
  }

  const teacher = getActiveTeacher(email);
  if (!teacher || !teacher.passwordHash || studioHashPassword(email, password, teacher.salt) !== teacher.passwordHash) {
    const locked = studioLoginFailure(email);
    studioAudit(email, "login", "", "denegado", locked ? "bloqueado" : "credenciales inválidas");
    return {
      success: false,
      locked,
      msg: locked
        ? "Demasiados intentos. Probá nuevamente en unos minutos."
        : "Email o contraseña incorrectos.",
    };
  }

  CacheService.getScriptCache().remove(studioLoginKey(email));

  // Registrar el último acceso sin exponer credenciales.
  if (teacher.lastAccessCol >= 0) {
    studioTeacherSheet()
      .getRange(teacher.rowIndex, teacher.lastAccessCol + 1)
      .setValue(studioNow());
  }

  const session = issueTeacherSession(teacher);
  studioAudit(email, "login", "", "ok", "inicio de sesión");
  return session;
}

function handleTeacherSession(body) {
  const session = requireTeacherSession(body);
  return {
    success: true,
    teacher: {
      email: session.teacher.email,
      name: session.teacher.name,
    },
  };
}

function handleTeacherLogout(body) {
  const token = String(body.token || "").trim();
  if (token) CacheService.getScriptCache().remove(studioSessionKey(token));
  return { success: true };
}