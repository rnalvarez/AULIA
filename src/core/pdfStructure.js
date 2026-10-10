const NOISE_TITLE_RE = /^(?:índice|indice|contenido|contents|table of contents|sumario|bibliografía|bibliografia|referencias|references|índice analítico|indice analitico)$/i;
const NUMBERING_RE = /^(\d+(?:\.\d+){0,8})[.)]?\s+(.+)$/;
const SECTION_WORD_RE = /^(?:PARTE|PART|CAP[ÍI]TULO|CHAPTER|UNIDAD|UNIT|MÓDULO|MODULE|SECCIÓN|SECTION|TEMA|LECCIÓN|LECCION|INTRODUCCIÓN|INTRODUCCION|CONCLUSIÓN|CONCLUSION|PREFACIO|PRÓLOGO|PROLOGO|APÉNDICE|APENDICE)\b/i;
const SENTENCE_END_RE = /[.!?;:]$/;
const PAGE_NUMBER_RE = /^(?:p(?:á|a)gina|page)?\s*[\-–—]?\s*\d{1,4}\s*[\-–—]?$/i;

function cleanPdfLine(value) {
  return String(value ?? "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function fontSizeFromItem(item) {
  const transform = Array.isArray(item?.transform) ? item.transform : [];
  const candidates = [
    Math.abs(Number(transform[3] || 0)),
    Math.abs(Number(transform[0] || 0)),
    Math.abs(Number(item?.height || 0)),
  ].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

function isBoldFont(fontName) {
  return /(?:bold|black|heavy|demi|semibold|medium|bd|negrita)/i.test(String(fontName || ""));
}

function joinPdfTextItems(parts) {
  let text = "";
  let previous = null;

  for (const item of parts || []) {
    const currentText = String(item?.text || "");
    if (!currentText) continue;

    if (previous) {
      const gap = Number(item.x || 0) - (Number(previous.x || 0) + Number(previous.width || 0));
      const fontSize = Math.max(1, Number(previous.fontSize || item.fontSize || 10));
      const threshold = Math.max(1.15, Math.min(2.8, fontSize * 0.15));
      const startsWithClosingPunctuation = /^[,.;:!?%\)\]\}»”’]/u.test(currentText);
      const endsWithOpeningPunctuation = /[(\[\{«“‘]$/u.test(text);
      if (gap > threshold && !startsWithClosingPunctuation && !endsWithOpeningPunctuation && !/\s$/.test(text)) {
        text += " ";
      }
    }

    text += currentText;
    previous = item;
  }

  return text.replace(/\s+/g, " ").trim();
}

function groupPdfItems(items, pageWidth = 0) {
  const normalized = [];
  for (const item of items || []) {
    const text = cleanPdfLine(item?.str || "");
    if (!text) continue;

    const transform = Array.isArray(item?.transform) ? item.transform : [];
    normalized.push({
      x: Number(transform[4] ?? 0),
      y: Number(transform[5] ?? 0),
      width: Math.max(0, Number(item?.width ?? 0)),
      height: Math.max(0, Number(item?.height ?? 0)),
      fontName: String(item?.fontName || ""),
      fontSize: fontSizeFromItem(item),
      text,
    });
  }

  const yBands = [];
  const tolerance = 3.2;
  for (const item of normalized.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let band = yBands.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (!band) {
      band = { y: item.y, items: [] };
      yBands.push(band);
    }
    band.items.push(item);
    band.y = band.items.reduce((sum, part) => sum + part.y, 0) / band.items.length;
  }

  const lines = [];
  for (const band of yBands.sort((a, b) => b.y - a.y)) {
    const sorted = band.items.slice().sort((a, b) => a.x - b.x);
    let group = [];
    const groups = [];

    const flush = () => {
      if (!group.length) return;
      groups.push(group);
      group = [];
    };

    for (let i = 0; i < sorted.length; i += 1) {
      const item = sorted[i];
      const previous = sorted[i - 1];

      if (previous) {
        const gap = item.x - (previous.x + previous.width);
        const previousTextIsNumber = /^\d{1,4}$/.test(previous.text);
        const itemIsNumber = /^\d{1,4}$/.test(item.text);
        const hugeGap = gap > Math.max(42, pageWidth * 0.12);
        const likelyColumnBreak = hugeGap &&
          !previousTextIsNumber &&
          !itemIsNumber &&
          sorted.length >= 5;

        if (likelyColumnBreak && !(item === sorted[sorted.length - 1] && /^\d{1,4}$/.test(item.text))) {
          flush();
        }
      }

      group.push(item);
    }
    flush();

    for (const parts of groups) {
      // PDF engines can split a word into several positioned glyph fragments.
      // Insert spaces only when the measured horizontal gap indicates a word boundary.
      const text = joinPdfTextItems(parts);
      if (!text) continue;
      const xMin = parts[0].x;
      const xMax = parts.reduce((max, part) => Math.max(max, part.x + part.width), xMin);
      const fontSizes = parts.map((part) => part.fontSize).filter(Boolean);
      const fontSize = fontSizes.length ? Math.max(...fontSizes) : 0;
      const boldRatio = parts.length
        ? parts.filter((part) => isBoldFont(part.fontName)).length / parts.length
        : 0;

      lines.push({
        text,
        xMin,
        xMax,
        width: Math.max(0, xMax - xMin),
        y: parts.reduce((sum, part) => sum + part.y, 0) / parts.length,
        fontSize,
        bold: boldRatio >= 0.55,
        boldRatio,
        fontNames: Array.from(new Set(parts.map((part) => part.fontName).filter(Boolean))),
        items: parts,
      });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y || a.xMin - b.xMin)
    .map((line, index) => ({ ...line, index }));
}

function detectPageColumns(lines, pageWidth) {
  const usable = (lines || [])
    .filter((line) => line.width > 0 && line.width < pageWidth * 0.72)
    .map((line) => line.xMin)
    .sort((a, b) => a - b);

  if (usable.length < 8 || !pageWidth) return { count: 1, anchors: [0] };

  let bestGap = 0;
  let bestIndex = -1;
  for (let i = 1; i < usable.length; i += 1) {
    const gap = usable[i] - usable[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestGap < pageWidth * 0.14) {
    return { count: 1, anchors: [usable[0]] };
  }

  const left = usable.slice(0, bestIndex);
  const right = usable.slice(bestIndex);
  if (left.length < 4 || right.length < 4) return { count: 1, anchors: [usable[0]] };

  return {
    count: 2,
    anchors: [
      left[Math.floor(left.length / 2)],
      right[Math.floor(right.length / 2)],
    ],
  };
}

function orderedPageLines(page) {
  const lines = page?.lines || [];
  const columns = page?.columns || { count: 1, anchors: [0] };
  if (columns.count !== 2) return lines.slice().sort((a, b) => b.y - a.y || a.xMin - b.xMin);

  const fullWidth = lines.filter((line) => line.width >= page.width * 0.72);
  const columnsLines = [[], []];

  for (const line of lines) {
    if (line.width >= page.width * 0.72) continue;
    const center = line.xMin + line.width / 2;
    const distances = columns.anchors.map((anchor) => Math.abs(center - anchor));
    const column = distances[0] <= distances[1] ? 0 : 1;
    columnsLines[column].push(line);
  }

  const topFull = fullWidth.filter((line) => line.y >= page.height * 0.70).sort((a, b) => b.y - a.y);
  const bottomFull = fullWidth.filter((line) => line.y < page.height * 0.25).sort((a, b) => b.y - a.y);

  return [
    ...topFull,
    ...columnsLines[0].sort((a, b) => b.y - a.y || a.xMin - b.xMin),
    ...columnsLines[1].sort((a, b) => b.y - a.y || a.xMin - b.xMin),
    ...bottomFull,
  ];
}

function styleKey(line) {
  const size = Number(line?.fontSize || 0);
  const bucket = size ? Math.round(size * 2) / 2 : 0;
  const bold = line?.bold ? "b" : "n";
  const font = String(line?.fontNames?.[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 28);
  return [font, bucket, bold].join("|");
}

function countStructuralRoles(node) {
  if (!node) return 0;
  let count = 0;
  const role = String(node?.role || node?.type || "");
  if (/^H[1-6]$/i.test(role)) count += 1;
  for (const child of node?.children || []) count += countStructuralRoles(child);
  return count;
}

function findRepeatedFurniture(pages) {
  const counts = new Map();
  const pageTotal = Math.max(1, pages.length);

  for (const page of pages) {
    const lines = page.lines || [];
    const candidates = [
      ...lines.filter((line) => line.y >= page.height * 0.86).slice(0, 3),
      ...lines.filter((line) => line.y <= page.height * 0.12).slice(-3),
    ];

    for (const line of candidates) {
      const text = cleanPdfLine(line.text);
      if (!text || text.length > 120 || PAGE_NUMBER_RE.test(text)) continue;
      const key = normalizedKey(text);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= Math.max(2, Math.ceil(pageTotal * 0.45)))
      .map(([key]) => key)
  );
}

function isNoiseLine(line, repeatedFurniture = new Set()) {
  const clean = cleanPdfLine(line?.text ?? line);
  if (!clean) return true;
  const key = normalizedKey(clean);
  if (repeatedFurniture.has(key)) return true;
  if (PAGE_NUMBER_RE.test(clean)) return true;
  if (/^[-–—]?\s*\d+\s*[-–—]?$/.test(clean)) return true;
  return false;
}

function numberingInfo(title) {
  const match = cleanPdfLine(title).match(NUMBERING_RE);
  if (!match) return null;
  return {
    number: match[1],
    level: Math.min(match[1].split(".").length, 8),
  };
}

function pageText(page, repeatedFurniture = new Set()) {
  return orderedPageLines(page)
    .map((line) => cleanPdfLine(line.text))
    .filter((line) => line && !isNoiseLine(line, repeatedFurniture));
}

function paragraphLike(line) {
  const text = cleanPdfLine(line.text);
  if (!text || text.length > 150) return true;
  if (SENTENCE_END_RE.test(text)) return true;
  if (text.split(/\s+/).length > 20) return true;
  const numbered = numberingInfo(text);
  if (/^(?:[-•▪◦]|\(?\d+[.)]|[A-Z][.)])\s+/.test(text) && !numbered) return true;
  return false;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coreTitle(value) {
  return normalizedKey(
    String(value || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[\u2020\u2021*]+/g, " ")
      .replace(/[“”"']/g, " ")
  );
}

function buildMultiLineHeadingCandidates(page, lines, bodySize, repeatedFurniture) {
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index];
    const firstText = cleanPdfLine(first.text);
    if (!firstText || isNoiseLine(first, repeatedFurniture) || paragraphLike(first)) continue;

    const firstNumbered = numberingInfo(firstText);
    const firstSectionWord = SECTION_WORD_RE.test(firstText);
    const firstSizeRatio = first.fontSize && bodySize ? first.fontSize / bodySize : 1;
    const firstStrong =
      Boolean(firstNumbered) ||
      firstSectionWord ||
      first.bold ||
      firstSizeRatio >= 1.18;
    if (!firstStrong) continue;

    const group = [first];
    let cursor = index + 1;

    while (cursor < lines.length && group.length < 4) {
      const next = lines[cursor];
      const text = cleanPdfLine(next.text);
      if (!text || isNoiseLine(next, repeatedFurniture) || paragraphLike(next)) break;

      const gap = Math.abs(Number(group[group.length - 1].y || 0) - Number(next.y || 0));
      const sameLeft = Math.abs(Number(first.xMin || 0) - Number(next.xMin || 0)) <= 18;
      const sameStyle = styleKey(first) === styleKey(next);
      const sizeCompatible =
        !first.fontSize ||
        !next.fontSize ||
        Math.abs(first.fontSize - next.fontSize) / Math.max(first.fontSize, next.fontSize) <= 0.12;
      const nextSizeRatio = next.fontSize && bodySize ? next.fontSize / bodySize : 1;
      const nextStrong =
        Boolean(numberingInfo(text)) ||
        SECTION_WORD_RE.test(text) ||
        next.bold ||
        nextSizeRatio >= 1.18;

      if (
        gap > Math.max(16, Math.max(first.fontSize || 0, next.fontSize || 0) * 0.95) ||
        !sameLeft ||
        !sameStyle ||
        !sizeCompatible ||
        !nextStrong ||
        text.length > 90
      ) break;

      group.push(next);
      cursor += 1;
    }

    if (group.length < 2) continue;

    const title = group.map((line) => cleanPdfLine(line.text)).join(" ").replace(/\s+/g, " ").trim();
    if (!title || title.length > 150) continue;

    const topRatio = page.height ? 1 - (first.y / page.height) : 0.5;
    const sizeRatio = first.fontSize && bodySize ? first.fontSize / bodySize : 1;
    let score = 8 + Math.min(4, (group.length - 1) * 2);
    if (first.bold) score += 2;
    if (sizeRatio >= 1.22) score += 2;
    if (sizeRatio >= 1.38) score += 2;
    if (topRatio <= 0.22) score += 2;
    if (!SENTENCE_END_RE.test(title)) score += 1;
    if (title.length <= 85) score += 1;

    output.push({
      pageNumber: page.pageNumber,
      lineIndex: index,
      endLineIndex: index + group.length - 1,
      title,
      level: numberingInfo(title)?.level || 1,
      number: numberingInfo(title)?.number || "",
      score,
      confidence: Math.max(0.62, Math.min(0.995, 0.50 + score * 0.04)),
      styleKey: styleKey(first),
      evidence: ["bloque de título multilinea", "geometría y tipografía"],
    });

    index = cursor - 1;
  }

  return output;
}

function detectHeadingCandidates(pages, repeatedFurniture, minPage = 1) {
  const candidates = [];
  const styleUse = new Map();

  for (const page of pages) {
    const lines = orderedPageLines(page);
    const bodySizes = lines
      .filter((line) => !isNoiseLine(line, repeatedFurniture))
      .map((line) => line.fontSize)
      .filter((size) => size > 0);
    const bodySize = median(bodySizes) || 10;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const text = cleanPdfLine(line.text);
      if (!text || page.pageNumber < minPage || isNoiseLine(line, repeatedFurniture)) continue;
      if (NOISE_TITLE_RE.test(text) || paragraphLike(line)) continue;

      const numbered = numberingInfo(text);
      const sectionWord = SECTION_WORD_RE.test(text);
      const previous = lines[index - 1];
      const next = lines[index + 1];
      const beforeGap = previous ? Math.max(0, previous.y - line.y) : 0;
      const afterGap = next ? Math.max(0, line.y - next.y) : 0;
      const topRatio = page.height ? 1 - (line.y / page.height) : 0.5;
      const sizeRatio = line.fontSize && bodySize ? line.fontSize / bodySize : 1;

      let score = 0;
      const evidence = [];

      if (numbered) { score += 4; evidence.push("numeración"); }
      if (sectionWord) { score += 4; evidence.push("palabra estructural"); }
      if (line.bold) { score += 2; evidence.push("tipografía destacada"); }
      if (sizeRatio >= 1.22) { score += 2; evidence.push("tamaño mayor"); }
      if (sizeRatio >= 1.38) { score += 2; evidence.push("tamaño claramente mayor"); }
      if (topRatio <= 0.22) { score += 2; evidence.push("inicio de página"); }
      if (beforeGap >= Math.max(line.fontSize * 1.4, 10)) { score += 2; evidence.push("espacio superior"); }
      if (afterGap >= Math.max(line.fontSize * 0.9, 7)) { score += 1; evidence.push("espacio inferior"); }
      if (!SENTENCE_END_RE.test(text)) { score += 1; evidence.push("forma de título"); }
      if (text.length <= 85) score += 1;

      const uppercaseRatio = (() => {
        const letters = text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || [];
        if (letters.length < 5) return 0;
        const upper = text.match(/[A-ZÁÉÍÓÚÜÑ]/g) || [];
        return upper.length / letters.length;
      })();

      if (uppercaseRatio >= 0.82 && text.length <= 85 && topRatio <= 0.32) {
        score += 1;
        evidence.push("composición destacada");
      }

      if (topRatio >= 0.78 && page.pageNumber > minPage && !numbered && !sectionWord) score -= 4;
      if (text.includes("©") || /\b(?:issn|isbn|doi|www\.|http)/i.test(text)) score -= 5;

      const structuralSignal =
        Boolean(numbered) ||
        sectionWord ||
        (sizeRatio >= 1.22 && (line.bold || beforeGap >= Math.max(line.fontSize * 1.4, 10))) ||
        (topRatio <= 0.22 && (line.bold || sizeRatio >= 1.18));

      if (score < 7 || !structuralSignal) continue;

      const candidate = {
        pageNumber: page.pageNumber,
        lineIndex: index,
        endLineIndex: index,
        title: text,
        level: numbered?.level || (sectionWord ? 1 : 2),
        number: numbered?.number || "",
        score,
        confidence: Math.max(0, Math.min(0.99, 0.42 + score * 0.045)),
        styleKey: styleKey(line),
        evidence,
      };

      styleUse.set(candidate.styleKey, (styleUse.get(candidate.styleKey) || 0) + 1);
      candidates.push(candidate);
    }

    candidates.push(...buildMultiLineHeadingCandidates(page, lines, bodySize, repeatedFurniture));
  }

  const consistentStyles = new Set(
    Array.from(styleUse.entries())
      .filter(([, count]) => count >= 3)
      .map(([key]) => key)
  );

  return candidates.map((candidate) => {
    if (!consistentStyles.has(candidate.styleKey)) return candidate;
    return {
      ...candidate,
      score: candidate.score + 2,
      confidence: Math.max(candidate.confidence, Math.min(0.995, candidate.confidence + 0.08)),
      evidence: [...candidate.evidence, "estilo consistente"],
    };
  });
}

function parseTocLine(line, pageCount, pageWidth) {
  const clean = cleanPdfLine(line?.text || "");
  if (!clean || clean.length > 180) return null;

  const dotted = clean.match(/^(.+?)(?:\.{2,}|·{2,}|…{2,})\s*(\d{1,4})$/);
  const terminal = clean.match(/^(.+?)\s+(\d{1,4})$/);
  const match = dotted || terminal;
  if (!match) return null;

  const printedPage = Number(match[2]);
  const title = cleanPdfLine(
    match[1]
      .replace(/\.{2,}\s*$/, "")
      .replace(/·{2,}\s*$/, "")
      .replace(/…{2,}\s*$/, "")
  );

  if (
    !title ||
    title.length < 3 ||
    printedPage < 1 ||
    printedPage > Math.max(pageCount, 5000) ||
    NOISE_TITLE_RE.test(title)
  ) return null;

  const lastItem = line?.items?.[line.items.length - 1];
  const pageNumberAtRight = pageWidth
    ? Number(lastItem?.x || 0) >= pageWidth * 0.58
    : true;

  if (!dotted && !pageNumberAtRight) return null;
  if (SENTENCE_END_RE.test(title) && !/^\d+(?:\.\d+)*\s+/.test(title)) return null;

  const numbered = numberingInfo(title);
  const sectionWord = SECTION_WORD_RE.test(title);

  return {
    title,
    printedPage,
    level: numbered?.level || (sectionWord ? 1 : 2),
    number: numbered?.number || "",
    xMin: Number(line?.xMin || 0),
    tocLine: clean,
  };
}

function tocPageScore(page) {
  const rows = orderedPageLines(page);
  let candidates = 0;
  let dotted = 0;
  let numbered = 0;

  for (const row of rows) {
    const parsed = parseTocLine(row, page?.pageCount || 9999, page?.width || 0);
    if (!parsed) continue;
    candidates += 1;
    if (/\.{2,}|·{2,}|…{2,}/.test(row.text)) dotted += 1;
    if (parsed.number) numbered += 1;
  }

  const density = candidates / Math.max(1, rows.length);
  return candidates * 2 + density * 10 + dotted * 1.5 + numbered;
}

function findTocWindow(pages) {
  let indexPage = -1;

  for (let i = 0; i < Math.min(pages.length, 60); i += 1) {
    const text = pages[i].lines.map((line) => line.text).join(" ");
    if (/\b(?:índice|indice|contenido|contents|table of contents|sumario)\b/i.test(text)) {
      indexPage = i;
      break;
    }
  }

  if (indexPage < 0) return null;

  let bestPage = -1;
  let bestScore = 0;
  const scanEnd = Math.min(pages.length, indexPage + 50);

  for (let i = indexPage; i < scanEnd; i += 1) {
    const score = tocPageScore(pages[i]);
    if (score > bestScore) {
      bestScore = score;
      bestPage = i;
    }
  }

  if (bestPage < 0 || bestScore < 10) return null;

  let end = bestPage;
  let quiet = 0;
  for (let i = bestPage; i < scanEnd; i += 1) {
    const score = tocPageScore(pages[i]);
    if (score >= 6) {
      end = i;
      quiet = 0;
    } else {
      quiet += 1;
      if (quiet >= 2) break;
    }
  }

  return {
    start: indexPage,
    end: end + 1,
    confidence: Math.min(0.99, 0.55 + bestScore / 80),
  };
}

function titleSimilarity(a, b) {
  const na = coreTitle(a);
  const nb = coreTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokensA = new Set(na.split(" ").filter((token) => token.length >= 3));
  const tokensB = new Set(nb.split(" ").filter((token) => token.length >= 3));
  if (!tokensA.size || !tokensB.size) return 0;

  const intersection = Array.from(tokensA).filter((token) => tokensB.has(token)).length;
  if (!intersection) return 0;

  const shorter = Math.min(tokensA.size, tokensB.size);
  const containment = intersection / shorter;
  const coverageA = intersection / tokensA.size;
  const coverageB = intersection / tokensB.size;

  if (containment === 1 && shorter >= 2) return 0.93;
  return Math.max(coverageA * 0.62 + coverageB * 0.18, containment * 0.84);
}

function findBestHeadingPage(entry, headingCandidates, minPage, estimatedPage) {
  const target = Number(estimatedPage || minPage);
  const candidates = headingCandidates
    .filter((candidate) => candidate.pageNumber >= minPage)
    .map((candidate) => {
      const similarity = titleSimilarity(candidate.title, entry.title);
      const numberBonus = entry.number && candidate.number === entry.number ? 0.22 : 0;
      const proximity = Math.abs(candidate.pageNumber - target);
      const proximityBonus = Math.max(0, 0.18 - proximity * 0.004);
      const score = similarity * 0.62 + numberBonus + proximityBonus + candidate.confidence * 0.16;
      return { candidate, score, similarity };
    })
    .filter((item) => item.similarity >= 0.84)
    .sort((a, b) => b.score - a.score);

  return candidates[0] || null;
}

function inferIndentLevels(entries) {
  const xs = entries
    .filter((entry) => !entry.number && Number.isFinite(entry.xMin))
    .map((entry) => entry.xMin)
    .sort((a, b) => a - b);

  const anchors = [];
  for (const x of xs) {
    if (!anchors.length || Math.abs(x - anchors[anchors.length - 1]) > 14) {
      anchors.push(x);
    }
  }

  return entries.map((entry) => {
    if (entry.number || !anchors.length || !Number.isFinite(entry.xMin)) return entry;
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
      level: Math.max(1, Math.min(8, nearest + 1)),
      inferredLevel: Math.max(1, Math.min(8, nearest + 1)),
    };
  });
}

function buildHierarchy(entries) {
  const stack = [];
  let activeGroup = "";

  return entries.map((entry) => {
    if (entry.tocGroup) {
      activeGroup = entry.tocGroup;
      stack[0] = activeGroup;
    }

    const requestedLevel = Number(entry.level || 1);
    const level = entry.tocGroup
      ? Math.max(2, Math.min(8, requestedLevel))
      : Math.max(1, Math.min(8, requestedLevel));

    stack.length = Math.max(0, level - 1);
    stack[level - 1] = entry.title;
    stack.length = level;

    return {
      ...entry,
      level,
      path: stack.filter(Boolean),
    };
  });
}

function extractOffset(mappedEntries) {
  const offsets = mappedEntries
    .filter((entry) => Number.isFinite(entry.physicalPage))
    .map((entry) => entry.physicalPage - entry.printedPage);
  return median(offsets) ?? 0;
}

function lineIndexForCandidate(page, title) {
  const lines = orderedPageLines(page);
  let bestIndex = -1;
  let bestScore = 0;
  lines.forEach((line, index) => {
    const score = titleSimilarity(line.text, title);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= 0.84 ? bestIndex : -1;
}

function buildSectionsFromBoundaries(pages, boundaries, repeatedFurniture, source, totalPrintedOffset = 0) {
  const sections = [];
  const normalized = boundaries
    .filter(Boolean)
    .sort((a, b) => a.page - b.page || a.lineIndex - b.lineIndex);

  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const next = normalized[i + 1];

    const startPage = Math.max(1, Math.min(pages.length, current.page));

    // A structural section runs until the next sibling or ancestor. Child
    // headings must not truncate their parent section boundary.
    let boundary = null;
    if (next) {
      for (let j = i + 1; j < normalized.length; j += 1) {
        if (Number(normalized[j].level || 1) <= Number(current.level || 1)) {
          boundary = normalized[j];
          break;
        }
      }
    }

    const endPage = boundary
      ? (
          boundary.page === startPage
            ? startPage
            : Math.max(startPage, Math.min(pages.length, boundary.page - 1))
        )
      : pages.length;

    const contentLines = [];
    for (let pageNo = startPage; pageNo <= endPage; pageNo += 1) {
      const page = pages[pageNo - 1];
      const lines = orderedPageLines(page);
      let startIndex = pageNo === startPage
        ? Math.max(0, (current.endLineIndex ?? current.lineIndex ?? -1) + 1)
        : 0;
      let endIndex = pageNo === endPage && boundary && boundary.page === pageNo
        ? Math.max(startIndex, boundary.lineIndex ?? boundary.endLineIndex ?? lines.length)
        : lines.length;

      for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!isNoiseLine(line, repeatedFurniture)) contentLines.push(cleanPdfLine(line.text));
      }
    }

    const content = contentLines.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!content && !current.allowEmpty) continue;

    sections.push({
      title: current.title,
      level: current.level || 1,
      sectionPath: Array.isArray(current.path) ? current.path : [current.title],
      content,
      sourcePageStart: startPage,
      sourcePageEnd: endPage,
      ...(current.printedPage
        ? { printedPageStart: current.printedPage }
        : {}),
      ...(boundary?.printedPage
        ? { printedPageEnd: Math.max(current.printedPage || boundary.printedPage, boundary.printedPage - 1) }
        : {}),
      segmentationSource: source,
      confidence: Number(current.confidence || 0.5),
      evidence: Array.from(new Set(current.evidence || [])),
      ...(current.childrenCount ? { childrenCount: current.childrenCount } : {}),
      ...(current.structuralOnly ? { structuralOnly: true } : {}),
    });
  }

  return sections;
}

function hierarchyChildrenCount(entries) {
  const counts = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const current = entries[i];
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[j].level <= current.level) break;
      if (entries[j].level === current.level + 1) {
        counts.set(i, (counts.get(i) || 0) + 1);
      }
      break;
    }
  }
  return counts;
}

