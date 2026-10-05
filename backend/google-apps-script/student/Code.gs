// AULIA — shared student backend
// One public endpoint serves all published courses.
// Student data stays separated by course in its own Google Sheet.
// Pedagogical analytics are derived from the published Course Pack + interactions.

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
  const publishedFileCol = studentColumn(headers, ["Published Drive File ID"]);

  for (let i = 1; i < values.length; i += 1) {
    const id = studentCell(values[i], idCol);
    const slug = studentCell(values[i], slugCol);
    if (id !== target && slug !== target) continue;

    const status = studentCell(values[i], statusCol);
    const studentSheetId = studentCell(values[i], studentSheetCol);
    const publishedFileId = studentCell(values[i], publishedFileCol);

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
      publishedFileId,
    };
  }

  throw new Error("La cátedra no existe.");
}

function studentSpreadsheetForCourse(course) {
  return SpreadsheetApp.openById(course.studentSheetId);
}

function loadPublishedPack(course) {
  if (!course?.publishedFileId) {
    throw new Error("La cátedra no tiene una versión publicada disponible.");
  }
  const raw = DriveApp.getFileById(course.publishedFileId).getBlob().getDataAsString("UTF-8");
  const pack = JSON.parse(raw);
  if (String(pack?.id || "") !== String(course.courseId || "")) {
    throw new Error("El Course Pack publicado no coincide con la cátedra.");
  }
  return pack;
}

function studentSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (headers) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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

function clampConfusion(value) {
  const number = Number(value);
  if (!isFinite(number)) return 0;
  return Math.max(0, Math.min(2, Math.round(number)));
}

function confusionLabel(level) {
  return level === 2 ? "Reiterada" : level === 1 ? "Posible" : "Sin indicio";
}

function questionShowsConfusion(question) {
  const text = normalizeText(question);
  return /\b(no entiendo|no entiend(o|e)|no me queda claro|no comprendo|no comprendi|no logro entender|me confunde|estoy confundido|que significa|qué significa|no se si|no sé si|no entiendo por que|por que es que|entonces.*es|es lo mismo|seria lo mismo)\b/.test(text);
}

function listFromCell(value, separator) {
  return String(value || "")
    .split(separator || "|")
    .map(item => item.trim())
    .filter(Boolean);
}

function dateStampValue(fecha, hora) {
  const f = String(fecha || "").trim();
  const h = String(hora || "00:00").trim();
  const match = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number((h.split(":")[0] || "0")),
    Number((h.split(":")[1] || "0"))
  ).getTime();
}

function formatStampFromDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, STUDENT_TIMEZONE, "dd/MM/yyyy HH:mm");
}

function conceptMapFromPack(pack) {
  const map = {};
  for (const concept of pack?.concepts || []) {
    const id = String(concept?.id || "").trim();
    if (!id) continue;
    map[id] = concept;
  }
  return map;
}

function bibliographyMapFromPack(pack) {
  const map = {};
  for (const item of pack?.bibliography || []) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    map[id] = item;
  }
  return map;
}

function analyticsForInteraction(pack, body, question) {
  const concepts = conceptMapFromPack(pack);
  const requested = Array.isArray(body.conceptIds) ? body.conceptIds : [];
  const conceptIds = [...new Set(requested.map(id => String(id || "").trim()).filter(id => id && concepts[id]))];

  let level = clampConfusion(body.confusionLevel);
  if (level === 0 && questionShowsConfusion(question) && conceptIds.length) level = 1;

  const bibliography = bibliographyMapFromPack(pack);
  const sourceIds = [...new Set(conceptIds.flatMap(id => Array.isArray(concepts[id]?.sourceBibliographyIds)
    ? concepts[id].sourceBibliographyIds.map(value => String(value || "").trim()).filter(value => bibliography[value])
    : []))];

  const conceptTitles = conceptIds.map(id => String(concepts[id]?.title || id));
  const sourceTitles = sourceIds.map(id => {
    const ref = bibliography[id];
    return [ref?.title, ref?.author, ref?.year].filter(Boolean).join(" · ");
  }).filter(Boolean);

  return {
    conceptIds,
    conceptTitles,
    sourceIds,
    sourceTitles,
    confusionLevel: level,
    confusion: confusionLabel(level),
  };
}

