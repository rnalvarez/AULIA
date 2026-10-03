function formatSources(items) {
  if (!items.length) {
    return "No encontré una unidad conceptual suficientemente cercana dentro del corpus.";
  }
  return items
    .map((item) => "• " + item.title + ": " + item.summary)
    .join("\n");
}

function responseForStrategy(strategy, { course, retrieved, mode }) {
  const sourceText = formatSources(retrieved);

  switch (strategy) {
    case "retrieve":
      return [
        "Dentro del corpus de " + course.title + ", la consulta se puede abordar desde:",
        sourceText,
        "",
        "La recuperación está desacoplada del proveedor de IA.",
      ].join("\n");

    case "socratic":
      if (!retrieved.length) {
        return "No encontré un concepto suficientemente cercano. ¿Qué elemento concreto de la bibliografía pensás que se relaciona con tu pregunta?";
      }
      return [
        "Tomemos " + retrieved[0].title + " como punto de partida.",
        "",
        "¿Qué parte de tu hipótesis se explicaría con este concepto y qué parte quedaría todavía sin explicar?",
      ].join("\n");

    case "scene-analysis":
      return [
        "Describí la escena o situación con la mayor precisión posible.",
        "",
        "Antes de interpretar, voy a contrastar tu descripción con estas unidades del corpus:",
        sourceText,
        "",
        "¿Qué observamos o escuchamos concretamente antes de asignarle un concepto?",
      ].join("\n");

    case "guided-analysis":
      return [
        "Vamos a trabajar de manera secuencial con la modalidad «" + mode.title + "».",
        "",
        sourceText,
        "",
        "Primer paso: describí lo que ocurre sin interpretarlo todavía.",
      ].join("\n");

    case "diagnostic":
      return [
        "Trabajemos el problema como un diagnóstico.",
        "",
        sourceText,
        "",
        "¿Qué relación concreta entre los elementos de la escena podría explicar el efecto que describís?",
      ].join("\n");

    default:
      return [
        "Modalidad: " + mode.title,
        "",
        sourceText,
        "",
        "La estrategia de esta modalidad es configurable por el course pack.",
      ].join("\n");
  }
}

export function buildPedagogicalResponse({ course, mode, retrieved }) {
  return responseForStrategy(mode?.strategy || "generic", {
    course,
    mode,
    retrieved,
  });
}
