// AULIA — Teacher Studio courses, authorization and publication

function studioCourseSheetIds(course) {
  const headers = course.sheet.getRange(1, 1, 1, course.sheet.getLastColumn()).getValues()[0];
  return {
    studentSheetId: studioColumn(headers, ["Student Sheet ID"]),
    studentSheetUrl: studioColumn(headers, ["Student Sheet URL"]),
  };
}

function studioCommissionSheetName(commission, index) {
  const colors = ["🟦", "🟩", "🟨", "🟪", "🟧", "🟥", "⬜"];
  const code = String(commission?.code || "").trim();
  const title = String(commission?.title || "").trim();
  const label = code || title || ("Comisión " + (index + 1));
  return (colors[index % colors.length] + " Comisión " + label).slice(0, 100);
}

function studioEnsureCommissionSheets(ss, commissions = []) {
  const headers = [
    "DNI", "Nombre y Apellido", "Comisión", "Consultas", "Sesiones",
    "Modos utilizados", "Conceptos trabajados", "Posibles confusiones",
    "Confusiones reiteradas", "Primera actividad", "Última actividad", "Estado"
  ];

  (commissions || []).forEach((commission, index) => {
    const name = studioCommissionSheetName(commission, index);
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    try {
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      sheet.setColumnWidths(1, headers.length, 125);
      sheet.setColumnWidth(2, 190);
      sheet.setColumnWidth(7, 220);
    } catch (e) {}
  });
}

function studioInitializeStudentWorkbook(title, commissions = []) {
  const ss = SpreadsheetApp.create("AULIA · " + String(title || "Cátedra") + " · Alumnos");
  const configs = {
    "📋 Padrón": [
      "DNI", "Apellido", "Nombre", "Comisión", "Activo (Sí/No)",
      "PIN Hash (no tocar)", "Fecha registro PIN"
    ],
    "📝 Interacciones": [
      "Fecha", "Hora", "SID", "DNI", "Nombre y Apellido", "Comisión",
      "Modo", "Concepto IDs", "Conceptos", "Fuentes bibliográficas",
      "Confusión", "Nivel confusión", "Pregunta del alumno",
      "Respuesta del asistente", "Modelo"
    ],
    "👤 Por alumno": [
      "ID/DNI", "Nombre y Apellido", "Comisión", "Consultas", "Sesiones",
      "Modos utilizados", "Conceptos trabajados", "Posibles confusiones",
      "Confusiones reiteradas", "Primera consulta", "Última consulta", "Estado"
    ],
    "🧠 Conceptos": [
      "Concepto", "Fuentes bibliográficas", "Alumnos", "Interacciones",
      "Posibles confusiones", "Confusiones reiteradas", "Total confusión",
      "% confusión", "Última actividad"
    ],
    "📊 Resumen": ["Métrica", "Valor"],
  };

  const first = ss.getSheets()[0];
  first.setName("📋 Padrón");

  Object.entries(configs).forEach(([name, headers]) => {
    const sheet = name === "📋 Padrón"
      ? first
      : ss.insertSheet(name);

    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    try {
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      sheet.autoResizeColumns(1, headers.length);
    } catch (e) {}
  });

  first.setColumnWidths(1, 7, 150);
  studioEnsureCommissionSheets(ss, commissions);

  return {
    id: ss.getId(),
    url: ss.getUrl(),
  };
}

function studioStudentInteractionHeaders() {
  return [
    "Fecha", "Hora", "SID", "DNI", "Nombre y Apellido", "Comisión", "Modo",
    "Concepto IDs", "Conceptos", "Fuentes bibliográficas", "Confusión",
    "Nivel confusión", "Pregunta del alumno", "Respuesta del asistente", "Modelo"
  ];
}