function commissionDescriptors(pack) {
  return (pack?.commissions || []).map((item, index) => ({
    index,
    id: String(item?.id || "").trim(),
    title: String(item?.title || "").trim(),
    code: String(item?.code || "").trim(),
  }));
}

function commissionMatches(value, descriptor) {
  const target = normalizeText(value);
  if (!target) return false;
  const code = normalizeText(descriptor?.code);
  const title = normalizeText(descriptor?.title);
  const full = normalizeText("comision " + (descriptor?.code || descriptor?.title || ""));
  return target === code || target === title || target === full ||
    (code && target.includes(code) && target.includes("comision")) ||
    (title && target.includes(title));
}

function commissionSheetName(descriptor, index) {
  const colors = ["🟦", "🟩", "🟨", "🟪", "🟧", "🟥", "⬜"];
  const label = descriptor?.code || descriptor?.title || ("Comisión " + (index + 1));
  return (colors[index % colors.length] + " Comisión " + label).slice(0, 100);
}

function analysisHeaders() {
  return [
    "DNI", "Nombre y Apellido", "Comisión", "Consultas", "Sesiones",
    "Modos utilizados", "Conceptos trabajados", "Posibles confusiones",
    "Confusiones reiteradas", "Primera actividad", "Última actividad", "Estado"
  ];
}

function ensureAnalysisSheets(ss, pack) {
  const interactionHeaders = [
    "Fecha", "Hora", "SID", "DNI", "Nombre y Apellido", "Comisión", "Modo",
    "Concepto IDs", "Conceptos", "Fuentes bibliográficas", "Confusión",
    "Nivel confusión", "Pregunta del alumno", "Respuesta del asistente", "Modelo"
  ];
  studentSheet(ss, "📝 Interacciones", interactionHeaders);
  studentSheet(ss, "👤 Por alumno", analysisHeaders());
  studentSheet(ss, "🧠 Conceptos", [
    "Concepto", "Fuentes bibliográficas", "Alumnos", "Interacciones",
    "Posibles confusiones", "Confusiones reiteradas", "Total confusión",
    "% confusión", "Última actividad"
  ]);
  studentSheet(ss, "📊 Resumen", ["Métrica", "Valor"]);

  commissionDescriptors(pack).forEach((descriptor, index) => {
    studentSheet(ss, commissionSheetName(descriptor, index), analysisHeaders());
  });
}

function readRoster(ss) {
  const sheet = studentSheet(ss, "📋 Padrón", [
    "DNI", "Apellido", "Nombre", "Comisión", "Activo (Sí/No)",
    "PIN Hash (no tocar)", "Fecha registro PIN"
  ]);
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const dniCol = studentColumn(headers, ["DNI"]);
  const lastCol = studentColumn(headers, ["Apellido"]);
  const nameCol = studentColumn(headers, ["Nombre"]);
  const commissionCol = studentColumn(headers, ["Comisión", "Comision"]);
  const activeCol = studentColumn(headers, ["Activo (Sí/No)", "Activo"]);

  const rows = [];
  for (let i = 1; i < values.length; i += 1) {
    const dni = normalizeDni(values[i][dniCol]);
    if (!dni) continue;
    rows.push({
      dni,
      nombre: [studentCell(values[i], lastCol), studentCell(values[i], nameCol)].filter(Boolean).join(", ") || dni,
      comision: studentCell(values[i], commissionCol),
      activo: activeCol < 0 ? true : isActive(values[i][activeCol]),
    });
  }
  return rows;
}

