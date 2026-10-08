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
  if (Array.isArray(course?.modes) && course.modes.length === 0) {
    errors.push("El course pack debe tener al menos un modo");
  }

  checkUniqueIds(course?.bibliography, "Bibliografía", errors);
  checkUniqueIds(course?.documents, "Documentos", errors);
  checkUniqueIds(course?.pedagogicalUnits, "Unidades pedagógicas", errors);
  checkUniqueIds(course?.concepts, "Conceptos", errors);
  checkUniqueIds(course?.modes, "Modos", errors);
  checkUniqueIds(course?.activities, "Actividades", errors);
  checkUniqueIds(course?.examples, "Ejemplos", errors);
  if (Array.isArray(course?.corpus)) checkUniqueIds(course.corpus, "Corpus", errors);
  if (Array.isArray(course?.commissions)) checkUniqueIds(course.commissions, "Comisiones", errors);

  for (const [index, chunk] of (course?.corpus || []).entries()) {
    if (!chunk?.content) errors.push(`Corpus[${index}] no tiene content`);
  }

  const validScopes = new Set(["included", "reference", "excluded"]);
  const validPriorities = new Set(["central", "normal", "context"]);

  for (const document of course?.documents || []) {
    for (const section of document?.sections || []) {
      if (section?.scope && !validScopes.has(section.scope)) {
        errors.push(`La sección "${section?.title || "sin título"}" tiene scope inválido`);
      }
      if (section?.priority && !validPriorities.has(section.priority)) {
        errors.push(`La sección "${section?.title || "sin título"}" tiene priority inválida`);
      }
      if (section?.teacherConcepts && !Array.isArray(section.teacherConcepts)) {
        errors.push(`La sección "${section?.title || "sin título"}" tiene teacherConcepts inválidos`);
      }
    }
  }

  for (const [index, chunk] of (course?.corpus || []).entries()) {
    if (chunk?.scope && !validScopes.has(chunk.scope)) {
      errors.push(`Corpus[${index}] tiene scope inválido`);
    }
    if (chunk?.priority && !validPriorities.has(chunk.priority)) {
      errors.push(`Corpus[${index}] tiene priority inválida`);
    }
  }

  for (const unit of course?.pedagogicalUnits || []) {
    if (!unit?.title) errors.push(`Una unidad pedagógica no tiene title`);
    if (unit?.reviewStatus && !["pending", "approved"].includes(unit.reviewStatus)) {
      errors.push(`La unidad pedagógica "${unit?.id || "sin id"}" tiene reviewStatus inválido`);
    }
  }

  if (course?.curriculumMap && typeof course.curriculumMap === "object") {
    const map = course.curriculumMap;
    if (map.reviewStatus && !["pending", "approved"].includes(map.reviewStatus)) {
      errors.push("El mapa curricular tiene reviewStatus inválido");
    }

    const unitIds = new Set((course?.pedagogicalUnits || []).map((unit) => unit?.id).filter(Boolean));
    const sequence = Array.isArray(map.sequence) ? map.sequence : [];
    const seenSequence = new Set();

    for (const unitId of sequence) {
      if (!unitIds.has(unitId)) {
        errors.push(`El mapa curricular referencia una unidad inexistente: ${unitId}`);
      }
      if (seenSequence.has(unitId)) {
        errors.push(`El mapa curricular contiene una unidad repetida: ${unitId}`);
      }
      seenSequence.add(unitId);
    }

    for (const unit of course?.pedagogicalUnits || []) {
      for (const prerequisiteId of unit?.prerequisiteUnitIds || []) {
        if (!unitIds.has(prerequisiteId)) {
          errors.push(`La unidad "${unit?.id || "sin id"}" referencia un prerrequisito inexistente: ${prerequisiteId}`);
        }
        if (prerequisiteId === unit?.id) {
          errors.push(`La unidad "${unit?.id || "sin id"}" no puede ser prerrequisito de sí misma`);
        }
      }
    }

    const dependencies = new Map(
      (course?.pedagogicalUnits || []).map((unit) => [unit.id, new Set(unit.prerequisiteUnitIds || [])])
    );
    const visiting = new Set();
    const visited = new Set();
    function visit(id) {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const prerequisiteId of dependencies.get(id) || []) {
        if (dependencies.has(prerequisiteId) && visit(prerequisiteId)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    }
    for (const id of dependencies.keys()) {
      if (visit(id)) {
        errors.push("El mapa curricular contiene dependencias circulares.");
        break;
      }
    }
  }

  const bibliographyIds = new Set((course?.bibliography || []).map((item) => item?.id).filter(Boolean));
  const corpusIds = new Set((course?.corpus || []).map((item) => item?.id).filter(Boolean));

  for (const concept of course?.concepts || []) {
    for (const sourceId of concept?.sourceBibliographyIds || []) {
      if (!bibliographyIds.has(sourceId)) {
        errors.push(`El concepto "${concept?.id || "sin id"}" referencia una fuente bibliográfica inexistente: ${sourceId}`);
      }
    }
    for (const sourceId of concept?.sourceCorpusIds || []) {
      if (corpusIds.size && !corpusIds.has(sourceId)) {
        errors.push(`El concepto "${concept?.id || "sin id"}" referencia un fragmento inexistente: ${sourceId}`);
      }
    }
  }

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
