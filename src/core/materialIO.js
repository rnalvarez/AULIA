function slugify(value) {
  return String(value ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "fragmento";
}

function splitMarkdown(text) {
  const lines = String(text ?? "").replace(/\\r/g, "").split("\\n");
  const out = [];
  let title = "";
  let buffer = [];
  const flush = () => {
    const content = buffer.join("\\n").trim();
    if (!content) return;
    out.push({ title: title || "Material", chapter: title, content });
    buffer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\\s+(.+)$/);
    if (heading) { flush(); title = heading[1].trim(); }
    else buffer.push(line);
  }
  flush();
  return out.length ? out : [{ title: "Material", chapter: "", content: String(text ?? "").trim() }];
}

function splitPlainText(text) {
  const lines = String(text ?? "").replace(/\\r/g, "").split("\\n");
  const out = [];
  let title = "";
  let buffer = [];
  const flush = () => {
    const content = buffer.join("\\n").trim();
    if (!content) return;
    const parts = content.length > 2600 ? (content.match(/[\\s\\S]{1,2400}(?:\\s|$)/g) || [content]) : [content];
    parts.forEach((part, i) => out.push({
      title: title ? (parts.length > 1 ? title + " · parte " + (i + 1) : title) : "Fragmento " + (out.length + 1),
      chapter: title,
      content: part.trim(),
    }));
    buffer = [];
  };
  for (const line of lines) {
    const clean = line.trim();
    const isChapter = /^(CAP[ÍI]TULO|PARTE|UNIDAD|MÓDULO|MODULE|CHAPTER)\\b/i.test(clean);
    const isHeading = clean.length > 3 && clean.length < 100 && /^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 ·—:()'",.-]*$/.test(clean);
    if (isChapter || isHeading) { flush(); title = clean; }
    else buffer.push(line);
  }
  flush();
  return out.length ? out : [{ title: "Material", chapter: "", content: String(text ?? "").trim() }];
}

function normalizeChunk(item, index) {
  const content = String(item?.content || item?.text || "").trim();
  if (!content) return null;
  return {
    id: item.id || "fragmento-" + (index + 1) + "-" + slugify(item.title || item.chapter || "material"),
    title: item.title || item.chapter || "Fragmento " + (index + 1),
    chapter: item.chapter || "",
    content,
    ...(item.source ? { source: item.source } : {}),
    ...(item.sourceBibliographyId ? { sourceBibliographyId: item.sourceBibliographyId } : {}),
  };
}

export async function readMaterialFile(file) {
  const name = file.name || "material";
  const ext = name.toLowerCase().split(".").pop();

  if (ext === "pdf" || ext === "docx") {
    throw new Error("El archivo fue reconocido, pero la extracción de PDF/DOCX todavía no está integrada. En esta versión cargá TXT, Markdown o JSON.");
  }
  if (!["txt", "md", "markdown", "json"].includes(ext)) {
    throw new Error("Formato no compatible. Usá TXT, Markdown o JSON.");
  }

  const raw = await file.text();
  if (ext === "json") {
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error("El JSON no es válido."); }

    if (data?.format === "aulia-course-pack") {
      return {
        corpus: (data.corpus || []).map(normalizeChunk).filter(Boolean),
        bibliography: Array.isArray(data.bibliography) ? data.bibliography : [],
      };
    }

    const items = Array.isArray(data) ? data : Array.isArray(data?.corpus) ? data.corpus : null;
    if (items) {
      return {
        corpus: items.map(normalizeChunk).filter(Boolean),
        bibliography: Array.isArray(data?.bibliography) ? data.bibliography : [],
      };
    }

    if (typeof data?.content === "string" || typeof data?.text === "string") {
      const fragments = splitPlainText(data.content || data.text).map(normalizeChunk).filter(Boolean);
      return { corpus: fragments, bibliography: Array.isArray(data?.bibliography) ? data.bibliography : [] };
    }

    throw new Error("El JSON no contiene corpus, content o text reconocibles.");
  }

  const fragments = ext === "md" || ext === "markdown" ? splitMarkdown(raw) : splitPlainText(raw);
  return { corpus: fragments.map(normalizeChunk).filter(Boolean), bibliography: [] };
}

export function materialToCorpus(material) {
  return {
    corpus: (material.corpus || []).map((x, i) => ({ ...x, id: x.id || "fragmento-" + Date.now() + "-" + (i + 1) })),
    bibliography: material.bibliography || [],
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
