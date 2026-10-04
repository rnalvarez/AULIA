// AULIA — Teacher Studio courses and authorization

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
  const updatedCol = studioColumn(headers, ["Actualizado"]);

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
      updatedAt: studioCell(values[i], updatedCol),
    };
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
      updatedAt: studioCell(values[i], updatedCol),
    });
  }
  return courses.sort((a, b) => a.title.localeCompare(b.title, "es"));
}

function studioReadPack(course) {
  if (!course.fileId) throw new Error("La cátedra no tiene course pack asociado.");
  const file = DriveApp.getFileById(course.fileId);
  return JSON.parse(file.getBlob().getDataAsString("UTF-8"));
}

function studioWritePack(course, pack) {
  if (!pack || typeof pack !== "object") throw new Error("Course pack inválido.");
  if (String(pack.id || "") !== String(course.courseId)) throw new Error("El course pack no coincide con la cátedra.");

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

  course.sheet.getRange(course.rowIndex, 2).setValue(String(pack.title || course.title));
  course.sheet.getRange(course.rowIndex, 5).setValue(course.fileId);
  course.sheet.getRange(course.rowIndex, 6).setValue(now);

  return {
    courseId: course.courseId,
    title: String(pack.title || course.title),
    updatedAt: now,
    pack,
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
      endpoint: "",
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
    meta: {
      courseId: access.course.courseId,
      title: access.course.title,
      status: access.course.status,
      role: access.role,
      updatedAt: access.course.updatedAt,
    },
  };
}

function handleStudioCreateCourse(body) {
  const session = requireTeacherSession(body);
  const title = String(body.title || "Nueva cátedra").trim().slice(0, 160);
  const pack = blankStudioCourse(session.teacher);
  pack.title = title || "Nueva cátedra";
  pack.description = String(body.description || pack.description).trim().slice(0, 500);

  const sheet = studioSheet(STUDIO_SHEETS.courses, "courses");
  const folder = studioDriveFolder();
  const file = folder.createFile(pack.id + "-course-pack.json", JSON.stringify(pack, null, 2), MimeType.PLAIN_TEXT);
  const now = new Date().toISOString();

  sheet.appendRow([pack.id, pack.title, session.teacher.email, "draft", file.getId(), now]);

  studioAudit(session.teacher.email, "create-course", pack.id, "ok", pack.title);

  return {
    success: true,
    course: pack,
    meta: {
      courseId: pack.id,
      title: pack.title,
      status: "draft",
      role: "owner",
      updatedAt: now,
    },
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
  studioAudit(session.teacher.email, "save-course", courseId, "ok", result.title);

  return {
    success: true,
    course: result.pack,
    meta: {
      courseId: result.courseId,
      title: result.title,
      status: access.course.status,
      role: access.role,
      updatedAt: result.updatedAt,
    },
  };
}