function studioMigrateStudentInteractionSheet(ss) {
  const headers = studioStudentInteractionHeaders();
  let sheet = ss.getSheetByName("📝 Interacciones");
  if (!sheet) {
    sheet = ss.insertSheet("📝 Interacciones");
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getValues()[0].map(value => String(value || "").trim());
  const same = currentHeaders.length === headers.length &&
    headers.every((value, index) => String(currentHeaders[index] || "").trim().toLowerCase() === value.toLowerCase());
  if (same) return;

  const values = sheet.getDataRange().getValues();
  const oldHeaders = values[0] || [];
  const col = name => {
    const normalized = oldHeaders.map(value => String(value || "").trim().toLowerCase());
    return normalized.indexOf(String(name).trim().toLowerCase());
  };
  const rows = values.slice(1).map(row => [
    col("Fecha") >= 0 ? row[col("Fecha")] : "",
    col("Hora") >= 0 ? row[col("Hora")] : "",
    col("SID") >= 0 ? row[col("SID")] : "",
    col("DNI") >= 0 ? row[col("DNI")] : "",
    col("Nombre y Apellido") >= 0 ? row[col("Nombre y Apellido")] : "",
    col("Comisión") >= 0 ? row[col("Comisión")] : "",
    col("Modo") >= 0 ? row[col("Modo")] : "",
    col("Concepto IDs") >= 0 ? row[col("Concepto IDs")] : "",
    col("Conceptos") >= 0 ? row[col("Conceptos")] : "",
    col("Fuentes bibliográficas") >= 0 ? row[col("Fuentes bibliográficas")] : "",
    col("Confusión") >= 0 ? row[col("Confusión")] : "",
    col("Nivel confusión") >= 0 ? row[col("Nivel confusión")] : 0,
    col("Pregunta del alumno") >= 0 ? row[col("Pregunta del alumno")] : "",
    col("Respuesta del asistente") >= 0 ? row[col("Respuesta del asistente")] : "",
    col("Modelo") >= 0 ? row[col("Modelo")] : "",
  ]);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
}

function studioEnsureStudentAnalysisSheets(ss, commissions = []) {
  studioMigrateStudentInteractionSheet(ss);

  const porAlumno = ss.getSheetByName("👤 Por alumno") || ss.insertSheet("👤 Por alumno");
  porAlumno.getRange(1, 1, 1, 12).setValues([[
    "ID/DNI", "Nombre y Apellido", "Comisión", "Consultas", "Sesiones",
    "Modos utilizados", "Conceptos trabajados", "Posibles confusiones",
    "Confusiones reiteradas", "Primera consulta", "Última consulta", "Estado"
  ]]);
  porAlumno.setFrozenRows(1);

  const conceptos = ss.getSheetByName("🧠 Conceptos") || ss.insertSheet("🧠 Conceptos");
  conceptos.getRange(1, 1, 1, 9).setValues([[
    "Concepto", "Fuentes bibliográficas", "Alumnos", "Interacciones",
    "Posibles confusiones", "Confusiones reiteradas", "Total confusión",
    "% confusión", "Última actividad"
  ]]);
  conceptos.setFrozenRows(1);

  const resumen = ss.getSheetByName("📊 Resumen") || ss.insertSheet("📊 Resumen");
  if (resumen.getLastRow() === 0) resumen.getRange(1, 1, 1, 2).setValues([["Métrica", "Valor"]]);
  resumen.setFrozenRows(1);

  studioEnsureCommissionSheets(ss, commissions);
}

function studioEnsureStudentWorkbook(course, commissions = []) {
  const ids = studioCourseSheetIds(course);
  if (ids.studentSheetId >= 0) {
    const row = course.sheet.getRange(course.rowIndex, 1, 1, course.sheet.getLastColumn()).getValues()[0];
    const existingId = studioCell(row, ids.studentSheetId);
    if (existingId) {
      const existing = SpreadsheetApp.openById(existingId);
      studioEnsureStudentAnalysisSheets(existing, commissions);
      return {
        id: existingId,
        url: ids.studentSheetUrl >= 0
          ? studioCell(row, ids.studentSheetUrl)
          : "https://docs.google.com/spreadsheets/d/" + existingId + "/edit",
      };
    }
  }

  const workbook = studioInitializeStudentWorkbook(course.title, commissions);
  const initialized = SpreadsheetApp.openById(workbook.id);
  studioEnsureStudentAnalysisSheets(initialized, commissions);
  if (ids.studentSheetId >= 0) {
    course.sheet.getRange(course.rowIndex, ids.studentSheetId + 1).setValue(workbook.id);
  }
  if (ids.studentSheetUrl >= 0) {
    course.sheet.getRange(course.rowIndex, ids.studentSheetUrl + 1).setValue(workbook.url);
  }
  return workbook;
}

function studioFindCourseRow(courseId) {
  const target = String(courseId || "").trim();
  if (!target) return null;
  const sheet = studioSheet(STUDIO_SHEETS.courses, "courses");
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];

  const idCol = studioColumn(headers, ["Course ID"]);
  const titleCol = studioColumn(headers, ["Título"]);
  const ownerCol = studioColumn(headers, ["Owner Email"]);
  const statusCol = studioColumn(headers, ["Estado"]);
  const fileCol = studioColumn(headers, ["Drive File ID"]);
  const slugCol = studioColumn(headers, ["Public Slug"]);
  const publishedFileCol = studioColumn(headers, ["Published Drive File ID"]);
  const updatedCol = studioColumn(headers, ["Actualizado"]);
  const publishedAtCol = studioColumn(headers, ["Publicado"]);
  const studentSheetIdCol = studioColumn(headers, ["Student Sheet ID"]);
  const studentSheetUrlCol = studioColumn(headers, ["Student Sheet URL"]);

  for (let i = 1; i < values.length; i += 1) {
    if (studioCell(values[i], idCol) !== target) continue;
    return {
      rowIndex: i + 1,
      sheet,
      courseId: target,
      title: studioCell(values[i], titleCol),
      ownerEmail: normalizeStudioEmail(values[i][ownerCol]),
      status: studioCell(values[i], statusCol) || "draft",
      fileId: studioCell(values[i], fileCol),
      publicSlug: studioCell(values[i], slugCol),
      publishedFileId: studioCell(values[i], publishedFileCol),
      updatedAt: studioCell(values[i], updatedCol),
      publishedAt: studioCell(values[i], publishedAtCol),
      studentSheetId: studioCell(values[i], studentSheetIdCol),
      studentSheetUrl: studioCell(values[i], studentSheetUrlCol),
    };
  }
  return null;
}

