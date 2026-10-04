// AULIA — dispatcher for the CHIONIA pilot backend.
// This backend handles course access and teacher tracking.
// The LLM is called directly by the student's browser with the student's own API key.

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
    console.error("doPost", err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  try {
    actualizarResumen(getSpreadsheet());
    return textResponse("✓ AULIA backend · CHIONIA pilot · Resumen actualizado");
  } catch (err) {
    return textResponse("Error: " + String(err && err.message || err));
  }
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function textResponse(value) {
  return ContentService.createTextOutput(String(value))
    .setMimeType(ContentService.MimeType.TEXT);
}

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function requiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Falta la propiedad " + name + ".");
  return value;
}
