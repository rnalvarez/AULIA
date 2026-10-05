// AULIA — Teacher Studio backend configuration
const STUDIO_BACKEND_VERSION = "0.1.0";
const STUDIO_TIMEZONE = "America/Argentina/Buenos_Aires";
const STUDIO_SESSION_TTL_SECONDS = 6 * 60 * 60;
const STUDIO_LOGIN_MAX_FAILURES = 5;
const STUDIO_LOGIN_WINDOW_SECONDS = 10 * 60;
const STUDIO_LOGIN_LOCK_SECONDS = 15 * 60;

const STUDIO_SHEETS = {
  teachers: "👩‍🏫 Docentes",
  courses: "📚 Cátedras",
  permissions: "👥 Permisos",
  audit: "📝 Auditoría",
};

const STUDIO_HEADERS = {
  teachers: ["Email", "Nombre", "Password Hash", "Salt", "Activo", "Creado", "Último acceso"],
  courses: ["Course ID", "Título", "Owner Email", "Estado", "Drive File ID", "Public Slug", "Published Drive File ID", "Actualizado", "Publicado"],
  permissions: ["Email", "Course ID", "Rol", "Activo", "Creado", "Actualizado"],
  audit: ["Fecha", "Email", "Acción", "Course ID", "Resultado", "Detalle"],
};

function studioRequiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Falta la propiedad " + name + ".");
  return value;
}

function studioSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty("STUDIO_SHEET_ID");
  return id
    ? SpreadsheetApp.openById(id)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function studioDriveFolder() {
  const id = studioRequiredProperty("COURSE_PACK_FOLDER_ID");
  return DriveApp.getFolderById(id);
}

function studioSheet(name, headersKey) {
  const ss = studioSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const expected = STUDIO_HEADERS[headersKey] || [];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  } else {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(v => String(v || "").trim());
    const missing = expected.filter(header => !current.some(h => h.toLowerCase() === header.toLowerCase()));
    if (missing.length) {
      sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    }
  }

  sheet.setFrozenRows(1);
  try {
    sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), expected.length)).setFontWeight("bold");
  } catch (e) {}
  return sheet;
}

function studioTeacherSheet() {
  const sheet = studioSheet(STUDIO_SHEETS.teachers, "teachers");
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const lastAccessIndex = studioColumn(headers, ["Último acceso"]);

  if (lastAccessIndex < 0) {
    sheet.getRange(1, lastColumn + 1).setValue("Último acceso");
  }

  // Hash y salt son datos técnicos. Quedan ocultos en la hoja de administración.
  try {
    if (sheet.getMaxColumns() >= 4) {
      sheet.hideColumns(3, 2);
    }
  } catch (e) {}

  sheet.setFrozenRows(1);
  return sheet;
}

function normalizeStudioEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function studioNow() {
  return Utilities.formatDate(new Date(), STUDIO_TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function studioHash(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ("0" + ((b + 256) % 256).toString(16)).slice(-2)).join("");
}

function studioRandomSalt() {
  return Utilities.getUuid().replace(/-/g, "");
}

function studioHashPassword(email, password, salt) {
  return studioHash(
    normalizeStudioEmail(email) + ":" + String(password || "") + ":" + String(salt || "")
  );
}

function studioSlugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 44) || "catedra";
}

