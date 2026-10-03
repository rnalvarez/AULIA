export function normalizeStudentId(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildStudentContext({
  courseId,
  studentId,
  name = "",
  commission = "",
}) {
  return {
    courseId,
    studentId: normalizeStudentId(studentId),
    name,
    commission,
  };
}

/*
  El cliente no autoriza por sí mismo a un estudiante.
  La futura API o Apps Script debe resolver el padrón y las credenciales.
*/
