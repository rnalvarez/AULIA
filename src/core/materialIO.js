function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "fragmento";
}

function splitMarkdown(text, sourceName = "") {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const out = [];
  let title = "";
  let buffer = [];

  function flush() {
    const content = buffer.join("\n").trim();
    if (!content) return;
    out.push({ title: title || "Material", chapter: title, content, source: sourceName || undefined });
    buffer = [];
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { flush(); title = heading[1].trim(); }
    else buffer.push(line);
  }
  flush();
  return out.length ? out : [{ title: "Material", chapter: "", content: String(text ?? "").trim(), source: sourceName || undefined }];
}

function splitPlainText(text, sourceName = "") {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const out = [];
  let title = "";
  let buffer = [];

  function flush() {
    const content = buffer.join("\n").trim();
    if (!content) return;
    const parts = content.length > 2600
      ? (content.match(/[\s\S]{1,2400}(?:\s|$)/g) || [content])
      : [content];
    parts.forEach((part, i) => out.push({
      title: title ? (parts.length > 1 ? title + " · parte " + (i + 1) : title) : "Fragmento " + (out.length + 1),
      chapter: title,
      content: part.trim(),
      source: sourceName || undefined,
    }));
    buffer = [];
  }

  for (const line of lines) {
    const clean = line.trim();
    const isChapter = /^(CAP[ÍI]TULO|PARTE|UNIDAD|MÓDULO|MODULE|CHAPTER)\b/i.test(clean);
    const isHeading = clean.length > 3 && clean.length < 100 &&
      /^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 ·—:()'",.-]*$/.test(clean);
    if (isChapter || isHeading) { flush(); title = clean; }
    else buffer.push(line);
  }
  flush();
  return out.length ? out : [{ title: "Material", chapter: "", content: String(text ?? "").trim(), source: sourceName || undefined }];
}

function normalizeChunk(item, index, sourceName = "") {
  const content = String(item?.content || item?.text || "").trim();
  if (!content) return null;
  return {
    id: item.id || "fragmento-" + (index + 1) + "-" + slugify(item.title || item.chapter || "material"),
    title: item.title || item.chapter || "Fragmento " + (index + 1),
    chapter: item.chapter || "",
    content,
    ...(item.source || sourceName ? { source: item.source || sourceName } : {}),
    ...(item.sourcePage ? { sourcePage: item.sourcePage } : {}),
    ...(item.sourceBibliographyId ? { sourceBibliographyId: item.sourceBibliographyId } : {}),
  };
}

function groupPdfItems(items) {
  const lines = [];
  for (const item of items || []) {
    const text = String(item?.str || "").replace(/\s+/g, " ").trim();
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
    .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isLikelyHeading(line) {
  const clean = String(line || "").trim();
  if (!clean || clean.length > 120) return false;
  if (/^(CAP[ÍI]TULO|PARTE|UNIDAD|MÓDULO|MODULE|CHAPTER)\b/i.test(clean)) return true;
  const letters = (clean.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []);
  if (letters.length < 4) return false;
  const upper = (clean.match(/[A-ZÁÉÍÓÚÜÑ]/g) || []).length;
  return upper / letters.length >= 0.78 && clean.length <= 90;
}

function pdfPageToFragments(lines, pageNumber, sourceName) {
  const out = [];
  let title = "";
  let buffer = [];

  function flush() {
    const content = buffer.join("\n").trim();
    if (!content) return;
    const parts = content.length > 2600
      ? (content.match(/[\s\S]{1,2400}(?:\s|$)/g) || [content])
      : [content];
    parts.forEach((part, i) => out.push({
      title: title ? (parts.length > 1 ? title + " · parte " + (i + 1) : title) : "Página " + pageNumber,
      chapter: title,
      content: part.trim(),
      source: sourceName,
      sourcePage: pageNumber,
    }));
    buffer = [];
  }

  for (const line of lines) {
    if (isLikelyHeading(line)) { flush(); title = line; }
    else buffer.push(line);
  }
  flush();
  return out;
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
  const corpus = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const lines = groupPdfItems(textContent.items);
    corpus.push(...pdfPageToFragments(lines, pageNumber, file.name));
    page.cleanup?.();
  }

  await pdf.cleanup?.();
  await pdf.destroy?.();
  if (!corpus.length) {
    throw new Error("El PDF no contiene texto extraíble. Si es un escaneo de páginas, todavía hace falta OCR antes de incorporarlo a AULIA.");
  }

  return { corpus, bibliography: [], sourceName: file.name, pages: pdf.numPages };
}

async function readDocx(file) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: true,
    }
  );

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.value, "text/html");
  const fragments = [];
  let title = "";
  let buffer = [];

  function flush() {
    const content = buffer.join("\n").trim();
    if (!content) return;
    const parts = content.length > 2600
      ? (content.match(/[\s\S]{1,2400}(?:\s|$)/g) || [content])
      : [content];
    parts.forEach((part, i) => fragments.push({
      title: title ? (parts.length > 1 ? title + " · parte " + (i + 1) : title) : file.name,
      chapter: title,
      content: part.trim(),
      source: file.name,
    }));
    buffer = [];
  }

  for (const node of Array.from(doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li"))) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^H[1-6]$/i.test(node.tagName)) { flush(); title = text; }
    else buffer.push(text);
  }
  flush();

  return {
    corpus: fragments.length ? fragments : [{ title: file.name, chapter: "", content: result.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), source: file.name }],
    bibliography: [],
    sourceName: file.name,
    warnings: (result.messages || []).map((message) => message.message).filter(Boolean),
  };
}

export async function readMaterialFile(file) {
  const name = file.name || "material";
  const ext = name.toLowerCase().split(".").pop();

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
      };
    }

    const items = Array.isArray(data) ? data : Array.isArray(data?.corpus) ? data.corpus : null;
    if (items) {
      return {
        corpus: items.map((item, index) => normalizeChunk(item, index, name)).filter(Boolean),
        bibliography: Array.isArray(data?.bibliography) ? data.bibliography : [],
        sourceName: name,
      };
    }

    if (typeof data?.content === "string" || typeof data?.text === "string") {
      const fragments = splitPlainText(data.content || data.text, name).map((item, index) => normalizeChunk(item, index, name)).filter(Boolean);
      return { corpus: fragments, bibliography: Array.isArray(data?.bibliography) ? data.bibliography : [], sourceName: name };
    }

    throw new Error("El JSON no contiene corpus, content o text reconocibles.");
  }

  const fragments = ext === "md" || ext === "markdown"
    ? splitMarkdown(raw, name)
    : splitPlainText(raw, name);

  return {
    corpus: fragments.map((item, index) => normalizeChunk(item, index, name)).filter(Boolean),
    bibliography: [],
    sourceName: name,
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
