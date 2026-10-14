import { applySectionRoleDefaults } from "./sectionRoles.js";

export const EXTERNAL_DOCUMENT_ANALYSIS_INPUT_FORMAT = "aulia-external-document-source";
export const EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT = "aulia-multimodal-document-analysis";
export const EXTERNAL_DOCUMENT_ANALYSIS_VERSION = 1;
export const EXTERNAL_DOCUMENT_ANALYSIS_BATCH_SIZE = 20;

const ROLES = new Set(["contenido", "preliminares", "indice", "referencias", "anexo", "actividades"]);
const PRIORITIES = new Set(["central", "normal", "context"]);
const SCOPES = new Set(["included", "reference", "excluded"]);

function clean(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
function slug(value) {
  return clean(value, 140).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "documento";
}
function hash(value) {
  let result = 2166136261;
  for (const char of String(value ?? "")) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
function chunksForDocument(course, document) {
  const id = String(document?.id || "");
  const source = String(document?.sourceName || "").trim().toLocaleLowerCase();
  return (Array.isArray(course?.corpus) ? course.corpus : []).filter(chunk =>
    (id && String(chunk?.documentId || "") === id) ||
    (!chunk?.documentId && source && String(chunk?.source || chunk?.sourceName || "").trim().toLocaleLowerCase() === source)
  );
}
function makeSignature(document, segments) {
  return "external-doc-v1-" + hash(JSON.stringify({
    documentId: String(document?.id || ""),
    sourceName: String(document?.sourceName || ""),
    title: String(document?.title || ""),
    pageCount: Number(document?.pages || document?.analysis?.pageCount || 0),
    segments: segments.map(item => [item.segmentId, item.text, item.pageStart, item.pageEnd]),
  }));
}

export function createExternalDocumentAnalysisPackage({ course, documentId } = {}) {
  const document = (course?.documents || []).find(item => String(item?.id || "") === String(documentId || ""));
  if (!document?.id) throw new Error("Elegí un documento identificado de la bibliografía.");
  const seen = new Set();
  const segments = chunksForDocument(course, document).map((chunk, index) => {
    const segmentId = String(chunk?.id || "").trim();
    const text = String(chunk?.content || "").trim();
    if (!segmentId || !text) return null;
    if (seen.has(segmentId)) throw new Error("El documento contiene un ID de fragmento repetido: " + segmentId);
    seen.add(segmentId);
    const sectionPath = Array.isArray(chunk?.sectionPath)
      ? chunk.sectionPath.map(item => clean(item, 140)).filter(Boolean)
      : String(chunk?.chapter || chunk?.title || "").split(" › ").map(item => clean(item, 140)).filter(Boolean);
    return {
      segmentId, order: index + 1,
      title: clean(chunk?.title || chunk?.chapter || document.title || "Fragmento", 180),
      sectionPath,
      pageStart: Number(chunk?.sourcePageStart || chunk?.sourcePage || 0) || null,
      pageEnd: Number(chunk?.sourcePageEnd || chunk?.sourcePageStart || chunk?.sourcePage || 0) || null,
      printedPageStart: Number(chunk?.printedPageStart || 0) || null,
      printedPageEnd: Number(chunk?.printedPageEnd || chunk?.printedPageStart || 0) || null,
      roleHint: ROLES.has(chunk?.role) ? chunk.role : "",
      text,
    };
  }).filter(Boolean);
  if (!segments.length) throw new Error("El documento no tiene fragmentos de texto para exportar.");
  return {
    format: EXTERNAL_DOCUMENT_ANALYSIS_INPUT_FORMAT,
    version: EXTERNAL_DOCUMENT_ANALYSIS_VERSION,
    createdAt: new Date().toISOString(),
    sourceSignature: makeSignature(document, segments),
    totalSegments: segments.length,
    recommendedSegmentsPerResponse: EXTERNAL_DOCUMENT_ANALYSIS_BATCH_SIZE,
    course: { title: String(course?.title || ""), language: String(course?.language || "es") },
    document: {
      id: String(document.id), title: String(document.title || document.sourceName || "Documento"),
      sourceName: String(document.sourceName || ""),
      documentType: String(document.documentType || "apunte"),
      pageCount: Number(document.pages || document.analysis?.pageCount || 0) || null,
    },
    segments,
  };
}

export function createExternalDocumentAnalysisPrompt({
  courseTitle = "", documentTitle = "", documentType = "", documentId = "", sourceSignature = "", totalSegments = 0,
} = {}) {
  const schema = {
    format: EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT, version: EXTERNAL_DOCUMENT_ANALYSIS_VERSION,
    documentId, sourceSignature, totalSegments,
    processedSegmentIds: ["ID exacto de cada fragmento revisado en esta tanda"],
    assignments: [{
      segmentId: "ID exacto", sectionTitle: "Título respaldado por el texto",
      sectionPath: ["Parte", "Capítulo", "Apartado"], level: 2,
      role: "contenido", confidence: 0.9, rationale: "Evidencia breve",
    }],
  };
  return [
    "Actuá como analista documental académico. Reconstruí la organización real del documento para un asistente universitario. No escribas un resumen general ni diseñes un programa de materia.",
    "CÁTEDRA: " + (courseTitle || "No especificada"),
    "DOCUMENTO: " + (documentTitle || "Documento"),
    "TIPO DOCUMENTAL: " + (documentType || "sin confirmar"),
    "DOCUMENT_ID (copiar exactamente): " + documentId,
    "SOURCE_SIGNATURE (copiar exactamente): " + sourceSignature,
    "TOTAL DE FRAGMENTOS: " + totalSegments,
    "",
    "Usá el JSON adjunto de formato " + EXTERNAL_DOCUMENT_ANALYSIS_INPUT_FORMAT + ". Cada fragmento tiene segmentId, páginas y texto. Si adjunto también el PDF original y tu servicio puede leerlo, contrastá los títulos con el original; los IDs del JSON siguen siendo la referencia obligatoria.",
    "Procesá en tandas consecutivas de hasta " + EXTERNAL_DOCUMENT_ANALYSIS_BATCH_SIZE + " fragmentos por respuesta. Incluí cada ID exactamente una vez, también si corresponde a portada, índice, referencias, anexo o ejercicio.",
    "Agrupá fragmentos contiguos del mismo apartado con igual sectionTitle y sectionPath. Armá una jerarquía fiel a los indicios visibles; no conviertas encabezados corrientes en capítulos.",
    "Elegí role entre contenido, preliminares, indice, referencias, anexo y actividades. Si no hay evidencia suficiente, usá contenido y una confianza menor.",
    "No inventes títulos, autores ni páginas. No reescribas el texto: AULIA conservará el original. No incluyas claves content/text en la salida.",
    "processedSegmentIds debe declarar todos los IDs de la tanda; assignments debe contener una asignación para cada uno. Si te digo CONTINUAR, seguí por los siguientes fragmentos sin repetir ni saltear IDs.",
    "Devolvé solo JSON válido, sin Markdown, siguiendo esta estructura:",
    JSON.stringify(schema, null, 2),
    "level debe ser entero 1–6; confidence debe ser numérico 0–1 (se admite porcentaje 0–100); sectionPath debe ser un arreglo jerárquico. No cambies documentId, sourceSignature ni totalSegments. Empezá por la primera tanda."
  ].join("\n\n");
}

export function validateExternalDocumentAnalysisBatch(parsed, sourcePackage) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El resultado externo no es un objeto JSON.");
  if (parsed.format !== EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT) throw new Error("Formato incorrecto: se esperaba " + EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT + ".");
  if (Number(parsed.version) !== EXTERNAL_DOCUMENT_ANALYSIS_VERSION) throw new Error("La versión del análisis externo no es compatible.");
  if (String(parsed.documentId || "") !== String(sourcePackage?.document?.id || "")) throw new Error("El resultado corresponde a otro documento.");
  if (String(parsed.sourceSignature || "") !== String(sourcePackage?.sourceSignature || "")) throw new Error("La firma del documento cambió. Exportá un paquete nuevo.");
  if (Number(parsed.totalSegments) !== Number(sourcePackage?.totalSegments || 0)) throw new Error("El total de fragmentos no coincide con el documento actual.");
  if (!Array.isArray(parsed.processedSegmentIds) || !Array.isArray(parsed.assignments)) throw new Error("Faltan processedSegmentIds o assignments.");
  const ids = parsed.processedSegmentIds.map(value => String(value || "").trim());
  if (!ids.length || ids.some(id => !id)) throw new Error("La tanda no declara los IDs procesados.");
  if (new Set(ids).size !== ids.length) throw new Error("processedSegmentIds contiene IDs repetidos.");
  const positions = new Map((sourcePackage.segments || []).map((segment, index) => [segment.segmentId, index]));
  const unknown = ids.filter(id => !positions.has(id));
  if (unknown.length) throw new Error("El resultado usa IDs ajenos al documento: " + unknown.slice(0, 3).join(", "));
  const indices = ids.map(id => positions.get(id));
  for (let index = 1; index < indices.length; index += 1) {
    if (indices[index] !== indices[index - 1] + 1) throw new Error("La tanda debe cubrir IDs consecutivos y en el orden del paquete.");
  }
  if (parsed.assignments.length !== ids.length) throw new Error("Debe haber exactamente una asignación por cada fragmento procesado.");
  const processed = new Set(ids), assigned = new Set();
  const assignments = parsed.assignments.map((item, index) => {
    const segmentId = String(item?.segmentId || "").trim();
    if (!segmentId || !processed.has(segmentId)) throw new Error("La asignación " + (index + 1) + " usa un ID que no fue declarado como procesado.");
    if (assigned.has(segmentId)) throw new Error("Hay más de una asignación para " + segmentId + ".");
    assigned.add(segmentId);
    const sectionTitle = clean(item?.sectionTitle, 180);
    if (!sectionTitle) throw new Error("La asignación de " + segmentId + " no tiene título.");
    const sectionPath = Array.isArray(item?.sectionPath) ? item.sectionPath.map(value => clean(value, 140)).filter(Boolean).slice(0, 6) : [];
    if (!sectionPath.length) sectionPath.push(sectionTitle);
    const level = Number(item?.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error("level inválido para " + segmentId + ": debe ser entero de 1 a 6.");
    const role = String(item?.role || "contenido");
    if (!ROLES.has(role)) throw new Error("role no admitido para " + segmentId + ".");
    let confidence = Number(item?.confidence);
    if (!Number.isFinite(confidence)) throw new Error("confidence debe ser numérico para " + segmentId + ".");
    if (confidence > 1 && confidence <= 100) confidence /= 100;
    if (confidence < 0 || confidence > 1) throw new Error("confidence debe estar entre 0 y 1 para " + segmentId + ".");
    return { segmentId, sectionTitle, sectionPath, level, role, confidence, rationale: clean(item?.rationale, 320) };
  });
  const byId = new Map(assignments.map(item => [item.segmentId, item]));
  return {
    format: EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT, version: EXTERNAL_DOCUMENT_ANALYSIS_VERSION,
    documentId: String(parsed.documentId), sourceSignature: String(parsed.sourceSignature),
    totalSegments: Number(parsed.totalSegments), processedSegmentIds: ids,
    assignments: ids.map(id => byId.get(id)),
  };
}

export function mergeExternalDocumentAnalysis(existing, batch, sourcePackage) {
  const sameSource = existing?.sourceSignature === sourcePackage?.sourceSignature &&
    existing?.documentId === sourcePackage?.document?.id;
  const byId = new Map((sameSource && Array.isArray(existing?.assignments) ? existing.assignments : [])
    .map(item => [String(item?.segmentId || ""), item]).filter(([id]) => id));
  for (const assignment of batch?.assignments || []) byId.set(assignment.segmentId, assignment);
  const ordered = (sourcePackage?.segments || []).map(segment => byId.get(segment.segmentId)).filter(Boolean);
  const processedSegmentIds = ordered.map(item => item.segmentId);
  const complete = Number(sourcePackage?.totalSegments || 0) > 0 && processedSegmentIds.length === Number(sourcePackage.totalSegments);
  return {
    format: EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT, version: EXTERNAL_DOCUMENT_ANALYSIS_VERSION,
    documentId: String(sourcePackage?.document?.id || ""), sourceSignature: String(sourcePackage?.sourceSignature || ""),
    totalSegments: Number(sourcePackage?.totalSegments || 0), status: complete ? "complete" : "partial",
    processedSegmentIds, assignments: ordered, updatedAt: new Date().toISOString(),
  };
}

function joinText(chunks) {
  let text = "";
  for (const chunk of chunks || []) {
    const next = String(chunk?.content || "").trim();
    if (!next) continue;
    if (!text) { text = next; continue; }
    let overlap = 0;
    for (let size = Math.min(320, text.length, next.length); size >= 40; size -= 1) {
      if (text.slice(-size) === next.slice(0, size)) { overlap = size; break; }
    }
    text += "\n\n" + next.slice(overlap).trim();
  }
  return text.trim();
}

export function applyExternalDocumentAnalysis(course, documentId, sourcePackage, analysis) {
  if (analysis?.status !== "complete") throw new Error("El análisis externo todavía no cubre todos los fragmentos.");
  if (analysis?.sourceSignature !== sourcePackage?.sourceSignature) throw new Error("El análisis externo no coincide con el paquete original.");
  const current = createExternalDocumentAnalysisPackage({ course, documentId });
  if (current.sourceSignature !== sourcePackage.sourceSignature) throw new Error("El documento cambió desde la exportación. Prepará un paquete nuevo.");
  const document = (course?.documents || []).find(item => String(item?.id || "") === String(documentId || ""));
  if (!document) throw new Error("No se encontró el documento del análisis externo.");
  const corpus = Array.isArray(course?.corpus) ? course.corpus : [];
  const chunksById = new Map(corpus.map(chunk => [String(chunk?.id || ""), chunk]));
  const assignmentsById = new Map((analysis.assignments || []).map(item => [item.segmentId, item]));
  const segments = sourcePackage.segments || [];
  if (segments.length !== Number(sourcePackage.totalSegments) ||
      segments.some(segment => !chunksById.has(segment.segmentId) || !assignmentsById.has(segment.segmentId))) {
    throw new Error("Falta una asignación válida para algún fragmento actual.");
  }
  const documentPriority = PRIORITIES.has(document.priority) ? document.priority : "normal";
  const groups = [];
  for (const segment of segments) {
    const chunk = chunksById.get(segment.segmentId);
    const assignment = assignmentsById.get(segment.segmentId);
    const key = JSON.stringify([
      assignment.sectionTitle, assignment.sectionPath, assignment.level, assignment.role,
      chunk?.scopeSource === "teacher" ? chunk.scope : "",
      chunk?.prioritySource === "teacher" ? chunk.priority : "",
    ]);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.segments.push(segment); last.chunks.push(chunk); last.assignments.push(assignment);
    } else groups.push({ key, segments: [segment], chunks: [chunk], assignments: [assignment] });
  }
  const sections = groups.map((group, index) => {
    const first = group.chunks[0] || {}, assignment = group.assignments[0];
    const pages = group.chunks.flatMap(chunk => [
      Number(chunk?.sourcePageStart || chunk?.sourcePage || 0),
      Number(chunk?.sourcePageEnd || chunk?.sourcePageStart || chunk?.sourcePage || 0),
    ]).filter(value => Number.isFinite(value) && value > 0);
    const confidence = group.assignments.length ? Math.min(...group.assignments.map(item => item.confidence)) : 0.5;
    const rationale = [...new Set(group.assignments.map(item => item.rationale).filter(Boolean))];
    const content = joinText(group.chunks);
    const section = {
      id: slug(documentId) + "-externa-seccion-" + (index + 1),
      title: assignment.sectionTitle, path: [...assignment.sectionPath], sectionPath: [...assignment.sectionPath],
      level: assignment.level, content,
      sourcePageStart: pages.length ? Math.min(...pages) : null,
      sourcePageEnd: pages.length ? Math.max(...pages) : null,
      segmentationSource: "external-ai-text", confidence,
      role: assignment.role, roleSource: "ai", roleConfidence: confidence,
      scope: SCOPES.has(first.scope) ? first.scope : "included",
      scopeSource: first.scopeSource === "teacher" ? "teacher" : "role-default",
      priority: PRIORITIES.has(first.priority) ? first.priority : documentPriority,
      prioritySource: first.prioritySource === "teacher" ? "teacher" : "document",
      evidence: rationale.length ? rationale : ["Estructura propuesta por una IA externa a partir de los fragmentos originales."],
      needsReview: confidence < 0.7, fragmentCount: group.chunks.length, preview: content.slice(0, 180),
    };
    return applySectionRoleDefaults(section, {
      pageCount: Number(document.pages || document.analysis?.pageCount || 0),
      sectionIndex: index, sectionCount: groups.length,
      isFirstSection: index === 0, isLastSection: index === groups.length - 1,
      startPage: section.sourcePageStart || 0, endPage: section.sourcePageEnd || 0, documentPriority,
    });
  });
  const sectionById = new Map();
  groups.forEach((group, index) => group.segments.forEach(segment => sectionById.set(segment.segmentId, sections[index])));
  const nextCorpus = corpus.map(chunk => {
    const section = sectionById.get(String(chunk?.id || ""));
    if (!section) return chunk;
    const keepScope = chunk.scopeSource === "teacher" && SCOPES.has(chunk.scope);
    const keepPriority = chunk.prioritySource === "teacher" && PRIORITIES.has(chunk.priority);
    return {
      ...chunk, sectionId: section.id, title: section.title, chapter: section.sectionPath.join(" › "),
      sectionPath: [...section.sectionPath], sectionLevel: section.level,
      segmentationSource: "external-ai-text", confidence: section.confidence,
      structureEvidence: section.evidence,
      role: section.role, roleSource: section.roleSource, roleConfidence: section.roleConfidence,
      scope: keepScope ? chunk.scope : section.scope, scopeSource: keepScope ? "teacher" : section.scopeSource,
      priority: keepPriority ? chunk.priority : section.priority, prioritySource: keepPriority ? "teacher" : section.prioritySource,
      ...(section.needsReview ? { needsReview: true, reviewNotes: "Revisá la sección sugerida por la IA externa." } : {}),
    };
  });
  const average = sections.reduce((sum, section) => sum + Number(section.confidence || 0), 0) / Math.max(1, sections.length);
  const summary = {
    ...(document.analysis || {}), version: 4, method: "external-document-analysis", model: "IA externa",
    confidence: average, sectionCount: sections.length,
    lowConfidenceSections: sections.filter(section => section.needsReview).length,
    semanticTasksProcessed: segments.length, externalSourceSignature: sourcePackage.sourceSignature,
    warnings: [...new Set([
      ...(document.analysis?.warnings || []),
      "La segmentación se propuso con una IA externa. El texto original no fue reescrito; revisá títulos, roles y páginas antes de publicar.",
    ])],
  };
  const nextDocument = {
    ...document, analysis: summary,
    sections: sections.map(section => ({ ...section, path: [...section.sectionPath], fullText: section.content, preview: section.content.slice(0, 180) })),
    externalAnalysis: { ...analysis, status: "complete" },
  };
  return {
    ...course,
    documents: (course.documents || []).map(item => String(item?.id || "") === String(documentId || "") ? nextDocument : item),
    corpus: nextCorpus, knowledgeBase: null,
  };
}
