// AULIA — CHIONIA pilot tracking and teacher views

function handleLog(body) {
  const auth = requireSession(body);
  const student = auth.student;
  const q = String(body.q || "").trim();
  const r = String(body.r || "").trim();
  const model = String(body.model || "").trim();
  const mode = labelMode(body.modeId);
  const concepts = detectConcepts(q);
  const confusion = detectConfusion(q);
  const now = new Date();
  const fecha = Utilities.formatDate(now, TIMEZONE, "dd/MM/yyyy");
  const hora = Utilities.formatDate(now, TIMEZONE, "HH:mm");
  const sid = String(body.sid || Utilities.getUuid()).toUpperCase().substring(0, 8);
  const displayName = student.apellido && student.nombre
    ? student.apellido + ", " + student.nombre
    : (student.apellido || student.nombre || student.dni);
  const ss = getSpreadsheet();

  writeInteraction(ss, fecha, hora, sid, student.dni, displayName, student.comision,
    q, r, model, mode, concepts, confusion);
  const isNew = updateStudent(ss, student.dni, displayName, student.comision,
    fecha, hora, concepts, confusion);
  updateConceptRanking(ss, concepts);

  const logSheet = ss.getSheetByName(SHEETS.log);
  const total = logSheet ? Math.max(0, logSheet.getLastRow() - 1) : 0;
  if (isNew || total <= 3 || total % 10 === 0) {
    updateCommissionViews(ss);
    updateSummary(ss);
  }
  return { ok: true, tracked: true, total };
}

function labelMode(modeId) {
  const id = String(modeId || "").trim();
  return MODE_LABELS[id] || "Consulta";
}

function detectConcepts(question) {
  const text = normalizeText(question);
  return CONCEPTOS.filter(concept => text.includes(normalizeText(concept)));
}

function detectConfusion(question) {
  const text = normalizeText(question);
  return CONFUSION_PATTERNS.some(pattern => text.includes(normalizeText(pattern)));
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  const row = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (row.every(value => !String(value || "").trim())) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function writeInteraction(ss, fecha, hora, sid, dni, displayName, comision,
  q, r, model, modo, concepts, confusion) {
  const sheet = ss.getSheetByName(SHEETS.log) || ss.insertSheet(SHEETS.log);
  const headers = [
    "Fecha","Hora","SID","DNI","Nombre y Apellido","Comisión","Modo",
    "Conceptos detectados","¿Confusión?","Pregunta del alumno",
    "Respuesta de Chion (inicio)","Modelo",
  ];
  ensureHeaders(sheet, headers);
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 12).setValues([[
    fecha, hora, sid, dni, displayName, comision, modo,
    concepts.join(", ") || "—", confusion ? "⚠ Sí" : "No",
    q.substring(0, 500), r.substring(0, 400), model,
  ]]);
}

function updateStudent(ss, dni, displayName, comision, fecha, hora, concepts, confusion) {
  const sheet = ss.getSheetByName(SHEETS.alumno) || ss.insertSheet(SHEETS.alumno);
  const headers = [
    "ID/DNI","Nombre y Apellido","Comisión","Consultas","Primera consulta",
    "Última consulta","Conceptos trabajados","Nro. confusiones","Nivel de uso","Observación automática",
  ];
  ensureHeaders(sheet, headers);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i += 1) {
    if (normalizeDni(data[i][0]) === normalizeDni(dni)) { rowIndex = i + 1; break; }
  }

  const timestamp = fecha + " " + hora;
  if (rowIndex < 0) {
    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, 10).setValues([[
      dni, displayName, comision, 1, timestamp, timestamp,
      concepts.join(", ") || "—", confusion ? 1 : 0,
      usageLevel(1, false), usageObservation(1, confusion ? 1 : 0, concepts),
    ]]);
    return true;
  }

  const row = data[rowIndex - 1];
  const total = (parseInt(row[3], 10) || 0) + 1;
  const confusions = (parseInt(row[7], 10) || 0) + (confusion ? 1 : 0);
  const previous = String(row[6] || "") === "—" ? [] : String(row[6] || "").split(", ").filter(Boolean);
  const allConcepts = [...new Set(previous.concat(concepts))];
  sheet.getRange(rowIndex, 2).setValue(displayName);
  sheet.getRange(rowIndex, 3).setValue(comision || row[2] || "");
  sheet.getRange(rowIndex, 4).setValue(total);
  sheet.getRange(rowIndex, 6).setValue(timestamp);
  sheet.getRange(rowIndex, 7).setValue(allConcepts.join(", ") || "—");
  sheet.getRange(rowIndex, 8).setValue(confusions);
  sheet.getRange(rowIndex, 9).setValue(usageLevel(total, confusions / total > 0.35));
  sheet.getRange(rowIndex, 10).setValue(usageObservation(total, confusions, allConcepts));
  return false;
}

