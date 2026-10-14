import { groupPdfItems, analyzePdfStructure } from "./pdfStructure.js";
import { createPdfiumRenderer, hasMeaningfulInk } from "./pdfiumFallback.js";

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "fragmento";
}

const MAX_UNIT_CHARS = 5200;
const OVERLAP_CHARS = 320;

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00ad/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanPdfLine(value) {
  return String(value ?? "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function repairHyphenation(value) {
  return String(value ?? "")
    .replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])[-‐‑]\s+([a-záéíóúüñ])/g, "$1$2");
}

function normalizedKey(value) {
  return cleanPdfLine(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+/g, "#")
    .replace(/[^a-z0-9# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line, repeatedKeys = new Set()) {
  const clean = cleanPdfLine(line);
  if (!clean) return true;
  const key = normalizedKey(clean);
  if (repeatedKeys.has(key)) return true;
  if (/^(?:page|p[aá]gina)\s+\d+$/i.test(clean)) return true;
  if (/^[-–—]?\s*\d+\s*[-–—]?$/.test(clean)) return true;
  return false;
}

function splitAtNaturalBoundaries(text, maxChars = MAX_UNIT_CHARS) {
  const clean = normalizeWhitespace(repairHyphenation(text));
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
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
      current += "\n\n" + paragraph;
      continue;
    }

    pushCurrent();

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [paragraph];
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
    return tail ? tail + "\n\n" + piece : piece;
  });
}