function studioFindPublishedCourse(ref) {
  const target = String(ref || "").trim();
  if (!target) return null;

  const sheet = studioSheet(STUDIO_SHEETS.courses, "courses");
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const idCol = studioColumn(headers, ["Course ID"]);
  const slugCol = studioColumn(headers, ["Public Slug"]);

  for (let i = 1; i < values.length; i += 1) {
    const courseId = studioCell(values[i], idCol);
    const publicSlug = studioCell(values[i], slugCol);
    if (courseId !== target && publicSlug !== target) continue;

    const course = studioFindCourseRow(courseId);
    if (!course || course.status === "draft" || !course.publishedFileId) {
      return null;
    }
    return course;
  }
  return null;
}

function studioRoleFor(email, courseId) {
  const normalizedEmail = normalizeStudioEmail(email);
  const course = studioFindCourseRow(courseId);
  if (!course) return null;
  if (course.ownerEmail === normalizedEmail) return "owner";

  const sheet = studioSheet(STUDIO_SHEETS.permissions, "permissions");
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const emailCol = studioColumn(headers, ["Email"]);
  const courseCol = studioColumn(headers, ["Course ID"]);
  const roleCol = studioColumn(headers, ["Rol"]);
  const activeCol = studioColumn(headers, ["Activo"]);

  const rank = { viewer: 1, editor: 2, owner: 3 };
  let best = null;

  for (let i = 1; i < values.length; i += 1) {
    if (normalizeStudioEmail(values[i][emailCol]) !== normalizedEmail) continue;
    if (studioCell(values[i], courseCol) !== courseId) continue;
    const active = activeCol < 0 || ["si", "sí", "1", "true"].includes(String(values[i][activeCol] || "").trim().toLowerCase());
    if (!active) continue;
    const role = String(values[i][roleCol] || "").trim().toLowerCase();
    if (!["viewer", "editor"].includes(role)) continue;
    if (!best || rank[role] > rank[best]) best = role;
  }
  return best;
}

function studioRequireCourseAccess(email, courseId, write) {
  const course = studioFindCourseRow(courseId);
  if (!course) throw new Error("La cátedra no existe.");

  const role = studioRoleFor(email, courseId);
  if (!role) throw new Error("No tenés acceso a esta cátedra.");

  if (write && role === "viewer") {
    throw new Error("Tu acceso a esta cátedra es solo de lectura.");
  }

  return { course, role };
}

function studioAuthorizedCourses(email) {
  const normalizedEmail = normalizeStudioEmail(email);
  const sheet = studioSheet(STUDIO_SHEETS.courses, "courses");
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const idCol = studioColumn(headers, ["Course ID"]);
  const titleCol = studioColumn(headers, ["Título"]);
  const statusCol = studioColumn(headers, ["Estado"]);
  const slugCol = studioColumn(headers, ["Public Slug"]);
  const updatedCol = studioColumn(headers, ["Actualizado"]);

  const courses = [];
  for (let i = 1; i < values.length; i += 1) {
    const courseId = studioCell(values[i], idCol);
    if (!courseId) continue;
    const role = studioRoleFor(normalizedEmail, courseId);
    if (!role) continue;
    courses.push({
      courseId,
      title: studioCell(values[i], titleCol),
      status: studioCell(values[i], statusCol) || "draft",
      role,
      publicSlug: studioCell(values[i], slugCol),
      updatedAt: studioCell(values[i], updatedCol),
    });
  }
  return courses.sort((a, b) => a.title.localeCompare(b.title, "es"));
}

function studioReadPackFile(fileId) {
  if (!fileId) throw new Error("La cátedra no tiene course pack asociado.");
  return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString("UTF-8"));
}

function studioReadPack(course) {
  return studioReadPackFile(course.fileId);
}