function readInteractions(ss) {
  const sheet = studentSheet(ss, "📝 Interacciones", [
    "Fecha", "Hora", "SID", "DNI", "Nombre y Apellido", "Comisión", "Modo",
    "Concepto IDs", "Conceptos", "Fuentes bibliográficas", "Confusión",
    "Nivel confusión", "Pregunta del alumno", "Respuesta del asistente", "Modelo"
  ]);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];

  const ix = {
    fecha: studentColumn(headers, ["Fecha"]),
    hora: studentColumn(headers, ["Hora"]),
    sid: studentColumn(headers, ["SID"]),
    dni: studentColumn(headers, ["DNI"]),
    name: studentColumn(headers, ["Nombre y Apellido"]),
    commission: studentColumn(headers, ["Comisión", "Comision"]),
    mode: studentColumn(headers, ["Modo"]),
    conceptIds: studentColumn(headers, ["Concepto IDs"]),
    concepts: studentColumn(headers, ["Conceptos"]),
    sources: studentColumn(headers, ["Fuentes bibliográficas"]),
    confusion: studentColumn(headers, ["Confusión"]),
    level: studentColumn(headers, ["Nivel confusión"]),
    question: studentColumn(headers, ["Pregunta del alumno"]),
  };

  return values.slice(1).map(row => ({
    fecha: studentCell(row, ix.fecha),
    hora: studentCell(row, ix.hora),
    sid: studentCell(row, ix.sid),
    dni: normalizeDni(studentCell(row, ix.dni)),
    nombre: studentCell(row, ix.name),
    comision: studentCell(row, ix.commission),
    mode: studentCell(row, ix.mode),
    conceptIds: listFromCell(row[ix.conceptIds], "|"),
    concepts: listFromCell(row[ix.concepts], ";"),
    sources: listFromCell(row[ix.sources], ";"),
    confusion: studentCell(row, ix.confusion),
    level: clampConfusion(studentCell(row, ix.level)),
    question: studentCell(row, ix.question),
    timestamp: dateStampValue(studentCell(row, ix.fecha), studentCell(row, ix.hora)),
  })).filter(row => row.dni);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
}

function writeTable(sheet, startRow, startCol, headers, rows) {
  const width = headers.length;
  const clearRows = Math.max(sheet.getLastRow() - startRow + 1, rows.length + 2, 3);
  sheet.getRange(startRow, startCol, clearRows, width).clearContent();
  sheet.getRange(startRow, startCol, 1, width).setValues([headers]);
  if (rows.length) sheet.getRange(startRow + 1, startCol, rows.length, width).setValues(rows);
  return rows.length;
}

function styleHeader(range) {
  range
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#30343b");
}

function styleSection(range) {
  range
    .setFontWeight("bold")
    .setBackground("#e8eaed");
}

function formatAnalysisSheet(sheet, widths) {
  try {
    widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, widths.length).setFontWeight("bold").setBackground("#30343b").setFontColor("#ffffff");
  } catch (e) {}
}

function buildStudentStats(roster, interactions) {
  const stats = {};
  roster.forEach(student => {
    stats[student.dni] = {
      ...student,
      interactions: 0,
      sessions: new Set(),
      modes: new Set(),
      concepts: new Set(),
      possibleConfusion: 0,
      repeatedConfusion: 0,
      firstTs: 0,
      lastTs: 0,
    };
  });

  interactions.forEach(item => {
    const entry = stats[item.dni] || (stats[item.dni] = {
      dni: item.dni,
      nombre: item.nombre || item.dni,
      comision: item.comision || "",
      activo: true,
      interactions: 0,
      sessions: new Set(),
      modes: new Set(),
      concepts: new Set(),
      possibleConfusion: 0,
      repeatedConfusion: 0,
      firstTs: 0,
      lastTs: 0,
    });

    entry.interactions += 1;
    if (item.sid) entry.sessions.add(item.sid);
    if (item.mode) entry.modes.add(item.mode);
    item.conceptIds.forEach(id => entry.concepts.add(id));
    if (item.level >= 1) entry.possibleConfusion += 1;
    if (item.level >= 2) entry.repeatedConfusion += 1;
    if (item.timestamp) {
      if (!entry.firstTs || item.timestamp < entry.firstTs) entry.firstTs = item.timestamp;
      if (!entry.lastTs || item.timestamp > entry.lastTs) entry.lastTs = item.timestamp;
    }
  });

  return stats;
}

