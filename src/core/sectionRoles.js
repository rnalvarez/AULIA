const TITLE_ROLE_RULES = [
  {
    role: "preliminares",
    pattern: /^(?:portada|caratula|front matter|title page|creditos|copyright|derechos de autor|dedicatoria|agradecimientos|colofon|colophon)\b/i,
    evidence: "el título coincide con una sección preliminar",
  },
  {
    role: "indice",
    pattern: /^(?:indice|tabla de contenidos|tabla de contenido|sumario|contents|table of contents|toc|indice analitico|indice onomastico|index|indexes|onomastic index)\b/i,
    evidence: "el título coincide con un índice o tabla de contenidos",
  },
  {
    role: "referencias",
    pattern: /^(?:bibliografia|bibliography|referencias|references|obras citadas|works cited|citas bibliograficas|filmografia|filmography|fuentes citadas)\b/i,
    evidence: "el título coincide con bibliografía o referencias",
  },
  {
    role: "anexo",
    pattern: /^(?:anexo|anexos|apendice|apendices|appendix|appendices|glosario|glossary|material suplementario|supplementary material)\b/i,
    evidence: "el título identifica material anexo o complementario",
  },
  {
    role: "actividades",
    pattern: /^(?:actividades|actividad|ejercicios|consignas|preguntas de repaso|review questions|exercises|practice activities|practica)\b/i,
    evidence: "el título identifica ejercicios o consignas",
  },
];

const EXPLICIT_CONTENT_TITLE_RE = /^(?:introduccion|introduction|conclusion|conclusiones|concluding remarks|discusion|discussion|metodo|method|metodologia|methodology|resultados|results|resumen|abstract)\b/i;

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionTitle(section) {
  const raw = section?.title || section?.heading || section?.sectionTitle || "";
  return normalizeText(raw).replace(/^\s*(?:(?:\d+(?:\.\d+)*[.)]?)|(?:[ivxlcdm]+[.)]))\s+/i, "").trim();
}

function sectionText(section) {
  return String(section?.content || section?.text || section?.rawText || "");
}

function getLines(section, content) {
  const candidate = Array.isArray(section?.lines) ? section.lines : content.split(/\r?\n/);
  return candidate.map((line) => String(line ?? "").trim()).filter(Boolean);
}

function hasReferencePattern(line) {
  const normalized = String(line || "").trim();
  const surnameAndInitials = /^[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’\-]+,\s*(?:[A-ZÁÉÍÓÚÜÑ]\.?\s*){1,4}/.test(normalized);
  const citationDetails = /\(\d{4}[a-z]?\)|\bpp?\.\s*\d+|\bdoi\b|10\.\d{4,9}\//i.test(normalized);
  const doiOrUrl = /https?:\/\/doi\.org\//i.test(normalized);
  return (surnameAndInitials && (citationDetails || normalized.length > 35)) || citationDetails || doiOrUrl;
}

function result(role, confidence, evidence) {
  return {
    role,
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    evidence: [...new Set((evidence || []).filter(Boolean))],
  };
}

/**
 * Clasifica una sección documental mediante señales locales y explicables.
 * context puede incluir pageCount/totalPages, sectionIndex/sectionCount,
 * startPage/endPage y el indicador isContentsPage. No realiza llamadas de red.
 */
export function classifySectionRole(section, context = {}) {
  const title = sectionTitle(section);
  const content = sectionText(section);
  const lines = getLines(section, content);
  const evidence = [];

  if (title && EXPLICIT_CONTENT_TITLE_RE.test(title)) {
    return result("contenido", 0.98, ["el título identifica una parte del cuerpo del texto"]);
  }

  const titleRule = TITLE_ROLE_RULES.find((rule) => title && rule.pattern.test(title));
  if (titleRule) {
    return result(titleRule.role, 0.98, [titleRule.evidence, "clasificación por regla de título"]);
  }

  const contentsPage = Boolean(section?.isContentsPage || context?.isContentsPage);
  const tocLines = lines.filter((line) =>
    /(?:\.{2,}|·{2,}|…{2,})\s*\d{1,4}$/.test(line) ||
    /\s{2,}\d{1,4}$/.test(line)
  );
  const tocRatio = lines.length ? tocLines.length / lines.length : 0;
  if (contentsPage) evidence.push("la página está marcada como parte de un índice");
  if (tocLines.length >= 2 && tocRatio >= 0.25) {
    return result("indice", Math.min(0.97, 0.78 + tocRatio * 0.18), [
      ...evidence,
      "hay " + tocLines.length + " líneas con puntos guía o número de página (" + Math.round(tocRatio * 100) + "%)",
    ]);
  }
  if (contentsPage) {
    return result("indice", 0.82, [...evidence, "marca estructural de índice conservada desde la extracción"]);
  }

  const referenceLines = lines.filter(hasReferencePattern);
  const referenceRatio = lines.length ? referenceLines.length / lines.length : 0;
  if (referenceLines.length >= 3 && referenceRatio >= 0.3) {
    return result("referencias", Math.min(0.96, 0.76 + referenceRatio * 0.2), [
      "hay " + referenceLines.length + " líneas con patrones de cita (" + Math.round(referenceRatio * 100) + "%)",
      "se reconocen apellidos, años, páginas o identificadores DOI",
    ]);
  }

  const startPage = Number(section?.sourcePageStart || section?.sourcePage || context?.startPage || 0);
  const endPage = Number(section?.sourcePageEnd || section?.sourcePage || context?.endPage || startPage || 0);
  const totalPages = Number(context?.pageCount || context?.totalPages || section?.sourcePageCount || 0);
  const sectionIndex = Number(context?.sectionIndex ?? -1);
  const sectionCount = Number(context?.sectionCount || 0);
  const isFirstSection = context?.isFirstSection === true || sectionIndex === 0;
  const isLastSection = context?.isLastSection === true || (sectionCount > 0 && sectionIndex === sectionCount - 1);
  const hasVeryLittleText = content.trim().length > 0 && content.trim().length <= 140 && lines.length <= 5;

  if (hasVeryLittleText && ((startPage > 0 && startPage <= 2) || (isFirstSection && startPage === 0))) {
    return result("preliminares", 0.76, [
      "hay muy poco texto en las primeras páginas",
      "la posición inicial es compatible con portada o créditos",
    ]);
  }
  if (hasVeryLittleText && (
    (totalPages > 0 && endPage >= totalPages - 1) ||
    (isLastSection && endPage === 0)
  )) {
    return result("preliminares", 0.71, [
      "hay muy poco texto en las últimas páginas",
      "la ubicación es compatible con colofón o créditos finales; requiere verificación",
    ]);
  }

  if (title) evidence.push("el título no coincide con patrones de exclusión ni con señales típicas de referencias");
  evidence.push("sin señales suficientes para una clasificación más específica; se propone contenido para revisión");
  return result("contenido", 0.62, evidence);
}
