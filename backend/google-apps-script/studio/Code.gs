// AULIA — Teacher Studio backend dispatcher
// Separate from the course-specific student backend.

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    switch (String(body.action || "")) {
      case "login": return studioJson(handleTeacherLogin(body));
      case "session": return studioJson(handleTeacherSession(body));
      case "logout": return studioJson(handleTeacherLogout(body));
      case "list-courses": return studioJson(handleStudioListCourses(body));
      case "get-course": return studioJson(handleStudioGetCourse(body));
      case "create-course": return studioJson(handleStudioCreateCourse(body));
      case "save-course": return studioJson(handleStudioSaveCourse(body));
      case "publish-course": return studioJson(handleStudioPublishCourse(body));
      case "prepare-delete-course": return studioJson(handleStudioPrepareDeleteCourse(body));
      case "delete-course": return studioJson(handleStudioDeleteCourse(body));
      case "public-course": return studioJson(handlePublicCourse(body));
      default: return studioJson({ success: false, error: "Acción no reconocida." });
    }
  } catch (err) {
    console.error("Studio doPost", err);
    return studioJson({ success: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return studioJson({
    success: true,
    service: "AULIA Studio",
    version: STUDIO_BACKEND_VERSION,
    status: "ready",
  });
}

function studioJson(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// Función de entrada para la configuración inicial del backend.
// Puede ejecutarse directamente desde el selector de funciones de Apps Script.
function setupStudio() {
  // Inicializa la estructura base y luego aplica las migraciones de columnas.
  initializeStudio();

  const ss = studioSpreadsheet();
  const migrations = {
    "📚 Cátedras": [
      "Course ID",
      "Título",
      "Owner Email",
      "Estado",
      "Drive File ID",
      "Public Slug",
      "Published Drive File ID",
      "Student Sheet ID",
      "Student Sheet URL",
      "Actualizado",
      "Publicado",
    ],
    "👩‍🏫 Docentes": [
      "Email",
      "Nombre",
      "Password Hash",
      "Salt",
      "Activo",
      "Creado",
      "Último acceso",
    ],
  };

  Object.entries(migrations).forEach(([sheetName, expectedHeaders]) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const currentHeaders = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0]
      .map(value => String(value || "").trim());

    const normalized = new Set(currentHeaders.map(value => value.toLowerCase()));
    const missing = expectedHeaders.filter(header => !normalized.has(header.toLowerCase()));

    if (missing.length) {
      sheet
        .getRange(1, lastColumn + 1, 1, missing.length)
        .setValues([missing]);
    }

    sheet.setFrozenRows(1);
    try {
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold");
    } catch (e) {}

    if (sheetName === "👩‍🏫 Docentes" && sheet.getMaxColumns() >= 4) {
      try {
        sheet.hideColumns(3, 2);
      } catch (e) {}
    }
  });

  console.log("✓ Migración de estructura Studio completada.");
  console.log("Sheet: " + ss.getId());
  return "AULIA Studio inicializado y estructura actualizada.";
}
