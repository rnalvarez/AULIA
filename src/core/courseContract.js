export function validateCourse(course) {
  const errors = [];
  if (!course?.id) errors.push("Falta course.id");
  if (!course?.title) errors.push("Falta course.title");
  if (!course?.author) errors.push("Falta course.author");
  if (!Array.isArray(course?.bibliography)) errors.push("Falta course.bibliography");
  if (!Array.isArray(course?.concepts)) errors.push("Falta course.concepts");
  if (!Array.isArray(course?.modes)) errors.push("Falta course.modes");

  for (const mode of course?.modes || []) {
    if (!mode.id) errors.push("Un modo no tiene id");
    if (!mode.title) errors.push("Un modo no tiene title");
  }

  return { valid: errors.length === 0, errors };
}
