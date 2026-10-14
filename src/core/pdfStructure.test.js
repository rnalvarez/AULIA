import test from "node:test";
import assert from "node:assert/strict";
import { analyzePdfStructure } from "./pdfStructure.js";

function line(text, y, { fontSize = 11, bold = false, xMin = 40, width } = {}) {
  return {
    text,
    y,
    xMin,
    width: width ?? Math.min(text.length * fontSize * 0.48, 500),
    fontSize,
    height: fontSize,
    bold,
    fontNames: [bold ? "Synthetic-Bold" : "Synthetic-Regular"],
    items: [],
  };
}

function page(pageNumber, texts, { width = 600, height = 800 } = {}) {
  return {
    pageNumber,
    width,
    height,
    lines: texts.map((entry) => line(entry.text, entry.y, entry)),
  };
}

function syntheticBook() {
  return [
    page(1, [
      { text: "Portada", y: 740, fontSize: 24, bold: true },
      { text: "Material sintético de prueba", y: 680, fontSize: 10 },
    ]),
    page(2, [
      { text: "Índice", y: 750, fontSize: 20, bold: true },
      { text: "Capítulo 1 Introducción ........ 3", y: 700 },
      { text: "Capítulo 2 Percepción ........ 4", y: 670 },
      { text: "Capítulo 3 Escucha ........ 5", y: 640 },
      { text: "Referencias ........ 7", y: 610 },
    ]),
    page(3, [
      { text: "Capítulo 1 Introducción", y: 740, fontSize: 22, bold: true },
      { text: "CUERPO CAPÍTULO UNO: idea sintética sobre escucha.", y: 690 },
      { text: "El ejemplo inventado no contiene citas bibliográficas.", y: 650 },
      { text: "Continúa el cuerpo del primer capítulo.", y: 610 },
    ]),
    page(4, [
      { text: "Capítulo 2 Percepción", y: 740, fontSize: 22, bold: true },
      { text: "CUERPO CAPÍTULO DOS: percepción y sonido.", y: 690 },
      { text: "Segundo ejemplo sintético sin apellidos citados.", y: 650 },
      { text: "Continúa el cuerpo del segundo capítulo.", y: 610 },
    ]),
    page(5, [
      { text: "Capítulo 3 Escucha", y: 740, fontSize: 22, bold: true },
      { text: "CUERPO CAPÍTULO TRES: escucha audiovisual.", y: 690 },
      { text: "Tercer ejemplo sintético sin bibliografía.", y: 650 },
      { text: "Continúa el cuerpo del tercer capítulo.", y: 610 },
    ]),
    page(6, [
      { text: "Conclusión", y: 740, fontSize: 20, bold: true },
      { text: "CONCLUSIÓN DEL AUTOR: cierre inventado del material.", y: 690 },
      { text: "Estas ideas finales forman parte del contenido.", y: 650 },
    ]),
    page(7, [
      { text: "Referencias", y: 740, fontSize: 20, bold: true },
      { text: "Gómez, L. (1997). Escucha y percepción. Editorial Sur.", y: 690 },
      { text: "Smith, J. (2002). Sound and image. pp. 12-18.", y: 650 },
      { text: "Pérez, A. (2010). DOI 10.1234/ejemplo.", y: 610 },
    ]),
  ];
}

test("separa preliminares, índice, capítulos y referencias en un PDF sintético", async () => {
  const result = await analyzePdfStructure({
    pdf: { getOutline: async () => null },
    pages: syntheticBook(),
  });

  const preliminaries = result.sections.filter((section) => section.role === "preliminares");
  const contents = result.sections.filter((section) => section.role === "indice");
  const references = result.sections.filter((section) => section.role === "referencias");

  assert.ok(preliminaries.length >= 1, JSON.stringify(result.sections.map(({ title, role }) => ({ title, role }))));
  assert.equal(contents.length, 1);
  assert.equal(contents[0].isContentsPage, true);
  assert.ok(references.length >= 1);

  const referenceText = "Gómez, L. (1997)";
  assert.ok(references.some((section) => section.content.includes(referenceText)));
  assert.equal(
    result.sections.some((section) => section.role !== "referencias" && section.content.includes(referenceText)),
    false,
    "el texto bibliográfico no debe quedar dentro de un capítulo u otra sección"
  );
  assert.equal(result.sections.filter((section) => /^Capítulo [123]/i.test(section.title)).length, 3);
});

test("las líneas de un índice no se convierten en encabezados de sección", async () => {
  const result = await analyzePdfStructure({
    pdf: { getOutline: async () => null },
    pages: syntheticBook(),
  });

  const toc = result.sections.find((section) => section.role === "indice");
  assert.ok(toc);
  assert.match(toc.content, /Capítulo 1 Introducción/);
  assert.match(toc.content, /Capítulo 3 Escucha/);
  assert.equal(result.sections.some((section) => section.title === "Capítulo 1 Introducción" && section.sourcePageStart === 2), false);
});