async function resolveOutlinePage(pdf, destination) {
  try {
    const dest = typeof destination === "string"
      ? await pdf.getDestination(destination)
      : destination;
    const ref = Array.isArray(dest) ? dest[0] : null;
    if (!ref) return null;
    const pageIndex = await pdf.getPageIndex(ref);
    return Number.isFinite(pageIndex) ? pageIndex + 1 : null;
  } catch {
    return null;
  }
}

async function flattenOutline(pdf, items, level = 1, path = [], output = []) {
  for (const item of items || []) {
    const title = cleanPdfLine(item?.title || "");
    if (!title || NOISE_TITLE_RE.test(title)) continue;

    const page = await resolveOutlinePage(pdf, item?.dest);
    const nextPath = [...path, title];
    output.push({ title, level, path: nextPath, page });

    if (Array.isArray(item?.items) && item.items.length) {
      await flattenOutline(pdf, item.items, level + 1, nextPath, output);
    }
  }
  return output;
}

async function buildOutlineBoundaries(pdf, pages, headingCandidates) {
  const outline = await pdf.getOutline?.();
  if (!Array.isArray(outline) || !outline.length) return null;

  const entries = (await flattenOutline(pdf, outline))
    .filter((entry) => Number.isFinite(entry.page) && entry.page >= 1 && entry.page <= pages.length);

  if (entries.length < 2) return null;

  const mapped = entries.map((entry) => {
    const candidate = findBestHeadingPage(entry, headingCandidates, 1, entry.page);
    const physicalPage = candidate?.candidate?.pageNumber || entry.page;
    const lineIndex = candidate?.candidate?.lineIndex ?? lineIndexForCandidate(pages[physicalPage - 1], entry.title);
    return {
      ...entry,
      page: physicalPage,
      lineIndex: lineIndex >= 0 ? lineIndex : 0,
      endLineIndex: candidate?.candidate?.endLineIndex ?? (lineIndex >= 0 ? lineIndex : 0),
      confidence: candidate
        ? Math.max(0.76, Math.min(0.99, candidate.score))
        : 0.72,
      evidence: candidate ? [...candidate.candidate.evidence, "marcador PDF"] : ["marcador PDF"],
    };
  });

  const ordered = [];
  for (const entry of mapped) {
    if (!ordered.length || entry.page > ordered[ordered.length - 1].page || (entry.page === ordered[ordered.length - 1].page && entry.lineIndex >= ordered[ordered.length - 1].lineIndex)) {
      ordered.push(entry);
    }
  }
  if (ordered.length < 2) return null;

  const withHierarchy = buildHierarchy(ordered);
  const childCounts = hierarchyChildrenCount(withHierarchy);

  const boundaries = withHierarchy.map((entry, index) => ({
    ...entry,
    printedPage: null,
    childrenCount: childCounts.get(index) || 0,
  }));

  return {
    boundaries,
    confidence: median(boundaries.map((entry) => entry.confidence)) || 0.7,
  };
}

