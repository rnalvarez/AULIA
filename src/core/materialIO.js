import { groupPdfItems, analyzePdfStructure } from "./pdfStructure.js";

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "fragmento";
}

const MAX_UNIT_CHARS = 5200;
const OVERLAP_CHARS = 320;

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\\u00ad/g, "")
    .replace(/[ \\t]+/g, " ")
    .replace(/ *\\n */g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
}

function cleanPdfLine(value) {
  return String(value ?? "")
    .replace(/\\u00ad/g, "")
    .replace(/\\s+/g, " ")
    .trim();
}

function repairHyphenation(value) {
  return String(value ?? "")
    .replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])[-‐‑]\\s+([a-záéíóúüñ])/g, "$1$2");
}

function normalizedKey(value) {
  return cleanPdfLine(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/\\d+/g, "#")
    .replace(/[^a-z0-9# ]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function isNoiseLine(line, repeatedKeys = new Set()) {
  const clean = cleanPdfLine(line);
  if (!clean) return true;
  const key = normalizedKey(clean);
  if (repeatedKeys.has(key)) return true;
  if (/^(?:page|p[aá]gina)\\s+\\d+$/i.test(clean)) return true;
  if (/^[-–—]?\\s*\\d+\\s*[-–—]?$/.test(clean)) return true;
  return false;
}

function splitAtNaturalBoundaries(text, maxChars = MAX_UNIT_CHARS) {
  const clean = normalizeWhitespace(repairHyphenation(text));
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const pieces = [];
  let current = "";

  function pushCurrent() {
    const value = current.trim();
    if (value) pieces.push(value);
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if ((current.length + 2 + paragraph.length) <= maxChars) {
      current += "\\n\\n" + paragraph;
      continue;
    }

    pushCurrent();

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\\s|$)|[^.!?]+$/g) || [paragraph];
    for (const sentenceRaw of sentences) {
      const sentence = sentenceRaw.trim();
      if (!sentence) continue;
      if (!current) {
        current = sentence;
      } else if ((current.length + 1 + sentence.length) <= maxChars) {
        current += " " + sentence;
      } else {
        pushCurrent();
        current = sentence;
      }
    }
    pushCurrent();
  }

  if (current) pushCurrent();

  // Add a small contextual overlap so retrieval does not lose a definition
  // that sits immediately before a hard size boundary.
  return pieces.map((piece, index) => {
    if (index === 0) return piece;
    const previous = pieces[index - 1];
    const tail = previous.slice(Math.max(0, previous.length - OVERLAP_CHARS)).trim();
    return tail ? tail + "\\n\\n" + piece : piece;
  });
}

function makeSectionId(documentId, section, index) {
  return slugify([
    documentId,
    ...(section?.sectionPath || []),
    section?.title || "material",
    Number(index || 0) + 1,
  ].join("-"));
}