function buildConceptStats(pack, roster, interactions) {
  const concepts = conceptMapFromPack(pack);
  const stats = {};
  Object.keys(concepts).forEach(id => {
    const concept = concepts[id];
    stats[id] = {
      id,
      title: String(concept?.title || id),
      sourceIds: Array.isArray(concept?.sourceBibliographyIds) ? concept.sourceBibliographyIds : [],
      students: new Set(),
      interactions: 0,
      possibleConfusion: 0,
      repeatedConfusion: 0,
      lastTs: 0,
    };
  });

  interactions.forEach(item => {
    item.conceptIds.forEach(id => {
      if (!stats[id]) return;
      const entry = stats[id];
      entry.interactions += 1;
      if (item.dni) entry.students.add(item.dni);
      if (item.level >= 1) entry.possibleConfusion += 1;
      if (item.level >= 2) entry.repeatedConfusion += 1;
      if (item.timestamp && item.timestamp > entry.lastTs) entry.lastTs = item.timestamp;
    });
  });

  return stats;
}

function buildCommissionStats(pack, roster, interactions, studentStats) {
  const descriptors = commissionDescriptors(pack);
  const groups = descriptors.map((descriptor, index) => ({
    key: "declared-" + index,
    descriptor,
    sheetName: commissionSheetName(descriptor, index),
    students: roster.filter(student => commissionMatches(student.comision, descriptor)),
    interactions: interactions.filter(item => commissionMatches(item.comision, descriptor)),
  }));

  const assigned = new Set();
  groups.forEach(group => group.students.forEach(student => assigned.add(student.dni)));
  const extraValues = uniqueSorted(roster.map(student => student.comision).filter(value =>
    value && !descriptors.some(descriptor => commissionMatches(value, descriptor))
  ));

  extraValues.forEach((value, index) => {
    groups.push({
      key: "extra-" + index,
      descriptor: { id: "", title: value, code: value },
      sheetName: commissionSheetName({ title: value, code: value }, descriptors.length + index),
      students: roster.filter(student => normalizeText(student.comision) === normalizeText(value)),
      interactions: interactions.filter(item => normalizeText(item.comision) === normalizeText(value)),
    });
  });

  return groups.map(group => {
    const activeStudents = group.students.filter(student => (studentStats[student.dni]?.interactions || 0) > 0).length;
    const confusion = group.interactions.filter(item => item.level >= 1).length;
    return { ...group, activeStudents, confusion };
  });
}

function renderStudentRows(students, studentStats, concepts) {
  return students
    .map(student => {
      const stat = studentStats[student.dni] || {};
      const conceptTitles = [...(stat.concepts || new Set())]
        .map(id => concepts[id]?.title || id)
        .sort((a, b) => String(a).localeCompare(String(b), "es"));
      return [
        student.dni,
        stat.nombre || student.nombre || student.dni,
        stat.comision || student.comision || "",
        Number(stat.interactions || 0),
        (stat.sessions instanceof Set ? stat.sessions.size : 0),
        uniqueSorted(stat.modes instanceof Set ? [...stat.modes] : []).join(" · "),
        conceptTitles.join(" · "),
        Number(stat.possibleConfusion || 0),
        Number(stat.repeatedConfusion || 0),
        stat.firstTs ? formatStampFromDate(new Date(stat.firstTs)) : "—",
        stat.lastTs ? formatStampFromDate(new Date(stat.lastTs)) : "—",
        stat.interactions > 0 ? "Activo" : "Sin actividad",
      ];
    })
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es"));
}

function updateCommissionSheets(ss, commissionGroups, studentStats, concepts) {
  const headers = analysisHeaders();
  commissionGroups.forEach(group => {
    const sheet = studentSheet(ss, group.sheetName, headers);
    const rows = renderStudentRows(group.students, studentStats, concepts);
    writeTable(sheet, 1, 1, headers, rows);
    formatAnalysisSheet(sheet, [110, 190, 120, 85, 80, 190, 240, 110, 115, 135, 135, 100]);

    const total = group.students.length;
    const active = group.activeStudents;
    const interactions = group.interactions.length;
    const confusion = group.confusion;

    sheet.getRange(1, 14, 4, 2).setValues([
      ["ALUMNOS", total],
      ["CON ACTIVIDAD", active],
      ["INTERACCIONES", interactions],
      ["POSIBLES CONFUSIONES", confusion],
    ]);
    sheet.getRange(1, 14, 4, 1).setFontWeight("bold").setBackground("#e8eaed");
    sheet.getRange(1, 15, 4, 1).setFontWeight("bold");
  });
}