function studioWritePack(course, pack) {
  if (!pack || typeof pack !== "object") throw new Error("Course pack inválido.");
  if (String(pack.id || "") !== String(course.courseId)) {
    throw new Error("El course pack no coincide con la cátedra.");
  }

  const serialized = JSON.stringify(pack, null, 2);
  const now = new Date().toISOString();

  if (course.fileId) {
    DriveApp.getFileById(course.fileId).setContent(serialized);
  } else {
    const file = studioDriveFolder().createFile(
      course.courseId + "-course-pack.json",
      serialized,
      MimeType.PLAIN_TEXT
    );
    course.fileId = file.getId();
  }

  const updatedCol = studioColumn(
    course.sheet.getRange(1, 1, 1, course.sheet.getLastColumn()).getValues()[0],
    ["Actualizado"]
  );
  const fileCol = studioColumn(
    course.sheet.getRange(1, 1, 1, course.sheet.getLastColumn()).getValues()[0],
    ["Drive File ID"]
  );
  const titleCol = studioColumn(
    course.sheet.getRange(1, 1, 1, course.sheet.getLastColumn()).getValues()[0],
    ["Título"]
  );

  course.sheet.getRange(course.rowIndex, titleCol + 1).setValue(String(pack.title || course.title));
  course.sheet.getRange(course.rowIndex, fileCol + 1).setValue(course.fileId);
  course.sheet.getRange(course.rowIndex, updatedCol + 1).setValue(now);

  return {
    courseId: course.courseId,
    title: String(pack.title || course.title),
    updatedAt: now,
    pack,
  };
}

function studioUniquePublicSlug(title, excludeCourseId) {
  const base = studioSlugify(title);
  const sheet = studioSheet(STUDIO_SHEETS.courses, "courses");
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const idCol = studioColumn(headers, ["Course ID"]);
  const slugCol = studioColumn(headers, ["Public Slug"]);
  const used = new Set();

  for (let i = 1; i < values.length; i += 1) {
    if (studioCell(values[i], idCol) === String(excludeCourseId || "").trim()) continue;
    const value = studioCell(values[i], slugCol);
    if (value) used.add(value);
  }

  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(base + "-" + n)) n += 1;
  return base + "-" + n;
}

function studioValidatePublishPack(course, pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") errors.push("Course pack inválido.");
  if (String(pack?.id || "") !== String(course.courseId)) errors.push("El ID interno no coincide con la cátedra.");
  if (!String(pack?.title || "").trim()) errors.push("Falta el nombre de la cátedra.");
  if (!String(pack?.author || "").trim()) errors.push("Falta la autoría de la cátedra.");

  const arrayKeys = ["bibliography", "concepts", "modes", "activities", "examples", "corpus", "commissions"];
  for (const key of arrayKeys) {
    if (!Array.isArray(pack?.[key])) errors.push("Falta course." + key + ".");
  }

  if (!Array.isArray(pack?.modes) || !pack.modes.length) {
    errors.push("La cátedra debe tener al menos un modo de interacción.");
  }

  const modeIds = new Set();
  for (const mode of pack?.modes || []) {
    if (!mode?.id) errors.push("Hay un modo sin ID.");
    else if (modeIds.has(mode.id)) errors.push("Hay IDs de modo duplicados: " + mode.id);
    else modeIds.add(mode.id);
    if (!mode?.strategy) errors.push("El modo " + (mode?.id || "sin ID") + " no tiene estrategia.");
    if (!mode?.pedagogicalGoal) errors.push("El modo " + (mode?.id || "sin ID") + " no tiene objetivo pedagógico.");
  }

  for (const unit of pack?.pedagogicalUnits || []) {
    if (!String(unit?.title || "").trim()) {
      errors.push("Hay una unidad pedagógica sin título.");
    }
    if (String(unit?.reviewStatus || "") === "pending") {
      errors.push('Hay unidades pedagógicas pendientes de revisión. Aprobálas o descartalas antes de publicar.');
    }
  }

  if (pack?.curriculumMap) {
    const map = pack.curriculumMap;
    const unitIds = new Set((pack?.pedagogicalUnits || []).map(item => item?.id).filter(Boolean));
    if (String(map.reviewStatus || "") === "pending") {
      errors.push("El mapa curricular está pendiente de revisión. Aprobalo antes de publicar.");
    }
    if (!Array.isArray(map.sequence) || !map.sequence.length) {
      errors.push("El mapa curricular no tiene una secuencia de unidades.");
    } else {
      const seen = new Set();
      for (const unitId of map.sequence) {
        if (!unitIds.has(unitId)) errors.push("El mapa curricular referencia una unidad inexistente: " + unitId);
        if (seen.has(unitId)) errors.push("El mapa curricular contiene una unidad repetida: " + unitId);
        seen.add(unitId);
      }
      if (seen.size !== unitIds.size) {
        errors.push("El mapa curricular debe incluir todas las unidades pedagógicas.");
      }
    }
    for (const unit of pack?.pedagogicalUnits || []) {
      for (const prerequisiteId of unit?.prerequisiteUnitIds || []) {
        if (!unitIds.has(prerequisiteId)) {
          errors.push("La unidad " + (unit?.id || "sin ID") + " referencia un prerrequisito inexistente: " + prerequisiteId);
        }
        if (prerequisiteId === unit?.id) {
          errors.push("Una unidad no puede ser prerrequisito de sí misma: " + (unit?.id || "sin ID"));
        }
      }
    }
  }

  const conceptIds = new Set((pack?.concepts || []).map(item => item?.id).filter(Boolean));
  for (const activity of pack?.activities || []) {
    if (activity?.modeId && !modeIds.has(activity.modeId)) {
      errors.push("La actividad " + (activity?.id || "sin ID") + " referencia un modo inexistente.");
    }
  }
  for (const example of pack?.examples || []) {
    for (const conceptId of example?.concepts || []) {
      if (!conceptIds.has(conceptId)) {
        errors.push("El ejemplo " + (example?.id || "sin ID") + " referencia un concepto inexistente.");
      }
    }
  }
  for (const chunk of pack?.corpus || []) {
    if (!chunk?.content) errors.push("Hay un fragmento de corpus sin contenido.");
  }

  if (!String(pack?.llm?.endpoint || "").trim()) {
    errors.push("Falta configurar el endpoint de IA.");
  }
  if (!Array.isArray(pack?.llm?.models) || !pack.llm.models.length) {
    errors.push("Falta configurar al menos un modelo de IA.");
  }
  if (!String(STUDIO_STUDENT_BACKEND_ENDPOINT || "").trim()) {
    errors.push("Falta configurar STUDENT_BACKEND_ENDPOINT en las propiedades del backend de Studio.");
  }

  return errors;
}

