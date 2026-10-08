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
}) {
  return {
    id: documentId,
    title: String(file?.name || "Material").replace(/\\.[^.]+$/, ""),
    sourceName: file?.name || "",
    format,
    pages: pages || null,
    sections: (sections || []).map((section, index) => ({
      id: makeSectionId(documentId, section, index),
      title: section.title || "Material",
      path: Array.isArray(section.sectionPath) ? section.sectionPath : [],
      level: Number(section.level || 1),
      sourcePageStart: section.sourcePageStart || null,
      sourcePageEnd: section.sourcePageEnd || null,
      segmentationSource: section.segmentationSource || "text-structure",
    })),
    sectionCount: (sections || []).length,
  };
}

function makeDocumentId(sourceName) {
  return "doc-" + slugify(sourceName || "material");
}

function headingInfo(line, explicitLevel = null) {
  const clean = cleanPdfLine(line);
  if (!clean || clean.length > 140) return null;

  const numbered = clean.match(/^(\\d+(?:\\.\\d+){0,4})[.)]?\\s+(.+)$/);
  if (numbered && numbered[2].length <= 125 && !/[.!?]$/.test(numbered[2])) {
    const depth = numbered[1].split(".").length;
    return { title: clean, level: explicitLevel || Math.min(depth, 6) };
  }

  if (/^(CAP[ÍI]TULO|PARTE|UNIDAD|MÓDULO|MODULE|CHAPTER|SECCIÓN|SECTION)\\b/i.test(clean)) {
    return { title: clean, level: explicitLevel || 1 };
  }

  const letters = (clean.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []);
  if (letters.length >= 5) {
    const upper = (clean.match(/[A-ZÁÉÍÓÚÜÑ]/g) || []).length;
    if (upper / letters.length >= 0.78 && clean.length <= 100) {
      return { title: clean, level: explicitLevel || 2 };
    }
  }

  return null;
}

function groupPdfRows(items) {
  const rows = [];
  for (const item of items || []) {
    const text = cleanPdfLine(item?.str || "");
    if (!text) continue;

    const x = Number(item?.transform?.[4] ?? 0);
    const y = Number(item?.transform?.[5] ?? 0);
    const width = Math.max(0, Number(item?.width ?? 0));

    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }

    row.items.push({ x, width, text });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const ordered = row.items.slice().sort((a, b) => a.x - b.x);
      const text = ordered.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      const xMin = ordered.length ? ordered[0].x : 0;
      const xMax = ordered.reduce((max, item) => Math.max(max, item.x + item.width), xMin);

      return {
        text,
        xMin,
        xMax,
        items: ordered,
      };
    })
    .filter((row) => row.text);
}

function groupPdfItems(items) {
  const lines = [];
  for (const item of items || []) {
    const text = cleanPdfLine(item?.str || "");
    if (!text) continue;
    const y = Number(item?.transform?.[5] ?? 0);
    const x = Number(item?.transform?.[4] ?? 0);
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, text });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.items
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\\s+/g, " ")
      .trim())
    .filter(Boolean);
}