function updatePorAlumno(ss, studentStats, concepts) {
  const rosterStudents = Object.values(studentStats);
  const rows = rosterStudents.map(stat => {
    const conceptTitles = [...stat.concepts].map(id => concepts[id]?.title || id).sort((a, b) => String(a).localeCompare(String(b), "es"));
    return [
      stat.dni,
      stat.nombre,
      stat.comision,
      stat.interactions,
      stat.sessions.size,
      uniqueSorted([...stat.modes]).join(" · "),
      conceptTitles.join(" · "),
      stat.possibleConfusion,
      stat.repeatedConfusion,
      stat.firstTs ? formatStampFromDate(new Date(stat.firstTs)) : "—",
      stat.lastTs ? formatStampFromDate(new Date(stat.lastTs)) : "—",
      stat.interactions > 0 ? "Activo" : "Sin actividad",
    ];
  }).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es"));

  const sheet = studentSheet(ss, "👤 Por alumno", analysisHeaders());
  writeTable(sheet, 1, 1, analysisHeaders(), rows);
  formatAnalysisSheet(sheet, [110, 190, 120, 85, 80, 190, 240, 110, 115, 135, 135, 100]);
}

function updateConceptsSheet(ss, pack, interactions) {
  const stats = buildConceptStats(pack, readRoster(ss), interactions);
  const bibliography = bibliographyMapFromPack(pack);
  const rows = Object.values(stats).map(stat => {
    const sourceTitles = stat.sourceIds.map(id => bibliography[id]).filter(Boolean).map(ref =>
      [ref.title, ref.author, ref.year].filter(Boolean).join(" · ")
    );
    const totalConfusion = stat.possibleConfusion;
    const ratio = stat.interactions ? totalConfusion / stat.interactions : 0;
    return [
      stat.title,
      sourceTitles.join(" · "),
      stat.students.size,
      stat.interactions,
      stat.possibleConfusion,
      stat.repeatedConfusion,
      totalConfusion,
      ratio,
      stat.lastTs ? formatStampFromDate(new Date(stat.lastTs)) : "—",
    ];
  }).sort((a, b) => Number(b[3]) - Number(a[3]) || Number(b[4]) - Number(a[4]));

  const sheet = studentSheet(ss, "🧠 Conceptos", [
    "Concepto", "Fuentes bibliográficas", "Alumnos", "Interacciones",
    "Posibles confusiones", "Confusiones reiteradas", "Total confusión",
    "% confusión", "Última actividad"
  ]);
  writeTable(sheet, 1, 1, [
    "Concepto", "Fuentes bibliográficas", "Alumnos", "Interacciones",
    "Posibles confusiones", "Confusiones reiteradas", "Total confusión",
    "% confusión", "Última actividad"
  ], rows);
  formatAnalysisSheet(sheet, [190, 280, 80, 100, 120, 130, 110, 100, 135]);
  if (rows.length) sheet.getRange(2, 8, rows.length, 1).setNumberFormat("0.0%");
}

