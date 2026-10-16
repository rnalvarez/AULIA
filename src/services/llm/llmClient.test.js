import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./llmClient.js";

function makeKnowledgeItem(index, mode = "knowledge") {
  const term = "CONCEPTO_PRUEBA_" + index;
  return {
    id: "kb-" + index,
    title: term,
    _retrievalKind: mode,
    knowledgeEntry: {
      term,
      aliases: ["alias uno", "alias dos", "alias tres", "alias cuatro", "alias cinco"],
      category: "categoría de prueba",
      definition: ("Definición fundamentada en el pasaje de prueba. ").repeat(24),
      explanation: ("Desarrollo complementario del concepto. ").repeat(24),
      definitionVariants: ["Una variante de definición que conserva el sentido."],
      distinctions: ["Distinción importante para evitar confusiones."],
      relatedTerms: ["término relacionado uno", "término relacionado dos", "término relacionado tres"],
      examples: ["Ejemplo breve del material."],
      evidence: [{
        sourceName: "Manual de prueba",
        title: term,
        sectionPath: ["Capítulo de prueba", "Sección de conceptos"],
        pageStart: 27 + index,
        pageEnd: 27 + index,
        excerpt: ("Fragmento verificable tomado del material fuente. ").repeat(8),
      }],
    },
  };
}

function makePrompt({ modeId = "analisis", retrievedCount = 4 } = {}) {
  const knowledge = Array.from({ length: retrievedCount }, (_, index) => makeKnowledgeItem(index + 1));
  const courseConcepts = Array.from({ length: 3 }, (_, index) => ({
    id: "course-concept-" + index,
    title: "CONCEPTO_CURRICULAR_" + index,
    explanation: ("Resumen curricular específico. ").repeat(30),
    sourceBibliographyIds: [],
    pedagogicalUnitIds: [],
    confusionCriteria: ["Criterio de confusión."],
  }));
  const curricularRetrieved = courseConcepts.map(item => ({ ...item, id: item.id }));
  const corpus = Array.from({ length: 4 }, (_, index) => ({
    id: "corpus-" + index,
    title: "FRAGMENTO_BIBLIOGRÁFICO_" + index,
    sectionPath: ["Capítulo " + index, "Sección " + index],
    source: "Fuente cargada por el docente",
    sourcePageStart: index + 1,
    sourcePageEnd: index + 1,
    content: ("Este es el contenido literal recuperado de la bibliografía. ").repeat(80),
  }));
  return buildSystemPrompt({
    course: {
      id: "test-course",
      title: "Cátedra de prueba",
      bibliography: [],
      concepts: courseConcepts,
      pedagogicalUnits: [],
      curriculumMap: null,
    },
    assistant: { name: "AULIA", instructions: "Responder desde la bibliografía autorizada." },
    mode: {
      id: modeId,
      title: "Modo pedagógico de prueba",
      strategy: "contrastar y justificar con evidencia",
      pedagogicalGoal: "Ayudar a comprender y relacionar ideas.",
      instructions: "Distinguir evidencia del texto e interpretación.",
    },
    retrieved: [...knowledge, ...curricularRetrieved, ...corpus],
  });
}

function sliceAfterBefore(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, "missing start marker: " + startMarker);
  const contentStart = start + startMarker.length;
  const end = text.indexOf(endMarker, contentStart);
  assert.notEqual(end, -1, "missing end marker: " + endMarker);
  return text.slice(contentStart, end);
}

test("el prompt limita el tamaño de cada bloque de contexto recuperado", () => {
  const prompt = makePrompt({ retrievedCount: 4 });
  const knowledge = sliceAfterBefore(
    prompt,
    "BASE DE CONOCIMIENTO CONSTRUIDA A PARTIR DE LA BIBLIOGRAFÍA:",
    "Las entradas de la base conceptual"
  );
  const concepts = sliceAfterBefore(
    prompt,
    "CONCEPTOS AUTORIZADOS PARA EL ANÁLISIS DE ESTA INTERACCIÓN:",
    "Corpus recuperado:"
  );
  const corpus = sliceAfterBefore(
    prompt,
    "Corpus recuperado:",
    "IMPORTANTE — SALIDA ESTRUCTURADA:"
  );

  assert.ok(knowledge.length <= 3900, "indexed knowledge exceeds its context budget: " + knowledge.length);
  assert.ok(concepts.length <= 1400, "course concepts exceed their context budget: " + concepts.length);
  assert.ok(corpus.length <= 3100, "retrieved passages exceed their context budget: " + corpus.length);
  assert.ok(prompt.length <= 15000, "system prompt grew beyond the intended size: " + prompt.length);
});

test("el contexto compacto conserva una referencia de fuente y página", () => {
  const prompt = makePrompt({ retrievedCount: 1 });
  assert.match(prompt, /FUENTE: Manual de prueba/);
  assert.match(prompt, /PÁGINAS: 28/);
  assert.match(prompt, /EVIDENCIA TEXTUAL:/);
});

test("el modo socrático limita la cantidad de conceptos indexados", () => {
  const prompt = makePrompt({ modeId: "socratico", retrievedCount: 4 });
  assert.match(prompt, /CONCEPTO_PRUEBA_1/);
  assert.match(prompt, /CONCEPTO_PRUEBA_2/);
  assert.doesNotMatch(prompt, /CONCEPTO_PRUEBA_3/);
  assert.match(prompt, /Estrategia pedagógica del modo: contrastar y justificar con evidencia/);
});
