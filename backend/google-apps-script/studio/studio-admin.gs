// AULIA — Teacher administration inside the admin Sheet

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("AULIA")
    .addItem("Abrir administración de docentes", "openTeacherAdmin")
    .addItem("Activar/desactivar docente seleccionado", "toggleSelectedTeacher")
    .addSeparator()
    .addItem("Inicializar / reparar estructura", "initializeStudio")
    .addToUi();
}

function openTeacherAdmin() {
  const html = HtmlService
    .createHtmlOutputFromFile("studio-admin-panel")
    .setTitle("AULIA · Docentes");
  SpreadsheetApp.getUi().showSidebar(html);
}

function createTeacherFromAdmin(form) {
  const data = form || {};
  const email = String(data.email || "").trim();
  const name = String(data.name || "").trim();
  const password = String(data.password || "");
  const passwordConfirm = String(data.passwordConfirm || "");

  if (password !== passwordConfirm) {
    throw new Error("Las contraseñas no coinciden.");
  }

  const result = provisionTeacher(email, name, password);
  studioAudit("sheet-admin", "provision-teacher", "", "ok", email);

  return result;
}

function toggleSelectedTeacher() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== STUDIO_SHEETS.teachers) {
    throw new Error("Seleccioná primero una fila en la hoja 👩‍🏫 Docentes.");
  }

  const row = sheet.getActiveRange().getRow();
  if (row <= 1) {
    throw new Error("Seleccioná una fila de docente, no el encabezado.");
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const emailCol = studioColumn(headers, ["Email"]);
  const activeCol = studioColumn(headers, ["Activo"]);

  if (emailCol < 0 || activeCol < 0) {
    throw new Error("La hoja Docentes no tiene la estructura esperada.");
  }

  const email = normalizeStudioEmail(sheet.getRange(row, emailCol + 1).getValue());
  if (!email) throw new Error("La fila seleccionada no tiene email.");

  const current = String(sheet.getRange(row, activeCol + 1).getValue() || "")
    .trim()
    .toLowerCase();
  const nextActive = !["si", "sí", "1", "true"].includes(current);

  setTeacherActive(email, nextActive);
  studioAudit("sheet-admin", nextActive ? "activate-teacher" : "deactivate-teacher", "", "ok", email);

  SpreadsheetApp.getUi().alert(
    nextActive
      ? "Docente activado: " + email
      : "Docente desactivado: " + email
  );
}