function makeSectionId(documentId, section, index) {
  // Keep the ordinal before long titles/paths because slugify truncates IDs.
  // Putting it last could remove it from the 56-character slug and make
  // different sections share the same ID, so a button changed several at once.
  return slugify([
    documentId,
    "seccion",
    Number(index || 0) + 1,
    ...(section?.sectionPath || []),
    section?.title || "material",
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
          semanticBoundaries: Number(analysis.semanticBoundaries || 0),
          semanticTasksProcessed: Number(analysis.semanticTasksProcessed || 0),
          semanticOutline: Array.isArray(analysis.semanticOutline) ? analysis.semanticOutline : [],
          layout: analysis.layout || {
            landscapeTwoAreaPages: 0,
            ambiguousLandscapePages: 0,
            landscapeUnverifiedPages: 0,
            horizontalSinglePages: 0,
          },
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
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const sections = [];
  let path = [];
  let current = null;

  function flush() {
    if (!current) return;
    const content = normalizeWhitespace(repairHyphenation(current.lines.join("\n")));
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
      const md = line.match(/^(#{1,6})\s+(.+)$/);
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


function measureLocalTextQuality(value, confidence = 55) {
  const text = String(value || "");
  const visible = text.replace(/\s/g, "");
  const letters = (text.match(/\p{L}/gu) || []).length;
  const tokens = text.match(/[\p{L}\p{N}]+/gu) || [];
  const wordTokens = tokens.filter(token => (token.match(/\p{L}/gu) || []).length >= 2);
  const singleRatio = tokens.filter(token => (token.match(/\p{L}/gu) || []).length === 1).length / Math.max(1, tokens.length);
  const replacements = (text.match(/\uFFFD/g) || []).length;
  const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  const alphaRatio = letters / Math.max(1, visible.length);
  const wordRatio = wordTokens.length / Math.max(1, tokens.length);
  const contentScore = Math.min(1, letters / 180);
  const conf = Math.max(0, Math.min(100, Number(confidence) || 0));
  const score = Math.max(0, Math.min(100,
    alphaRatio * 25 + wordRatio * 25 + contentScore * 20 + conf * 0.30 -
    singleRatio * 18 - replacements * 3 - controls * 5
  ));
  return { score, chars: text.length, letters, words: wordTokens.length, confidence: conf, alphaRatio, singleRatio };
}

function isLocalTextPoor(value) {
  const quality = measureLocalTextQuality(value, 65);
  return quality.chars < 90 || quality.letters < 45 || quality.score < 54 ||
    quality.singleRatio > 0.28 || /(?:\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F])/.test(String(value || ""));
}

function looksLikeTocPage(value) {
  const raw = String(value || "").replace(/\r/g, "");
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // A table-of-contents page can have plenty of text characters and still be
  // unusable for structure detection when text-layer coordinates are wrong.
  // Only force OCR when the page begins with a dedicated TOC heading and has
  // multiple page-number/leader signals, not merely because prose says "índice".
  const hasDedicatedHeading = /^\s*(?:indice|contenido|sumario|contents|table of contents)\b/.test(normalized);
  if (!hasDedicatedHeading) return false;
  const pageNumbers = normalized.match(/\b\d{1,3}\b/g) || [];
  const leaders = normalized.match(/(?:\.{2,}|…{2,}|·{2,})/g) || [];
  return pageNumbers.length >= 5 || leaders.length >= 3;
}

function parseTesseractTsv(data) {
  const tsv = String(data?.tsv || "");
  if (!tsv.trim()) return [];
  const rows = tsv.split(/\r?\n/);
  const grouped = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    if (!rows[index]) continue;
    const fields = rows[index].split("\t");
    if (fields.length < 12 || Number(fields[0]) !== 5) continue;
    const text = String(fields.slice(11).join("\t") || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const left = Number(fields[6]), top = Number(fields[7]);
    const width = Number(fields[8]), height = Number(fields[9]);
    const confidence = Number(fields[10]);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    const key = [fields[1], fields[2], fields[3], fields[4]].join(":");
    if (!grouped.has(key)) grouped.set(key, {
      text: "", left, top, right: left + width, bottom: top + height,
      confidenceTotal: 0, confidenceCount: 0,
    });
    const line = grouped.get(key);
    line.text += (line.text ? " " : "") + text;
    line.left = Math.min(line.left, left);
    line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, left + width);
    line.bottom = Math.max(line.bottom, top + height);
    if (Number.isFinite(confidence) && confidence >= 0) {
      line.confidenceTotal += confidence;
      line.confidenceCount += 1;
    }
  }
  return Array.from(grouped.values()).map(line => ({
    text: line.text.replace(/\s+/g, " ").trim(), left: line.left, top: line.top,
    width: Math.max(0, line.right - line.left), height: Math.max(0, line.bottom - line.top),
    confidence: line.confidenceCount ? line.confidenceTotal / line.confidenceCount : 0,
  })).filter(line => line.text).sort((a, b) => a.top - b.top || a.left - b.left);
}

function textFromTesseractRecords(records) {
  return (records || []).slice().sort((a, b) => {
    const rank = side => side === "left" ? 0 : side === "right" ? 1 : -1;
    if (a.logicalSide && b.logicalSide && rank(a.logicalSide) !== rank(b.logicalSide)) return rank(a.logicalSide) - rank(b.logicalSide);
    return a.top - b.top || a.left - b.left;
  }).map(line => line.text).filter(Boolean).join("\n").trim();
}

function detectOcrSpread(records, width, height) {
  if (!width || !height || width / height < 1.32) return false;
  const body = (records || []).filter(line => line.width > width * 0.025 && line.width < width * 0.66);
  const left = body.filter(line => line.left + line.width / 2 < width * 0.46);
  const right = body.filter(line => line.left + line.width / 2 > width * 0.54);
  if (left.length < 5 || right.length < 5) return false;
  const span = lines => {
    const ys = lines.map(line => line.top + line.height / 2);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  if (span(left) < height * 0.22 || span(right) < height * 0.22) return false;
  return Math.min(...right.map(line => line.left)) - Math.max(...left.map(line => line.left + line.width)) >= -width * 0.025;
}

function enhanceLocalOcrCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No se pudo preparar la segunda variante de imagen para OCR.");
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    let value = Math.max(0, Math.min(255, (gray - 126) * 1.24 + 126));
    if (value > 246) value = 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function toPageGeometryLines(records, scale, canvasHeight, xOffset = 0) {
  // page.lines uses displayed page coordinates (rotation already applied).
  // Keep OCR boxes in that same coordinate system instead of converting back
  // to the PDF's unrotated coordinate space.
  return (records || []).map((record, index) => {
    const x0 = (Number(record.left || 0) + xOffset) / scale;
    const x1 = x0 + Number(record.width || 0) / scale;
    const y0 = (canvasHeight - Number(record.top || 0)) / scale;
    const y1 = (canvasHeight - (Number(record.top || 0) + Number(record.height || 0))) / scale;
    const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
    const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);
    return {
      text: record.text, xMin, xMax, width: Math.max(0, xMax - xMin), y: (yMin + yMax) / 2,
      fontSize: Math.max(1, yMax - yMin), bold: false, boldRatio: 0,
      fontNames: ["local-ocr-tesseract6"], items: [], index, ocr: true,
      ocrConfidence: Number(record.confidence || 0),
      ...(record.logicalSide ? { logicalSide: record.logicalSide } : {}),
    };
  }).filter(Boolean);
}

async function recognizeLocalCanvas(worker, canvas, viewport, scale) {
  await worker.setParameters({
    tessedit_pageseg_mode: "3", preserve_interword_spaces: "1",
    user_defined_dpi: String(Math.max(180, Math.min(300, Math.round(scale * 72)))),
  });
  const result = await worker.recognize(canvas, {}, { blocks: true, tsv: true });
  const records = parseTesseractTsv(result?.data);
  const confidence = Number(result?.data?.confidence || 0);
  if (!records.length) {
    const fallback = String(result?.data?.text || "").replace(/\r/g, "").split("\n").map(text => text.trim()).filter(Boolean);
    const fallbackRecords = fallback.map((text, index) => ({
      text, left: 0, top: Math.round(index * canvas.height / Math.max(1, fallback.length)),
      width: canvas.width, height: Math.max(1, Math.round(canvas.height / Math.max(1, fallback.length))), confidence,
    }));
    const fallbackText = fallbackRecords.map(line => line.text).join("\n");
    return {
      records: fallbackRecords, text: fallbackText, confidence,
      quality: measureLocalTextQuality(fallbackText, confidence), usedGeometry: false, detectedSpread: false,
    };
  }

  let selected = records;
  let spread = false;
  if (detectOcrSpread(records, canvas.width, canvas.height)) {
    const mid = Math.round(canvas.width / 2);
    const overlap = Math.max(8, Math.round(canvas.width * 0.008));
    const leftWidth = Math.min(canvas.width, mid + overlap);
    const rightStart = Math.max(0, mid - overlap);
    const rightWidth = canvas.width - rightStart;
    let leftCanvas = null, rightCanvas = null;
    try {
      leftCanvas = document.createElement("canvas");
      leftCanvas.width = leftWidth; leftCanvas.height = canvas.height;
      rightCanvas = document.createElement("canvas");
      rightCanvas.width = rightWidth; rightCanvas.height = canvas.height;
      const lc = leftCanvas.getContext("2d"), rc = rightCanvas.getContext("2d");
      if (!lc || !rc) throw new Error("No se pudieron separar las páginas enfrentadas para OCR.");
      lc.drawImage(canvas, 0, 0, leftWidth, canvas.height, 0, 0, leftWidth, canvas.height);
      rc.drawImage(canvas, rightStart, 0, rightWidth, canvas.height, 0, 0, rightWidth, canvas.height);
      await worker.setParameters({
        tessedit_pageseg_mode: "4", preserve_interword_spaces: "1",
        user_defined_dpi: String(Math.max(180, Math.min(300, Math.round(scale * 72)))),
      });
      const leftResult = await worker.recognize(leftCanvas, {}, { blocks: true, tsv: true });
      const rightResult = await worker.recognize(rightCanvas, {}, { blocks: true, tsv: true });
      const leftRecords = parseTesseractTsv(leftResult?.data).map(item => ({ ...item, logicalSide: "left" }));
      const rightRecords = parseTesseractTsv(rightResult?.data).map(item => ({
        ...item, left: item.left + rightStart, logicalSide: "right",
      }));
      const spanning = records.filter(item => item.width >= canvas.width * 0.66);
      const splitRecords = [...spanning, ...leftRecords, ...rightRecords];
      const splitText = textFromTesseractRecords(splitRecords);
      const fullText = textFromTesseractRecords(records);
      const splitConfidence = (Number(leftResult?.data?.confidence || 0) + Number(rightResult?.data?.confidence || 0)) / 2;
      const splitQuality = measureLocalTextQuality(splitText, splitConfidence);
      const fullQuality = measureLocalTextQuality(fullText, confidence);
      if (splitRecords.length >= 8 && splitQuality.letters >= Math.min(45, fullQuality.letters * 0.65) &&
          splitQuality.score >= fullQuality.score - 8) {
        selected = splitRecords;
        spread = true;
      }
    } finally {
      if (leftCanvas) { leftCanvas.width = 0; leftCanvas.height = 0; }
      if (rightCanvas) { rightCanvas.width = 0; rightCanvas.height = 0; }
    }
  }
  const text = textFromTesseractRecords(selected);
  const effectiveConfidence = selected.length
    ? selected.reduce((sum, line) => sum + Number(line.confidence || 0), 0) / selected.length
    : confidence;
  return {
    records: selected, text, confidence: effectiveConfidence,
    quality: measureLocalTextQuality(text, effectiveConfidence),
    usedGeometry: selected.some(item => Number(item.width) > 0), detectedSpread: spread,
  };
}

async function runLocalPdfOcr(pdf, pages, onProgress = () => {}, renderPdfiumFallback = null) {
  const targets = (pages || []).filter(page => {
    const text = (page.lines || []).map(line => line?.text || "").join("\n").trim();
    // TOC pages need reliable line geometry for matching titles and page
    // numbers. OCR them even when the native text layer has a high character
    // count but its reading order or line boundaries are misleading.
    return isLocalTextPoor(text) || looksLikeTocPage(text);
  });
  if (!targets.length) return {
    attemptedPages: 0, recognizedPages: 0, improvedPages: 0, lowConfidencePages: [], spreadPages: [],
  };

  let createWorker;
  try {
    ({ createWorker } = await import("tesseract.js"));
  } catch {
    throw new Error("No se pudo cargar el motor de OCR local. Recargá AULIA con conexión a Internet e intentá nuevamente.");
  }

  let worker = null;
  let recognizedPages = 0, improvedPages = 0;
  const lowConfidencePages = [], spreadPages = [];
  let activePage = targets[0]?.pageNumber || 1;
  try {
    onProgress({
      phase: "ocr", processed: 0, total: targets.length, pageNumber: activePage,
      message: "OCR local avanzado: lectura de alta resolución, coordenadas reales y control de calidad por página.",
    });
    worker = await createWorker(["spa", "eng"], 1);
    await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1", user_defined_dpi: "300" });

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      activePage = target.pageNumber;
      const page = await pdf.getPage(activePage);
      let canvas = null, enhancedCanvas = null;
      try {
        const nativeViewport = page.getViewport({ scale: 1, rotation: 0 });
        const scale = Math.min(4.1, 4200 / Math.max(nativeViewport.width, nativeViewport.height));
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("No se pudo preparar la imagen de la página.");
        let pdfJsRenderError = null;
        try {
          await page.render({ canvasContext: context, viewport }).promise;
        } catch (error) {
          pdfJsRenderError = error;
        }

        if (pdfJsRenderError || !hasMeaningfulInk(canvas)) {
          if (renderPdfiumFallback) {
            try {
              const fallback = await renderPdfiumFallback(activePage, {
                scale,
                width: canvas.width,
                height: canvas.height,
                rotation: Number(page.rotate || 0),
              });
              if (hasMeaningfulInk(fallback.canvas)) {
                canvas.width = 0;
                canvas.height = 0;
                canvas = fallback.canvas;
                target.pdfiumFallbackUsed = true;
                target.pdfiumFallbackDiagnostics = fallback.diagnostics;
              } else {
                fallback.canvas.width = 0;
                fallback.canvas.height = 0;
                target.pdfiumFallbackError = "PDFium no produjo píxeles legibles en la página " + activePage + ".";
              }
            } catch (fallbackError) {
              target.pdfiumFallbackError = "PDFium no pudo recuperar la página " + activePage + ": " +
                (fallbackError?.message || "error de renderizado");
              if (pdfJsRenderError) {
                target.pdfiumFallbackError = "PDF.js: " + (pdfJsRenderError?.message || "lienzo vacío") +
                  "; PDFium: " + (fallbackError?.message || "error de renderizado");
              }
            }
          } else if (pdfJsRenderError) {
            target.pdfiumFallbackError = "PDF.js no pudo renderizar la página " + activePage + ": " +
              (pdfJsRenderError?.message || "error de renderizado");
          }
        }

        const originalText = (target.lines || []).map(line => line?.text || "").join("\n").trim();
        const originalQuality = measureLocalTextQuality(originalText, 65);
        let best = await recognizeLocalCanvas(worker, canvas, viewport, scale);
        let bestText = String(best.text || "").trim();
        let bestQuality = best.quality || measureLocalTextQuality(bestText, best.confidence);

        if (bestQuality.letters < 90 || bestQuality.score < 57 || best.confidence < 48) {
          enhancedCanvas = enhanceLocalOcrCanvas(canvas);
          const enhanced = await recognizeLocalCanvas(worker, enhancedCanvas, viewport, scale);
          const enhancedText = String(enhanced.text || "").trim();
          const enhancedQuality = enhanced.quality || measureLocalTextQuality(enhancedText, enhanced.confidence);
          if (enhancedQuality.score > bestQuality.score ||
              (enhancedQuality.score >= bestQuality.score - 3 && enhancedQuality.letters > bestQuality.letters * 1.15)) {
            best = enhanced;
            bestText = enhancedText;
            bestQuality = enhancedQuality;
            target.ocrEnhancement = "grayscale-contrast";
          }
        }

        const geometryLines = best.usedGeometry
          ? toPageGeometryLines(best.records || [], scale, canvas.height)
          : [];
        const fallbackLines = bestText.split("\n").map(line => line.trim()).filter(Boolean);
        const finalLines = geometryLines.length ? geometryLines : fallbackLines.map((text, lineIndex) => {
          const height = Number(target.height || nativeViewport.height);
          const width = Number(target.width || nativeViewport.width);
          const step = height / (fallbackLines.length + 1);
          return {
            text, xMin: 0, xMax: width, width, y: height - (lineIndex + 1) * step,
            fontSize: 10, bold: false, boldRatio: 0, fontNames: ["local-ocr-text-only"], items: [],
            index: lineIndex, ocr: true, syntheticGeometry: true,
          };
        });

        const sourceWasPoor = isLocalTextPoor(originalText);
        const forceStructureOcr = looksLikeTocPage(originalText);
        const ocrCanReplace = bestText.length > 0 &&
          (sourceWasPoor
            ? bestQuality.score >= Math.max(38, originalQuality.score - 4)
            : forceStructureOcr
              ? geometryLines.length >= 5 &&
                bestQuality.score >= Math.max(42, originalQuality.score - 12)
              : bestQuality.score >= originalQuality.score + 3);
        if (ocrCanReplace && finalLines.length) {
          target.lines = finalLines;
          target.ocrRecognized = true;
          target.ocrGeometryReliable = geometryLines.length > 0;
          target.ocrConfidence = Math.round(best.confidence || bestQuality.confidence || 0);
          target.ocrQualityScore = Math.round(bestQuality.score);
          target.ocrTextChars = bestText.length;
          target.ocrSpreadSplit = Boolean(best.detectedSpread);
          if (best.detectedSpread) spreadPages.push(activePage);
          recognizedPages += 1;
          improvedPages += 1;
          if (bestQuality.score < 55 || best.confidence < 48) lowConfidencePages.push(activePage);
        } else {
          target.ocrRecognized = false;
          target.ocrGeometryReliable = false;
          target.ocrConfidence = Math.round(best.confidence || 0);
          target.ocrQualityScore = Math.round(bestQuality.score);
          lowConfidencePages.push(activePage);
        }
      } catch (error) {
        throw new Error("Falló el OCR local avanzado de la página " + activePage + ": " + (error?.message || "error de reconocimiento."));
      } finally {
        if (enhancedCanvas) { enhancedCanvas.width = 0; enhancedCanvas.height = 0; }
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        page.cleanup?.();
      }
      target.ocrAttempted = true;
      onProgress({
        phase: "ocr", processed: index + 1, total: targets.length, pageNumber: activePage,
        message: "OCR local avanzado · página " + activePage + " (" + (index + 1) + " de " + targets.length + ")" +
          (target.ocrSpreadSplit ? " · doble página detectada" : "") +
          (target.ocrEnhancement ? " · imagen optimizada" : ""),
      });
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error("No se pudo completar el OCR local avanzado.");
  } finally {
    if (worker) { try { await worker.terminate(); } catch {} }
  }

  return {
    attemptedPages: targets.length, recognizedPages, improvedPages,
    lowConfidencePages: Array.from(new Set(lowConfidencePages)).sort((a, b) => a - b),
    spreadPages: Array.from(new Set(spreadPages)).sort((a, b) => a - b),
  };
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
  let pdfiumRenderer = null;
  const renderPdfiumFallback = async (pageNumber, options = {}) => {
    if (!pdfiumRenderer) pdfiumRenderer = await createPdfiumRenderer(file);
    return pdfiumRenderer.renderPage(pageNumber, options);
  };

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      // Normalize text geometry into the same displayed orientation used for page
      // images and layout analysis. Many scanned books store landscape spreads with
      // a 270° page rotation; grouping raw PDF coordinates breaks their lines.
      const viewport = page.getViewport({ scale: 1 });
      const displayTextItems = textContent.items.map((item) => {
        const rawTransform = Array.isArray(item?.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        const transform = pdfjsLib.Util.transform(viewport.transform, rawTransform);
        return {
          ...item,
          transform: [
            transform[0], transform[1], transform[2], transform[3],
            transform[4], viewport.height - transform[5],
          ],
        };
      });

      let structTree = null;
      try {
        structTree = await page.getStructTree?.();
      } catch {
        structTree = null;
      }

      const structHeadings = countPdfStructHeadings(structTree);
      if (structHeadings > 0) structTreePages += 1;

      const lines = groupPdfItems(displayTextItems, viewport.width);
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
      let pdfiumFallbackUsed = false;
      let pdfiumFallbackDiagnostics = null;
      let pdfiumFallbackError = "";
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

          let pdfJsRenderError = null;
          try {
            await page.render({ canvasContext: context, viewport: imageViewport }).promise;
          } catch (error) {
            pdfJsRenderError = error;
          }

          if (pdfJsRenderError || !hasMeaningfulInk(canvas)) {
            try {
              const fallback = await renderPdfiumFallback(pageNumber, {
                scale,
                width: canvas.width,
                height: canvas.height,
                rotation: Number(page.rotate || 0),
              });
              if (hasMeaningfulInk(fallback.canvas)) {
                canvas.width = 0;
                canvas.height = 0;
                canvas = fallback.canvas;
                pdfiumFallbackUsed = true;
                pdfiumFallbackDiagnostics = fallback.diagnostics;
              } else {
                fallback.canvas.width = 0;
                fallback.canvas.height = 0;
                throw new Error("PDFium también devolvió una imagen vacía.");
              }
            } catch (error) {
              pdfiumFallbackError = (pdfJsRenderError ? "PDF.js: " + (pdfJsRenderError?.message || "lienzo vacío") + "; " : "") +
                (error?.message || "Error de renderizado.");
            }
          }

          if (hasMeaningfulInk(canvas)) imageDataUrl = canvas.toDataURL("image/jpeg", 0.68);
        } catch (error) {
          imageDataUrl = "";
          pdfiumFallbackError = error?.message || "No se pudo renderizar la página.";
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
        pdfiumFallbackUsed,
        pdfiumFallbackDiagnostics,
        pdfiumFallbackError,
      });

      onProgress({ phase: includePageImages ? "rendering" : "extracting", processed: pageNumber, total: pageCount, pageNumber });
      page.cleanup?.();
    }

    const localTextOnlyMode = !includePageImages && !includeAIPageText && !includePageImagesForLowText;
    let localOcr = { attemptedPages: 0, recognizedPages: 0 };
    if (localTextOnlyMode) {
      localOcr = await runLocalPdfOcr(pdf, pages, onProgress, renderPdfiumFallback);
    }

    const hasExtractableText = pages.some((page) =>
      (page.lines || []).some((line) => String(line?.text || "").trim())
    );
    if (!hasExtractableText && !includePageImages && !includePageImagesForLowText) {
      throw new Error("AULIA no pudo reconocer texto en este PDF, ni en su capa de texto ni mediante OCR local. Comprobá que las páginas sean legibles; como alternativa, usá «OCR y visión selectiva · Groq».");
    }

    const analysis = await analyzePdfStructure({
      pdf,
      pages,
      structTreePages,
    });
    const pdfiumFallbackPages = pages.filter(page => page.pdfiumFallbackUsed).map(page => page.pageNumber);
    const pdfiumFallbackErrors = pages.filter(page => page.pdfiumFallbackError).map(page => ({
      pageNumber: page.pageNumber,
      error: page.pdfiumFallbackError,
    }));
    if (pdfiumFallbackPages.length) {
      analysis.pdfiumFallbackPages = pdfiumFallbackPages;
      analysis.warnings = [
        ...(analysis.warnings || []),
        "PDFium recuperó la imagen de las páginas físicas " + pdfiumFallbackPages.join(", ") +
          " porque PDF.js no pudo dibujarlas. El texto OCR de esas páginas debe verificarse contra el documento original.",
      ];
    }
    if (pdfiumFallbackErrors.length) {
      analysis.pdfiumFallbackErrors = pdfiumFallbackErrors;
      analysis.warnings = [
        ...(analysis.warnings || []),
        "No se pudo recuperar con PDFium el renderizado de las páginas físicas " +
          pdfiumFallbackErrors.map(item => item.pageNumber).join(", ") + ". Revisá esas páginas visualmente.",
      ];
    }
    if (localOcr.attemptedPages > 0) {
      analysis.localOcrPages = localOcr.attemptedPages;
      analysis.localOcrRecognizedPages = localOcr.recognizedPages;
      analysis.localOcrImprovedPages = Number(localOcr.improvedPages || localOcr.recognizedPages || 0);
      analysis.localOcrLowConfidencePages = Array.isArray(localOcr.lowConfidencePages) ? localOcr.lowConfidencePages : [];
      analysis.localOcrSpreadPages = Array.isArray(localOcr.spreadPages) ? localOcr.spreadPages : [];
      const ocrWarnings = [];
      if (localOcr.recognizedPages < localOcr.attemptedPages) {
        ocrWarnings.push(
          (localOcr.attemptedPages - localOcr.recognizedPages) +
          " página(s) requirieron OCR, pero el resultado no superó de forma suficiente la calidad del texto anterior. Revisá esas páginas antes de generar el índice conceptual."
        );
      }
      if (analysis.localOcrLowConfidencePages.length) {
        ocrWarnings.push(
          "OCR local con confianza limitada en las páginas físicas " +
          analysis.localOcrLowConfidencePages.join(", ") +
          ". El texto se conservó, pero conviene verificarlo contra el PDF."
        );
      }
      if (analysis.localOcrSpreadPages.length) {
        ocrWarnings.push(
          "Se detectaron y leyeron por separado posibles páginas enfrentadas en: " +
          analysis.localOcrSpreadPages.join(", ") +
          ". Verificá el orden de lectura en esas páginas."
        );
      }
      if (pages.some(page => page.ocrRecognized && !page.ocrGeometryReliable)) {
        ocrWarnings.push("En algunas páginas el OCR recuperó texto, pero Tesseract no devolvió coordenadas reales; se mantuvo el texto y se marcó la geometría como aproximada.");
      }
      if (ocrWarnings.length) analysis.warnings = [...(analysis.warnings || []), ...ocrWarnings];
    }

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
      aiPages: (includePageImages || includeAIPageText || includePageImagesForLowText) ? pages.map((page) => {
        const orderedLines = page.readingLines?.length ? page.readingLines : page.lines || [];
        return {
          pageNumber: page.pageNumber,
          width: Number(page.width || 0),
          height: Number(page.height || 0),
          aspectRatio: Number(page.width || 0) / Math.max(1, Number(page.height || 0)),
          extractedText: orderedLines
            .map((line) => typeof line === "string" ? line : line?.text || "")
            .filter(Boolean)
            .join("\n")
            .trim(),
          lineItems: orderedLines.map((line, index) => ({
            lineNumber: index + 1,
            text: typeof line === "string" ? line : String(line?.text || ""),
            logicalSide: line?.logicalSide || "",
            bold: Boolean(line?.bold),
            fontSize: Number(line?.fontSize || 0),
            xMin: Number(line?.xMin || 0),
            width: Number(line?.width || 0),
          })).filter(line => line.text.trim()),
          layoutKind: page.layoutKind || "single-page",
          layoutConfidence: Number(page.layoutConfidence || 0),
          imageDataUrl: page.imageDataUrl || "",
          needsVisualAnalysis: Boolean(page.needsVisualAnalysis),
          pdfiumFallbackUsed: Boolean(page.pdfiumFallbackUsed || page.ocrPdfiumFallbackUsed),
          ...(page.pdfiumFallbackDiagnostics || page.ocrPdfiumFallbackDiagnostics
            ? { pdfiumFallbackDiagnostics: page.pdfiumFallbackDiagnostics || page.ocrPdfiumFallbackDiagnostics }
            : {}),
          ...(page.pdfiumFallbackError ? { pdfiumFallbackError: page.pdfiumFallbackError } : {}),
        };
      }) : undefined,
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
    if (pdfiumRenderer) {
      try { pdfiumRenderer.dispose(); } catch {}
      pdfiumRenderer = null;
    }
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
    const content = normalizeWhitespace(repairHyphenation(current.lines.join("\n")));
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
    const text = node.textContent?.replace(/\s+/g, " ").trim();
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
  let pdfiumRenderer = null;
  const renderPdfiumFallback = async (pageNumber, options = {}) => {
    if (!pdfiumRenderer) pdfiumRenderer = await createPdfiumRenderer(file);
    return pdfiumRenderer.renderPage(pageNumber, options);
  };
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
        let pdfJsRenderError = null;
        try {
          await page.render({ canvasContext: context, viewport: imageViewport }).promise;
        } catch (error) {
          pdfJsRenderError = error;
        }
        let pdfiumFallbackUsed = false;
        let pdfiumFallbackError = "";
        if (pdfJsRenderError || !hasMeaningfulInk(canvas)) {
          try {
            const fallback = await renderPdfiumFallback(pageNumber, {
              scale,
              width: canvas.width,
              height: canvas.height,
              rotation: Number(page.rotate || 0),
            });
            if (hasMeaningfulInk(fallback.canvas)) {
              canvas.width = 0;
              canvas.height = 0;
              canvas = fallback.canvas;
              pdfiumFallbackUsed = true;
            } else {
              fallback.canvas.width = 0;
              fallback.canvas.height = 0;
              throw new Error("PDFium también devolvió una imagen vacía.");
            }
          } catch (error) {
            pdfiumFallbackError = (pdfJsRenderError ? "PDF.js: " + (pdfJsRenderError?.message || "lienzo vacío") + "; " : "") +
              (error?.message || "Error de renderizado.");
          }
        }
        const imageDataUrl = hasMeaningfulInk(canvas) ? canvas.toDataURL("image/jpeg", 0.68) : "";
        rendered.push({ pageNumber, imageDataUrl, pdfiumFallbackUsed, ...(pdfiumFallbackError ? { pdfiumFallbackError } : {}) });
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
    if (pdfiumRenderer) {
      try { pdfiumRenderer.dispose(); } catch {}
      pdfiumRenderer = null;
    }
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
        table ? "Tabla reconstruida a partir de la página:\n" + table : "",
      ].filter(Boolean).join("\n");
    }).filter(Boolean);

    const bodyParts = [];
    if (needsOcr) {
      const recoveredText = transcription || rawText;
      if (recoveredText) bodyParts.push("TEXTO RECUPERADO POR LECTURA VISUAL · PÁGINA " + pageNumber + "\n" + recoveredText);
    } else if (transcription && transcription !== rawText) {
      bodyParts.push("TRANSCRIPCIÓN ALTERNATIVA PROPUESTA POR IA · VERIFICAR CON EL TEXTO EXTRAÍDO · PÁGINA " + pageNumber + "\n" + transcription);
      warnings.push("Página " + pageNumber + ": la lectura visual propuso una transcripción distinta del texto extraído; ambas versiones se conservan para revisión.");
    }

    if (visualText.length) bodyParts.push("LECTURA VISUAL ASISTIDA POR IA · PÁGINA " + pageNumber + "\n" + visualText.join("\n\n"));
    const content = bodyParts.join("\n\n").trim();
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
    const localSectionMeta = (material?.document?.sections || []).find(section =>
      Number(section?.sourcePageStart || 0) <= pageNumber &&
      Number(section?.sourcePageEnd || section?.sourcePageStart || 0) >= pageNumber
    ) || (material?.document?.sections || [])[0];
    const sectionPath = Array.isArray(localSection?.sectionPath) && localSection.sectionPath.length
      ? localSection.sectionPath
      : Array.isArray(localSectionMeta?.path) && localSectionMeta.path.length
        ? localSectionMeta.path
        : (Array.isArray(analysis.sectionPath) && analysis.sectionPath.length
            ? analysis.sectionPath
            : [String(analysis.sectionTitle || "Material sin sección identificada")]);
    const sectionTitle = String(localSection?.title || localSectionMeta?.title || sectionPath[sectionPath.length - 1] || "Lectura visual").trim();
    const baseId = slugify(sourceDocumentId + "-lectura-visual-pagina-" + pageNumber);
    let id = baseId;
    let suffix = 1;
    while (usedIds.has(id)) id = baseId + "-" + suffix++;
    usedIds.add(id);

    visualChunks.push({
      id,
      unitId: id,
      sectionId: localSection?.sectionId || localSectionMeta?.id || slugify(sourceDocumentId + "-" + sectionPath.join("-")),
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
      scope: localSection?.scope || localSectionMeta?.scope || "included",
      priority: localSection?.priority || localSectionMeta?.priority || "normal",
      teacherTopic: localSection?.teacherTopic || localSectionMeta?.teacherTopic || "",
      teacherConcepts: Array.isArray(localSection?.teacherConcepts)
        ? localSection.teacherConcepts
        : (Array.isArray(localSectionMeta?.teacherConcepts) ? localSectionMeta.teacherConcepts : []),
      teacherLimit: localSection?.teacherLimit || localSectionMeta?.teacherLimit || "",
      visualElementCount: visualElements.length,
      ...(needsReview ? { needsReview: true } : {}),
      ...(reviewNote ? { reviewNotes: reviewNote } : {}),
      structureEvidence: ["La estructura del documento se conservó desde la extracción local; la IA se usó solo para recuperar texto o interpretar elementos visuales de esta página."],
    });

    if (needsReview) warnings.push("Página " + pageNumber + (reviewNote ? ": " + reviewNote : ": requiere revisión de la lectura visual."));
  }

  const uniqueWarnings = Array.from(new Set(warnings));
  const { sections: _sourceSections, ...baseAnalysis } = material?.analysis || {};
  const analysisSummary = {
    ...baseAnalysis,
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


export function applyAISemanticSegmentation(material, semanticResult) {
  const sourceName = String(material?.sourceName || material?.document?.sourceName || "material.pdf");
  const documentId = String(material?.document?.id || makeDocumentId(sourceName));
  const sections = (semanticResult?.sections || []).map((section, index) => ({
    ...section,
    title: String(section?.title || "Sección " + (index + 1)).trim(),
    level: Math.max(1, Math.min(6, Number(section?.level || 1))),
    sectionPath: Array.isArray(section?.sectionPath) && section.sectionPath.length
      ? section.sectionPath.map(value => String(value || "").trim()).filter(Boolean)
      : [String(section?.title || "Material general")],
    content: normalizeWhitespace(String(section?.content || "")),
    segmentationSource: "ai-text-first",
    confidence: Math.max(0.2, Math.min(0.99, Number(section?.confidence || 0.5))),
    scope: section?.scope || "included",
    priority: section?.priority || "normal",
    evidence: Array.isArray(section?.evidence) ? section.evidence : [],
  }));
  if (!sections.length) throw new Error("La interpretación temática de la IA no devolvió secciones para revisar.");

  const originalAnalysis = material?.analysis || material?.document?.analysis || {};
  const uniqueWarnings = Array.from(new Set([
    ...(material?.warnings || []),
    ...(semanticResult?.warnings || []),
  ]));
  const confidences = sections.map(section => Number(section.confidence || 0.5));
  const semanticAnalysis = {
    ...originalAnalysis,
    version: 3,
    method: "ai-text-first",
    documentType: semanticResult?.documentType || originalAnalysis.documentType || "documento",
    model: semanticResult?.model || originalAnalysis.model || "",
    confidence: confidences.reduce((sum, value) => sum + value, 0) / Math.max(1, confidences.length),
    sectionCount: sections.length,
    lowConfidenceSections: sections.filter(section => Number(section.confidence || 0) < 0.62 || section.needsReview).length,
    semanticBoundaries: Number(semanticResult?.boundariesFound || 0),
    semanticTasksProcessed: Number(semanticResult?.tasksProcessed || 0),
    semanticOutline: Array.isArray(semanticResult?.outline) ? semanticResult.outline : [],
    warnings: uniqueWarnings,
  };

  const corpus = buildSectionFragments({
    sections,
    sourceName,
    documentId,
    sourcePageCount: material?.pages || null,
  });

  // Keep visual descriptions/tables already extracted from Groq, but attach them
  // to the new semantic section that covers their source page instead of leaving
  // them assigned to obsolete local section IDs.
  const visualChunks = (material?.corpus || [])
    .filter(chunk => chunk?.segmentationSource === "vision-selective")
    .map((chunk, index) => {
      // The OCR transcription is now represented in the semantic section text.
      // Keep only actual visual descriptions/tables here to avoid indexing the
      // same transcribed page twice under two different passage IDs.
      const fullVisualContent = String(chunk?.content || "");
      const visualMarker = "LECTURA VISUAL ASISTIDA POR IA · PÁGINA ";
      const markerIndex = fullVisualContent.indexOf(visualMarker);
      const visualOnlyContent = markerIndex >= 0 ? fullVisualContent.slice(markerIndex).trim() : "";
      if (!visualOnlyContent) return null;
      const pageNumber = Number(chunk?.sourcePageStart || chunk?.sourcePage || 0);
      const candidates = sections.map((section, sectionIndex) => ({ section, sectionIndex }))
        .filter(({ section }) =>
          !section.structuralOnly &&
          Number(section.sourcePageStart || 0) <= pageNumber &&
          Number(section.sourcePageEnd || section.sourcePageStart || 0) >= pageNumber
        )
        .sort((a, b) =>
          Number(b.section.sourcePageStart || 0) - Number(a.section.sourcePageStart || 0) ||
          Number(b.section.level || 1) - Number(a.section.level || 1)
        );
      const target = candidates[0];
      const targetSection = target?.section;
      const targetIndex = target?.sectionIndex ?? 0;
      const nextPath = targetSection?.sectionPath || chunk.sectionPath || [];
      return {
        ...chunk,
        id: String(chunk.id || "visual-" + index),
        content: visualOnlyContent,
        sectionId: targetSection ? makeSectionId(documentId, targetSection, targetIndex) : chunk.sectionId,
        chapter: nextPath.join(" › "),
        sectionPath: [...nextPath],
        sectionLevel: Number(targetSection?.level || chunk.sectionLevel || 1),
        scope: targetSection?.scope || "included",
        priority: targetSection?.priority || "normal",
        teacherTopic: targetSection?.teacherTopic || "",
        teacherConcepts: Array.isArray(targetSection?.teacherConcepts) ? targetSection.teacherConcepts : [],
        teacherLimit: targetSection?.teacherLimit || "",
      };
    });

  const document = buildDocumentMeta({
    file: { name: sourceName },
    documentId,
    sections,
    pages: material?.pages || null,
    format: material?.document?.format || "pdf",
    analysis: semanticAnalysis,
  });
  document.title = material?.document?.title || document.title;

  return {
    ...material,
    corpus: [...corpus, ...visualChunks.filter(Boolean)],
    document,
    analysis: semanticAnalysis,
    warnings: uniqueWarnings,
    aiAnalysis: {
      provider: "Groq · interpretación semántica del texto",
      model: semanticResult?.model || "",
      method: "ai-text-first",
      sectionsDetected: sections.length,
      boundariesDetected: Number(semanticResult?.boundariesFound || 0),
      needsReview: uniqueWarnings.length > 0 || sections.some(section => section.needsReview),
    },
  };
}