function studioMeta(course, role) {
  return {
    courseId: course.courseId,
    title: course.title,
    status: course.status,
    role,
    publicSlug: course.publicSlug,
    studentSheetId: course.studentSheetId,
    studentSheetUrl: course.studentSheetUrl,
    updatedAt: course.updatedAt,
    publishedAt: course.publishedAt,
    publicUrl: course.publicSlug
      ? "https://rnalvarez.github.io/AULIA/?course=" + encodeURIComponent(course.publicSlug)
      : "",
  };
}

function blankStudioCourse(owner) {
  const suffix = Utilities.getUuid().slice(0, 8).toLowerCase();
  const id = studioSlugify("nueva-catedra") + "-" + suffix;
  return {
    id,
    title: "Nueva cátedra",
    author: owner.name || owner.email,
    description: "Asistente pedagógico configurado con AULIA.",
    language: "es",
    level: "universitario",
    publicSlug: "",
    assistant: {
      name: "Asistente pedagógico",
      shortTitle: "Asistente de la cátedra",
      initials: "AI",
      welcomeMessage: "Hola. Soy el asistente pedagógico de esta cátedra. ¿Qué querés explorar?",
      suggestions: [],
      instructions: "",
    },
    bibliography: [],
    concepts: [],
    examples: [],
    corpus: [],
    commissions: [],
    modes: [{
      id: "consulta",
      title: "Consultá con el asistente",
      description: "Preguntá libremente sobre el corpus del curso.",
      pedagogicalGoal: "comprender",
      strategy: "retrieve",
      placeholder: "Escribí tu consulta...",
    }],
    activities: [{
      id: "consulta-concepto",
      title: "Consulta conceptual",
      modeId: "consulta",
      description: "Comprender una unidad del curso.",
    }],
    llm: {
      provider: "groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
      generation: {
        temperature: 0.4,
        max_tokens: 800,
        top_p: 0.9,
        stream: false,
      },
      keyPolicy: "student-provided",
    },
    tracking: {
      provider: "google-sheets",
      courseId: id,
      identitySource: "padron",
      interactionSource: "interactions",
      sessionSource: "sessions",
      endpoint: STUDIO_STUDENT_BACKEND_ENDPOINT,
      actions: {
        check: "check",
        register: "registrar",
        verify: "verificar",
        logInteraction: "log",
      },
      failOpen: false,
    },
  };
}

function handleStudioListCourses(body) {
  const session = requireTeacherSession(body);
  return {
    success: true,
    teacher: { email: session.teacher.email, name: session.teacher.name },
    courses: studioAuthorizedCourses(session.teacher.email),
  };
}

function handleStudioGetCourse(body) {
  const session = requireTeacherSession(body);
  const access = studioRequireCourseAccess(session.teacher.email, body.courseId, false);
  return {
    success: true,
    course: studioReadPack(access.course),
    meta: studioMeta(access.course, access.role),
  };
}

function studioDeleteConfirmationKey(token) {
  return "aulia:studio:delete-confirm:" + String(token || "");
}