function buildSectionFragments({
  sections,
  sourceName,
  documentId,
  sourcePageCount = null,
}) {
  const corpus = [];
  let index = 0;

  for (const [sectionIndex, section] of (sections || []).entries()) {
    const content = normalizeWhitespace(repairHyphenation(section.content));
    if (!content) continue;

    const parts = splitAtNaturalBoundaries(content);
    const base = slugify([
      documentId,
      ...(section.sectionPath || []),
      section.title || "unidad",
    ].join("-"));

    parts.forEach((part, partIndex) => {
      index += 1;
      const unitId = base || "unidad-" + index;
      corpus.push({
        sectionId: makeSectionId(documentId, section, sectionIndex),
        id: unitId + (parts.length > 1 ? "-p" + (partIndex + 1) : ""),
        unitId,
        title: parts.length > 1
          ? String(section.title || "Unidad") + " · parte " + (partIndex + 1)
          : String(section.title || "Unidad"),
        chapter: String(section.sectionPath?.join(" › ") || section.title || "").trim(),
        sectionPath: Array.isArray(section.sectionPath) ? section.sectionPath : [],
        sectionLevel: Number(section.level || 1),
        content: part,
        source: sourceName || undefined,
        sourcePage: section.sourcePageStart || undefined,
        sourcePageStart: section.sourcePageStart || undefined,
        sourcePageEnd: section.sourcePageEnd || undefined,
        ...(section.printedPageStart ? { printedPageStart: section.printedPageStart } : {}),
        ...(section.printedPageEnd ? { printedPageEnd: section.printedPageEnd } : {}),
        segmentationSource: section.segmentationSource || "text-structure",
        confidence: Number(section.confidence || 0.5),
        structureEvidence: Array.isArray(section.evidence) ? section.evidence : [],
        ...(section.visualElementCount ? { visualElementCount: Number(section.visualElementCount) } : {}),
        ...(section.needsReview ? { needsReview: true } : {}),
        ...(section.reviewNotes ? { reviewNotes: String(section.reviewNotes) } : {}),
        ...(section.childrenCount ? { childrenCount: section.childrenCount } : {}),
        scope: section.scope || "included",
        priority: section.priority || "normal",
        teacherTopic: section.teacherTopic || "",
        teacherConcepts: Array.isArray(section.teacherConcepts) ? section.teacherConcepts : [],
        teacherLimit: section.teacherLimit || "",
        documentId,
        ...(sourcePageCount ? { sourcePageCount } : {}),
      });
    });
  }

  return corpus;
}

function buildDocumentMeta({
  file,
  documentId,
  sections,
  pages = null,
  format = "",
  analysis = null,
}) {
  return {
    id: documentId,
    title: String(file?.name || "Material").replace(/\.[^.]+$/, ""),
    sourceName: file?.name || "",
    format,
    pages: pages || null,
    analysis: analysis
      ? {
          version: Number(analysis.version || 2),
          method: analysis.method || "pdf-conservative",
          documentType: analysis.documentType || "documento",
          confidence: Number(analysis.confidence || 0),
          tocDetected: Boolean(analysis.tocDetected),
          outlineDetected: Boolean(analysis.outlineDetected),
          structTreePages: Number(analysis.structTreePages || 0),
          repeatedFurnitureDetected: Number(analysis.repeatedFurnitureDetected || 0),
          columns: analysis.columns || { one: pages || 0, two: 0 },
          headingCandidates: Number(analysis.headingCandidates || 0),
          sectionCount: Number(analysis.sectionCount || (sections || []).length),
          lowConfidenceSections: Number(analysis.lowConfidenceSections || 0),
          warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
          model: String(analysis.model || ""),
          aiAnalyzedPages: Number(analysis.aiAnalyzedPages || 0),
        }
      : null,
    sections: (sections || []).map((section, index) => ({
      id: makeSectionId(documentId, section, index),
      title: section.title || "Material",
      path: Array.isArray(section.sectionPath) ? section.sectionPath : [],
      level: Number(section.level || 1),
      sourcePageStart: section.sourcePageStart || null,
      sourcePageEnd: section.sourcePageEnd || null,
      printedPageStart: section.printedPageStart || null,
      printedPageEnd: section.printedPageEnd || null,
      segmentationSource: section.segmentationSource || "text-structure",
      confidence: Number(section.confidence || 0.5),
      evidence: Array.isArray(section.evidence) ? section.evidence : [],
      visualElementCount: Number(section.visualElementCount || 0),
      needsReview: Boolean(section.needsReview),
      reviewNotes: String(section.reviewNotes || ""),
      ...(section.sourceTextOriginal ? { sourceTextOriginal: String(section.sourceTextOriginal) } : {}),
      childrenCount: Number(section.childrenCount || 0),
      scope: section.scope || "included",
      priority: section.priority || "normal",
      teacherTopic: section.teacherTopic || "",
      teacherConcepts: Array.isArray(section.teacherConcepts) ? section.teacherConcepts : [],
      teacherLimit: section.teacherLimit || "",
    })),
    sectionCount: (sections || []).length,
  };
}
function makeDocumentId(sourceName) {
  return "doc-" + slugify(sourceName || "material");
}

