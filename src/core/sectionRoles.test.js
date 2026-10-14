import test from "node:test";
import assert from "node:assert/strict";
import { classifySectionRole } from "./sectionRoles.js";

test("reconoce los seis roles a partir de títulos y estructura sintética", () => {
  const cases = [
    [{ title: "Portada", content: "Universidad y título de la obra" }, "preliminares"],
    [{ title: "Índice", content: "Capítulo 1 ........ 12\nCapítulo 2 ........ 24\nCapítulo 3 ........ 31" }, "indice"],
    [{ title: "Referencias", content: "Chion, M. (1994). Audio-Vision. London.\nSmith, J. (2018). Sound Studies. pp. 20-32.\nPerez, A. (2020). DOI 10.1234/example.\nTaylor, R. (2016). Listening. pp. 5-9." }, "referencias"],
    [{ title: "Glosario", content: "Términos complementarios y sus definiciones." }, "anexo"],
    [{ title: "Ejercicios de repaso", content: "1. Respondé las preguntas." }, "actividades"],
    [{ title: "Introducción", content: "Este libro presenta el problema." }, "contenido"],
  ];
  for (const [section, expectedRole] of cases) {
    const classified = classifySectionRole(section, { pageCount: 30 });
    assert.equal(classified.role, expectedRole, section.title);
    assert.ok(classified.confidence >= 0 && classified.confidence <= 1);
    assert.ok(Array.isArray(classified.evidence) && classified.evidence.length > 0);
  }
});

test("reconoce un índice por sus líneas aunque el título no sea informativo", () => {
  const section = {
    title: "Sección sin nombre",
    content: "Presentación ........ 3\nMarco conceptual ........ 8\nMétodo ........ 15\nResultados ........ 22",
  };
  assert.equal(classifySectionRole(section).role, "indice");
});

test("reconoce patrones de cita aunque el encabezado no diga bibliografía", () => {
  const classified = classifySectionRole({
    title: "Apuntes de lectura",
    content: "Gomez, L. (1997). Escucha y percepción. Editorial Sur.\nSmith, J. (2002). Sound and image. pp. 12-18.\nPerez, A. (2010). DOI 10.1234/ejemplo.\nJones, R. (2018). Film sound studies. Buenos Aires.",
  });
  assert.equal(classified.role, "referencias");
  assert.ok(classified.evidence.some((item) => item.includes("patrones de cita")));
});

test("ante evidencia ambigua devuelve contenido con confianza menor a 0.7", () => {
  const classified = classifySectionRole({
    title: "Una nota",
    content: "Un fragmento breve que no aporta señales suficientes para saber si es cuerpo del texto u otra sección.",
  });
  assert.equal(classified.role, "contenido");
  assert.ok(classified.confidence < 0.7);
  assert.ok(classified.evidence.some((item) => item.includes("revisión")));
});

test("la posición y una cantidad mínima de texto permiten detectar preliminares con cautela", () => {
  const classified = classifySectionRole(
    { title: "Datos editoriales", content: "Edición 2024\nISBN 000-0-00-000000-0", sourcePageStart: 2 },
    { pageCount: 120 }
  );
  assert.equal(classified.role, "preliminares");
  assert.ok(classified.confidence < 0.8);
});