function handleStudioPrepareDeleteCourse(body) {
  const session = requireTeacherSession(body);
  const courseId = String(body.courseId || "").trim();
  if (!courseId) throw new Error("Falta identificar la cátedra.");
  if (body.acknowledgeDelete !== true) {
    throw new Error("La primera confirmación de borrado es obligatoria.");
  }

  const access = studioRequireCourseAccess(session.teacher.email, courseId, false);
  if (access.role !== "owner") {
    throw new Error("Solo el responsable de la cátedra puede eliminarla.");
  }

  const course = access.course;
  const published = course.status !== "draft" || Boolean(course.publishedFileId);
  const confirmationToken = Utilities.getUuid() + "-" + Utilities.getUuid();

  // Token ligado a docente + cátedra + versión, de un solo uso y con caducidad.
  CacheService.getScriptCache().put(
    studioDeleteConfirmationKey(confirmationToken),
    JSON.stringify({
      email: normalizeStudioEmail(session.teacher.email),
      courseId: course.courseId,
      title: String(course.title || ""),
      status: String(course.status || "draft"),
      updatedAt: String(course.updatedAt || ""),
      fileId: String(course.fileId || ""),
      publishedFileId: String(course.publishedFileId || ""),
      published,
    }),
    300
  );

  studioAudit(
    session.teacher.email,
    "prepare-delete-course",
    courseId,
    "confirmación inicial",
    String(course.title || "") + " · " + (published ? "publicada" : "borrador")
  );

  return {
    success: true,
    confirmationToken,
    title: String(course.title || "Sin título"),
    status: String(course.status || "draft"),
    published,
    studentSheetPreserved: Boolean(course.studentSheetId),
    expiresIn: 300,
  };
}

function handleStudioDeleteCourse(body) {
  const session = requireTeacherSession(body);
  const courseId = String(body.courseId || "").trim();
  const confirmationToken = String(body.confirmationToken || "").trim();
  const confirmedTitle = String(body.confirmationTitle || "");

  if (!courseId) throw new Error("Falta identificar la cátedra.");
  if (!confirmationToken) throw new Error("Falta la autorización temporal de borrado.");

  const cache = CacheService.getScriptCache();
  const tokenKey = studioDeleteConfirmationKey(confirmationToken);
  const rawProof = cache.get(tokenKey);
  if (!rawProof) {
    throw new Error("La autorización de borrado venció o ya fue utilizada. Iniciá nuevamente las dos confirmaciones.");
  }

  let proof;
  try { proof = JSON.parse(rawProof); }
  catch (err) { throw new Error("La autorización temporal de borrado no es válida."); }

  const access = studioRequireCourseAccess(session.teacher.email, courseId, false);
  if (access.role !== "owner") {
    throw new Error("Solo el responsable de la cátedra puede eliminarla.");
  }

  const course = access.course;
  const title = String(course.title || "");
  const published = course.status !== "draft" || Boolean(course.publishedFileId);

  if (String(proof.email || "") !== normalizeStudioEmail(session.teacher.email) ||
      String(proof.courseId || "") !== courseId) {
    throw new Error("La autorización temporal no corresponde a esta cátedra o docente.");
  }

  if (String(proof.title || "") !== title ||
      String(proof.status || "draft") !== String(course.status || "draft") ||
      String(proof.updatedAt || "") !== String(course.updatedAt || "") ||
      String(proof.fileId || "") !== String(course.fileId || "") ||
      String(proof.publishedFileId || "") !== String(course.publishedFileId || "")) {
    cache.remove(tokenKey);
    throw new Error("La cátedra cambió desde la primera confirmación. Volvé a iniciar el borrado para revisar su estado actualizado.");
  }

  // Segunda autorización: el responsable debe volver a escribir el título exacto.
  if (!confirmedTitle.trim() || confirmedTitle.trim() !== title) {
    studioAudit(session.teacher.email, "delete-course", courseId, "denegado", "el título de confirmación no coincide");
    throw new Error("El nombre escrito no coincide exactamente con el título de la cátedra. No se eliminó.");
  }

  if (published && body.confirmPublished !== true) {
    throw new Error("La segunda confirmación para una cátedra publicada es obligatoria.");
  }

  // Token de un solo uso: se consume después de validar ambas autorizaciones.
  cache.remove(tokenKey);

  // Retirar ambas versiones del Course Pack. La planilla de alumnos no se borra:
  // puede contener padrón, interacciones y datos que deben conservarse.
  const fileIds = Array.from(new Set([
    String(course.fileId || ""),
    String(course.publishedFileId || ""),
  ].filter(Boolean)));
  const fileStates = [];

  try {
    fileIds.forEach(function(fileId) {
      const file = DriveApp.getFileById(fileId);
      const wasTrashed = file.isTrashed();
      fileStates.push({ id: fileId, wasTrashed: wasTrashed });
      if (!wasTrashed) file.setTrashed(true);
    });
  } catch (err) {
    fileStates.slice().reverse().forEach(function(state) {
      if (state.wasTrashed) return;
      try { DriveApp.getFileById(state.id).setTrashed(false); } catch (restoreErr) {}
    });
    studioAudit(session.teacher.email, "delete-course", courseId, "error", "no se pudo retirar el Course Pack: " + String(err && err.message || err));
    throw new Error("No se pudo enviar las versiones de la cátedra a la papelera. No se eliminó el registro. " + String(err && err.message || err));
  }

  try {
    course.sheet.deleteRow(course.rowIndex);
  } catch (err) {
    fileStates.slice().reverse().forEach(function(state) {
      if (state.wasTrashed) return;
      try { DriveApp.getFileById(state.id).setTrashed(false); } catch (restoreErr) {}
    });
    throw new Error("No se pudo quitar la cátedra del registro. Las versiones de Drive se restauraron cuando fue posible. " + String(err && err.message || err));
  }

  // Limpiar permisos asociados para no dejar referencias huérfanas.
  try {
    const permissions = studioSheet(STUDIO_SHEETS.permissions, "permissions");
    const values = permissions.getDataRange().getValues();
    const headers = values[0] || [];
    const courseCol = studioColumn(headers, ["Course ID"]);

    if (courseCol >= 0) {
      for (let row = values.length - 1; row >= 1; row -= 1) {
        if (studioCell(values[row], courseCol) === courseId) {
          permissions.deleteRow(row + 1);
        }
      }
    }
  } catch (err) {
    console.error("No se pudieron limpiar permisos de la cátedra eliminada: " + err);
  }

  const preservedStudentSheetUrl = String(course.studentSheetUrl || "");
  studioAudit(
    session.teacher.email,
    "delete-course",
    courseId,
    "ok",
    title + " · estado anterior: " + String(course.status || "draft") +
      (course.studentSheetId ? " · planilla de alumnos conservada" : "")
  );

  return {
    success: true,
    courseId,
    title,
    previousStatus: String(course.status || "draft"),
    studentSheetPreserved: Boolean(course.studentSheetId),
    studentSheetUrl: preservedStudentSheetUrl,
  };
}

