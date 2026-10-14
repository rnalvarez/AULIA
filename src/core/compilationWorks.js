import { applySectionRoleDefaults } from "./sectionRoles.js";
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const slug = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "obra";
function pageLines(page) {
  const items = Array.isArray(page?.lineItems) ? page.lineItems.map(line => clean(line?.text)).filter(Boolean) : [];
  return items.length ? items : String(page?.extractedText || page?.text || "").split(/\r?\n/).map(clean).filter(Boolean);
}
function guessAuthor(lines) {
  return (lines || []).find(line => line.length <= 120 && /[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+/.test(line) &&
    !/universidad|facultad|department|departamento|instituto|resumen|abstract|keywords/i.test(line) && !/[.!?]$/.test(line)) || "";
}
export function detectCompilationWorks(material) {
  const pages = (material?.aiPages || []).slice().sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
  const pageCount = Math.max(Number(material?.pages || material?.document?.pages || 0), ...pages.map(p => Number(p.pageNumber || 0)));
  const detected = [];
  for (const page of pages) {
    const lines = pageLines(page);
    const abstractIndex = lines.findIndex((line, index) => index < 14 && /^(resumen|abstract)\b/i.test(line));
    if (abstractIndex < 1) continue;
    const leading = lines.slice(0, abstractIndex);
    const title = leading.find(line => line.length >= 8 && line.length <= 180 && !/^(issn|isbn|doi|palabras clave|keywords|universidad|facultad)\b/i.test(line));
    if (!title || /^(introducci[oó]n|introduction|contenido|indice|referencias|bibliograf[ií]a)$/i.test(title)) continue;
    const afterTitle = leading.slice(leading.indexOf(title) + 1);
    const author = guessAuthor(afterTitle);
    const year = (leading.join(" ") + " " + lines.slice(abstractIndex, abstractIndex + 2).join(" ")).match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    const startPage = Number(page.pageNumber);
    if (!Number.isInteger(startPage) || startPage < 1) continue;
    detected.push({ id: "obra-" + slug(title) + "-" + startPage, title: title.slice(0, 180), author, year, startPage, endPage: pageCount, confidence: 0.78, needsReview: false, evidence: "Título y Resumen/Abstract detectados en la página física " + startPage });
  }
  const unique = [], starts = new Set();
  for (const work of detected.sort((a, b) => a.startPage - b.startPage)) {
    if (starts.has(work.startPage)) continue;
    starts.add(work.startPage); unique.push(work);
  }
  return unique.map((work, index) => ({ ...work, endPage: unique[index + 1] ? unique[index + 1].startPage - 1 : pageCount }));
}
function normalizeWork(work, index, pageCount) {
  const title = clean(work?.title) || "Obra " + (index + 1);
  const startPage = Math.trunc(Number(work?.startPage)), endPage = Math.trunc(Number(work?.endPage));
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage || endPage > pageCount) {
    throw new Error("El rango físico de «" + title + "» debe estar entre 1 y " + pageCount + ".");
  }
  return { ...work, id: clean(work?.id) || "obra-" + slug(title) + "-" + startPage, title, author: clean(work?.author), year: clean(work?.year), startPage, endPage };
}
function sourceMetadataAtPage(corpus, pageNumber) {
  return (corpus || []).filter(chunk => {
    const start = Number(chunk?.sourcePageStart || chunk?.sourcePage || 0), end = Number(chunk?.sourcePageEnd || start);
    return start > 0 && start <= pageNumber && end >= pageNumber;
  }).sort((a, b) => Number(b.sourcePageStart || b.sourcePage || 0) - Number(a.sourcePageStart || a.sourcePage || 0) || Number(b.sectionLevel || 1) - Number(a.sectionLevel || 1))[0] || {};
}
export function splitCompilationIntoWorks(material, proposedWorks = []) {
  const parent = material?.document || {};
  const pages = (material?.aiPages || []).slice().sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
  const pageCount = Math.max(Number(material?.pages || parent.pages || 0), ...pages.map(p => Number(p.pageNumber || 0)));
  if (!pageCount) throw new Error("No hay páginas físicas confiables para separar la compilación.");
  const works = proposedWorks.map((work, i) => normalizeWork(work, i, pageCount)).sort((a, b) => a.startPage - b.startPage);
  if (!works.length) throw new Error("Agregá al menos una obra a la compilación.");
  for (let i = 1; i < works.length; i++) if (works[i].startPage <= works[i - 1].endPage) {
    throw new Error("Los rangos de las obras se superponen: revisá «" + works[i - 1].title + "» y «" + works[i].title + "».");
  }
  return works.map(work => {
    const documentId = (parent.id || "documento-compilacion") + "-obra-" + slug(work.title) + "-" + work.startPage;
    const bibliographyId = "bibliografia-" + slug(work.title) + "-" + work.startPage;
    const grouped = [];
    for (const page of pages.filter(p => Number(p.pageNumber) >= work.startPage && Number(p.pageNumber) <= work.endPage)) {
      const pageNumber = Number(page.pageNumber), text = pageLines(page).join("\n");
      if (!text) continue;
      const source = sourceMetadataAtPage(material?.corpus, pageNumber);
      const resolved = applySectionRoleDefaults({ ...source, title: source.title || work.title, content: text, sourcePageStart: pageNumber, sourcePageEnd: pageNumber, sourcePageCount: pageCount }, { pageCount, startPage: pageNumber, endPage: pageNumber, documentPriority: parent.priority || "normal" });
      const role = resolved.role, title = source.title || (role === "referencias" ? "Referencias" : work.title);
      const path = Array.isArray(source.sectionPath) && source.sectionPath.length ? source.sectionPath : [title];
      const key = [source.sectionId || "", title, role, path.join(" › ")].join("::");
      let section = grouped[grouped.length - 1];
      if (!section || section._key !== key || section.sourcePageEnd + 1 !== pageNumber) {
        section = {
          id: documentId + "-section-" + (grouped.length + 1), title, path, sectionPath: path,
          level: Number(source.sectionLevel || 1), sourcePageStart: pageNumber, sourcePageEnd: pageNumber,
          segmentationSource: source.segmentationSource || "compilation-page-range",
          confidence: Number(source.confidence ?? source.roleConfidence ?? resolved.roleConfidence ?? 0.5),
          evidence: [...(Array.isArray(source.structureEvidence) ? source.structureEvidence : []), ...(resolved.evidence || []), "texto asociado a páginas físicas exactas"],
          role, roleSource: resolved.roleSource, roleConfidence: resolved.roleConfidence,
          scope: resolved.scope, scopeSource: resolved.scopeSource,
          priority: resolved.priority, prioritySource: resolved.prioritySource,
          needsReview: Boolean(resolved.needsReview || source.needsReview || /ambiguous|unverified/i.test(String(page.layoutKind || ""))),
          content: "", documentId, sourceBibliographyId: bibliographyId, _key: key,
        };
        grouped.push(section);
      }
      section.content = [section.content, text].filter(Boolean).join("\n\n");
      section.sourcePageEnd = pageNumber;
    }
    const sections = grouped.map(({ _key, ...section }) => section);
    const bibliography = {
      id: bibliographyId, title: work.title, author: work.author, year: work.year,
      role: "artículo de compilación", sourceType: "aulia-compilation-work",
      sourceDocumentId: parent.id || "", sourceName: parent.sourceName || material.sourceName || "",
      sourcePageStart: work.startPage, sourcePageEnd: work.endPage,
    };
    const corpus = sections.map((section, index) => ({
      id: documentId + "-pasaje-" + (index + 1), unitId: section.id, sectionId: section.id,
      title: section.title, chapter: section.path.join(" › "), sectionPath: section.path, sectionLevel: section.level,
      content: section.content, source: material.sourceName || parent.sourceName || "",
      sourcePage: section.sourcePageStart, sourcePageStart: section.sourcePageStart, sourcePageEnd: section.sourcePageEnd,
      sourcePageCount: pageCount, documentId, sourceBibliographyId: bibliographyId,
      segmentationSource: section.segmentationSource, confidence: section.confidence, structureEvidence: section.evidence,
      role: section.role, roleSource: section.roleSource, roleConfidence: section.roleConfidence,
      scope: section.scope, scopeSource: section.scopeSource,
      priority: section.priority, prioritySource: section.prioritySource, needsReview: section.needsReview,
    }));
    const document = {
      ...parent, id: documentId, title: work.title, sourceName: parent.sourceName || material.sourceName || "",
      sourceDocumentId: parent.id || "", sourcePageStart: work.startPage, sourcePageEnd: work.endPage,
      pageRange: { start: work.startPage, end: work.endPage }, pages: work.endPage - work.startPage + 1,
      documentType: "articulo", documentTypeSource: "teacher", priority: parent.priority || "normal",
      workAuthor: work.author, workYear: work.year, sourceBibliographyId: bibliographyId, compilationWork: true,
      sections: sections.map(section => ({ ...section, path: section.sectionPath })),
    };
    return { ...material, sourceName: parent.sourceName || material.sourceName || "", pages: document.pages, document, corpus, bibliography: [bibliography] };
  });
}