async function buildTocBoundaries(pdf, pages, headingCandidates) {
  const toc = findTocWindow(pages);
  if (!toc) return null;

  const entries = [];
  for (let pageIndex = toc.start; pageIndex < toc.end; pageIndex += 1) {
    const page = pages[pageIndex];
    for (const line of orderedPageLines(page)) {
      const parsed = parseTocLine(line, pages.length, page.width);
      if (!parsed) continue;

      const duplicate = entries.some(
        (entry) => entry.title === parsed.title && entry.printedPage === parsed.printedPage
      );
      if (!duplicate) entries.push({ ...parsed, tocPage: pageIndex + 1 });
    }
  }

  if (entries.length < 3) return null;

  const enriched = buildHierarchy(inferIndentLevels(entries));
  const bodyMinPage = toc.end + 1;
  const mapped = enriched.map((entry) => {
    const target = Math.max(bodyMinPage, Math.min(pages.length, entry.printedPage));
    const match = findBestHeadingPage(entry, headingCandidates, bodyMinPage, target);
    return {
      ...entry,
      physicalPage: match?.candidate?.pageNumber || null,
      lineIndex: match?.candidate?.lineIndex ?? -1,
      endLineIndex: match?.candidate?.endLineIndex ?? (match?.candidate?.lineIndex ?? -1),
      matchScore: match?.score || 0,
      confidence: match
        ? Math.max(0.72, Math.min(0.995, match.score))
        : 0.58,
      evidence: match
        ? ["índice del documento", ...match.candidate.evidence]
        : ["índice del documento", "paginación estimada; encabezado no confirmado"],
    };
  });

  const offset = extractOffset(mapped);
  const remapped = mapped.map((entry) => {
    const fallbackPage = Math.max(bodyMinPage, Math.min(pages.length, Math.round(entry.printedPage + offset)));
    return {
      ...entry,
      page: entry.physicalPage || fallbackPage,
      lineIndex: entry.lineIndex >= 0 ? entry.lineIndex : lineIndexForCandidate(pages[(entry.physicalPage || fallbackPage) - 1], entry.title),
    };
  });

  // Never turn an unconfirmed TOC page estimate into a structural boundary.
  // A title must be located in the body with a real heading candidate. Otherwise
  // we fall back to another structural source instead of inventing a section.
  const confirmed = remapped.filter(
    (entry) => entry.page >= bodyMinPage && Number.isFinite(entry.physicalPage) && entry.confidence >= 0.72
  );

  if (confirmed.length < Math.max(3, Math.ceil(remapped.length * 0.55))) return null;

  const ordered = [];
  for (const entry of remapped) {
    if (!Number.isFinite(entry.physicalPage) || entry.confidence < 0.72) continue;
    const lineIndex = entry.lineIndex >= 0 ? entry.lineIndex : 0;
    if (!ordered.length || entry.page > ordered[ordered.length - 1].page || (entry.page === ordered[ordered.length - 1].page && lineIndex >= ordered[ordered.length - 1].lineIndex)) {
      ordered.push({ ...entry, lineIndex });
    }
  }

  if (ordered.length < 3) return null;

  const hierarchy = buildHierarchy(ordered);
  const childCounts = hierarchyChildrenCount(hierarchy);

  const boundaries = hierarchy.map((entry, index) => ({
    ...entry,
    childrenCount: childCounts.get(index) || 0,
  }));

  return {
    boundaries,
    toc,
    confidence: Math.min(
      0.99,
      Math.max(0.65, (toc.confidence + (median(boundaries.map((entry) => entry.confidence)) || 0.65)) / 2)
    ),
  };
}

