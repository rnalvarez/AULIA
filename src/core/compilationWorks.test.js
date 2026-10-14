import test from "node:test";
import assert from "node:assert/strict";
import { detectCompilationWorks, splitCompilationIntoWorks } from "./compilationWorks.js";
function sample() {
  const aiPages = [
    { pageNumber: 1, extractedText: "Listening Image\nAna Perez\nUniversidad Nacional\nAbstract\nInvented article one." },
    { pageNumber: 2, extractedText: "Article one continues.\nReferences\nPerez, A. (2018). Example." },
    { pageNumber: 3, extractedText: "Acoustic Spaces\nR. Gomez\nResumen\nArtículo sintético dos." },
    { pageNumber: 4, extractedText: "Artículo dos continúa.\nBibliografía\nGomez, R. (2020). Ejemplo." },
    { pageNumber: 5, extractedText: "Media and Listening\nJo Smith\nAbstract\nInvented article three." },
    { pageNumber: 6, extractedText: "Article three continues.\nReferences\nSmith, J. (2022). Sample." },
  ];
  return {
    sourceName: "compilacion-sintetica.pdf", pages: 6, aiPages,
    document: { id: "doc-pack", title: "Compilación sintética", sourceName: "compilacion-sintetica.pdf", documentType: "compilacion", documentTypeSource: "teacher", priority: "central", pages: 6 },
    corpus: aiPages.map(page => ({ id: "c"+page.pageNumber, title: /references|bibliografia/i.test(page.extractedText) ? "Referencias" : "Contenido", sectionPath: ["Contenido"], sectionLevel: 1, content: page.extractedText, sourcePageStart: page.pageNumber, sourcePageEnd: page.pageNumber, sourcePageCount: 6, documentId: "doc-pack", role: /references|bibliografia/i.test(page.extractedText) ? "referencias" : "contenido", roleSource: "rules", roleConfidence: 0.9 })),
  };
}
test("detecta obras a partir de Resumen/Abstract y asigna rangos físicos consecutivos", () => {
  const works = detectCompilationWorks(sample());
  assert.equal(works.length, 3);
  assert.deepEqual(works.map(w => [w.startPage, w.endPage]), [[1,2],[3,4],[5,6]]);
  assert.equal(works[0].title, "Listening Image");
  assert.equal(works[0].author, "Ana Perez");
});
test("separa tres documentos y sus tres entradas bibliográficas con enlaces estables", () => {
  const split = splitCompilationIntoWorks(sample(), detectCompilationWorks(sample()));
  assert.equal(split.length, 3);
  assert.equal(new Set(split.map(item => item.document.id)).size, 3);
  assert.equal(split.flatMap(item => item.bibliography).length, 3);
  for (const item of split) {
    assert.equal(item.document.documentType, "articulo");
    assert.ok(item.document.sourcePageStart <= item.document.sourcePageEnd);
    assert.ok(item.corpus.every(chunk => chunk.documentId === item.document.id && chunk.sourceBibliographyId === item.bibliography[0].id));
    assert.ok(item.document.sections.every(section => section.documentId === item.document.id && section.sourceBibliographyId === item.bibliography[0].id));
  }
});
test("rechaza rangos superpuestos y páginas fuera del PDF", () => {
  const material = sample();
  assert.throws(() => splitCompilationIntoWorks(material, [{title:"A",startPage:1,endPage:4},{title:"B",startPage:4,endPage:6}]), /se superponen/);
  assert.throws(() => splitCompilationIntoWorks(material, [{title:"A",startPage:1,endPage:9}]), /entre 1 y 6/);
});