function buildTextSections(text, sourceName, markdown = false) {
  const lines = String(text ?? "").replace(/\\r/g, "").split("\\n");
  const sections = [];
  let path = [];
  let current = null;

  function flush() {
    if (!current) return;
    const content = normalizeWhitespace(repairHyphenation(current.lines.join("\\n")));
    if (content) {
      sections.push({
        title: current.title || path[path.length - 1] || "Material general",
        level: current.level || (path.length || 1),
        sectionPath: current.path.length ? current.path.slice() : ["Material general"],
        content,
      });
    }
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current?.lines?.length) current.lines.push("");
      continue;
    }

    let heading = null;
    if (markdown) {
      const md = line.match(/^(#{1,6})\\s+(.+)$/);
      if (md) heading = { title: md[2].trim(), level: md[1].length };
    }
    heading ||= headingInfo(line);

    if (heading) {
      flush();
      const nextLevel = Math.max(1, Math.min(6, heading.level));
      path = path.slice(0, nextLevel - 1);
      path[nextLevel - 1] = heading.title;
      path = path.slice(0, nextLevel);
      current = {
        title: heading.title,
        level: nextLevel,
        path: path.slice(),
        lines: [],
      };
      continue;
    }

    if (!current) {
      current = {
        title: path[path.length - 1] || "Material general",
        level: path.length || 1,
        path: path.length ? path.slice() : ["Material general"],
        lines: [],
      };
    }

    current.lines.push(line);
  }

  flush();
  return sections;
}