function buildHeuristicBoundaries(pages, headingCandidates, minPage) {
  const candidates = headingCandidates
    .filter((candidate) => candidate.pageNumber >= minPage && candidate.score >= 9)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex);

  if (candidates.length < 2) return null;

  const strongNumbered = candidates.filter((candidate) => candidate.number);
  const selected = strongNumbered.length >= 2 ? candidates.filter((candidate) => candidate.number || candidate.score >= 12) : candidates;

  const deduped = [];
  for (const candidate of selected) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.pageNumber === candidate.pageNumber && Math.abs(previous.lineIndex - candidate.lineIndex) <= 1) {
      if (candidate.score > previous.score) deduped[deduped.length - 1] = candidate;
      continue;
    }
    deduped.push(candidate);
  }

  if (deduped.length < 2) return null;

  const hierarchy = buildHierarchy(
    deduped.map((candidate) => ({
      ...candidate,
      title: candidate.title,
      page: candidate.pageNumber,
      lineIndex: candidate.lineIndex,
    }))
  );

  return {
    boundaries: hierarchy.map((entry) => ({
      ...entry,
      confidence: Math.max(0.55, Math.min(0.92, entry.confidence)),
      evidence: [...entry.evidence, "análisis tipográfico y geométrico"],
    })),
    confidence: Math.min(0.92, Math.max(0.58, median(deduped.map((candidate) => candidate.confidence)) || 0.6)),
  };
}