function handleStudioCreateCourse(body) {
  const session = requireTeacherSession(body);
  const title = String(body.title || "Nueva cátedra").trim().slice(0, 160);
  const pack = blankStudioCourse(session.teacher);
  pack.title = title || "Nueva cátedra";
  pack.description = String(body.description || pack.description).trim().slice(0, 500);
  pack.publicSlug = studioUniquePublicSlug(pack.title, pack.id);

  const sheet = studioSheet(STUDIO_SHEETS.courses, "courses");
  const folder = studioDriveFolder();
  const file = folder.createFile(pack.id + "-course-pack.json", JSON.stringify(pack, null, 2), MimeType.PLAIN_TEXT);
  const now = new Date().toISOString();

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(header => {
    switch (String(header).trim()) {
      case "Course ID": return pack.id;
      case "Título": return pack.title;
      case "Owner Email": return session.teacher.email;
      case "Estado": return "draft";
      case "Drive File ID": return file.getId();
      case "Public Slug": return pack.publicSlug;
      case "Published Drive File ID": return "";
      case "Actualizado": return now;
      case "Publicado": return "";
      default: return "";
    }
  });
  sheet.appendRow(row);

  studioAudit(session.teacher.email, "create-course", pack.id, "ok", pack.title);

  const course = studioFindCourseRow(pack.id);
  return {
    success: true,
    course: pack,
    meta: studioMeta(course, "owner"),
  };
}

function handleStudioSaveCourse(body) {
  const session = requireTeacherSession(body);
  const courseId = String(body.courseId || "").trim();
  const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
  const access = studioRequireCourseAccess(session.teacher.email, courseId, true);

  if (access.course.updatedAt && expectedUpdatedAt !== access.course.updatedAt) {
    studioAudit(session.teacher.email, "save-course", courseId, "conflict", "versión remota modificada");
    return {
      success: false,
      conflict: true,
      msg: "La cátedra fue modificada desde otra sesión. Recargá la versión remota antes de guardar.",
      remoteUpdatedAt: access.course.updatedAt,
    };
  }

  const result = studioWritePack(access.course, body.course);
  let nextStatus = access.course.status;
  if (access.course.status === "published") nextStatus = "changes-pending";

  const statusCol = studioColumn(
    access.course.sheet.getRange(1, 1, 1, access.course.sheet.getLastColumn()).getValues()[0],
    ["Estado"]
  );
  access.course.sheet.getRange(access.course.rowIndex, statusCol + 1).setValue(nextStatus);
  access.course.status = nextStatus;

  studioAudit(session.teacher.email, "save-course", courseId, "ok", result.title);

  const refreshed = studioFindCourseRow(courseId);
  return {
    success: true,
    course: result.pack,
    meta: studioMeta(refreshed, access.role),
  };
}

