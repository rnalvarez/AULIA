import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_BASE_VERSION,
  knowledgeCorpusSignature,
  legacyKnowledgeCorpusSignatureV2,
} from "../../core/knowledgeBase.js";
import {
  buildKnowledgePassages,
  migrateLegacyKnowledgeBaseV2,
} from "./knowledgeBase.js";

function makeEntry(id, term, evidence) {
  return {
    id,
    term,
    aliases: [],
    category: "concepto",
    definition: "Definición fundamentada en la fuente.",
    explanation: "Desarrollo del concepto.",
    distinctions: [],
    relatedTerms: [],
    examples: [],
    evidence,
  };
}

function makeEvidence(passage, excerpt = "fragmento literal") {
  return {
    passageId: passage.passageId,
    sourceId: passage.sourceId,
    sourceName: passage.sourceName,
    title: passage.title,
    sectionPath: passage.sectionPath,
    pageStart: passage.pageStart,
    pageEnd: passage.pageEnd,
    scope: passage.scope,
    priority: passage.priority,
    excerpt,
  };
}

test("migra el índice v2 y reanaliza solo los pasajes afectados por exclusiones", () => {
  const corpus = [
    { id: "active-a", title: "Sección A", source: "Manual", content: "Contenido válido A.", scope: "included" },
    { id: "excluded-b", title: "Sección B", source: "Manual", content: "Contenido excluido B.", scope: "excluded" },
    { id: "active-c", title: "Sección C", source: "Manual", content: "Contenido válido C.", scope: "included" },
  ];
  const oldPassages = buildKnowledgePassages(corpus, { includeExcluded: true });
  const activePassages = buildKnowledgePassages(corpus);
  const passageA = oldPassages.find(item => item.sourceId === "active-a");
  const passageB = oldPassages.find(item => item.sourceId === "excluded-b");
  const passageC = oldPassages.find(item => item.sourceId === "active-c");
  const existingIndex = {
    version: 2,
    sourceSignature: legacyKnowledgeCorpusSignatureV2(corpus),
    status: "complete",
    entries: [
      makeEntry("unsafe-a", "Concepto de A", [makeEvidence(passageA)]),
      makeEntry("unsafe-mixed", "Concepto mixto", [makeEvidence(passageA), makeEvidence(passageB)]),
      makeEntry("safe-c", "Concepto de C", [makeEvidence(passageC)]),
    ],
    processedPassageIds: oldPassages.map(item => item.passageId),
    totalPassages: oldPassages.length,
    requestCount: 8,
  };

  const migrated = migrateLegacyKnowledgeBaseV2({ existingIndex, corpus, passages: activePassages });

  assert.ok(migrated);
  assert.equal(migrated.version, KNOWLEDGE_BASE_VERSION);
  assert.equal(migrated.sourceSignature, knowledgeCorpusSignature(corpus));
  assert.equal(migrated.status, "partial");
  assert.equal(migrated.totalPassages, activePassages.length);
  assert.deepEqual(migrated.entries.map(item => item.id), ["safe-c"]);
  assert.deepEqual(migrated.processedPassageIds, [passageC.passageId]);
  assert.equal(migrated.requestCount, 8);
});

test("migra sin nuevas tandas si el texto no cambió y no hay exclusiones", () => {
  const corpus = [
    { id: "one", title: "Sección uno", source: "Manual", content: "Contenido uno.", scope: "included" },
    { id: "two", title: "Sección dos", source: "Manual", content: "Contenido dos.", scope: "included" },
  ];
  const passages = buildKnowledgePassages(corpus);
  const entries = passages.map((passage, index) =>
    makeEntry("safe-" + index, "Concepto " + index, [makeEvidence(passage)])
  );
  const existingIndex = {
    version: 2,
    sourceSignature: legacyKnowledgeCorpusSignatureV2(corpus),
    status: "complete",
    entries,
    processedPassageIds: passages.map(item => item.passageId),
    totalPassages: passages.length,
    requestCount: 4,
  };

  const migrated = migrateLegacyKnowledgeBaseV2({ existingIndex, corpus, passages });

  assert.ok(migrated);
  assert.deepEqual(migrated.processedPassageIds, passages.map(item => item.passageId));
  assert.equal(migrated.entries.length, entries.length);
  assert.equal(migrated.status, "partial");
});

test("no migra índices v2 si cambió el texto fuente", () => {
  const original = [{ id: "one", title: "Sección", content: "Texto original." }];
  const existingIndex = {
    version: 2,
    sourceSignature: legacyKnowledgeCorpusSignatureV2(original),
    status: "complete",
    entries: [],
    processedPassageIds: [],
    totalPassages: 0,
  };
  const changed = [{ ...original[0], content: "Texto modificado." }];
  assert.equal(
    migrateLegacyKnowledgeBaseV2({
      existingIndex,
      corpus: changed,
      passages: buildKnowledgePassages(changed),
    }),
    null
  );
});