function modeStats(interactions) {
  const map = {};
  interactions.forEach(item => {
    const key = item.mode || "Sin modo";
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function updateSummary(ss, pack, roster, interactions, studentStats, commissionGroups, conceptStats) {
  const sheet = studentSheet(ss, "📊 Resumen", ["Métrica", "Valor"]);
  sheet.clearContents();

  const activeStudents = Object.values(studentStats).filter(stat => stat.interactions > 0).length;
  const totalInteractions = interactions.length;
  const possibleConfusion = interactions.filter(item => item.level >= 1).length;
  const repeatedConfusion = interactions.filter(item => item.level >= 2).length;
  const avg = activeStudents ? totalInteractions / activeStudents : 0;
  const lastTs = interactions.reduce((max, item) => Math.max(max, item.timestamp || 0), 0);

  sheet.getRange(1, 1, 1, 2).merge().setValue("AULIA · " + String(pack?.title || "Cátedra") + " · RESUMEN");
  sheet.getRange(1, 1).setFontWeight("bold").setFontSize(16).setBackground("#30343b").setFontColor("#ffffff");

  sheet.getRange(3, 1, 1, 2).setValues([["VISIÓN GENERAL", ""]]);
  styleSection(sheet.getRange(3, 1, 1, 2));
  sheet.getRange(4, 1, 7, 2).setValues([
    ["Alumnos en padrón", roster.length],
    ["Alumnos con actividad", activeStudents],
    ["Sin actividad", Math.max(0, roster.length - activeStudents)],
    ["Interacciones", totalInteractions],
    ["Promedio por alumno activo", avg],
    ["Posibles confusiones", possibleConfusion],
    ["Confusiones reiteradas", repeatedConfusion],
  ]);
  sheet.getRange(4, 2).setNumberFormat("0.0");

  let row = 12;
  sheet.getRange(row, 1, 1, 4).setValues([["POR COMISIÓN", "", "", ""]]);
  styleSection(sheet.getRange(row, 1, 1, 4));
  row += 1;
  sheet.getRange(row, 1, 1, 4).setValues([["Comisión", "Alumnos", "Con actividad", "Interacciones"]]);
  styleHeader(sheet.getRange(row, 1, 1, 4));
  row += 1;
  const commissionRows = commissionGroups.map(group => [
    group.descriptor.code || group.descriptor.title || "Sin comisión",
    group.students.length,
    group.activeStudents,
    group.interactions.length,
  ]);
  if (commissionRows.length) sheet.getRange(row, 1, commissionRows.length, 4).setValues(commissionRows);
  row += Math.max(commissionRows.length, 1) + 1;

  sheet.getRange(row, 1, 1, 3).setValues([["MODOS MÁS UTILIZADOS", "", ""]]);
  styleSection(sheet.getRange(row, 1, 1, 3));
  row += 1;
  sheet.getRange(row, 1, 1, 3).setValues([["Modo", "Interacciones", "%"]]);
  styleHeader(sheet.getRange(row, 1, 1, 3));
  row += 1;
  const modes = modeStats(interactions);
  const modeRows = modes.map(([mode, count]) => [mode, count, totalInteractions ? count / totalInteractions : 0]);
  if (modeRows.length) sheet.getRange(row, 1, modeRows.length, 3).setValues(modeRows);
  if (modeRows.length) sheet.getRange(row, 3, modeRows.length, 1).setNumberFormat("0.0%");
  row += Math.max(modeRows.length, 1) + 2;

  const sortedConcepts = Object.values(conceptStats).sort((a, b) =>
    b.interactions - a.interactions || b.possibleConfusion - a.possibleConfusion
  );
  sheet.getRange(row, 1, 1, 4).setValues([["CONCEPTOS MÁS TRABAJADOS", "", "", ""]]);
  styleSection(sheet.getRange(row, 1, 1, 4));
  row += 1;
  sheet.getRange(row, 1, 1, 4).setValues([["Concepto", "Alumnos", "Interacciones", "Posibles confusiones"]]);
  styleHeader(sheet.getRange(row, 1, 1, 4));
  row += 1;
  const conceptRows = sortedConcepts.slice(0, 12).map(stat => [
    stat.title, stat.students.size, stat.interactions, stat.possibleConfusion
  ]);
  if (conceptRows.length) sheet.getRange(row, 1, conceptRows.length, 4).setValues(conceptRows);
  row += Math.max(conceptRows.length, 1) + 2;

  const confusedConcepts = [...sortedConcepts].sort((a, b) =>
    b.possibleConfusion - a.possibleConfusion || b.interactions - a.interactions
  );
  sheet.getRange(row, 1, 1, 4).setValues([["CONCEPTOS CON MÁS POSIBLE CONFUSIÓN", "", "", ""]]);
  styleSection(sheet.getRange(row, 1, 1, 4));
  row += 1;
  sheet.getRange(row, 1, 1, 4).setValues([["Concepto", "Interacciones", "Posibles confusiones", "% confusión"]]);
  styleHeader(sheet.getRange(row, 1, 1, 4));
  row += 1;
  const confusionRows = confusedConcepts.filter(stat => stat.interactions > 0).slice(0, 12).map(stat => [
    stat.title,
    stat.interactions,
    stat.possibleConfusion,
    stat.interactions ? stat.possibleConfusion / stat.interactions : 0,
  ]);
  if (confusionRows.length) {
    sheet.getRange(row, 1, confusionRows.length, 4).setValues(confusionRows);
    sheet.getRange(row, 4, confusionRows.length, 1).setNumberFormat("0.0%");
  }
  row += Math.max(confusionRows.length, 1) + 2;

  sheet.getRange(row, 1, 1, 2).setValues([["ÚLTIMA ACTIVIDAD", lastTs ? formatStampFromDate(new Date(lastTs)) : "—"]]);
  styleSection(sheet.getRange(row, 1, 1, 1));

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 180);
  sheet.setFrozenRows(1);
}

function refreshAnalytics(ss, pack) {
  const roster = readRoster(ss);
  const interactions = readInteractions(ss);
  ensureAnalysisSheets(ss, pack);

  const studentStats = buildStudentStats(roster, interactions);
  const concepts = conceptMapFromPack(pack);
  const conceptStats = buildConceptStats(pack, roster, interactions);
  const commissionGroups = buildCommissionStats(pack, roster, interactions, studentStats);

  updatePorAlumno(ss, studentStats, concepts);
  updateConceptsSheet(ss, pack, interactions);
  updateCommissionSheets(ss, commissionGroups, studentStats, concepts);
  updateSummary(ss, pack, roster, interactions, studentStats, commissionGroups, conceptStats);
}

function handleLog(body) {
  const auth = requireSession(body);
  const ss = studentSpreadsheetForCourse(auth.course);
  const pack = loadPublishedPack(auth.course);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    ensureAnalysisSheets(ss, pack);

    const now = new Date();
    const fecha = Utilities.formatDate(now, STUDENT_TIMEZONE, "dd/MM/yyyy");
    const hora = Utilities.formatDate(now, STUDENT_TIMEZONE, "HH:mm");
    const sid = String(body.sid || Utilities.getUuid()).toUpperCase().substring(0, 8);
    const mode = String(body.modeId || "consulta").trim();
    const q = String(body.q || "").trim().substring(0, 500);
    const r = String(body.r || "").trim().substring(0, 1000);
    const model = String(body.model || "").trim();
    const analytics = analyticsForInteraction(pack, body, q);

    const log = studentSheet(ss, "📝 Interacciones", [
      "Fecha", "Hora", "SID", "DNI", "Nombre y Apellido", "Comisión", "Modo",
      "Concepto IDs", "Conceptos", "Fuentes bibliográficas", "Confusión",
      "Nivel confusión", "Pregunta del alumno", "Respuesta del asistente", "Modelo"
    ]);
    log.insertRowAfter(1);
    log.getRange(2, 1, 1, 15).setValues([[
      fecha,
      hora,
      sid,
      auth.student.dni,
      [auth.student.apellido, auth.student.nombre].filter(Boolean).join(", ") || auth.student.dni,
      auth.student.comision,
      mode,
      analytics.conceptIds.join("|"),
      analytics.conceptTitles.join("; "),
      analytics.sourceTitles.join("; "),
      analytics.confusion,
      analytics.confusionLevel,
      q,
      r,
      model
    ]]);

    refreshAnalytics(ss, pack);
    return {
      ok: true,
      tracked: true,
      total: Math.max(0, log.getLastRow() - 1),
      concepts: analytics.conceptIds,
      confusionLevel: analytics.confusionLevel,
    };
  } finally {
    lock.releaseLock();
  }
}
