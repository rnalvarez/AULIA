import test from "node:test";
import assert from "node:assert/strict";
import { retrieveFromCourse } from "./retrieval.js";

test("la coincidencia con un autor citado no recupera pasajes de referencias excluidas", () => {
  const course = {
    concepts: [],
    corpus: [
      { id: "referencia-excluida", title: "Referencias", content: "Zorilla, Amalia (1998). Teoría de la escucha. Editorial Sintética. DOI 10.1234/escucha.", source: "bibliografia-sintetica.pdf", sourcePageStart: 42, sourcePageEnd: 42, role: "referencias", scope: "excluded", priority: "normal" },
      { id: "contenido-incluido", title: "Escucha", content: "La escucha audiovisual permite relacionar sonidos y situaciones.", source: "apunte-sintetico.pdf", sourcePageStart: 8, sourcePageEnd: 8, role: "contenido", scope: "included", priority: "normal" },
    ],
    knowledgeBase: null,
  };
  const results = retrieveFromCourse(course, "Zorilla Amalia teoría de la escucha DOI");
  assert.equal(results.some(item => item.id === "referencia-excluida"), false);
  assert.equal(results.some(item => item.sourcePageStart === 42), false);
});