async function readPdf(file, { includePageImages = false, includeAIPageText = false, includePageImagesForLowText = false, onProgress = () => {} } = {}) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;

  const pageCount = pdf.numPages;
  const pages = [];
  let structTreePages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const viewport = page.getViewport({ scale: 1 });

      let structTree = null;
      try {
        structTree = await page.getStructTree?.();
      } catch {
        structTree = null;
      }

      const structHeadings = countPdfStructHeadings(structTree);
      if (structHeadings > 0) structTreePages += 1;

      const lines = groupPdfItems(textContent.items, viewport.width);
      const pageTextForImageDecision = lines
        .map(line => typeof line === "string" ? line : line?.text || "")
        .filter(Boolean)
        .join("\n")
        .trim();
      const alphanumericCount = (pageTextForImageDecision.match(/[\p{L}\p{N}]/gu) || []).length;
      const replacementCount = (pageTextForImageDecision.match(/\uFFFD/g) || []).length;
      const textLooksUnreliable = pageTextForImageDecision.length < 100 ||
        (pageTextForImageDecision.length > 0 && alphanumericCount / pageTextForImageDecision.length < 0.23) ||
        replacementCount > Math.max(2, pageTextForImageDecision.length * 0.01);
      let hasEmbeddedImage = false;
      let hasComplexVectorGraphics = false;
      if (includePageImagesForLowText && !includePageImages) {
        try {
          const operatorList = await page.getOperatorList();
          const ops = pdfjsLib.OPS || {};
          const imageOps = new Set([
            ops.paintImageXObject,
            ops.paintInlineImageXObject,
            ops.paintImageMaskXObject,
            ops.paintImageMaskXObjectGroup,
          ].filter(value => typeof value === "number"));
          const drawingOps = new Set([
            ops.constructPath,
            ops.stroke,
            ops.fill,
            ops.eoFill,
            ops.fillStroke,
            ops.eoFillStroke,
            ops.shadingFill,
          ].filter(value => typeof value === "number"));
          hasEmbeddedImage = operatorList.fnArray.some(operator => imageOps.has(operator));
          const drawingCount = operatorList.fnArray.reduce((count, operator) => count + (drawingOps.has(operator) ? 1 : 0), 0);
          hasComplexVectorGraphics = drawingCount >= 24;
        } catch {
          hasEmbeddedImage = false;
          hasComplexVectorGraphics = false;
        }
      }
      const needsVisualAnalysis = includePageImages ||
        (includePageImagesForLowText && (textLooksUnreliable || hasEmbeddedImage || hasComplexVectorGraphics));
      const renderPageImage = needsVisualAnalysis;
      let imageDataUrl = "";
      if (renderPageImage) {
        let canvas = null;
        try {
          const maxDimension = 1500;
          const scale = Math.min(2, maxDimension / Math.max(viewport.width, viewport.height));
          const imageViewport = page.getViewport({ scale });
          canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(imageViewport.width));
          canvas.height = Math.max(1, Math.ceil(imageViewport.height));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No se pudo crear el lienzo de la página.");
          await page.render({ canvasContext: context, viewport: imageViewport }).promise;
          imageDataUrl = canvas.toDataURL("image/jpeg", 0.68);
        } catch {
          imageDataUrl = "";
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        lines,
        structHeadings,
        imageDataUrl,
        needsVisualAnalysis,
      });

      onProgress({ phase: includePageImages ? "rendering" : "extracting", processed: pageNumber, total: pageCount, pageNumber });
      page.cleanup?.();
    }

    const hasExtractableText = pages.some((page) => page.lines.length);
    if (!hasExtractableText && !includePageImages && !includePageImagesForLowText) {
      throw new Error("Este PDF parece ser un escaneo sin texto extraíble. Elegí «OCR y visión selectiva · Groq» para recuperar el texto de sus páginas.");
    }

    const analysis = await analyzePdfStructure({
      pdf,
      pages,
      structTreePages,
    });

    const documentId = makeDocumentId(file.name);
    const corpus = buildSectionFragments({
      sections: analysis.sections,
      sourceName: file.name,
      documentId,
      sourcePageCount: pageCount,
    });

    if (!corpus.length && !includePageImages && !includePageImagesForLowText) {
      throw new Error("AULIA pudo abrir el PDF, pero no encontró unidades de contenido recuperables.");
    }

    return {
      corpus,
      aiPages: (includePageImages || includeAIPageText || includePageImagesForLowText) ? pages.map((page) => ({
        pageNumber: page.pageNumber,
        extractedText: (page.readingLines?.length ? page.readingLines : page.lines || [])
          .map((line) => typeof line === "string" ? line : line?.text || "")
          .filter(Boolean)
          .join("\n")
          .trim(),
        imageDataUrl: page.imageDataUrl || "",
        needsVisualAnalysis: Boolean(page.needsVisualAnalysis),
      })) : undefined,
      bibliography: [],
      sourceName: file.name,
      pages: pageCount,
      document: buildDocumentMeta({
        file,
        documentId,
        sections: analysis.sections,
        pages: pageCount,
        format: "pdf",
        analysis,
      }),
      analysis,
      warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
    };
  } finally {
    await pdf.cleanup?.();
    await pdf.destroy?.();
  }
}

function countPdfStructHeadings(node) {
  if (!node) return 0;
  let count = 0;
  const role = String(node?.role || node?.type || "");
  if (/^H[1-6]$/i.test(role)) count += 1;
  for (const child of node?.children || []) count += countPdfStructHeadings(child);
  return count;
}

