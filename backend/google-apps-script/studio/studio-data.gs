// AULIA — Teacher Studio courses, authorization and publication

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
  if (!String(pack?.tracking?.endpoint || "").trim()) {
    errors.push("Falta configurar el endpoint de acceso/seguimiento de la cátedra.");
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
    meta: studioMeta(access.course, access.role),
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

  const pack = body.course;
  const errors = studioValidatePublishPack(access.course, pack);
  if (errors.length) {
    studioAudit(session.teacher.email, "publish-course", courseId, "invalid", errors.join(" | "));
    return {
      success: false,
      validation: { valid: false, errors },
      msg: "La cátedra no puede publicarse todavía. Revisá los requisitos indicados.",
    };
  }

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
  const publishedFileCol = studioColumn(headers, ["Published Drive File ID"]);
  const publishedAtCol = studioColumn(headers, ["Publicado"]);
  const slugCol = studioColumn(headers, ["Public Slug"]);

  const publicSlug = access.course.publishedFileId
    ? (access.course.publicSlug || studioUniquePublicSlug(pack.title, courseId))
    : studioUniquePublicSlug(pack.title, courseId);
  access.course.sheet.getRange(access.course.rowIndex, statusCol + 1).setValue("published");
  access.course.sheet.getRange(access.course.rowIndex, publishedFileCol + 1).setValue(publishedFileId);
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
