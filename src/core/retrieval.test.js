import test from "node:test";
import assert from "node:assert/strict";
import { KNOWLEDGE_BASE_VERSION, knowledgeCorpusSignature } from "./knowledgeBase.js";
import { retrieveFromCourse } from "./retrieval.js";
import { buildKnowledgePassages } from "../services/llm/knowledgeBase.js";

test("knowledge index version changes when corpus scope changes", () => {
  const included = [{ id: "p1", title: "Sección", content: "Contenido suficiente." }];
  const excluded = [{ ...included[0], scope: "excluded" }];
  assert.equal(KNOWLEDGE_BASE_VERSION, 3);
  assert.notEqual(knowledgeCorpusSignature(included), knowledgeCorpusSignature(excluded));
});

test("knowledge index builder omits excluded material by default", () => {
  const corpus = [
    { id: "included", title: "Incluido", content: "Texto autorizado." },
    { id: "excluded", title: "Excluido", scope: "excluded", content: "Texto que no debe indexarse." },
  ];
  assert.deepEqual(buildKnowledgePassages(corpus).map(p => p.sourceId), ["included"]);
  assert.deepEqual(
    buildKnowledgePassages(corpus, { includeExcluded: true }).map(p => p.sourceId),
    ["included", "excluded"]
  );
});

test("retrieval keeps valid evidence when another reference is excluded or missing", () => {
  const corpus = [
    { id: "active", title: "Sección válida", source: "Libro", content: "Definición útil.", scope: "included", priority: "central", sourcePageStart: 12 },
    { id: "excluded", title: "Sección excluida", source: "Libro", content: "Texto excluido.", scope: "excluded" },
    { id: "reference", title: "Sección referencial", source: "Libro", content: "Texto referencial.", scope: "reference" },
  ];
  const entries = [{
    id: "kb-concepto",
    term: "Concepto relevante",
    aliases: ["idea pertinente"],
    category: "categoría",
    definition: "Definición sustentada en el material.",
    explanation: "Explicación.",
    distinctions: [],
    relatedTerms: [],
    examples: [],
    evidence: [
      { sourceId: "excluded", sourceName: "Libro", excerpt: "evidencia excluida" },
      { sourceId: "active", sourceName: "Libro", excerpt: "evidencia válida", pageStart: 5 },
      { sourceId: "reference", sourceName: "Libro", excerpt: "evidencia referencial" },
      { sourceId: "missing", sourceName: "Fuente inexistente", excerpt: "evidencia no disponible" },
    ],
  }];
  const passages = buildKnowledgePassages(corpus);
  const course = {
    concepts: [],
    corpus,
    knowledgeBase: {
      version: KNOWLEDGE_BASE_VERSION,
      sourceSignature: knowledgeCorpusSignature(corpus),
      status: "complete",
      totalPassages: passages.length,
      processedPassageIds: passages.map(p => p.passageId),
      entries,
    },
  };

  const result = retrieveFromCourse(course, "Concepto relevante", { includeReference: false });
  const item = result.find(value => value.id === "kb-concepto");
  assert.ok(item, "the concept should remain retrievable through its valid evidence");
  assert.deepEqual(item.knowledgeEntry.evidence.map(ref => ref.sourceId), ["active"]);
  assert.deepEqual(item.sourceIds, ["active"]);
  assert.equal(item.priority, "central");
  assert.equal(item.sourcePageStart, 12);
});