function guessDocumentType(pages, tocDetected, outlineDetected) {
  const total = pages.length;
  const firstPages = pages.slice(0, Math.min(8, total));
  const text = firstPages.flatMap((page) => page.lines.map((line) => line.text)).join(" ");
  const longLines = pages.flatMap((page) => page.lines).filter((line) => line.text.length > 90).length;
  const shortLineRatio = pages.reduce((sum, page) => sum + page.lines.length, 0)
    ? pages.reduce((sum, page) => sum + page.lines.filter((line) => line.text.length <= 70).length, 0) /
      pages.reduce((sum, page) => sum + page.lines.length, 0)
    : 0;

  if (tocDetected || outlineDetected) {
    if (/\b(?:tesis|disertación|doctoral|maestría|universidad)\b/i.test(text)) return "tesis / trabajo académico";
    return total >= 25 ? "libro / monografía" : "documento estructurado";
  }

  if (/\b(?:abstract|resumen|keywords|palabras clave|doi)\b/i.test(text) && longLines > 5) {
    return "artículo académico";
  }

  if (shortLineRatio > 0.62 && total <= 40) return "apunte / documento breve";
  return "documento sin estructura explícita";
}

export async function analyzePdfStructure({ pdf, pages, structTreePages = 0 }) {
  const totalPages = pages.length;
  for (const page of pages) {
    page.columns = detectPageColumns(page.lines, page.width);
    page.readingLines = orderedPageLines(page);
    page.pageCount = totalPages;
  }

  const repeatedFurniture = findRepeatedFurniture(pages);
  const headingCandidates = detectHeadingCandidates(pages, repeatedFurniture, 1);
  // A conservative fallback must never silently discard the first part of
  // the uploaded document. Front matter can be identified separately later;
  // until then, keep page 1 as the source of truth.
  const bodyPage = 1;

  const tocResult = await buildTocBoundaries(pdf, pages, headingCandidates);
  const outlineResult = tocResult ? null : await buildOutlineBoundaries(pdf, pages, headingCandidates);
  const fallbackStart = tocResult?.toc?.end + 1 || bodyPage;
  const heuristicResult = tocResult || outlineResult ? null : buildHeuristicBoundaries(pages, headingCandidates, fallbackStart);

  let sourceResult = tocResult || outlineResult || heuristicResult;
  let source = tocResult ? "pdf-toc" : outlineResult ? "pdf-outline" : heuristicResult ? "pdf-hybrid-heuristic" : "pdf-conservative";

  if (!sourceResult) {
    const lines = pages.flatMap((page) => pageText(page, repeatedFurniture));
    sourceResult = {
      boundaries: [{
        title: "Material general",
        level: 1,
        path: ["Material general"],
        page: bodyPage,
        lineIndex: 0,
        confidence: 0.34,
        evidence: ["no se encontró una estructura suficientemente confiable"],
        allowEmpty: false,
      }],
      confidence: 0.34,
    };
  }

  const sections = sourceResult.boundaries.length === 1 && sourceResult.boundaries[0].title === "Material general"
    ? [{
        title: "Material general",
        level: 1,
        sectionPath: ["Material general"],
        content: pages
          .slice(bodyPage - 1)
          .flatMap((page) => pageText(page, repeatedFurniture))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        sourcePageStart: bodyPage,
        sourcePageEnd: totalPages,
        segmentationSource: source,
        confidence: 0.34,
        evidence: sourceResult.boundaries[0].evidence,
      }]
    : buildSectionsFromBoundaries(pages, sourceResult.boundaries, repeatedFurniture, source);

  const tocDetected = Boolean(tocResult);
  const outlineDetected = Boolean(outlineResult);
  const columnCounts = pages.map((page) => page.columns?.count || 1);
  const twoColumnPages = columnCounts.filter((count) => count === 2).length;
  const oneColumnPages = columnCounts.filter((count) => count === 1).length;

  const warnings = [];
  const lowConfidence = sections.filter((section) => Number(section.confidence || 0) < 0.62);

  if (!tocDetected && !outlineDetected && sections.length > 1) {
    warnings.push("La estructura se reconstruyó mediante evidencias tipográficas y geométricas; no se encontró un índice o marcador PDF suficientemente fiable.");
  }
  if (tocResult && sections.some((section) => Number(section.confidence || 0) < 0.72)) {
    warnings.push("Algunas entradas del índice no pudieron contrastarse con un encabezado real del cuerpo y fueron descartadas como límites estructurales.");
  }
  if (twoColumnPages > 0 && oneColumnPages > 0) {
    warnings.push("El documento combina páginas de una y dos columnas; AULIA adaptó el orden de lectura por página.");
  }
  if (lowConfidence.length) {
    warnings.push(`${lowConfidence.length} sección(es) presentan una confianza de segmentación baja y conviene revisarlas antes de trabajar pedagógicamente con ellas.`);
  }
  if (structTreePages > 0) {
    warnings.push("El PDF contiene estructura etiquetada; se utilizó como evidencia del relevamiento, pero no se tomó como única fuente porque su calidad puede variar entre archivos.");
  }

  const methodConfidence = Math.max(
    0.34,
    Math.min(
      0.99,
      (sourceResult.confidence || 0.34) * 0.72 +
      (tocDetected ? 0.15 : 0) +
      (outlineDetected ? 0.10 : 0) +
      (headingCandidates.length >= 4 ? 0.05 : 0) +
      (structTreePages > 0 ? 0.03 : 0)
    )
  );

  return {
    version: 2,
    method: source,
    documentType: guessDocumentType(pages, tocDetected, outlineDetected),
    confidence: methodConfidence,
    pageCount: totalPages,
    tocDetected,
    outlineDetected,
    structTreePages,
    repeatedFurnitureDetected: repeatedFurniture.size,
    columns: {
      one: oneColumnPages,
      two: twoColumnPages,
    },
    headingCandidates: headingCandidates.length,
    sectionCount: sections.length,
    lowConfidenceSections: lowConfidence.length,
    warnings,
    sections,
  };
}

export { groupPdfItems };