function handleStudioPublishCourse(body) {
  const session = requireTeacherSession(body);
  const courseId = String(body.courseId || "").trim();
  const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
  const access = studioRequireCourseAccess(session.teacher.email, courseId, true);

  if (access.role !== "owner") {
    throw new Error("Solo el responsable de la cátedra puede publicar.");
  }

  if (access.course.updatedAt && expectedUpdatedAt !== access.course.updatedAt) {
    studioAudit(session.teacher.email, "publish-course", courseId, "conflict", "versión remota modificada");
    return {
      success: false,
      conflict: true,
      msg: "La cátedra cambió desde otra sesión. Recargá la versión remota antes de publicar.",
      remoteUpdatedAt: access.course.updatedAt,
    };
  }

  const pack = JSON.parse(JSON.stringify(body.course || {}));
  pack.tracking = {
    ...(pack.tracking || {}),
    endpoint: STUDIO_STUDENT_BACKEND_ENDPOINT,
  };

  const errors = studioValidatePublishPack(access.course, pack);
  if (errors.length) {
    studioAudit(session.teacher.email, "publish-course", courseId, "invalid", errors.join(" | "));
    return {
      success: false,
      validation: { valid: false, errors },
      msg: "La cátedra no puede publicarse todavía. Revisá los requisitos indicados.",
    };
  }

  // La primera publicación provisiona automáticamente la Sheet de alumnos.
  const studentWorkbook = studioEnsureStudentWorkbook(access.course, pack.commissions || []);

  // Se guarda primero como borrador para asegurar que Studio y la versión publicada
  // parten exactamente del mismo contenido.
  const draftResult = studioWritePack(access.course, pack);
  const serialized = JSON.stringify(draftResult.pack, null, 2);

  let publishedFileId = access.course.publishedFileId;
  if (publishedFileId) {
    DriveApp.getFileById(publishedFileId).setContent(serialized);
  } else {
    const file = studioDriveFolder().createFile(
      courseId + "-published-course-pack.json",
      serialized,
      MimeType.PLAIN_TEXT
    );
    publishedFileId = file.getId();
  }

  const headers = access.course.sheet.getRange(1, 1, 1, access.course.sheet.getLastColumn()).getValues()[0];
  const statusCol = studioColumn(headers, ["Estado"]);
  const studentSheetIdCol = studioColumn(headers, ["Student Sheet ID"]);
  const studentSheetUrlCol = studioColumn(headers, ["Student Sheet URL"]);
  const publishedFileCol = studioColumn(headers, ["Published Drive File ID"]);
  const publishedAtCol = studioColumn(headers, ["Publicado"]);
  const slugCol = studioColumn(headers, ["Public Slug"]);

  const publicSlug = access.course.publishedFileId
    ? (access.course.publicSlug || studioUniquePublicSlug(pack.title, courseId))
    : studioUniquePublicSlug(pack.title, courseId);
  access.course.sheet.getRange(access.course.rowIndex, statusCol + 1).setValue("published");
  access.course.sheet.getRange(access.course.rowIndex, publishedFileCol + 1).setValue(publishedFileId);
  access.course.sheet.getRange(access.course.rowIndex, studentSheetIdCol + 1).setValue(studentWorkbook.id);
  access.course.sheet.getRange(access.course.rowIndex, studentSheetUrlCol + 1).setValue(studentWorkbook.url);
  access.course.sheet.getRange(access.course.rowIndex, publishedAtCol + 1).setValue(new Date().toISOString());
  access.course.sheet.getRange(access.course.rowIndex, slugCol + 1).setValue(publicSlug);

  pack.publicSlug = publicSlug;
  access.course.status = "published";
  access.course.publicSlug = publicSlug;
  access.course.publishedFileId = publishedFileId;
  access.course.publishedAt = new Date().toISOString();

  // Mantener el publicSlug dentro de ambos archivos evita que una exportación pierda el vínculo.
  const finalSerialized = JSON.stringify(pack, null, 2);
  DriveApp.getFileById(access.course.fileId).setContent(finalSerialized);
  DriveApp.getFileById(publishedFileId).setContent(finalSerialized);

  studioAudit(session.teacher.email, "publish-course", courseId, "ok", publicSlug);

  const refreshed = studioFindCourseRow(courseId);
  return {
    success: true,
    course: pack,
    meta: studioMeta(refreshed, access.role),
  };
}

function handlePublicCourse(body) {
  const ref = String(body.course || body.courseId || "").trim();
  const course = studioFindPublishedCourse(ref);

  if (!course) {
    return {
      success: false,
      notPublished: true,
      msg: "Esta cátedra no está publicada o no existe.",
    };
  }

  try {
    const pack = studioReadPackFile(course.publishedFileId);
    pack.publicSlug = course.publicSlug;
    return {
      success: true,
      course: pack,
      meta: {
        courseId: course.courseId,
        publicSlug: course.publicSlug,
        publishedAt: course.publishedAt,
      },
    };
  } catch (err) {
    console.error("handlePublicCourse", err);
    return {
      success: false,
      msg: "No se pudo cargar la versión publicada.",
    };
  }
}