async function readDocx(file) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;

  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: true,
    }
  );

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.value, "text/html");
  const sections = [];
  let path = [];
  let current = null;

  function flush() {
    if (!current) return;
    const content = normalizeWhitespace(repairHyphenation(current.lines.join("\\n")));
    if (content) {
      sections.push({
        title: current.title || path[path.length - 1] || "Material general",
        level: current.level || (path.length || 1),
        sectionPath: current.path.length ? current.path.slice() : ["Material general"],
        content,
      });
    }
    current = null;
  }

  for (const node of Array.from(doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li"))) {
    const text = node.textContent?.replace(/\\s+/g, " ").trim();
    if (!text) continue;

    const heading = /^H([1-6])$/i.test(node.tagName)
      ? { title: text, level: Number(node.tagName.slice(1)) }
      : null;

    if (heading) {
      flush();
      const nextLevel = heading.level;
      path = path.slice(0, nextLevel - 1);
      path[nextLevel - 1] = heading.title;
      path = path.slice(0, nextLevel);
      current = {
        title: heading.title,
        level: nextLevel,
        path: path.slice(),
        lines: [],
      };
      continue;
    }

    if (!current) {
      current = {
        title: path[path.length - 1] || "Material general",
        level: path.length || 1,
        path: path.length ? path.slice() : ["Material general"],
        lines: [],
      };
    }

    current.lines.push(text);
  }

  flush();

  const documentId = makeDocumentId(file.name);
  const corpus = buildSectionFragments({
    sections,
    sourceName: file.name,
    documentId,
  });

  if (!corpus.length) {
    throw new Error("El DOCX no contiene texto recuperable.");
  }

  return {
    corpus,
    bibliography: [],
    sourceName: file.name,
    document: buildDocumentMeta({
      file,
      documentId,
      sections,
      format: "docx",
    }),
    warnings: (result.messages || []).map((message) => message.message).filter(Boolean),
  };
}

/**
 * Render only the requested PDF pages. Used by resume so a large PDF's text and
 * structure are not re-extracted just because Groq temporarily ran out of quota.
 */
export async function renderPdfPageImages(file, pageNumbers, onProgress = () => {}) {
  const requested = Array.from(new Set((pageNumbers || []).map(Number)))
    .filter(number => Number.isInteger(number) && number > 0)
    .sort((a, b) => a - b);
  if (!requested.length) return [];
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  try {
    const rendered = [];
    for (let index = 0; index < requested.length; index += 1) {
      const pageNumber = requested[index];
      if (pageNumber > pdf.numPages) {
        throw new Error("La página " + pageNumber + " ya no existe en el PDF guardado.");
      }
      const page = await pdf.getPage(pageNumber);
      let canvas = null;
      try {
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1500 / Math.max(viewport.width, viewport.height));
        const imageViewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(imageViewport.width));
        canvas.height = Math.max(1, Math.ceil(imageViewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No se pudo crear la imagen de la página " + pageNumber + ".");
        await page.render({ canvasContext: context, viewport: imageViewport }).promise;
        rendered.push({ pageNumber, imageDataUrl: canvas.toDataURL("image/jpeg", 0.68) });
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        page.cleanup?.();
      }
      onProgress({ phase: "rendering", processed: index + 1, total: requested.length, pageNumber });
    }
    return rendered;
  } finally {
    await pdf.cleanup?.();
    await pdf.destroy?.();
  }
}

export async function readMaterialFile(file, { includePageImages = false, includeAIPageText = false, includePageImagesForLowText = false, onProgress = () => {} } = {}) {
  const name = file.name || "material";
  const ext = name.toLowerCase().split(".").pop();
  const documentId = makeDocumentId(name);

  if (ext === "pdf") return readPdf(file, { includePageImages, includeAIPageText, includePageImagesForLowText, onProgress });
  if (ext === "docx") return readDocx(file);

  if (!["txt", "md", "markdown", "json"].includes(ext)) {
    throw new Error("Formato no compatible. Usá PDF, DOCX, TXT, Markdown o JSON.");
  }

  const raw = await file.text();

  if (ext === "json") {
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error("El JSON no es válido."); }

    if (data?.format === "aulia-course-pack") {
      return {
        corpus: (data.corpus || []).map((item, index) => normalizeChunk(item, index, name)).filter(Boolean),
        bibliography: Array.isArray(data.bibliography) ? data.bibliography : [],
        sourceName: name,
        document: {
          id: documentId,
          title: data?.course?.title || name,
          sourceName: name,
          format: "aulia-course-pack",
          pages: null,
          sections: [],
          sectionCount: 0,
        },
      };
    }

    const items = Array.isArray(data) ? data : Array.isArray(data?.corpus) ? data.corpus : null;
    if (items) {
      const corpus = items.map((item, index) => normalizeChunk(item, index, name)).filter(Boolean);
      return {
        corpus,
        bibliography: Array.isArray(data?.bibliography) ? data.bibliography : [],
        sourceName: name,
        document: {
          id: documentId,
          title: data?.title || name,
          sourceName: name,
          format: "json",
          pages: null,
          sections: [],
          sectionCount: 0,
        },
      };
    }

    if (typeof data?.content === "string" || typeof data?.text === "string") {
      const sourceText = data.content || data.text;
      const sections = buildTextSections(sourceText, name, false);
      return {
        corpus: buildSectionFragments({ sections, sourceName: name, documentId }),
        bibliography: Array.isArray(data?.bibliography) ? data.bibliography : [],
        sourceName: name,
        document: buildDocumentMeta({ file, documentId, sections, format: "json" }),
      };
    }

    throw new Error("El JSON no contiene corpus, content o text reconocibles.");
  }

  const sections = buildTextSections(
    raw,
    name,
    ext === "md" || ext === "markdown"
  );

  return {
    corpus: buildSectionFragments({ sections, sourceName: name, documentId }),
    bibliography: [],
    sourceName: name,
    document: buildDocumentMeta({
      file,
      documentId,
      sections,
      format: ext,
    }),
  };
}

