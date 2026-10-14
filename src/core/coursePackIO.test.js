import test from "node:test";
import assert from "node:assert/strict";
import { COURSE_PACK_VERSION, courseToPack, packToCourse } from "./coursePackIO.js";

function makeCourse() {
  return {
    id: "pack-compatibilidad",
    title: "Curso sintético",
    author: "Docente de prueba",
    bibliography: [],
    concepts: [],
    modes: [{ id: "modo", title: "Modo", strategy: "retrieve", pedagogicalGoal: "Recuperar información" }],
    activities: [],
    examples: [],
    documents: [{
      id: "documento-1",
      title: "Libro sintético",
      documentType: "libro",
      documentTypeSource: "teacher",
      priority: "central",
      sections: [{
        id: "seccion-1",
        title: "Capítulo",
        role: "contenido",
        roleSource: "teacher",
        roleConfidence: 0.98,
        scope: "included",
        scopeSource: "teacher",
        priority: "central",
        prioritySource: "teacher",
      }],
    }],
    corpus: [{
      id: "pasaje-1",
      title: "Pasaje",
      content: "Texto sintético de prueba.",
      documentId: "documento-1",
      role: "referencias",
      roleSource: "rules",
      roleConfidence: 0.91,
      scope: "excluded",
      scopeSource: "role-default",
      priority: "normal",
      prioritySource: "document",
    }],
  };
}

test("exporta course packs 1.1 y conserva todos los metadatos de roles", () => {
  const pack = courseToPack(makeCourse());
  assert.equal(COURSE_PACK_VERSION, "1.1");
  assert.equal(pack.version, "1.1");
  const roundTrip = packToCourse(JSON.parse(JSON.stringify(pack)));
  assert.deepEqual(roundTrip.corpus[0], pack.corpus[0]);
  assert.deepEqual(roundTrip.documents[0], pack.documents[0]);
});

test("importa packs 1.0 sin exigir los campos incorporados en 1.1", () => {
  const pack = courseToPack(makeCourse());
  const legacy = {
    ...pack,
    version: "1.0",
    documents: pack.documents.map(({ documentType, documentTypeSource, priority, ...document }) => ({
      ...document,
      sections: document.sections.map(({ role, roleSource, roleConfidence, scopeSource, prioritySource, ...section }) => section),
    })),
    corpus: pack.corpus.map(({ role, roleSource, roleConfidence, scopeSource, prioritySource, ...chunk }) => chunk),
  };
  const imported = packToCourse(legacy);
  assert.equal(imported.id, "pack-compatibilidad");
  assert.equal(imported.corpus[0].content, "Texto sintético de prueba.");
  assert.equal(imported.corpus[0].role, undefined);
  assert.equal(imported.documents[0].documentType, undefined);
});

test("rechaza valores fuera de los enums cerrados cuando los campos están presentes", () => {
  const pack = courseToPack(makeCourse());
  const invalid = JSON.parse(JSON.stringify(pack));
  invalid.corpus[0].role = "bibliografia-y-algo-mas";
  assert.throws(() => packToCourse(invalid), /role inválido/);
  const invalidDocument = JSON.parse(JSON.stringify(pack));
  invalidDocument.documents[0].documentType = "tesis";
  assert.throws(() => packToCourse(invalidDocument), /documentType inválido/);
});