function findRepeatedPageFurniture(pageLines) {
  const counts = new Map();
  const pages = pageLines.length || 1;

  for (const lines of pageLines) {
    const candidates = [];
    if (lines.length) candidates.push(lines.slice(0, 3));
    if (lines.length > 3) candidates.push(lines.slice(-3));
    for (const line of candidates.flat()) {
      const clean = cleanPdfLine(line);
      if (!clean || clean.length > 120) continue;
      const key = normalizedKey(clean);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const repeated = new Set();
  for (const [key, count] of counts) {
    if (count >= Math.max(2, Math.ceil(pages * 0.55))) repeated.add(key);
  }
  return repeated;
}

async function resolvePdfOutlinePage(pdf, destination) {
  try {
    const dest = typeof destination === "string"
      ? await pdf.getDestination(destination)
      : destination;
    const pageRef = Array.isArray(dest) ? dest[0] : null;
    if (!pageRef) return null;
    const pageIndex = await pdf.getPageIndex(pageRef);
    return Number.isFinite(pageIndex) ? pageIndex + 1 : null;
  } catch {
    return null;
  }
}

async function flattenPdfOutline(pdf, items, level = 1, parentPath = [], output = []) {
  for (const item of items || []) {
    const title = cleanPdfLine(item?.title || "");
    if (!title) continue;

    const page = await resolvePdfOutlinePage(pdf, item?.dest);
    const path = [...parentPath, title];
    output.push({
      title,
      level,
      path,
      page,
    });

    if (Array.isArray(item?.items) && item.items.length) {
      await flattenPdfOutline(pdf, item.items, level + 1, path, output);
    }
  }
  return output;
}

function tocNumberInfo(title) {
  const match = String(title || "").match(/^(\d+(?:\.\d+){0,8})[.)]?\s+/);
  if (!match) return null;
  const number = match[1];
  return {
    number,
    level: Math.min(number.split(".").length, 8),
  };
}

function parsePdfTocRow(row, pageCount, pageWidth = 0) {
  const clean = cleanPdfLine(row?.text || "");
  if (!clean || clean.length > 180) return null;

  const dottedMatch = clean.match(/^(.+?)(?:\.{2,}|·{2,})\s*(\d{1,4})$/);
  const terminalPageMatch = clean.match(/^(.+?)\s+(\d{1,4})$/);
  const match = dottedMatch || terminalPageMatch;
  if (!match) return null;

  const printedPage = Number(match[2]);
  let title = cleanPdfLine(match[1])
    .replace(/\.{2,}\s*$/, "")
    .replace(/·{2,}\s*$/, "");

  if (
    !title ||
    !Number.isFinite(printedPage) ||
    printedPage < 1 ||
    printedPage > Math.max(pageCount, 5000) ||
    /^(?:índice|indice|contenido|contents|table of contents|sumario)$/i.test(title)
  ) {
    return null;
  }

  const numbered = tocNumberInfo(title);
  const upperTitle = /^(?:PARTE|CAP[ÍI]TULO|CHAPTER|UNIDAD|MÓDULO|MODULE|SECCIÓN|SECTION)\b/i.test(title);

  // A real index entry normally ends with the page number near the right edge
  // or uses dotted leaders. A plain sentence followed by a number is rejected
  // unless its right edge supports a page-number column.
  const hasDottedLeader = Boolean(dottedMatch);
  const lastItem = row?.items?.[row.items.length - 1];
  const terminalAtRight = pageWidth
    ? Number(lastItem?.x || 0) >= pageWidth * 0.58
    : true;

  if (!hasDottedLeader && !terminalAtRight) return null;
  if (title.length < 3) return null;

  const level = numbered?.level || (upperTitle ? 1 : 2);
  return {
    title,
    printedPage,
    level,
    number: numbered?.number || "",
    xMin: Number(row?.xMin || 0),
  };
}

function tocPageScore(page, pageCount) {
  const rows = page?.tocRows || [];
  if (!rows.length) return 0;

  let candidates = 0;
  let dotted = 0;
  for (const row of rows) {
    const parsed = parsePdfTocRow(row, pageCount, page?.width || 0);
    if (parsed) {
      candidates += 1;
      if (/\.{2,}|·{2,}/.test(row.text)) dotted += 1;
    }
  }

  const density = candidates / Math.max(1, rows.length);
  return candidates * 2 + density * 8 + dotted * 1.5;
}

function findPdfTocWindow(pageData) {
  // Find the page that explicitly names the index first.
  let indexStart = -1;
  for (let i = 0; i < Math.min(pageData.length, 50); i += 1) {
    const joined = pageData[i].lines.join(" ");
    if (/\b(?:índice|indice|contenido|contents|table of contents|sumario)\b/i.test(joined)) {
      indexStart = i;
      break;
    }
  }
  if (indexStart < 0) return null;

  const start = indexStart;
  const end = Math.min(pageData.length, start + 50);
  let bestScore = 0;
  let firstContentPage = -1;

  for (let i = start; i < end; i += 1) {
    const score = tocPageScore(pageData[i], pageData.length);
    if (score > bestScore) {
      bestScore = score;
      firstContentPage = i;
    }
  }

  if (bestScore < 12 || firstContentPage < 0) return null;

  // The real index begins at the first high-density TOC page and usually
  // continues while entries remain dense. Allow brief blank/heading-only pages
  // inside a long multi-page index.
  let last = firstContentPage;
  let quietPages = 0;
  for (let i = firstContentPage; i < end; i += 1) {
    const score = tocPageScore(pageData[i], pageData.length);
    if (score >= 8) {
      last = i;
      quietPages = 0;
    } else {
      quietPages += 1;
      if (quietPages >= 2) break;
    }
  }

  return { start, end: last + 1 };
}

function headingMatchesTitle(line, title) {
  const a = normalizedKey(line);
  const b = normalizedKey(title);
  if (!a || !b) return false;
  if (a === b) return true;

  const cleanA = a.replace(/^#+\s*/, "");
  const cleanB = b.replace(/^#+\s*/, "");
  if (cleanA === cleanB) return true;

  const tokensA = new Set(cleanA.split(" ").filter((token) => token.length >= 3));
  const tokensB = cleanB.split(" ").filter((token) => token.length >= 3);
  if (!tokensA.size || !tokensB.length) return false;
  const overlap = tokensB.filter((token) => tokensA.has(token)).length / tokensB.length;
  return overlap >= 0.86;
}

function findPdfTitlePage(pageData, title, estimatedPage) {
  const target = Math.max(1, Math.min(pageData.length, Number(estimatedPage || 1)));
  const windows = [
    [target - 16, target + 16],
    [0, pageData.length - 1],
  ];

  for (const [start, end] of windows) {
    for (let pageIndex = Math.max(0, start); pageIndex <= Math.min(pageData.length - 1, end); pageIndex += 1) {
      if (!pageData[pageIndex].lines.some((line) => headingMatchesTitle(line, title))) continue;

      // Prefer a heading-like occurrence, but accept a normal line if the title
      // is otherwise exact. This helps PDFs with weak typography metadata.
      const heading = pageData[pageIndex].lines.some(
        (line) => headingInfo(line) && headingMatchesTitle(line, title)
      );
      if (heading) return pageIndex + 1;
    }
  }

  for (const [start, end] of windows) {
    for (let pageIndex = Math.max(0, start); pageIndex <= Math.min(pageData.length - 1, end); pageIndex += 1) {
      if (pageData[pageIndex].lines.some((line) => headingMatchesTitle(line, title))) {
        return pageIndex + 1;
      }
    }
  }

  return null;
}

function buildTocHierarchy(entries) {
  const stack = [];
  return entries.map((entry) => {
    let level = Math.max(1, Number(entry.level || 1));

    // If the TOC does not number entries, infer hierarchy from indentation.
    if (!entry.number && Number.isFinite(entry.xMin)) {
      level = Math.max(1, Math.min(8, entry.inferredLevel || level));
    }

    stack.length = Math.max(0, level - 1);
    stack[level - 1] = entry.title;
    const path = stack.slice(0, level).filter(Boolean);
    stack.length = level;
    return { ...entry, level, path };
  });
}

function inferTocIndentLevels(entries) {
  const xs = entries
    .filter((entry) => !entry.number && Number.isFinite(entry.xMin))
    .map((entry) => entry.xMin)
    .sort((a, b) => a - b);

  const anchors = [];
  for (const x of xs) {
    if (!anchors.length || Math.abs(x - anchors[anchors.length - 1]) > 12) {
      anchors.push(x);
    }
  }

  return entries.map((entry) => {
    if (entry.number || !Number.isFinite(entry.xMin) || !anchors.length) return entry;
    let nearest = 0;
    let best = Infinity;
    anchors.forEach((anchor, index) => {
      const distance = Math.abs(entry.xMin - anchor);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    return {
      ...entry,
      inferredLevel: Math.min(nearest + 1, 8),
    };
  });
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function buildPdfTocSections(pageData) {
  const window = findPdfTocWindow(pageData);
  if (!window) return null;

  const entries = [];
  for (let pageIndex = window.start; pageIndex < window.end; pageIndex += 1) {
    for (const row of pageData[pageIndex].tocRows || []) {
      const entry = parsePdfTocRow(row, pageData.length, pageData[pageIndex].width || 0);
      if (!entry) continue;

      const duplicate = entries.some(
        (item) => item.title === entry.title && item.printedPage === entry.printedPage
      );
      if (!duplicate) entries.push({ ...entry, tocPage: pageIndex + 1 });
    }
  }

  if (entries.length < 3) return null;

  const enriched = inferTocIndentLevels(entries);

  // Find the physical page for a sample of entries. This learns the common
  // printed-page offset without asking the model to interpret the document.
  const mappedByTitle = enriched.map((entry) => ({
    ...entry,
    physicalPage: findPdfTitlePage(
      pageData,
      entry.title,
      Math.max(1, Math.min(pageData.length, entry.printedPage))
    ),
  }));

  const offsets = mappedByTitle
    .filter((entry) => Number.isFinite(entry.physicalPage))
    .map((entry) => entry.physicalPage - entry.printedPage);

  const pageOffset = median(offsets) ?? 0;

  const mapped = mappedByTitle.map((entry) => ({
    ...entry,
    page: entry.physicalPage ||
      Math.max(1, Math.min(pageData.length, Math.round(entry.printedPage + pageOffset))),
  }));

  // The index order is authoritative. Drop only entries that cannot advance
  // through the physical document; never re-sort by accidental text matches.
  const ordered = [];
  for (const entry of mapped) {
    if (!ordered.length || entry.page >= ordered[ordered.length - 1].page) {
      ordered.push(entry);
    }
  }

  if (ordered.length < 3) return null;

  const repeatedFurniture = findRepeatedPageFurniture(pageData.map((page) => page.lines));
  const sections = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];

    // A structural entry ends at the next sibling or ancestor, not at the next
    // child. This preserves chapter/topic boundaries instead of arbitrarily
    // slicing a chapter at its first subsection.
    let nextBoundary = null;
    for (let j = i + 1; j < ordered.length; j += 1) {
      if (ordered[j].level <= current.level) {
        nextBoundary = ordered[j];
        break;
      }
    }

    const startPage = Math.max(1, Math.min(pageData.length, current.page));
    const endPage = nextBoundary
      ? Math.max(startPage, Math.min(pageData.length, nextBoundary.page - 1))
      : pageData.length;

    let lines = pageData
      .slice(startPage - 1, endPage)
      .flatMap((page) => page.lines)
      .map(cleanPdfLine)
      .filter(Boolean)
      .filter((line) => !isNoiseLine(line, repeatedFurniture));

    const headingIndex = lines.findIndex((line) => headingMatchesTitle(line, current.title));
    if (headingIndex >= 0) lines = lines.slice(headingIndex + 1);

    const content = normalizeWhitespace(repairHyphenation(lines.join(" ")));

    sections.push({
      title: current.title,
      level: current.level,
      sectionPath: current.path,
      content,
      sourcePageStart: startPage,
      sourcePageEnd: endPage,
      printedPageStart: current.printedPage,
      printedPageEnd: nextBoundary?.printedPage
        ? Math.max(current.printedPage, nextBoundary.printedPage - 1)
        : null,
      segmentationSource: "pdf-toc",
    });
  }

  return sections.length >= 3 ? sections : null;
}

function isGenericOutlineTitle(title) {
  return /^(?:[íi]ndice|contenido|contents|table of contents|sumario|pr[oó]logo|prefacio|bibliograf[ií]a|referencias|índice analítico)$/i.test(
    cleanPdfLine(title)
  );
}

async function buildPdfOutlineSections(pdf, pageData) {
  const outline = await pdf.getOutline?.();
  if (!Array.isArray(outline) || !outline.length) return null;

  const entries = (await flattenPdfOutline(pdf, outline))
    .filter((item) => item.page && item.page >= 1 && item.page <= pageData.length)
    .filter((item) => !isGenericOutlineTitle(item.title));

  if (!entries.length) return null;

  // Prefer the shallowest outline level that produces several distinct
  // document boundaries. This generally corresponds to chapters/major sections,
  // not every tiny subsection.
  const levels = Array.from(new Set(entries.map((item) => item.level))).sort((a, b) => a - b);
  let selected = null;

  for (const level of levels) {
    const candidates = entries
      .filter((item) => item.level === level)
      .sort((a, b) => a.page - b.page);
    const uniquePages = Array.from(new Set(candidates.map((item) => item.page)));
    if (uniquePages.length >= 3) {
      selected = candidates;
      break;
    }
  }

  if (!selected) return null;

  const boundaries = [];
  for (const item of selected) {
    if (!boundaries.length || item.page > boundaries[boundaries.length - 1].page) {
      boundaries.push(item);
    }
  }

  if (boundaries.length < 2) return null;

  const repeatedFurniture = findRepeatedPageFurniture(pageData.map((page) => page.lines));
  const sections = [];

  for (let i = 0; i < boundaries.length; i += 1) {
    const current = boundaries[i];
    const next = boundaries[i + 1];
    const startPage = current.page;
    const endPage = next ? Math.min(pageData.length, next.page - 1) : pageData.length;
    if (endPage < startPage) continue;

    let lines = pageData
      .slice(startPage - 1, endPage)
      .flatMap((page) => page.lines)
      .map(cleanPdfLine)
      .filter(Boolean)
      .filter((line) => !isNoiseLine(line, repeatedFurniture));

    const headingIndex = lines.findIndex(
      (line) => normalizedKey(line) === normalizedKey(current.title)
    );
    if (headingIndex >= 0) lines = lines.slice(headingIndex + 1);

    const content = normalizeWhitespace(repairHyphenation(lines.join(" ")));
    if (!content) continue;

    sections.push({
      title: current.title,
      level: current.level,
      sectionPath: Array.isArray(current.path) ? current.path : [current.title],
      content,
      sourcePageStart: startPage,
      sourcePageEnd: endPage,
      segmentationSource: "pdf-outline",
    });
  }

  return sections.length >= 2 ? sections : null;
}

function buildPdfSections(pageData) {
  const repeatedFurniture = findRepeatedPageFurniture(pageData.map((page) => page.lines));
  const sections = [];
  let path = [];
  let current = null;

  function flush() {
    if (!current) return;
    const content = normalizeWhitespace(current.lines.join(" "));
    if (content) {
      sections.push({
        title: current.title || path[path.length - 1] || "Material general",
        level: current.level || (path.length || 1),
        sectionPath: current.path.length ? current.path.slice() : ["Material general"],
        content,
        sourcePageStart: current.sourcePageStart,
        sourcePageEnd: current.sourcePageEnd,
      });
    }
    current = null;
  }

  for (const page of pageData) {
    let meaningful = page.lines
      .map(cleanPdfLine)
      .filter(Boolean);

    meaningful = meaningful.filter((line) => !isNoiseLine(line, repeatedFurniture));

    for (const line of meaningful) {
      const heading = headingInfo(line);
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
          sourcePageStart: page.pageNumber,
          sourcePageEnd: page.pageNumber,
        };
        continue;
      }

      if (!current) {
        current = {
          title: path[path.length - 1] || "Material general",
          level: path.length || 1,
          path: path.length ? path.slice() : ["Material general"],
          lines: [],
          sourcePageStart: page.pageNumber,
          sourcePageEnd: page.pageNumber,
        };
      }

      current.lines.push(line);
      current.sourcePageEnd = page.pageNumber;
    }
  }

  flush();

  return sections;
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

async function readPdf(file) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const lines = groupPdfItems(textContent.items);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      pageNumber,
      width: viewport.width,
      lines,
      tocRows: groupPdfRows(textContent.items),
    });
    page.cleanup?.();
  }

  if (!pages.some((page) => page.lines.length)) {
    await pdf.cleanup?.();
    await pdf.destroy?.();
    throw new Error("El PDF no contiene texto extraíble. Si es un escaneo de páginas, todavía hace falta OCR antes de incorporarlo a AULIA.");
  }

  // The book's own index is the primary structural source. The embedded PDF
  // outline is only a fallback when an index cannot be recovered.
  const tocSections = await buildPdfTocSections(pages);
  const outlineSections = tocSections ? null : await buildPdfOutlineSections(pdf, pages);
  const sections = tocSections || outlineSections || buildPdfSections(pages);

  await pdf.cleanup?.();
  await pdf.destroy?.();
  const documentId = makeDocumentId(file.name);
  const corpus = buildSectionFragments({
    sections,
    sourceName: file.name,
    documentId,
    sourcePageCount: pdf.numPages,
  });

  if (!corpus.length) {
    throw new Error("AULIA pudo abrir el PDF, pero no encontró unidades de contenido recuperables.");
  }

  return {
    corpus,
    bibliography: [],
    sourceName: file.name,
    pages: pdf.numPages,
    document: buildDocumentMeta({
      file,
      documentId,
      sections,
      pages: pdf.numPages,
      format: "pdf",
    }),
  };
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

export async function readMaterialFile(file) {
  const name = file.name || "material";
  const ext = name.toLowerCase().split(".").pop();
  const documentId = makeDocumentId(name);

  if (ext === "pdf") return readPdf(file);
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