function normalizeChunk(item, index, sourceName = "") {
  const content = String(item?.content || item?.text || "").trim();
  if (!content) return null;
  return {
    id: item.id || "fragmento-" + (index + 1) + "-" + slugify(item.title || item.chapter || "material"),
    unitId: item.unitId || item.id || "",
    title: item.title || item.chapter || "Fragmento " + (index + 1),
    chapter: item.chapter || "",
    sectionPath: Array.isArray(item.sectionPath) ? item.sectionPath : [],
    sectionLevel: Number(item.sectionLevel || 1),
    content,
    ...(item.source || sourceName ? { source: item.source || sourceName } : {}),
    ...(item.sourcePage ? { sourcePage: item.sourcePage } : {}),
    ...(item.sourcePageStart ? { sourcePageStart: item.sourcePageStart } : {}),
    ...(item.sourcePageEnd ? { sourcePageEnd: item.sourcePageEnd } : {}),
    ...(item.sourcePageCount ? { sourcePageCount: item.sourcePageCount } : {}),
    ...(item.documentId ? { documentId: item.documentId } : {}),
    ...(item.sectionId ? { sectionId: item.sectionId } : {}),
    ...(item.segmentationSource ? { segmentationSource: item.segmentationSource } : {}),
    ...(Number.isFinite(Number(item.confidence)) ? { confidence: Number(item.confidence) } : {}),
    ...(Array.isArray(item.structureEvidence) ? { structureEvidence: item.structureEvidence } : {}),
    ...(item.childrenCount ? { childrenCount: Number(item.childrenCount) } : {}),
    scope: item.scope || "included",
    priority: item.priority || "normal",
    teacherTopic: item.teacherTopic || "",
    teacherConcepts: Array.isArray(item.teacherConcepts) ? item.teacherConcepts : [],
    teacherLimit: item.teacherLimit || "",
    ...(item.sourceBibliographyId ? { sourceBibliographyId: item.sourceBibliographyId } : {}),
  };
}

export function materialToCorpus(material, existing = []) {
  const used = new Set((existing || []).map((item) => item.id));
  const corpus = (material.corpus || []).map((chunk, index) => {
    const base = chunk.id || "fragmento-" + slugify(material.sourceName || "material") + "-" + (index + 1);
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = base + "-" + suffix++;
    used.add(id);
    return { ...chunk, id };
  });

  return {
    corpus,
    bibliography: material.bibliography || [],
    sourceName: material.sourceName || "",
    document: material.document || null,
    warnings: material.warnings || [],
    pages: material.pages || null,
  };
}

function sameReference(a, b) {
  const x = (String(a?.title || "") + " " + String(a?.author || "")).trim().toLowerCase();
  const y = (String(b?.title || "") + " " + String(b?.author || "")).trim().toLowerCase();
  return x && y && x === y;
}

