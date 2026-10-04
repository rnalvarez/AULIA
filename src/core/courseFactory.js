export function createBlankCourse() {
  return {
    id: "nuevo-curso",
    title: "Nueva cátedra",
    author: "Nueva cátedra",
    description: "Asistente pedagógico configurado con AULIA.",
    language: "es",
    level: "universitario",
    assistant: {
      name: "Asistente pedagógico",
      shortTitle: "Asistente de la cátedra",
      initials: "AI",
      welcomeMessage: "Hola. Soy el asistente pedagógico de esta cátedra. ¿Qué querés explorar?",
      suggestions: [],
      instructions: "",
    },
    bibliography: [],
    concepts: [],
    examples: [],
    corpus: [],
    commissions: [],
    modes: [
      {
        id: "consulta",
        title: "Consultá con el asistente",
        description: "Preguntá libremente sobre el corpus del curso.",
        pedagogicalGoal: "comprender",
        strategy: "retrieve",
        placeholder: "Escribí tu consulta...",
      },
    ],
    activities: [
      {
        id: "consulta-concepto",
        title: "Consulta conceptual",
        modeId: "consulta",
        description: "Comprender una unidad del curso.",
      },
    ],
    llm: {
      provider: "",
      endpoint: "",
      models: [],
      generation: {},
    },
    tracking: {
      provider: "",
      courseId: "nuevo-curso",
      identitySource: "",
      interactionSource: "",
      sessionSource: "",
      endpoint: "",
    },
  };
}
