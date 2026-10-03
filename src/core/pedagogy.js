function formatSources(items) {
  if (!items.length) {
    return "No encontré una unidad conceptual suficientemente cercana dentro del corpus.";
  }
  return items
    .map((item) => "• " + item.title + ": " + item.summary)
    .join("\n");
}

export function buildPedagogicalResponse({ course, mode, retrieved }) {
  const sourceText = formatSources(retrieved);

  if (mode.id === "consulta") {
    return [
      "Dentro del corpus de " + course.title + ", la consulta se puede abordar desde:",
      sourceText,
      "",
      "Esta fundación usa únicamente las unidades recuperadas del course pack.",
    ].join("\n");
  }

  if (mode.id === "socratico") {
    if (!retrieved.length) {
      return "No encontré un concepto suficientemente cercano. ¿Qué elemento concreto de la bibliografía pensás que se relaciona con tu pregunta?";
    }
    const focus = retrieved[0];
    return [
      "Tomemos " + focus.title + " como punto de partida.",
      "",
      "¿Qué parte de tu pregunta se explicaría con este concepto y qué parte quedaría todavía sin explicar?",
    ].join("\n");
  }

  if (mode.id === "analisis") {
    return [
      "Describí la escena o situación con la mayor precisión posible.",
      "",
      "Antes de interpretar, voy a contrastar tu descripción con estas unidades del corpus:",
      sourceText,
      "",
      "¿Qué escuchamos o vemos concretamente antes de asignarle un concepto?",
    ].join("\n");
  }

  return [
    "Actividad: " + mode.title,
    "",
    sourceText,
    "",
    "Esta modalidad está preparada como extensión configurable del course pack.",
  ].join("\n");
}