export function mergeImportedBibliography(existing, incoming) {
  const merged = [...existing];
  for (const item of incoming || []) {
    if (merged.some((x) => sameReference(x, item))) continue;
    merged.push({ ...item, id: item.id || "bibliografia-" + slugify(item.title || "fuente") });
  }
  return merged;
}

export function mergeImportedDocuments(existing, incoming) {
  const merged = [...(existing || [])];
  for (const document of incoming || []) {
    if (!document?.id) continue;
    const index = merged.findIndex((item) =>
      item.id === document.id ||
      String(item.sourceName || "").toLowerCase() === String(document.sourceName || "").toLowerCase()
    );
    if (index >= 0) {
      merged[index] = { ...merged[index], ...document };
    } else {
      merged.push(document);
    }
  }
  return merged;
}


export function applySelectiveVisualAnalysis(material, pageResults, model = "qwen/qwen3.8-27b") {
  const sourcePages = new Map((material?.aiPages || []).map(page => [Number(page.pageNumber), page]));
  const existingCorpus = Array.isArray(material?.corpus) ? material.corpus : [];
  const sourceDocumentId = material?.document?.id || makeDocumentId(material?.sourceName || "material");
  const usedIds = new Set(existingCorpus.map(item => String(item?.id || "")));
  const visualChunks = [];
  const warnings = [...(material?.warnings || [])];

  for (const analysis of pageResults || []) {
    const pageNumber = Number(analysis?.pageNumber);
    const sourcePage = sourcePages.get(pageNumber);
    if (!sourcePage || !Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new Error("La lectura visual devolvió una página que no pertenece al PDF original.");
    }

    const rawText = normalizeWhitespace(sourcePage.extractedText || "");
    const transcription = normalizeWhitespace(analysis.transcription || "");
    const needsOcr = rawText.length < 100;
    const visualElements = Array.isArray(analysis.visualElements) ? analysis.visualElements : [];
    const visualText = visualElements.map(element => {
      const kind = String(element.kind || "elemento visual").trim();
      const title = String(element.title || "").trim();
      const description = String(element.description || "").trim();
      const table = String(element.tableMarkdown || "").trim();
      const labels = String(element.transcribedText || "").trim();
      return [
        "[Elemento visual: " + kind + (title ? " · " + title : "") + " · página " + pageNumber + "]",
        description,
        labels ? "Texto, etiquetas o valores visibles: " + labels : "",
        table ? "Tabla reconstruida a partir de la página:\\n" + table : "",
      ].filter(Boolean).join("\\n");
    }).filter(Boolean);

    const bodyParts = [];
    if (needsOcr) {
      const recoveredText = transcription || rawText;
      if (recoveredText) bodyParts.push("TEXTO RECUPERADO POR LECTURA VISUAL · PÁGINA " + pageNumber + "\\n" + recoveredText);
    } else if (transcription && transcription !== rawText) {
      bodyParts.push("TRANSCRIPCIÓN ALTERNATIVA PROPUESTA POR IA · VERIFICAR CON EL TEXTO EXTRAÍDO · PÁGINA " + pageNumber + "\\n" + transcription);
      warnings.push("Página " + pageNumber + ": la lectura visual propuso una transcripción distinta del texto extraído; ambas versiones se conservan para revisión.");
    }

    if (visualText.length) bodyParts.push("LECTURA VISUAL ASISTIDA POR IA · PÁGINA " + pageNumber + "\\n" + visualText.join("\\n\\n"));
    const content = bodyParts.join("\\n\\n").trim();
    const reviewNote = String(analysis.reviewNotes || "").trim();
    const needsReview = Boolean(analysis.needsReview || (!content && needsOcr) || (transcription && transcription !== rawText && !needsOcr));

    if (!content) {
      if (needsReview) warnings.push("Página " + pageNumber + (reviewNote ? ": " + reviewNote : ": la lectura visual no recuperó contenido utilizable; requiere revisión."));
      continue;
    }

    const localSection = existingCorpus.find(item =>
      item?.documentId === sourceDocumentId &&
      Number(item?.sourcePageStart || item?.sourcePage || 0) <= pageNumber &&
      Number(item?.sourcePageEnd || item?.sourcePageStart || item?.sourcePage || 0) >= pageNumber
    ) || existingCorpus.find(item => item?.documentId === sourceDocumentId);
    const sectionPath = Array.isArray(localSection?.sectionPath) && localSection.sectionPath.length
      ? localSection.sectionPath
      : (Array.isArray(analysis.sectionPath) && analysis.sectionPath.length
          ? analysis.sectionPath
          : [String(analysis.sectionTitle || "Material sin sección identificada")]);
    const sectionTitle = String(localSection?.title || sectionPath[sectionPath.length - 1] || "Lectura visual").trim();
    const baseId = slugify(sourceDocumentId + "-lectura-visual-pagina-" + pageNumber);
    let id = baseId;
    let suffix = 1;
    while (usedIds.has(id)) id = baseId + "-" + suffix++;
    usedIds.add(id);

    visualChunks.push({
      id,
      unitId: id,
      sectionId: localSection?.sectionId || slugify(sourceDocumentId + "-" + sectionPath.join("-")),
      title: sectionTitle + " · lectura visual p. " + pageNumber,
      chapter: sectionPath.join(" › "),
      sectionPath: [...sectionPath],
      sectionLevel: Number(localSection?.sectionLevel || sectionPath.length || 1),
      content,
      source: material?.sourceName || sourcePage.sourceName || "Bibliografía de la cátedra",
      sourcePage: pageNumber,
      sourcePageStart: pageNumber,
      sourcePageEnd: pageNumber,
      sourcePageCount: Number(material?.pages || sourcePages.size || 0),
      documentId: sourceDocumentId,
      segmentationSource: "vision-selective",
      confidence: Math.max(0, Math.min(1, Number(analysis.confidence ?? 0.5) || 0)),
      scope: localSection?.scope || "included",
      priority: localSection?.priority || "normal",
      teacherTopic: localSection?.teacherTopic || "",
      teacherConcepts: Array.isArray(localSection?.teacherConcepts) ? localSection.teacherConcepts : [],
      teacherLimit: localSection?.teacherLimit || "",
      visualElementCount: visualElements.length,
      ...(needsReview ? { needsReview: true } : {}),
      ...(reviewNote ? { reviewNotes: reviewNote } : {}),
      structureEvidence: ["La estructura del documento se conservó desde la extracción local; la IA se usó solo para recuperar texto o interpretar elementos visuales de esta página."],
    });

    if (needsReview) warnings.push("Página " + pageNumber + (reviewNote ? ": " + reviewNote : ": requiere revisión de la lectura visual."));
  }

  const uniqueWarnings = Array.from(new Set(warnings));
  const analysisSummary = {
    ...(material?.analysis || {}),
    method: pageResults?.length ? "local-structure-selective-vision" : (material?.analysis?.method || "pdf-local-structure"),
    documentType: pageResults?.length
      ? "texto extraído y estructura detectada localmente, con lectura visual selectiva"
      : (material?.analysis?.documentType || "documento procesado localmente"),
    model: pageResults?.length ? model : (material?.analysis?.model || ""),
    aiAnalyzedPages: Number(pageResults?.length || 0),
    warnings: uniqueWarnings,
  };

  return {
    ...material,
    corpus: [...existingCorpus, ...visualChunks],
    warnings: uniqueWarnings,
    analysis: analysisSummary,
    document: material?.document ? {
      ...material.document,
      analysis: analysisSummary,
      sections: material.document.sections || [],
    } : material?.document,
    aiPages: undefined,
    aiAnalysis: pageResults?.length ? {
      provider: "Groq · OCR y visión selectiva",
      model,
      method: "local-structure-selective-vision",
      pagesProcessed: pageResults.length,
      pagesTotal: sourcePages.size,
      needsReview: uniqueWarnings.length > 0,
    } : material?.aiAnalysis,
  };
}
