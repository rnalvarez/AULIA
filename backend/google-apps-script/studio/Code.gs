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