function usageLevel(total, confusionHigh) {
  if (total === 0) return "🔴 Sin uso";
  if (total < 3) return "🟡 Inicial";
  if (confusionHigh) return "🟠 Dificultad";
  if (total < 8) return "🟢 Activo";
  return "⭐ Avanzado";
}

function usageObservation(total, confusionCount, concepts) {
  if (total === 0) return "No ha usado el bot aún.";
  const ratio = confusionCount / total;
  const count = Array.isArray(concepts) ? concepts.length : 0;
  const notes = [];
  if (ratio > 0.5) notes.push("⚠ Confusión frecuente — intervención recomendada");
  else if (ratio > 0.35) notes.push("Señales de dificultad conceptual");
  if (count >= 8) notes.push("Amplia exploración: " + count + " conceptos distintos");
  if (count <= 2 && total >= 5) notes.push("Consultas repetitivas — poca variedad conceptual");
  if (total >= 15) notes.push("Alta participación");
  if (total === 1) notes.push("Una sola consulta");
  return notes.length ? notes.join(" · ") : "Uso normal";
}

function updateConceptRanking(ss, concepts) {
  if (!concepts.length) return;
  const sheet = ss.getSheetByName(SHEETS.conceptos) || ss.insertSheet(SHEETS.conceptos);
  const headers = ["Concepto de Chion","Frecuencia de consultas"];
  ensureHeaders(sheet, headers);
  const values = sheet.getDataRange().getValues();
  const counts = {};
  for (let i = 1; i < values.length; i += 1) {
    const name = String(values[i][0] || "").trim();
    if (name) counts[name] = parseInt(values[i][1], 10) || 0;
  }
  concepts.forEach(name => { counts[name] = (counts[name] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 2).setValues([headers]);
  if (sorted.length) sheet.getRange(2, 1, sorted.length, 2).setValues(sorted);
}

function parseLogDate(fecha, hora) {
  const f = String(fecha || "").split("/");
  const h = String(hora || "00:00").split(":");
  if (f.length !== 3) return null;
  const date = new Date(Number(f[2]), Number(f[1]) - 1, Number(f[0]), Number(h[0] || 0), Number(h[1] || 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function updateSummary(ss) {
  const sheet = ss.getSheetByName(SHEETS.resumen) || ss.insertSheet(SHEETS.resumen, 0);
  const log = ss.getSheetByName(SHEETS.log);
  const students = ss.getSheetByName(SHEETS.alumno);
  const concepts = ss.getSheetByName(SHEETS.conceptos);
  const logData = log ? log.getDataRange().getValues().slice(1) : [];
  const studentData = students ? students.getDataRange().getValues().slice(1) : [];
  const conceptData = concepts ? concepts.getDataRange().getValues().slice(1) : [];

  const total = logData.length;
  const learners = new Set(logData.map(row => String(row[3] || "").trim()).filter(Boolean)).size;
  const confusionCount = logData.filter(row => String(row[8] || "").includes("Sí")).length;
  const last24h = logData.filter(row => {
    const date = parseLogDate(row[0], row[1]);
    return date && Date.now() - date.getTime() <= 86400000;
  }).length;
  const nSinUso = studentData.filter(row => String(row[8] || "").includes("Sin uso")).length;
  const nInicial = studentData.filter(row => String(row[8] || "").includes("Inicial")).length;
  const nDificultad = studentData.filter(row => String(row[8] || "").includes("Dificultad")).length;
  const nActivo = studentData.filter(row => String(row[8] || "").includes("Activo")).length;
  const nAvanzado = studentData.filter(row => String(row[8] || "").includes("Avanzado")).length;

  sheet.clearContents();
  sheet.getRange(1, 1).setValue("AULIA · Panel Docente · CHIONIA");
  sheet.getRange(2, 1).setValue("Actualizado: " + Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy HH:mm"));
  const rows = [
    ["ACTIVIDAD GLOBAL", ""],
    ["Total de interacciones registradas", total],
    ["Alumnos identificados", learners],
    ["Interacciones en las últimas 24 h", last24h],
    ["Preguntas con señales de confusión", confusionCount],
    ["", ""],
    ["ESTADO DE LOS ALUMNOS", ""],
    ["⭐ Avanzado — alta participación", nAvanzado],
    ["🟢 Activo — uso regular", nActivo],
    ["🟠 Dificultad — confusión frecuente", nDificultad],
    ["🟡 Inicial — pocas consultas", nInicial],
    ["🔴 Sin uso — no han consultado", nSinUso],
    ["", ""],
    ["ALERTAS PARA EL DOCENTE", ""],
    [nDificultad ? "Alumnos con dificultad" : "Sin alertas de dificultad", nDificultad],
    [nSinUso ? "Alumnos sin uso" : "Sin alumnos sin uso", nSinUso],
    ["", ""],
    ["CONCEPTOS MÁS CONSULTADOS", ""],
    [conceptData.slice(0,5).map(row => String(row[0] || "") + " (" + (row[1] || 0) + ")").join(" · ") || "sin datos aún", ""],
  ];
  sheet.getRange(4, 1, rows.length, 2).setValues(rows);
  sheet.setColumnWidth(1, 360);
  sheet.setColumnWidth(2, 180);
}

function updateCommissionViews(ss) {
  const studentSheet = ss.getSheetByName(SHEETS.alumno);
  if (!studentSheet) return;
  const all = studentSheet.getDataRange().getValues().slice(1);
  const groups = {};
  COMISIONES_NOMBRES.forEach(name => { groups[name] = []; });
  all.forEach(row => {
    const raw = String(row[2] || "").trim();
    if (groups[raw]) { groups[raw].push(row); return; }
    const normalized = normalizeText(raw);
    const match = COMISIONES_NOMBRES.find(name => {
      const day = normalizeText(name.split("—")[1] || "");
      return day && normalized.includes(day);
    });
    if (match) groups[match].push(row);
  });

  const headers = ["DNI","Nombre y Apellido","Consultas","Primera consulta","Última consulta","Conceptos trabajados","Confusiones","Nivel","Observación"];
  const order = {"⭐ Avanzado":0,"🟢 Activo":1,"🟠 Dificultad":2,"🟡 Inicial":3,"🔴 Sin uso":4};
  const mapping = {
    "Comisión 1 — Lunes": SHEETS.lunes,
    "Comisión 2 — Miércoles": SHEETS.miercoles,
    "Comisión 3 — Jueves": SHEETS.jueves,
  };

  Object.entries(mapping).forEach(([commission, name]) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.clearContents();
    sheet.getRange(1, 1).setValue(commission);
    sheet.getRange(2, 1, 1, headers.length).setValues([headers]);
    const group = (groups[commission] || []).slice().sort((a,b) => (order[a[8]] ?? 5) - (order[b[8]] ?? 5));
    if (!group.length) {
      sheet.getRange(3, 1).setValue("Sin datos aún — los alumnos de esta comisión aparecerán aquí automáticamente");
      return;
    }
    const rows = group.map(a => [a[0],a[1],a[3],a[4],a[5],a[6],a[7],a[8],a[9]]);
    sheet.getRange(3, 1, rows.length, 9).setValues(rows);
    const totalQueries = group.reduce((sum,row) => sum + (parseInt(row[3],10) || 0), 0);
    const difficulty = group.filter(row => String(row[8] || "").includes("Dificultad")).length;
    const unused = group.filter(row => String(row[8] || "").includes("Sin uso")).length;
    const footerRow = group.length + 4;
    sheet.getRange(footerRow, 1, 1, 9).merge();
    sheet.getRange(footerRow, 1).setValue(
      "RESUMEN: " + group.length + " alumnos · " + totalQueries + " consultas totales · " +
      difficulty + " con dificultad · " + unused + " sin uso"
    );
  });
}
