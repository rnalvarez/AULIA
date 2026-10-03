const REQUIRED_ARRAYS = ["bibliography", "concepts", "modes", "activities", "examples"];

function checkUniqueIds(items, label, errors) {
  const seen = new Set();
  for (const [index, item] of (items || []).entries()) {
    if (!item?.id) continue;
    if (seen.has(item.id)) {
      errors.push(`${label} contiene un id duplicado: ${item.id}`);
    }
    seen.add(item.id);
    if (!item.title) errors.push(`${label}[${index}] no tiene title`);
  }
}

export function validateCourse(course) {
  const errors = [];

  if (!course?.id) errors.push("Falta course.id");
  if (!course?.title) errors.push("Falta course.title");
  if (!course?.author) errors.push("Falta course.author");

  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(course?.[key])) {
      errors.push(`Falta course.${key}`);
    }
  }

  checkUniqueIds(course?.bibliography, "Bibliografía", errors);
  checkUniqueIds(course?.concepts, "Conceptos", errors);
  checkUniqueIds(course?.modes, "Modos", errors);
  checkUniqueIds(course?.activities, "Actividades", errors);
  checkUniqueIds(course?.examples, "Ejemplos", errors);

  const modeIds = new Set((course?.modes || []).map((item) => item?.id).filter(Boolean));
  const conceptIds = new Set((course?.concepts || []).map((item) => item?.id).filter(Boolean));

  for (const mode of course?.modes || []) {
    if (!mode.strategy) errors.push(`El modo "${mode.id || "sin id"}" no tiene strategy`);
    if (!mode.pedagogicalGoal) errors.push(`El modo "${mode.id || "sin id"}" no tiene pedagogicalGoal`);
  }

  for (const activity of course?.activities || []) {
    if (activity?.modeId && !modeIds.has(activity.modeId)) {
      errors.push(`La actividad "${activity.id || "sin id"}" referencia un modeId inexistente: ${activity.modeId}`);
    }
  }

  for (const example of course?.examples || []) {
    for (const conceptId of example?.concepts || []) {
      if (!conceptIds.has(conceptId)) {
        errors.push(`El ejemplo "${example.id || "sin id"}" referencia un concepto inexistente: ${conceptId}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function cloneCourse(course) {
  return JSON.parse(JSON.stringify(course));
}