function studioColumn(headers, candidates) {
  const normalized = headers.map(h => String(h || "").trim().toLowerCase());
  for (const candidate of candidates) {
    const index = normalized.indexOf(String(candidate).trim().toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function studioCell(row, index) {
  return index >= 0 && row[index] != null ? String(row[index]).trim() : "";
}

function studioAudit(email, action, courseId, result, detail) {
  try {
    const sheet = studioSheet(STUDIO_SHEETS.audit, "audit");
    sheet.appendRow([
      studioNow(),
      normalizeStudioEmail(email),
      String(action || ""),
      String(courseId || ""),
      String(result || ""),
      String(detail || ""),
    ]);
  } catch (e) {
    console.error("studioAudit", e);
  }
}

function initializeStudio() {
  const ss = studioSpreadsheet();
  for (const key of Object.keys(STUDIO_SHEETS)) {
    studioSheet(STUDIO_SHEETS[key], key);
  }

  // La hoja Docentes recibe además la columna de último acceso y oculta
  // los campos técnicos de autenticación.
  studioTeacherSheet();

  const folderId = PropertiesService.getScriptProperties().getProperty("COURSE_PACK_FOLDER_ID");
  if (!folderId) {
    const folder = DriveApp.createFolder("AULIA · Course Packs");
    PropertiesService.getScriptProperties().setProperty("COURSE_PACK_FOLDER_ID", folder.getId());
    console.log("COURSE_PACK_FOLDER_ID=" + folder.getId());
  }

  console.log("STUDIO_SHEET_ID=" + ss.getId());
  console.log("✓ AULIA Studio backend inicializado.");
}

function provisionTeacher(email, name, password) {
  const normalizedEmail = normalizeStudioEmail(email);
  const cleanName = String(name || "").trim();
  const cleanPassword = String(password || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Email docente inválido.");
  }
  if (cleanName.length < 2) {
    throw new Error("Ingresá el nombre del docente.");
  }
  if (cleanPassword.length < 10) {
    throw new Error("La contraseña docente debe tener al menos 10 caracteres.");
  }

  const sheet = studioTeacherSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const emailCol = studioColumn(headers, ["Email"]);
  const nameCol = studioColumn(headers, ["Nombre"]);
  const hashCol = studioColumn(headers, ["Password Hash"]);
  const saltCol = studioColumn(headers, ["Salt"]);
  const activeCol = studioColumn(headers, ["Activo"]);
  const createdCol = studioColumn(headers, ["Creado"]);
  const lastAccessCol = studioColumn(headers, ["Último acceso"]);

  for (let i = 1; i < values.length; i += 1) {
    if (normalizeStudioEmail(values[i][emailCol]) !== normalizedEmail) continue;

    const salt = studioRandomSalt();
    const hash = studioHashPassword(normalizedEmail, cleanPassword, salt);
    const created = studioCell(values[i], createdCol) || studioNow();
    const lastAccess = studioCell(values[i], lastAccessCol);

    sheet.getRange(i + 1, 1, 1, headers.length).setValues([[
      normalizedEmail,
      cleanName,
      hash,
      salt,
      "Sí",
      created,
      lastAccess,
    ]]);

    return {
      updated: true,
      email: normalizedEmail,
      name: cleanName,
    };
  }

  const salt = studioRandomSalt();
  const hash = studioHashPassword(normalizedEmail, cleanPassword, salt);
  sheet.appendRow([
    normalizedEmail,
    cleanName,
    hash,
    salt,
    "Sí",
    studioNow(),
    "",
  ]);

  return {
    created: true,
    email: normalizedEmail,
    name: cleanName,
  };
}

function setTeacherActive(email, active) {
  const normalizedEmail = normalizeStudioEmail(email);
  if (!normalizedEmail) throw new Error("Falta el email docente.");

  const sheet = studioTeacherSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const emailCol = studioColumn(headers, ["Email"]);
  const activeCol = studioColumn(headers, ["Activo"]);

  for (let i = 1; i < values.length; i += 1) {
    if (normalizeStudioEmail(values[i][emailCol]) !== normalizedEmail) continue;
    sheet.getRange(i + 1, activeCol + 1).setValue(active ? "Sí" : "No");
    return { email: normalizedEmail, active: Boolean(active) };
  }

  throw new Error("No existe un docente con ese email.");
}

function getActiveTeacher(email) {
  const normalizedEmail = normalizeStudioEmail(email);
  const sheet = studioTeacherSheet();
  const values = sheet.getDataRange().getValues();
  if (!values.length) return null;

  const headers = values[0];
  const emailCol = studioColumn(headers, ["Email"]);
  const nameCol = studioColumn(headers, ["Nombre"]);
  const hashCol = studioColumn(headers, ["Password Hash"]);
  const saltCol = studioColumn(headers, ["Salt"]);
  const activeCol = studioColumn(headers, ["Activo"]);
  const lastAccessCol = studioColumn(headers, ["Último acceso"]);

  for (let i = 1; i < values.length; i += 1) {
    if (normalizeStudioEmail(values[i][emailCol]) !== normalizedEmail) continue;
    const active = activeCol < 0 || ["si", "sí", "1", "true"].includes(String(values[i][activeCol] || "").trim().toLowerCase());
    if (!active) return null;
    return {
      rowIndex: i + 1,
      email: normalizedEmail,
      name: studioCell(values[i], nameCol),
      passwordHash: studioCell(values[i], hashCol),
      salt: studioCell(values[i], saltCol),
      lastAccessCol,
    };
  }
  return null;
}
