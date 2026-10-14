import test from "node:test";
import assert from "node:assert/strict";
import { buildOutlinePrompt, resolveBoundaryRole } from "./semanticSegmentation.js";

test("el mapa global recibe el tipo declarado por el docente y guía artículos", () => {
  const prompt = buildOutlinePrompt({
    title: "Material sintético",
    pageCount: 12,
    samples: [],
    hints: [],
    declaredDocumentType: "articulo",
  });
  assert.match(prompt, /Tipo documental declarado por el docente: articulo/);
  assert.match(prompt, /no inventes capítulos de libro/);
  assert.match(prompt, /copiá exactamente el tipo declarado por el docente/);
});

test("la compilación se analiza obra por obra y no mezcla jerarquías", () => {
  const prompt = buildOutlinePrompt({
    title: "Compilación sintética",
    pageCount: 40,
    samples: [],
    hints: [],
    declaredDocumentType: "compilacion",
  });
  assert.match(prompt, /tratá una obra por vez/);
  assert.match(prompt, /no mezcles títulos, capítulos ni referencias/);
});

test("un rol claro se resuelve por reglas aunque la IA proponga otro", () => {
  const resolved = resolveBoundaryRole({
    title: "Referencias",
    line: { text: "Referencias" },
    proposedRole: "contenido",
    proposedConfidence: 0.95,
  });
  assert.equal(resolved.role, "referencias");
  assert.equal(resolved.roleSource, "rules");
  assert.ok(resolved.roleConfidence >= 0.7);
});

test("un rol ambiguo acepta una propuesta de IA validada por el enum", () => {
  const resolved = resolveBoundaryRole({
    title: "Una sección poco clara",
    line: { text: "Una sección poco clara" },
    proposedRole: "anexo",
    proposedConfidence: 0.84,
  });
  assert.equal(resolved.role, "anexo");
  assert.equal(resolved.roleSource, "ai");
  assert.equal(resolved.roleConfidence, 0.84);
});

test("si el rol sigue ambiguo, conserva contenido y marca revisión", () => {
  const resolved = resolveBoundaryRole({
    title: "Una sección poco clara",
    line: { text: "Una sección poco clara" },
    proposedRole: "otro-rol",
    proposedConfidence: 0.9,
  });
  assert.equal(resolved.role, "contenido");
  assert.equal(resolved.roleSource, "rules");
  assert.ok(resolved.roleConfidence < 0.7);
  assert.ok(resolved.roleEvidence.some((item) => item.includes("revisión docente")));
});
