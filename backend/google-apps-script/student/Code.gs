// AULIA — shared student backend
// One public endpoint serves all published courses.
// Course access and student data are resolved by courseId from the Studio admin Sheet.

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    switch (String(body.action || "")) {
      case "check": return jsonResponse(handleCheck(body));
      case "registrar": return jsonResponse(handleRegister(body));
      case "verificar": return jsonResponse(handleVerify(body));
      case "log": return jsonResponse(handleLog(body));
      default: return jsonResponse({ ok: false, error: "Acción no reconocida." });
    }
  } catch (err) {
    console.error("AULIA student doPost", err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: "AULIA Student Backend",
    version: STUDENT_BACKEND_VERSION,
    status: "ready",
  });
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function studentRequiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Falta la propiedad " + name + ".");
  return value;
}

function studentAdminSpreadsheet() {
  return SpreadsheetApp.openById(studentRequiredProperty("AULIA_ADMIN_SHEET_ID"));
}

function studentAdminCourse(ref) {
  const target = String(ref || "").trim();
  if (!target) throw new Error("Falta identificar la cátedra.");

  const sheet = studentAdminSpreadsheet().getSheetByName("📚 Cátedras");
  if (!sheet) throw new Error("Falta la hoja 📚 Cátedras.");

  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error("La administración de cátedras está vacía.");

  const headers = values[0];
  const idCol = studentColumn(headers, ["Course ID"]);
  const slugCol = studentColumn(headers, ["Public Slug"]);
  const statusCol = studentColumn(headers, ["Estado"]);
  const studentSheetCol = studentColumn(headers, ["Student Sheet ID"]);

  for (let i = 1; i < values.length; i += 1) {
    const id = studentCell(values[i], idCol);
    const slug = studentCell(values[i], slugCol);
    if (id !== target && slug !== target) continue;

    const status = studentCell(values[i], statusCol);
    const studentSheetId = studentCell(values[i], studentSheetCol);

    if (status !== "published") {
      throw new Error("La cátedra no está publicada.");
    }
    if (!studentSheetId) {
      throw new Error("La cátedra publicada no tiene Sheet de alumnos.");
    }

    return {
      courseId: id,
      publicSlug: slug,
      studentSheetId,
    };
  }

  throw new Error("La cátedra no existe.");
}

function studentSpreadsheetForCourse(course) {
  return SpreadsheetApp.openById(course.studentSheetId);
}

function studentSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (headers && sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (headers) {
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (current.every(value => !String(value || "").trim())) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  sheet.setFrozenRows(1);
  return sheet;
}

function studentColumn(headers, candidates) {
  const normalized = headers.map(h => String(h || "").trim().toLowerCase());
  for (const candidate of candidates) {
    const index = normalized.indexOf(String(candidate).trim().toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function studentCell(row, index) {
  return index >= 0 && row[index] != null ? String(row[index]).trim() : "";
}

function normalizeDni(value) {
  return String(value == null ? "" : value).replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isActive(value) {
  return ["si", "sí", "1", "true", "yes"].includes(normalizeText(value));
}

function findStudent(course, dniRaw) {
  const dni = normalizeDni(dniRaw);
  if (!dni) return null;

  const sheet = studentSheet(
    studentSpreadsheetForCourse(course),
    "📋 Padrón",
    ["DNI", "Apellido", "Nombre", "Comisión", "Activo (Sí/No)", "PIN Hash (no tocar)", "Fecha registro PIN"]
  );
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];

  const dniCol = studentColumn(headers, ["DNI"]);
  const lastCol = studentColumn(headers, ["Apellido"]);
  const nameCol = studentColumn(headers, ["Nombre"]);
  const commissionCol = studentColumn(headers, ["Comisión", "Comision"]);
  const activeCol = studentColumn(headers, ["Activo (Sí/No)", "Activo"]);
  const pinCol = studentColumn(headers, ["PIN Hash (no tocar)", "PIN Hash"]);
  const pinDateCol = studentColumn(headers, ["Fecha registro PIN"]);

  if (dniCol < 0 || pinCol < 0) throw new Error("La hoja 📋 Padrón necesita DNI y PIN Hash.");

  for (let i = 1; i < values.length; i += 1) {
    if (normalizeDni(values[i][dniCol]) !== dni) continue;
    return {
      rowIndex: i + 1,
      sheet,
      dni,
      apellido: studentCell(values[i], lastCol),
      nombre: studentCell(values[i], nameCol),
      comision: studentCell(values[i], commissionCol),
      activo: activeCol < 0 ? true : isActive(values[i][activeCol]),
      pinHash: studentCell(values[i], pinCol),
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

function sessionKey(token) {
  return "aulia:student:session:" + String(token || "");
}

function loginKey(courseId, dni) {
  return "aulia:student:login:" + courseId + ":" + normalizeDni(dni);
}

function issueSession(course, student) {
  const configured = Number(
    PropertiesService.getScriptProperties().getProperty("SESSION_TTL_SECONDS") || STUDENT_SESSION_TTL_SECONDS
  );
  const ttl = Math.max(900, Math.min(configured, 21600));
  const token = Utilities.getUuid() + "-" + Utilities.getUuid();

  CacheService.getScriptCache().put(
    sessionKey(token),
    JSON.stringify({
      courseId: course.courseId,
      dni: student.dni,
    }),
    ttl
  );

  return {
    success: true,
    allowed: true,
    token,
    expiresIn: ttl,
    dni: student.dni,
    apellido: student.apellido,
    nombre: student.nombre,
    comision: student.comision,
  };
}

function requireSession(body) {
  const course = studentAdminCourse(body.courseId);
  const token = String(body.token || body.authToken || "").trim();
  if (!token) throw new Error("Falta la sesión.");

  const raw = CacheService.getScriptCache().get(sessionKey(token));
  if (!raw) throw new Error("Sesión vencida o inválida. Volvé a iniciar sesión.");

  let data;
  try { data = JSON.parse(raw); }
  catch (e) { throw new Error("Sesión inválida. Volvé a iniciar sesión."); }

  if (data.courseId !== course.courseId) {
    throw new Error("Sesión no válida para esta cátedra.");
  }

  const student = findStudent(course, data.dni);
  if (!student || !student.activo) {
    throw new Error("Tu acceso ya no está habilitado en el padrón.");
  }

  return { course, token, student };
}

function readLoginState(courseId, dni) {
  const raw = CacheService.getScriptCache().get(loginKey(courseId, dni));
  if (!raw) return { failures: 0, windowStart: 0, lockedUntil: 0 };
  try { return JSON.parse(raw); }
  catch (e) { return { failures: 0, windowStart: 0, lockedUntil: 0 }; }
}

function saveLoginState(courseId, dni, state, ttl) {
  CacheService.getScriptCache().put(
    loginKey(courseId, dni),
    JSON.stringify(state),
    Math.max(30, ttl || STUDENT_LOGIN_WINDOW_SECONDS)
  );
}

function registerLoginFailure(courseId, dni) {
  const now = Date.now();
  let state = readLoginState(courseId, dni);

  if (!state.windowStart || now - state.windowStart > STUDENT_LOGIN_WINDOW_SECONDS * 1000) {
    state = { failures: 0, windowStart: now, lockedUntil: 0 };
  }

  state.failures += 1;
  if (state.failures >= STUDENT_LOGIN_MAX_FAILURES) {
    state.lockedUntil = now + STUDENT_LOGIN_LOCK_SECONDS * 1000;
    saveLoginState(courseId, dni, state, STUDENT_LOGIN_LOCK_SECONDS);
    return true;
  }

  saveLoginState(courseId, dni, state, STUDENT_LOGIN_WINDOW_SECONDS);
  return false;
}

function handleCheck(body) {
  const course = studentAdminCourse(body.courseId);
  const student = findStudent(course, body.dni);
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
  const course = studentAdminCourse(body.courseId);
  const dni = normalizeDni(body.dni);
  requirePin(body.pin);

  const student = findStudent(course, dni);
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
      student.sheet.getRange(student.rowIndex, student.pinDateCol + 1).setValue(
        Utilities.formatDate(new Date(), STUDENT_TIMEZONE, "dd/MM/yyyy HH:mm")
      );
    }
  } finally {
    lock.releaseLock();
  }

  return issueSession(course, student);
}

function handleVerify(body) {
  const course = studentAdminCourse(body.courseId);
  const dni = normalizeDni(body.dni);
  requirePin(body.pin);

  const state = readLoginState(course.courseId, dni);
  if (state.lockedUntil && Date.now() < state.lockedUntil) {
    return { allowed: false, locked: true, msg: "Demasiados intentos. Probá nuevamente en unos minutos." };
  }

  const student = findStudent(course, dni);
  if (!student) return { allowed: false, msg: "DNI no encontrado en el padrón." };
  if (!student.activo) return { allowed: false, msg: "Tu acceso está deshabilitado." };
  if (!student.pinHash) return { allowed: false, msg: "No tenés un PIN registrado aún." };

  if (hashPin(dni, body.pin) !== student.pinHash) {
    const locked = registerLoginFailure(course.courseId, dni);
    return {
      allowed: false,
      locked,
      msg: locked
        ? "Demasiados intentos. Probá nuevamente en unos minutos."
        : "PIN incorrecto. Si lo olvidaste, contactá al docente.",
    };
  }

  CacheService.getScriptCache().remove(loginKey(course.courseId, dni));
  return issueSession(course, student);
}

function handleLog(body) {
  const auth = requireSession(body);
  const ss = studentSpreadsheetForCourse(auth.course);
  const student = auth.student;
  const now = new Date();
  const fecha = Utilities.formatDate(now, STUDENT_TIMEZONE, "dd/MM/yyyy");
  const hora = Utilities.formatDate(now, STUDENT_TIMEZONE, "HH:mm");
  const sid = String(body.sid || Utilities.getUuid()).toUpperCase().substring(0, 8);
  const mode = String(body.modeId || "consulta").trim();
  const q = String(body.q || "").trim().substring(0, 500);
  const r = String(body.r || "").trim().substring(0, 1000);
  const model = String(body.model || "").trim();

  const log = studentSheet(ss, "📝 Interacciones", [
    "Fecha","Hora","SID","DNI","Nombre y Apellido","Comisión","Modo",
    "Pregunta del alumno","Respuesta del asistente","Modelo"
  ]);
  log.insertRowAfter(1);
  log.getRange(2, 1, 1, 10).setValues([[
    fecha, hora, sid, student.dni,
    [student.apellido, student.nombre].filter(Boolean).join(", ") || student.dni,
    student.comision, mode, q, r, model
  ]]);

  const students = studentSheet(ss, "👤 Por alumno", [
    "ID/DNI","Nombre y Apellido","Comisión","Consultas","Primera consulta","Última consulta"
  ]);
  const data = students.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i += 1) {
    if (normalizeDni(data[i][0]) === student.dni) {
      rowIndex = i + 1;
      break;
    }
  }

  const stamp = fecha + " " + hora;
  const displayName = [student.apellido, student.nombre].filter(Boolean).join(", ") || student.dni;

  if (rowIndex < 0) {
    students.insertRowAfter(1);
    students.getRange(2, 1, 1, 6).setValues([[
      student.dni, displayName, student.comision, 1, stamp, stamp
    ]]);
  } else {
    const previousCount = Number(data[rowIndex - 1][3]) || 0;
    students.getRange(rowIndex, 2).setValue(displayName);
    students.getRange(rowIndex, 3).setValue(student.comision || data[rowIndex - 1][2] || "");
    students.getRange(rowIndex, 4).setValue(previousCount + 1);
    students.getRange(rowIndex, 6).setValue(stamp);
  }

  const summary = studentSheet(ss, "📊 Resumen", ["Métrica", "Valor"]);
  summary.clearContents();
  summary.getRange(1, 1, 1, 2).setValues([["Métrica","Valor"]]);
  summary.getRange(2, 1, 4, 2).setValues([
    ["Interacciones", Math.max(0, log.getLastRow() - 1)],
    ["Alumnos con actividad", Math.max(0, students.getLastRow() - 1)],
    ["Última actualización", stamp],
    ["Estado", "Activo"],
  ]);

  return { ok: true, tracked: true, total: Math.max(0, log.getLastRow() - 1) };
}
