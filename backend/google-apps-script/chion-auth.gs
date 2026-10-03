// AULIA — CHIONIA pilot authentication and sessions

function findPadronStudent(dniRaw) {
  const dni = normalizeDni(dniRaw);
  if (!dni) return null;

  const sheet = getSheet(SHEETS.padron, false);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return null;

  const headers = values[0].map(String);
  const dniCol = findColumn(headers, ["DNI"]);
  const apellidoCol = findColumn(headers, ["Apellido"]);
  const nombreCol = findColumn(headers, ["Nombre"]);
  const comisionCol = findColumn(headers, ["Comisión", "Comision"]);
  const activeCol = findColumn(headers, ["Activo (Sí/No)", "Activo", "ACTIVO"]);
  const pinCol = findColumn(headers, ["PIN Hash (no tocar)", "PIN Hash", "PIN_HASH"]);
  const pinDateCol = findColumn(headers, ["Fecha registro PIN", "PIN_REGISTRADO"]);

  if (dniCol < 0 || pinCol < 0) throw new Error("La hoja Padrón necesita DNI y PIN Hash.");

  for (let i = 1; i < values.length; i += 1) {
    if (normalizeDni(values[i][dniCol]) !== dni) continue;
    return {
      rowIndex: i + 1,
      sheet,
      dni,
      apellido: cell(values[i], apellidoCol),
      nombre: cell(values[i], nombreCol),
      comision: cell(values[i], comisionCol),
      activo: activeCol >= 0 ? isActiveValue(values[i][activeCol]) : true,
      pinHash: cell(values[i], pinCol),
      pinCol,
      pinDateCol,
    };
  }
  return null;
}

function hashPin(dni, pin) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalizeDni(dni) + ":" + String(pin || "").trim(),
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ("0" + ((b + 256) % 256).toString(16)).slice(-2)).join("");
}

function requirePin(pin) {
  if (!/^\d{4,6}$/.test(String(pin || ""))) {
    throw new Error("El PIN debe tener entre 4 y 6 dígitos.");
  }
}

function handleCheck(body) {
  const student = findPadronStudent(body.dni);
  if (!student) return { found: false };
  return {
    found: true,
    activo: student.activo,
    hasPin: Boolean(student.pinHash),
    apellido: student.apellido,
    nombre: student.nombre,
    comision: student.comision,
  };
}

function handleRegister(body) {
  requireCourse(body);
  const dni = normalizeDni(body.dni);
  requirePin(body.pin);

  const student = findPadronStudent(dni);
  if (!student) return { success: false, msg: "DNI no encontrado en el padrón." };
  if (!student.activo) return { success: false, msg: "Tu acceso está deshabilitado. Contactá al docente." };
  if (student.pinHash) return { success: false, msg: "Ya tenés un PIN registrado. Pedile al docente que lo resetee si lo olvidaste." };

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const current = student.sheet.getRange(student.rowIndex, student.pinCol + 1).getValue();
    if (current) return { success: false, msg: "El PIN ya fue registrado." };

    student.sheet.getRange(student.rowIndex, student.pinCol + 1).setValue(hashPin(dni, body.pin));
    if (student.pinDateCol >= 0) {
      student.sheet.getRange(student.rowIndex, student.pinDateCol + 1)
        .setValue(Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy HH:mm"));
    }
  } finally {
    lock.releaseLock();
  }

  return issueSession(dni, student);
}

function loginKey(dni) {
  return "aulia:login:" + normalizeDni(dni);
}

function readLoginState(dni) {
  const raw = CacheService.getScriptCache().get(loginKey(dni));
  if (!raw) return { failures: 0, windowStart: 0, lockedUntil: 0 };
  try { return JSON.parse(raw); }
  catch (e) { return { failures: 0, windowStart: 0, lockedUntil: 0 }; }
}

function saveLoginState(dni, state, ttl) {
  CacheService.getScriptCache().put(
    loginKey(dni),
    JSON.stringify(state),
    Math.max(30, ttl || LOGIN_WINDOW_SECONDS)
  );
}

function isLoginLocked(dni) {
  const state = readLoginState(dni);
  return state.lockedUntil && Date.now() < state.lockedUntil;
}

function registerLoginFailure(dni) {
  const now = Date.now();
  let state = readLoginState(dni);

  if (!state.windowStart || now - state.windowStart > LOGIN_WINDOW_SECONDS * 1000) {
    state = { failures: 0, windowStart: now, lockedUntil: 0 };
  }

  state.failures += 1;
  if (state.failures >= LOGIN_MAX_FAILURES) {
    state.lockedUntil = now + LOGIN_LOCK_SECONDS * 1000;
    saveLoginState(dni, state, LOGIN_LOCK_SECONDS);
    return true;
  }

  saveLoginState(dni, state, LOGIN_WINDOW_SECONDS);
  return false;
}

function handleVerify(body) {
  requireCourse(body);
  const dni = normalizeDni(body.dni);
  requirePin(body.pin);

  if (isLoginLocked(dni)) {
    return { allowed: false, locked: true, msg: "Demasiados intentos. Probá nuevamente en unos minutos." };
  }

  const student = findPadronStudent(dni);
  if (!student) return { allowed: false, msg: "DNI no encontrado en el padrón." };
  if (!student.activo) return { allowed: false, msg: "Tu acceso está deshabilitado." };
  if (!student.pinHash) return { allowed: false, msg: "No tenés un PIN registrado aún." };

  if (hashPin(dni, body.pin) !== student.pinHash) {
    const locked = registerLoginFailure(dni);
    return {
      allowed: false,
      locked,
      msg: locked
        ? "Demasiados intentos. Probá nuevamente en unos minutos."
        : "PIN incorrecto. Si lo olvidaste, contactá al docente.",
    };
  }

  CacheService.getScriptCache().remove(loginKey(dni));
  return issueSession(dni, student);
}

function issueSession(dni, student) {
  const props = PropertiesService.getScriptProperties();
  const configured = Number(props.getProperty("SESSION_TTL_SECONDS") || DEFAULT_SESSION_TTL_SECONDS);
  const ttl = Math.max(900, Math.min(configured, 21600));
  const sessionKey = Utilities.getUuid() + "-" + Utilities.getUuid();

  CacheService.getScriptCache().put(
    "aulia:session:" + sessionKey,
    JSON.stringify({ courseId: requiredProperty("COURSE_ID"), dni }),
    ttl
  );

  return {
    success: true,
    allowed: true,
    sessionKey,
    expiresIn: ttl,
    dni,
    apellido: student.apellido,
    nombre: student.nombre,
    comision: student.comision,
  };
}

function requireSession(body) {
  const courseId = requireCourse(body);
  const sessionKey = String(body.sessionKey || body.token || body.authToken || "").trim();
  const raw = sessionKey ? CacheService.getScriptCache().get("aulia:session:" + sessionKey) : null;
  if (!raw) throw new Error("Sesión vencida o inválida. Volvé a iniciar sesión.");

  let session;
  try { session = JSON.parse(raw); }
  catch (e) { throw new Error("Sesión inválida. Volvé a iniciar sesión."); }

  if (session.courseId !== courseId) throw new Error("Sesión no válida para esta cátedra.");

  const student = findPadronStudent(session.dni);
  if (!student || !student.activo) throw new Error("Tu acceso ya no está habilitado en el padrón.");

  return { courseId, sessionKey, student };
}

function testAuth() {
  console.log("✓ AULIA backend auth cargado: " + AULIA_BACKEND_VERSION);
  console.log("✓ COURSE_ID configurado: " + requiredProperty("COURSE_ID"));
}
