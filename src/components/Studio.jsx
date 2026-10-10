import { useEffect, useMemo, useRef, useState } from "react";
import { cloneCourse, validateCourse } from "../core/courseContract.js";
import { downloadCoursePack, readCoursePackFile } from "../core/coursePackIO.js";
import { readMaterialFile, renderPdfPageImages, materialToCorpus, mergeImportedBibliography, mergeImportedDocuments, applySelectiveVisualAnalysis } from "../core/materialIO.js";
import { savePendingPdf, getPendingPdf, getPendingPdfStatus, savePreparedPdf, getPreparedPdf, updatePendingPdfStatus, listPendingPdfs, deletePendingPdf } from "../core/studioPersistence.js";
import { analyzePdfWithVision, getCachedVisionPageNumbers } from "../services/llm/multimodalIngestion.js";
import { requestTeacherProposal } from "../services/llm/teacherProposal.js";
import { buildKnowledgeBase, buildKnowledgePassages, isSupportedKnowledgeExcerpt, normalizeExternalKnowledgeEntries, mergeKnowledgeBaseEntries } from "../services/llm/knowledgeBase.js";
import { createExternalKnowledgePackage, createExternalKnowledgePrompt, downloadJsonFile, EXTERNAL_KNOWLEDGE_OUTPUT_FORMAT } from "../core/externalKnowledgeBaseIO.js";
import { KNOWLEDGE_BASE_VERSION, isKnowledgeBaseCurrent, summarizeKnowledgeBase, knowledgeCorpusSignature, legacyKnowledgeCorpusSignature } from "../core/knowledgeBase.js";
import { clearStudioApiKey, isGroqApiKey, loadStudioApiKey, saveStudioApiKey } from "../utils/studioStorage.js";
import LegalNotice from "./LegalNotice.jsx";

const STORAGE_PREFIX = "aulia:studio:";
const VERSION = "0.7";
const STEPS = [
  ["overview", "01", "Cátedra"],
  ["material", "02", "Bibliografía"],
  ["proposal", "03", "Diseño pedagógico"],
  ["interaction", "04", "Interacción"],
  ["commissions", "05", "Comisiones"],
];

const MATERIAL_SCOPE_OPTIONS = [
  ["included", "Incluido"],
  ["reference", "Referencial"],
  ["excluded", "Excluir"],
];
const MATERIAL_PRIORITY_OPTIONS = [
  ["central", "Central"],
  ["normal", "Complementario"],
  ["context", "Contexto"],
];

const MODES = {
  retrieve: ["Consulta", "comprender", "Preguntá por un concepto..."],
  "scene-analysis": ["Análisis de escena", "aplicar", "Describí la escena..."],
  socratic: ["Modo socrático", "elaborar", "Escribí tu hipótesis..."],
  "guided-analysis": ["Paso a paso", "experimentar", "Respondé para continuar..."],
  diagnostic: ["Diagnóstico", "diagnosticar", "Contame qué entendiste..."],
};

function slug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "item";
}
function uniqueId(prefix, items) {
  const used = new Set((items || []).map((x) => x.id));
  let i = 1, id = prefix;
  while (used.has(id)) id = prefix + "-" + i++;
  return id;
}
function list(value) {
  return String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
}
function firstSentence(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return (clean.match(/^(.{1,240}?[.!?])(?:\s|$)/)?.[1] || clean.slice(0, 240)).trim();
}

function mergeTeacherProposal(course, proposal) {
  const corpusIds = new Set((course.corpus || []).map((item) => item.id));
  const pedagogicalUnits = [...(course.pedagogicalUnits || [])];
  const existingUnitKeys = new Set(pedagogicalUnits.map((item) => slug(item.title)));
  const newUnits = [];

  for (const item of proposal.pedagogicalUnits || []) {
    const title = String(item?.title || "").trim();
    const key = slug(title);
    if (!title || existingUnitKeys.has(key)) continue;

    const unit = {
      id: uniqueId("unidad-" + (key || "item"), [...pedagogicalUnits, ...newUnits]),
      title,
      rationale: String(item.rationale || "").trim(),
      learningGoal: String(item.learningGoal || "").trim(),
      phase: String(item.phase || "").trim(),
      suggestedSequence: Number.isFinite(Number(item.sequence)) ? Number(item.sequence) : 999,
      prerequisiteTitles: Array.isArray(item.prerequisiteTitles) ? item.prerequisiteTitles.filter(Boolean).slice(0, 5) : [],
      prerequisiteUnitIds: [],
      conceptTitles: Array.isArray(item.conceptTitles) ? item.conceptTitles.filter(Boolean).slice(0, 8) : [],
      sourceCorpusIds: (item.sourceIds || []).filter((id) => corpusIds.has(id)),
      reviewStatus: "pending",
      suggested: true,
      suggestionSource: "llm",
    };
    newUnits.push(unit);
    existingUnitKeys.add(key);
  }

  const concepts = [...(course.concepts || [])];
  const conceptByKey = new Map(concepts.map((item) => [slug(item.title), item]));
  const newConcepts = [];
  let skippedConcepts = 0;

  for (const item of proposal.concepts || []) {
    const title = String(item?.title || "").trim();
    const key = slug(title);
    if (!title) {
      skippedConcepts += 1;
      continue;
    }

    const existing = conceptByKey.get(key);
    const sourceCorpusIds = (item.sourceIds || []).filter((id) => corpusIds.has(id));
    const bibliographyIds = new Set((course.bibliography || []).map((ref) => ref?.id).filter(Boolean));
    const sourceBibliographyIds = (item.sourceBibliographyIds || [])
      .filter((id) => bibliographyIds.has(id));

    if (existing) {
      const enriched = {
        ...existing,
        sourceCorpusIds: existing.sourceCorpusIds?.length ? existing.sourceCorpusIds : sourceCorpusIds,
        sourceBibliographyIds: existing.sourceBibliographyIds?.length
          ? existing.sourceBibliographyIds
          : sourceBibliographyIds.slice(0, 8),
        confusionCriteria: existing.confusionCriteria?.length
          ? existing.confusionCriteria
          : (item.confusionCriteria || []).filter(Boolean).slice(0, 5),
      };
      conceptByKey.set(key, enriched);
      const index = concepts.findIndex(concept => concept.id === existing.id);
      if (index >= 0) concepts[index] = enriched;
      skippedConcepts += 1;
      continue;
    }
    const concept = {
      id: uniqueId(key || "concepto", [...concepts, ...newConcepts]),
      title,
      chapter: String(item.chapter || "").trim(),
      summary: String(item.summary || "").trim(),
      explanation: String(item.explanation || "").trim(),
      aliases: Array.isArray(item.aliases) ? item.aliases.filter(Boolean).slice(0, 8) : [],
      keywords: Array.isArray(item.keywords) ? item.keywords.filter(Boolean).slice(0, 12) : [],
      sourceCorpusIds,
      sourceBibliographyIds: sourceBibliographyIds.slice(0, 8),
      confusionCriteria: Array.isArray(item.confusionCriteria)
        ? item.confusionCriteria.filter(Boolean).slice(0, 5)
        : [],
      suggested: true,
      suggestionSource: "llm",
    };
    newConcepts.push(concept);
    conceptByKey.set(key, concept);
  }

  const allConcepts = [...concepts, ...newConcepts];
  const examples = [...(course.examples || [])];
  const exampleKeys = new Set(examples.map((item) => slug(item.title)));
  const newExamples = [];

  for (const item of proposal.examples || []) {
    const title = String(item?.title || "").trim();
    const key = slug(title);
    if (!title || exampleKeys.has(key)) continue;
    const conceptIds = (item.conceptTitles || [])
      .map((title) => conceptByKey.get(slug(title))?.id)
      .filter(Boolean);
    newExamples.push({
      id: uniqueId("ejemplo-" + (key || "item"), [...examples, ...newExamples]),
      title,
      director: String(item.director || "").trim(),
      description: String(item.description || "").trim(),
      concepts: conceptIds,
      sourceCorpusIds: (item.sourceIds || []).filter((id) => corpusIds.has(id)),
      suggested: true,
      suggestionSource: "llm",
    });
    exampleKeys.add(key);
  }

  const activities = [...(course.activities || [])];
  const activityKeys = new Set(activities.map((item) => slug(item.title)));
  const newActivities = [];
  for (const item of proposal.activities || []) {
    const title = String(item?.title || "").trim();
    const key = slug(title);
    if (!title || activityKeys.has(key)) continue;
    const strategy = String(item.strategy || "retrieve");
    const matchingMode = (course.modes || []).find((mode) => mode.strategy === strategy);
    newActivities.push({
      id: uniqueId("actividad-" + (key || "item"), [...activities, ...newActivities]),
      title,
      modeId: matchingMode?.id || course.modes?.[0]?.id || "",
      description: [item.description, item.goal ? "Objetivo: " + item.goal : ""].filter(Boolean).join("\n\n"),
      suggested: true,
      suggestionSource: "llm",
    });
    activityKeys.add(key);
  }

  const unitCandidates = [...pedagogicalUnits, ...newUnits];
  const unitIds = new Set(unitCandidates.map((unit) => unit.id).filter(Boolean));
  const unitByTitle = new Map(unitCandidates.map((unit) => [slug(unit.title), unit]));

  const allUnits = unitCandidates.map((unit) => {
    const inferredPrerequisites = (unit.prerequisiteTitles || [])
      .map((title) => unitByTitle.get(slug(title))?.id)
      .filter((id) => id && id !== unit.id && unitIds.has(id));

    return {
      ...unit,
      prerequisiteUnitIds: Array.from(new Set([
        ...(unit.prerequisiteUnitIds || []),
        ...inferredPrerequisites,
      ])).filter((id) => id && id !== unit.id && unitIds.has(id)),
      conceptIds: Array.from(new Set(
        (unit.conceptTitles || [])
          .map((title) => conceptByKey.get(slug(title))?.id)
          .filter(Boolean)
      )),
    };
  }).map(({ suggestedSequence, prerequisiteTitles, ...unit }) => unit);

  const unitIdsByConcept = new Map();
  for (const unit of allUnits) {
    for (const conceptId of unit.conceptIds || []) {
      if (!unitIdsByConcept.has(conceptId)) unitIdsByConcept.set(conceptId, []);
      unitIdsByConcept.get(conceptId).push(unit.id);
    }
  }

  const conceptsWithUnits = allConcepts.map((concept) => {
    const ids = unitIdsByConcept.get(concept.id);
    return ids?.length
      ? { ...concept, pedagogicalUnitIds: Array.from(new Set(ids)) }
      : concept;
  });

  const existingSequence = Array.isArray(course.curriculumMap?.sequence)
    ? course.curriculumMap.sequence.filter((id) => unitIds.has(id))
    : pedagogicalUnits.map((unit) => unit.id).filter(Boolean);
  const proposedSequence = newUnits
    .slice()
    .sort((a, b) => a.suggestedSequence - b.suggestedSequence)
    .map((unit) => unit.id);
  const sequence = Array.from(new Set([
    ...existingSequence,
    ...proposedSequence,
    ...allUnits.map((unit) => unit.id),
  ])).filter(Boolean);

  const curriculumMap = allUnits.length
    ? {
        ...(course.curriculumMap || {}),
        title: course.curriculumMap?.title || "Mapa curricular sugerido",
        rationale: String(proposal.pedagogicalSummary || course.curriculumMap?.rationale || "").trim(),
        reviewStatus: "pending",
        suggested: true,
        suggestionSource: "llm",
        sequence,
      }
    : (course.curriculumMap || null);

  return {
    course: {
      ...course,
      pedagogicalUnits: allUnits,
      curriculumMap,
      concepts: conceptsWithUnits,
      examples: [...examples, ...newExamples],
      activities: [...activities, ...newActivities],
    },
    stats: {
      concepts: newConcepts.length,
      examples: newExamples.length,
      activities: newActivities.length,
      skippedConcepts,
    },
  };
}
function Field({ label, value, onChange, multiline = false, placeholder = "", hint = "" }) {
  const T = multiline ? "textarea" : "input";
  return <label className="studio-wf-field"><span>{label}</span><T value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={multiline ? 4 : undefined}/>{hint && <small>{hint}</small>}</label>;
}
function Panel({ eyebrow, title, description, actions, children }) {
  return <section className="studio-wf-panel"><div className="studio-wf-panel-head"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="studio-wf-panel-actions">{actions}</div>}</div>{children}</section>;
}
function Empty({ title, text, action }) {
  return <div className="studio-wf-empty"><strong>{title}</strong><span>{text}</span>{action}</div>;
}
function Row({ title, meta, onRemove, children }) {
  return <article className="studio-wf-row"><div className="studio-wf-row-main"><div className="studio-wf-row-title"><strong>{title || "Sin título"}</strong>{meta && <span>{meta}</span>}</div>{children}</div><button className="studio-wf-danger" type="button" onClick={onRemove}>Eliminar</button></article>;
}

function materialSegmentationLabel(value) {
  switch (value) {
    case "pdf-toc": return "Índice + contraste con el cuerpo";
    case "pdf-outline": return "Marcadores internos del PDF";
    case "pdf-hybrid-heuristic": return "Tipografía + geometría + consistencia";
    case "pdf-conservative": return "Segmentación conservadora";
    case "ai-multimodal": return "IA multimodal · lectura visual";
    case "ai-text-first": return "IA semántica sobre texto extraído · visión selectiva";
    case "local-structure-selective-vision": return "Estructura local + OCR/visión selectiva";
    default: return "Estructura detectada localmente";
  }
}

function structureConfidenceLabel(value) {
  const confidence = Number(value || 0);
  if (confidence >= 0.78) return "Alta";
  if (confidence >= 0.60) return "Media";
  return "Baja";
}

function buildMaterialStructure(course) {
  const corpus = Array.isArray(course?.corpus) ? course.corpus : [];
  const documents = Array.isArray(course?.documents) ? course.documents : [];
  const sections = [];
  const corpusByDocument = new Map();

  for (const chunk of corpus) {
    const key = String(chunk?.documentId || chunk?.source || "material-general");
    if (!corpusByDocument.has(key)) corpusByDocument.set(key, []);
    corpusByDocument.get(key).push(chunk);
  }

  for (const document of documents) {
    const documentChunks = corpusByDocument.get(String(document.id)) || [];

    for (const section of document.sections || []) {
      const path = Array.isArray(section.path) ? section.path : [];
      const titleKey = slug(section.title || "");
      const sectionId = section.id || document.id + "-" + sections.length;
      const matches = documentChunks.filter((chunk) => {
        if (chunk.sectionId === sectionId) return true;

        // Legacy corpus without sectionId: keep the fallback strictly inside
        // the same document and same structural path. Never match by title
        // across documents.
        const sameDocument =
          String(chunk.documentId || "") === String(document.id || "");
        const samePath =
          Array.isArray(chunk.sectionPath) &&
          chunk.sectionPath.join(" › ") === path.join(" › ");
        const sameTitle =
          slug(chunk.title || "").replace(/-parte-\d+$/i, "") === titleKey;

        return sameDocument && samePath && sameTitle;
      });

      const ordered = matches.slice().sort((x, y) =>
        Number(x?.sourcePageStart || x?.sourcePage || 0) -
        Number(y?.sourcePageStart || y?.sourcePage || 0)
      );
      const first = ordered[0] || {};
      const preview = ordered.map((item) => String(item?.content || "")).join(" ").trim();

      sections.push({
        id: sectionId,
        documentId: document.id,
        documentTitle: document.title || document.sourceName || "Material",
        title: section.title || path[path.length - 1] || "Sección",
        path,
        level: Number(section.level || 1),
        sourcePageStart: section.sourcePageStart || first.sourcePageStart || null,
        sourcePageEnd: section.sourcePageEnd || first.sourcePageEnd || first.sourcePage || null,
        printedPageStart: section.printedPageStart || first.printedPageStart || null,
        printedPageEnd: section.printedPageEnd || first.printedPageEnd || null,
        segmentationSource: section.segmentationSource || "text-structure",
        segmentationLabel: materialSegmentationLabel(section.segmentationSource),
        confidence: Number(section.confidence ?? first.confidence ?? 0.5),
        confidenceLabel: structureConfidenceLabel(section.confidence ?? first.confidence ?? 0.5),
        evidence: Array.isArray(section.evidence)
          ? section.evidence
          : (Array.isArray(first.structureEvidence) ? first.structureEvidence : []),
        needsReview: Boolean(section.needsReview || first.needsReview),
        reviewNotes: String(section.reviewNotes || first.reviewNotes || ""),
        sourceTextOriginal: String(section.sourceTextOriginal || ""),
        visualElementCount: Number(section.visualElementCount || first.visualElementCount || 0),
        childrenCount: Number(section.childrenCount || 0),
        scope: section.scope || "included",
        priority: section.priority || "normal",
        teacherTopic: section.teacherTopic || "",
        teacherConcepts: Array.isArray(section.teacherConcepts) ? section.teacherConcepts : [],
        teacherLimit: section.teacherLimit || "",
        fragmentCount: ordered.length,
        preview: preview.slice(0, 180),
        fullText: preview,
        analysis: document.analysis || null,
      });
    }
  }

  if (sections.length) return sections;

  const groups = new Map();
  for (const chunk of corpus) {
    const key = String(chunk?.unitId || chunk?.id || "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chunk);
  }

  return Array.from(groups.values()).map((items, index) => {
    const ordered = items.slice().sort((x, y) =>
      Number(x?.sourcePageStart || x?.sourcePage || 0) -
      Number(y?.sourcePageStart || y?.sourcePage || 0)
    );
    const first = ordered[0] || {};
    const last = ordered[ordered.length - 1] || first;
    const confidence = Number(first.confidence ?? 0.5);

    return {
      id: first.unitId || first.id || "material-section-" + index,
      documentId: first.documentId || "",
      documentTitle: first.source || "Material",
      title: String(first.title || first.chapter || "Sección").replace(/ · parte \d+$/i, ""),
      path: Array.isArray(first.sectionPath) ? first.sectionPath : [],
      level: Number(first.sectionLevel || 1),
      sourcePageStart: first.sourcePageStart || first.sourcePage || null,
      sourcePageEnd: last.sourcePageEnd || last.sourcePage || null,
      segmentationSource: first.segmentationSource || "corpus-fallback",
      segmentationLabel: materialSegmentationLabel(first.segmentationSource),
      confidence,
      confidenceLabel: structureConfidenceLabel(confidence),
      evidence: Array.isArray(first.structureEvidence) ? first.structureEvidence : [],
      childrenCount: Number(first.childrenCount || 0),
      scope: first.scope || "included",
      priority: first.priority || "normal",
      teacherTopic: first.teacherTopic || "",
      teacherConcepts: Array.isArray(first.teacherConcepts) ? first.teacherConcepts : [],
      teacherLimit: first.teacherLimit || "",
      fragmentCount: ordered.length,
      preview: ordered.map((item) => String(item?.content || "")).join("\n\n").trim().slice(0, 180),
      fullText: ordered.map((item) => String(item?.content || "")).join("\n\n").trim(),
      analysis: null,
    };
  });
}
export default function Studio({ course, courseMeta = null, canEdit = true, onCourseChanged, onSaveCourse, onPublishCourse, onReloadCourse }) {
  const storageKey = useMemo(() => STORAGE_PREFIX + course.id, [course.id]);
  const knowledgeRetryStorageKey = useMemo(() => STORAGE_PREFIX + "groq-retry:" + course.id, [course.id]);
  const [draft, setDraft] = useState(() => cloneCourse(course));
  const [draftReady, setDraftReady] = useState(false);
  const [knowledgeRetryAt, setKnowledgeRetryAt] = useState(() => localStorage.getItem(knowledgeRetryStorageKey) || "");
  const [knowledgeRetryCourseId, setKnowledgeRetryCourseId] = useState(() => course.id);
  const [pendingPdfsCourseId, setPendingPdfsCourseId] = useState(() => course.id);
  const autoResumePdfRef = useRef(false);
  const autoResumeKnowledgeRef = useRef(false);
  const [step, setStep] = useState("overview");
  const [status, setStatus] = useState("");
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [studioApiKey, setStudioApiKey] = useState(() => loadStudioApiKey(course.id));
  const [studioKeyInput, setStudioKeyInput] = useState("");
  const [showStudioKey, setShowStudioKey] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [analysisReport, setAnalysisReport] = useState(null);
  const [knowledgeBaseReport, setKnowledgeBaseReport] = useState(null);
  const [showExternalPrompt, setShowExternalPrompt] = useState(false);
  const [knowledgeProvider, setKnowledgeProvider] = useState("groq");
  const [ingestionProvider, setIngestionProvider] = useState(() => loadStudioApiKey(course.id) ? "groq" : "local");
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pendingPdfs, setPendingPdfs] = useState([]);
  const [rateLimitClock, setRateLimitClock] = useState(() => Date.now());

  useEffect(() => {
    setDraftReady(false);
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      setDraft(cloneCourse(course));
      setValidation(null);
      setStatus("");
      setDraftReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      const localDraft = parsed?.draft || parsed;
      const localVersion = parsed?.version || "";

      if (!canEdit) {
        setDraft(cloneCourse(course));
        setValidation(null);
        setStatus("Modo solo lectura.");
        setDraftReady(true);
        return;
      }

      if (courseMeta?.updatedAt && localVersion && localVersion !== courseMeta.updatedAt) {
        setDraft(cloneCourse(course));
        setValidation(null);
        setStatus("La versión remota cambió. Se descartó el borrador local anterior.");
        localStorage.removeItem(storageKey);
        setDraftReady(true);
        return;
      }

      setDraft(cloneCourse(localDraft));
      setValidation(null);
      setStatus("Borrador local recuperado.");
    } catch {
      localStorage.removeItem(storageKey);
      setDraft(cloneCourse(course));
    } finally {
      setDraftReady(true);
    }
  }, [course, storageKey, courseMeta?.updatedAt, canEdit]);

  useEffect(() => {
    setKnowledgeRetryCourseId("");
    setPendingPdfsCourseId("");
    setPendingPdfs([]);
    setKnowledgeRetryAt(localStorage.getItem(knowledgeRetryStorageKey) || "");
    setKnowledgeRetryCourseId(course.id);
    setStudioApiKey(loadStudioApiKey(course.id));
    setStudioKeyInput("");
    setShowStudioKey(false);
    setLegalAccepted(false);
    setAnalysisReport(null);
    setKnowledgeBaseReport(null);
    setShowExternalPrompt(false);
    setIngestionProvider(loadStudioApiKey(course.id) ? "groq" : "local");
    setUploadProgress(null);
  }, [course.id]);

  useEffect(() => {
    let active = true;
    listPendingPdfs(course.id).then(pending => {
      if (!active) return;
      setPendingPdfs(pending);
      setPendingPdfsCourseId(course.id);
    }).catch(() => {
      if (active) setStatus("No se pudo consultar el trabajo guardado en este navegador. Verificá que el almacenamiento del sitio esté habilitado.");
    });
    return () => { active = false; };
  }, [course.id]);

  useEffect(() => {
    const pendingWait = pendingPdfs.some(item => item.blockedUntil && Date.parse(item.blockedUntil) > rateLimitClock);
    const knowledgeWait = knowledgeRetryAt && Date.parse(knowledgeRetryAt) > rateLimitClock;
    if (!pendingWait && !knowledgeWait) return undefined;
    const timer = setInterval(() => setRateLimitClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [pendingPdfs, knowledgeRetryAt, rateLimitClock]);

  useEffect(() => {
    if (!draftReady || pendingPdfsCourseId !== course.id || !canEdit || !studioApiKey || busy || autoResumePdfRef.current) return;
    const candidate = pendingPdfs.find(item =>
      item?.id && item.blockedUntil && Number.isFinite(Date.parse(item.blockedUntil)) &&
      Date.parse(item.blockedUntil) <= rateLimitClock
    );
    if (!candidate) return;
    autoResumePdfRef.current = true;
    setStatus("Se liberó la ventana estimada de cuota de Groq. AULIA reanudará automáticamente el PDF desde el avance guardado…");
    Promise.resolve(resumePendingPdf(candidate)).finally(() => {
      autoResumePdfRef.current = false;
    });
  }, [draftReady, pendingPdfsCourseId, canEdit, studioApiKey, busy, pendingPdfs, rateLimitClock, course.id]);

  useEffect(() => {
    if (!draftReady || knowledgeRetryCourseId !== course.id || !canEdit || !studioApiKey || busy || autoResumeKnowledgeRef.current) return;
    const retryMs = Date.parse(knowledgeRetryAt || "");
    if (!knowledgeRetryAt || !Number.isFinite(retryMs) || retryMs > rateLimitClock) return;
    autoResumeKnowledgeRef.current = true;
    localStorage.removeItem(knowledgeRetryStorageKey);
    setKnowledgeRetryAt("");
    setStatus("Se cumplió el tiempo de espera estimado de Groq. AULIA continuará automáticamente la base conceptual desde los pasajes ya procesados…");
    Promise.resolve(buildFullKnowledgeBase()).finally(() => {
      autoResumeKnowledgeRef.current = false;
    });
  }, [draftReady, knowledgeRetryCourseId, canEdit, studioApiKey, busy, knowledgeRetryAt, rateLimitClock, knowledgeRetryStorageKey, course.id]);

  function mutate(updater, message = "Cambios pendientes de guardar.") {
    setDraft((current) => typeof updater === "function" ? updater(current) : { ...current, ...updater });
    setValidation(null); setStatus(message);
  }
  async function save() {
    if (!canEdit || busy) return;

    setBusy(true);
    try {
      const next = cloneCourse(draft);
      if (onSaveCourse) {
        const result = await onSaveCourse(next, courseMeta?.updatedAt || "");
        const version = result?.meta?.updatedAt || new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify({ version, draft: next }));
        onCourseChanged?.(cloneCourse(next));
        setStatus("Cátedra guardada en el backend.");
      } else {
        localStorage.setItem(storageKey, JSON.stringify({
          version: courseMeta?.updatedAt || "",
          draft: next,
        }));
        onCourseChanged?.(cloneCourse(next));
        setStatus("Borrador guardado en este navegador.");
      }
    } catch (err) {
      if (err?.conflict) {
        setStatus(err.message + " Usá “Recargar remoto” para continuar.");
      } else {
        setStatus(err.message || "No se pudo guardar la cátedra.");
      }
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!canEdit || busy) return;

    const hasActiveMaterial = (draft.corpus || []).some((item) =>
      (item?.scope || "included") !== "excluded" && String(item?.content || item?.explanation || item?.summary || "").trim()
    );
    if (hasActiveMaterial && !isKnowledgeBaseCurrent(draft)) {
      setStep("proposal");
      setStatus("Antes de publicar, completá la base conceptual automática de toda la bibliografía. Si el análisis quedó parcial por los límites de Groq, podés continuarlo desde el último lote.");
      return;
    }

    if (!legalAccepted) {
      setStatus("Antes de publicar, confirmá que tenés los derechos, permisos o autorizaciones necesarios sobre los materiales incorporados.");
      return;
    }

    const result = validateCourse(draft);
    if (!result.valid) {
      setValidation(result);
      setStatus("Corregí los problemas antes de publicar.");
      return;
    }

    const confirmed = window.confirm(
      "ADVERTENCIA ANTES DE PUBLICAR\n\n" +
      "Al publicar esta cátedra declarás que contás con los derechos, permisos, licencias o autorizaciones necesarios para utilizar y poner a disposición los materiales incorporados.\n\n" +
      "AULIA no verifica esos derechos ni determina la legalidad de su uso. La responsabilidad por los materiales y por el uso de la plataforma corresponde al responsable de la cátedra.\n\n" +
      "¿Confirmás que querés publicar?"
    );
    if (!confirmed) {
      setStatus("Publicación cancelada.");
      return;
    }

    if (!onPublishCourse) {
      setStatus("La publicación todavía no está conectada.");
      return;
    }

    setBusy(true);
    setStatus("Publicando la versión que acabás de validar…");
    try {
      const published = await onPublishCourse(cloneCourse(draft), courseMeta?.updatedAt || "");
      const version = published?.meta?.updatedAt || new Date().toISOString();
      localStorage.setItem(storageKey, JSON.stringify({ version, draft: cloneCourse(published?.course || draft) }));
      setValidation({ valid: true, errors: [] });
      setStatus("✓ Cátedra publicada. Esta es la versión que pueden utilizar los estudiantes.");
    } catch (err) {
      if (err?.conflict) {
        setStatus(err.message + " Usá “Recargar remoto” para continuar.");
      } else if (err?.validation) {
        setValidation(err.validation);
        setStatus(err.message || "La cátedra no puede publicarse todavía.");
      } else {
        setStatus(err.message || "No se pudo publicar la cátedra.");
      }
    } finally {
      setBusy(false);
    }
  }
  function restore() {
    const fresh = cloneCourse(course);
    localStorage.removeItem(storageKey); setDraft(fresh); onCourseChanged?.(fresh);
    setValidation(null); setStatus("Se restauró el course pack base.");
  }
  function validate() {
    const result = validateCourse(draft);
    setValidation(result); setStatus(result.valid ? "Course pack válido." : "Hay problemas que revisar.");
  }
  async function importPack(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    try {
      const imported = await readCoursePackFile(file);
      const normalized = cloneCourse(imported);
      normalized.id = course.id;
      normalized.tracking = { ...(normalized.tracking || {}), courseId: course.id };
      setDraft(normalized);
      onCourseChanged?.(cloneCourse(normalized));
      setValidation({ valid: true, errors: [] }); setStatus("Course pack importado."); setStep("overview");
    } catch (err) {
      setValidation({ valid: false, errors: [err.message] }); setStatus("No se pudo importar el course pack.");
    }
  }
  function updateMaterialSection(sectionId, patch) {
    mutate((current) => {
      const documents = (current.documents || []).map((document) => ({
        ...document,
        sections: (document.sections || []).map((section) =>
          section.id === sectionId ? { ...section, ...patch } : section
        ),
      }));

      // Scope, priority and teacher focus belong to one structural section.
      // They must never cascade to sibling or descendant sections.
      const corpus = (current.corpus || []).map((chunk) =>
        chunk.sectionId === sectionId ? { ...chunk, ...patch, sectionId } : chunk
      );

      return { ...current, documents, corpus };
    });
  }

  function setMaterialScope(sectionId, scope) {
    updateMaterialSection(sectionId, { scope });
  }

  function setMaterialPriority(sectionId, priority) {
    updateMaterialSection(sectionId, { priority });
  }

  async function processMaterialFiles(files, { forceVision = false, resumePendingId = "" } = {}) {
    if (!files.length) return;
    setAnalysisReport(null);
    setBusy(true);
    setUploadProgress(null);
    let workingDraft = cloneCourse(draft);
    let failedCount = 0;
    let multimodalDocuments = 0;
    let conventionalDocuments = 0;
    let processedPages = 0;

    try {
      for (const file of files) {
        const ext = String(file.name || "").toLowerCase().split(".").pop();
        const useVision = ext === "pdf" && Boolean(studioApiKey) && (forceVision || ingestionProvider === "groq");
        let pendingId = resumePendingId || "";
        let lastProgress = { processed: 0, total: 0 };
        try {
          if (useVision) {
            if (!pendingId) {
              const pendingRecord = await savePendingPdf(course.id, file);
              pendingId = pendingRecord.id;
            }
            setPendingPdfs(await listPendingPdfs(course.id));
          }

          // A fresh file-selection must not bypass a persisted cooldown for the same pending PDF.
          if (useVision && pendingId && !resumePendingId) {
            const priorStatus = await getPendingPdfStatus(pendingId);
            const priorBlockedUntil = Date.parse(priorStatus?.blockedUntil || "");
            if (Number.isFinite(priorBlockedUntil) && priorBlockedUntil > Date.now()) {
              const availableAt = new Date(priorBlockedUntil).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
              const message = "La cuota de Groq sigue bloqueada hasta " + availableAt + ". AULIA ya guardó la preparación y el avance; no se volvió a leer el PDF.";
              failedCount += 1;
              setUploadProgress({
                fileName: file.name,
                phase: "quota-wait",
                processed: 0,
                total: 0,
                pendingId,
                blockedUntil: priorStatus.blockedUntil,
                isDailyLimit: priorStatus.isDailyLimit,
                message,
                error: priorStatus.lastError || "",
              });
              setStatus(message);
              continue;
            }
          }

          setStatus("Preparando " + file.name + "…");
          let extracted = null;
          const cachedPreparationCandidate = useVision && pendingId
            ? await getPreparedPdf(pendingId, file)
            : null;
          // Older cache records did not persist the full extracted corpus. Re-extract
          // those once rather than resuming with only page metadata and losing the book text.
          const cachedPreparation = Array.isArray(cachedPreparationCandidate?.corpus)
            ? cachedPreparationCandidate
            : null;

          if (cachedPreparation) {
            extracted = {
              ...cachedPreparation,
              aiPages: (cachedPreparation.aiPages || []).map(page => ({
                ...page,
                imageDataUrl: "",
              })),
            };
            lastProgress = { processed: Number(extracted.pages || extracted.aiPages?.length || 0), total: Number(extracted.pages || extracted.aiPages?.length || 0) };
            setUploadProgress({
              fileName: file.name,
              phase: "restoring",
              processed: lastProgress.processed,
              total: lastProgress.total,
              message: "Preparación recuperada del navegador. No se volverá a extraer todo el PDF; solo se renderizarán las páginas visuales que hagan falta.",
              error: "",
              pendingId,
            });
          } else {
            setUploadProgress({
              fileName: file.name,
              phase: "extracting",
              processed: 0,
              total: 0,
              message: useVision
                ? "Leyendo el PDF una vez y guardando la preparación local para futuras reanudaciones…"
                : "Extrayendo el texto del documento…",
              error: "",
              pendingId,
            });
            extracted = await readMaterialFile(file, {
              includePageImages: false,
              includeAIPageText: ext === "pdf",
              includePageImagesForLowText: useVision,
              onProgress: (progress) => {
                lastProgress = { processed: progress.processed || 0, total: progress.total || 0 };
                setUploadProgress(current => ({
                  ...(current || {}),
                  fileName: file.name,
                  phase: progress.phase || "extracting",
                  processed: progress.processed || 0,
                  total: progress.total || 0,
                  message: (progress.phase === "rendering" ? "Preparando imágenes" : "Extrayendo texto") +
                    " · página " + (progress.processed || 0) + " de " + (progress.total || 0),
                  error: "",
                  pendingId,
                }));
              },
            });
            if (useVision && pendingId) {
              await savePreparedPdf(pendingId, file, extracted);
            }
          }
          let prepared = extracted;

          if (useVision && Array.isArray(extracted.aiPages) && extracted.aiPages.length) {
            let allPages = extracted.aiPages.slice().sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
            let visualPages = allPages.filter(page =>
              Boolean(page.needsVisualAnalysis) || String(page.extractedText || "").trim().length < 100
            );

            if (visualPages.length) {
              let modelName = "qwen/qwen3.8-27b";
              lastProgress = { processed: 0, total: visualPages.length };
              setUploadProgress({
                fileName: file.name,
                phase: "processing",
                processed: 0,
                total: visualPages.length,
                message: "El texto y la estructura se extraen localmente. Groq leerá solo " +
                  visualPages.length + " página(s) con poco texto o elementos visuales que requieren interpretación.",
                error: "",
                pendingId,
              });

              const reportVisionProgress = progress => {
                const processed = Number(progress.processed || 0);
                lastProgress = { processed, total: visualPages.length };
                const activePages = progress.phase === "processing-batch"
                  ? (progress.activePageNumbers || [])
                  : (progress.phase === "processing" ? (progress.pageNumbers || []) : []);
                setUploadProgress({
                  fileName: file.name,
                  phase: progress.phase || "processing",
                  processed,
                  total: visualPages.length,
                  model: progress.model || modelName,
                  activePages,
                  message: progress.phase === "rate-wait"
                    ? (progress.message || "Esperando la ventana de cuota de Groq; la extracción local permanece guardada.")
                    : progress.message || (progress.phase === "processing-batch"
                      ? "Leyendo visualmente las páginas " + activePages.join(", ") + "…"
                      : "Lectura visual selectiva en curso."),
                  error: "",
                  pendingId,
                });
              };

              const visionMaterial = {
                ...extracted,
                sourceFingerprint: [pendingId || course.id, file.name, file.size, file.lastModified].join("::"),
                aiPages: visualPages,
              };
              const cachedVisionPages = await getCachedVisionPageNumbers(visionMaterial);
              const missingImages = visualPages.filter(page =>
                !cachedVisionPages.has(Number(page.pageNumber)) &&
                !String(page.imageDataUrl || "").startsWith("data:image/")
              );

              if (missingImages.length) {
                setUploadProgress({
                  fileName: file.name,
                  phase: "rendering",
                  processed: 0,
                  total: visualPages.length,
                  message: "La extracción local ya está guardada. Renderizando únicamente " + missingImages.length + " página(s) visuales pendientes.",
                  error: "",
                  pendingId,
                });
                const rendered = await renderPdfPageImages(
                  file,
                  missingImages.map(page => page.pageNumber),
                  progress => setUploadProgress({
                    fileName: file.name,
                    phase: "rendering",
                    processed: 0,
                    total: visualPages.length,
                    activePages: [progress.pageNumber],
                    message: "Preparando página visual " + progress.processed + " de " + progress.total + ".",
                    error: "",
                    pendingId,
                  })
                );
                const imageByPage = new Map(rendered.map(page => [Number(page.pageNumber), page.imageDataUrl]));
                allPages = allPages.map(page => ({
                  ...page,
                  imageDataUrl: String(page.imageDataUrl || "").startsWith("data:image/")
                    ? page.imageDataUrl
                    : (imageByPage.get(Number(page.pageNumber)) || ""),
                }));
                const pageSet = new Set(visualPages.map(page => Number(page.pageNumber)));
                visualPages = allPages.filter(page => pageSet.has(Number(page.pageNumber)));
                extracted = { ...extracted, aiPages: allPages };
              }

              const visionImagesStillMissing = visualPages.filter(page =>
                !cachedVisionPages.has(Number(page.pageNumber)) &&
                !String(page.imageDataUrl || "").startsWith("data:image/")
              );
              if (visionImagesStillMissing.length) {
                throw new Error("No se pudieron preparar las imágenes de las páginas " +
                  visionImagesStillMissing.map(page => page.pageNumber).join(", ") +
                  ". AULIA conservó la extracción y la estructura local; no se descartará el avance.");
              }

              const visionResult = await analyzePdfWithVision(
                { ...visionMaterial, aiPages: visualPages },
                {
                  apiKey: studioApiKey,
                  courseTitle: workingDraft.title,
                  onProgress: reportVisionProgress,
                }
              );
              modelName = visionResult.model || modelName;
              prepared = applySelectiveVisualAnalysis(extracted, visionResult.pages, modelName);
              multimodalDocuments += 1;
              processedPages += visionResult.pages.length;
            } else {
              conventionalDocuments += 1;
            }
          } else {
            conventionalDocuments += 1;
          }

          if (!prepared.corpus?.length) {
            throw new Error(
              "No se pudo recuperar texto de " + file.name +
              ". Si es un PDF escaneado, seleccioná «Visión selectiva · Groq» y configurá una clave docente para recuperar el texto de las páginas sin capa de texto."
            );
          }

          const material = materialToCorpus(prepared, workingDraft.corpus || []);
          const materialDocument = material.document;
          workingDraft = {
            ...workingDraft,
            corpus: [...(workingDraft.corpus || []), ...material.corpus],
            documents: mergeImportedDocuments(workingDraft.documents || [], materialDocument ? [materialDocument] : []),
            bibliography: mergeImportedBibliography(workingDraft.bibliography || [], material.bibliography || []),
            knowledgeBase: null,
          };
          setDraft(cloneCourse(workingDraft));
          setValidation(null);
          try {
            localStorage.setItem(storageKey, JSON.stringify({
              version: courseMeta?.updatedAt || "",
              draft: workingDraft,
            }));
          } catch {}

          if (pendingId) {
            await deletePendingPdf(pendingId);
            setPendingPdfs(await listPendingPdfs(course.id));
          }
          setUploadProgress({
            fileName: file.name,
            phase: "complete",
            processed: useVision ? extracted.aiPages.length : 1,
            total: useVision ? extracted.aiPages.length : 1,
            model: prepared.aiAnalysis?.model || "",
            message: useVision
              ? "Documento incorporado. Se analizó el texto y solo se enviaron imágenes de páginas seleccionadas por contener imágenes integradas, gráficos vectoriales complejos o poco texto extraíble."
              : "Documento incorporado al corpus.",
            error: "",
            pendingId: "",
          });
        } catch (error) {
          failedCount += 1;
          const isRateLimit = Number(error?.status) === 429;
          const isDailyLimit = Boolean(error?.isDailyLimit);
          const waitMs = Math.max(0, Number(error?.retryAfterMs || 0));
          // When Groq omits a reset hint, make a bounded retry instead of requiring a manual click.
          const scheduledWaitMs = waitMs > 0 ? waitMs + 1500 : (isDailyLimit ? 24 * 60 * 60 * 1000 : 30 * 1000);
          const blockedUntil = isRateLimit
            ? new Date(Date.now() + scheduledWaitMs).toISOString()
            : "";
          let pauseMessage = "El análisis se interrumpió. AULIA conservó el PDF y la preparación local para reanudar sin volver a extraer todo el documento.";
          if (isRateLimit && isDailyLimit) {
            pauseMessage = "Se agotó la cuota diaria de Groq. La preparación y las tandas completadas están guardadas. AULIA intentará reanudar automáticamente después de " +
              new Date(blockedUntil).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) +
              (waitMs > 0 ? ", según la indicación del servicio." : "; como Groq no informó una hora exacta, esperará 24 horas antes de comprobarla otra vez para evitar reintentos diarios repetidos.");
          } else if (isRateLimit) {
            pauseMessage = "Límite temporal de Groq. La preparación está guardada; AULIA reintentará automáticamente a partir de " +
              new Date(blockedUntil).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + ".";
          }
          if (pendingId) {
            try {
              await updatePendingPdfStatus(pendingId, {
                blockedUntil,
                pauseReason: isRateLimit ? (isDailyLimit ? "daily-quota" : "temporary-rate-limit") : "",
                lastError: error?.message || "Error desconocido durante la carga.",
                isDailyLimit,
              });
            } catch {}
          }
          setUploadProgress({
            fileName: file.name,
            phase: isRateLimit ? "quota-wait" : pendingId ? "paused" : "error",
            processed: lastProgress.processed,
            total: lastProgress.total,
            message: pendingId ? pauseMessage : "No se pudo completar la carga de este archivo.",
            error: error?.message || "Error desconocido durante la carga.",
            pendingId,
            blockedUntil,
            isDailyLimit,
          });
          if (pendingId) {
            try { setPendingPdfs(await listPendingPdfs(course.id)); } catch {}
          }
          setStatus(pendingId
            ? pauseMessage + (error?.message ? " Detalle: " + error.message : "")
            : (error?.message || "No se pudo cargar el material."));
        }
      }

      if (!failedCount) {
        setStatus(
          "Carga completada." +
          (multimodalDocuments ? " " + multimodalDocuments + " PDF(s) enriquecidos con lectura visual selectiva (" + processedPages + " páginas)." : "") +
          (conventionalDocuments ? " " + conventionalDocuments + " archivo(s) segmentados localmente." : "") +
          " Revisá las secciones y generá el índice conceptual antes de publicar."
        );
      } else if (files.length > 1) {
        setStatus(failedCount + " archivo(s) quedaron pendientes. Podés reanudarlos sin volver a seleccionarlos.");
      }
    } catch (error) {
      setStatus(error?.message || "No se pudo cargar el material.");
    } finally {
      setBusy(false);
      try { setPendingPdfs(await listPendingPdfs(course.id)); } catch {}
    }
  }

  async function importMaterial(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await processMaterialFiles(files);
  }

  async function resumePendingPdf(pending) {
    if (!studioApiKey) {
      setIngestionProvider("groq");
      setShowStudioKey(true);
      setStatus("La preparación local del PDF está guardada. Configurá tu clave de Groq para reanudar solo las páginas que requieren lectura visual; no hace falta volver a cargarlo.");
      return;
    }
    setIngestionProvider("groq");
    setBusy(true);
    try {
      const pendingStatus = await getPendingPdfStatus(pending.id);
      const blockedUntilMs = Date.parse(pendingStatus?.blockedUntil || "");
      if (Number.isFinite(blockedUntilMs) && blockedUntilMs > Date.now()) {
        const availableAt = new Date(blockedUntilMs).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
        setUploadProgress({
          fileName: pendingStatus.fileName || pending.fileName,
          phase: "quota-wait",
          processed: 0,
          total: 0,
          pendingId: pending.id,
          blockedUntil: pendingStatus.blockedUntil,
          isDailyLimit: pendingStatus.isDailyLimit,
          message: (pendingStatus.isDailyLimit ? "La cuota diaria de Groq todavía no se restableció." : "El límite temporal de Groq todavía está vigente.") +
            " AULIA guardó la preparación del PDF y no volverá a leerlo. Podés reanudar después de " + availableAt + ".",
          error: pendingStatus.lastError || "",
        });
        setStatus("Todavía no conviene reanudar: Groq indicó que la cuota estará disponible después de " + availableAt + ".");
        return;
      }

      const file = await getPendingPdf(pending.id);
      if (!file) throw new Error("No se encontró el PDF guardado. Si el almacenamiento del navegador fue borrado, será necesario seleccionar el archivo otra vez.");
      await updatePendingPdfStatus(pending.id, {});
      await processMaterialFiles([file], { forceVision: true, resumePendingId: pending.id });
    } catch (error) {
      setStatus(error?.message || "No se pudo recuperar el PDF pendiente.");
    } finally {
      setBusy(false);
      try { setPendingPdfs(await listPendingPdfs(course.id)); } catch {}
    }
  }

  async function discardPendingPdf(pending) {
    try {
      await deletePendingPdf(pending.id);
      setPendingPdfs(await listPendingPdfs(course.id));
      setStatus("Se descartó el archivo pendiente " + pending.fileName + ".");
      if (uploadProgress?.pendingId === pending.id) setUploadProgress(null);
    } catch (error) {
      setStatus(error?.message || "No se pudo descartar el archivo pendiente.");
    }
  }

  function addBibliography() {
    mutate((c) => ({ ...c, bibliography: [...(c.bibliography || []), {
      id: uniqueId("bibliografia", c.bibliography), title: "Nueva referencia", author: "", publisher: "", year: "", role: "complementaria"
    }] }));
  }
  function edit(collection, index, patch) {
    mutate((c) => {
      const items = [...(c[collection] || [])];
      items[index] = { ...items[index], ...patch };
      return { ...c, [collection]: items };
    });
  }
  function remove(collection, index) {
    mutate((c) => {
      const items = [...(c[collection] || [])];
      const removed = items[index];
      const next = items.filter((_, i) => i !== index);

      if (collection !== "pedagogicalUnits" || !removed?.id) {
        return { ...c, [collection]: next };
      }

      const nextMap = c.curriculumMap
        ? {
            ...c.curriculumMap,
            sequence: (c.curriculumMap.sequence || []).filter((id) => id !== removed.id),
            reviewStatus: "pending",
          }
        : c.curriculumMap;

      return {
        ...c,
        pedagogicalUnits: next.map((unit) => ({
          ...unit,
          prerequisiteUnitIds: (unit.prerequisiteUnitIds || []).filter((id) => id !== removed.id),
        })),
        curriculumMap: nextMap,
      };
    });
  }
  function addMode(strategy) {
    const preset = MODES[strategy] || MODES.retrieve;
    mutate((c) => ({ ...c, modes: [...(c.modes || []), {
      id: uniqueId(slug(strategy), c.modes), title: preset[0], description: "Modalidad de interacción del curso.",
      pedagogicalGoal: preset[1], placeholder: preset[2], strategy, instructions: ""
    }] }));
  }
  function removeMode(index) {
    const id = draft.modes?.[index]?.id;
    if ((draft.activities || []).some((a) => a.modeId === id)) {
      setStatus("No se puede eliminar el modo porque una actividad todavía lo utiliza."); return;
    }
    remove("modes", index);
  }
  function addActivity() {
    mutate((c) => ({ ...c, activities: [...(c.activities || []), {
      id: uniqueId("actividad", c.activities), title: "Nueva actividad", modeId: c.modes?.[0]?.id || "", description: ""
    }] }));
  }
  function addCommission() {
    mutate((c) => ({ ...c, commissions: [...(c.commissions || []), {
      id: uniqueId("comision", c.commissions), title: "Nueva comisión", code: ""
    }] }));
  }
  function proposeConceptsLocal() {
    const corpus = draft.corpus || [];
    if (!corpus.length) { setStep("material"); setStatus("Primero cargá material."); return; }
    const seen = new Set((draft.concepts || []).map((x) => slug(x.title)));
    const additions = [];
    for (const chunk of corpus) {
      const rawTitle = String(chunk.chapter || chunk.title || "").trim();
      if (!rawTitle || /^REGLA ABSOLUTA$/i.test(rawTitle)) continue;
      const key = slug(rawTitle);
      if (seen.has(key)) continue;
      seen.add(key);
      additions.push({
        id: uniqueId(key, [...(draft.concepts || []), ...additions]),
        title: rawTitle.replace(/^CAPÍTULO\s+\d+\s*:\s*/i, ""),
        chapter: chunk.chapter || "",
        summary: firstSentence(chunk.content),
        explanation: "",
        aliases: [],
        keywords: [],
        sourceCorpusIds: chunk.id ? [chunk.id] : [],
        suggested: true,
      });
    }
    if (!additions.length) { setStep("proposal"); setStatus("No encontré unidades nuevas."); return; }
    mutate((c) => ({ ...c, concepts: [...(c.concepts || []), ...additions] }),
      additions.length + " unidades propuestas. Revisalas antes de publicar.");
    setStep("proposal");
  }

  function approveAllPedagogicalUnits() {
    const units = draft.pedagogicalUnits || [];
    if (!units.length) return;
    mutate((c) => ({
      ...c,
      pedagogicalUnits: (c.pedagogicalUnits || []).map((unit) => ({
        ...unit,
        reviewStatus: "approved",
      })),
    }), "Todas las unidades pedagógicas fueron aprobadas.");
  }

  function approveCurriculumMap() {
    if (!draft.curriculumMap?.sequence?.length) return;
    mutate((c) => ({
      ...c,
      curriculumMap: {
        ...(c.curriculumMap || {}),
        reviewStatus: "approved",
      },
    }), "El mapa curricular fue aprobado.");
  }

  function moveCurriculumUnit(index, direction) {
    mutate((c) => {
      const currentSequence = Array.isArray(c.curriculumMap?.sequence)
        ? [...c.curriculumMap.sequence]
        : (c.pedagogicalUnits || []).map((unit) => unit.id).filter(Boolean);
      const target = index + direction;
      if (index < 0 || target < 0 || index >= currentSequence.length || target >= currentSequence.length) return c;
      [currentSequence[index], currentSequence[target]] = [currentSequence[target], currentSequence[index]];
      return {
        ...c,
        curriculumMap: {
          ...(c.curriculumMap || {}),
          sequence: currentSequence,
          reviewStatus: "pending",
        },
      };
    }, "Orden curricular modificado. Revisá el mapa antes de publicar.");
  }

  function setCurriculumPrerequisites(unitId, value) {
    mutate((c) => {
      const byTitle = new Map((c.pedagogicalUnits || []).map((unit) => [slug(unit.title), unit.id]));
      const ids = Array.from(new Set(
        list(value)
          .map((title) => byTitle.get(slug(title)))
          .filter((id) => id && id !== unitId)
      ));
      return {
        ...c,
        pedagogicalUnits: (c.pedagogicalUnits || []).map((unit) =>
          unit.id === unitId ? { ...unit, prerequisiteUnitIds: ids } : unit
        ),
        curriculumMap: c.curriculumMap
          ? { ...c.curriculumMap, reviewStatus: "pending" }
          : c.curriculumMap,
      };
    }, "Dependencias curriculares actualizadas.");
  }

  function buildLocalCurriculumMap() {
    const units = [...(draft.pedagogicalUnits || [])];
    if (!units.length) {
      setStatus("Primero generá unidades pedagógicas.");
      return;
    }
    const pageFor = (unit) => {
      const pages = (unit.sourceCorpusIds || [])
        .map((sourceId) => draft.corpus?.find((chunk) => chunk.id === sourceId)?.sourcePageStart)
        .map(Number)
        .filter((page) => Number.isFinite(page) && page > 0);
      return pages.length ? Math.min(...pages) : Number.MAX_SAFE_INTEGER;
    };
    const ordered = units
      .slice()
      .sort((a, b) => pageFor(a) - pageFor(b) || String(a.title || "").localeCompare(String(b.title || ""), "es"))
      .map((unit) => unit.id)
      .filter(Boolean);

    mutate((c) => ({
      ...c,
      curriculumMap: {
        title: "Mapa curricular inicial",
        rationale: "Orden inicial construido localmente a partir de la secuencia de lectura de las unidades. No representa todavía una inferencia pedagógica de IA.",
        reviewStatus: "pending",
        suggested: true,
        suggestionSource: "local",
        sequence: ordered,
      },
    }), "Mapa curricular inicial generado a partir del orden del material.");
  }

  function saveTeacherKey() {
    const trimmed = studioKeyInput.trim();
    if (!isGroqApiKey(trimmed)) {
      setStatus('La clave no parece ser una API key de Groq. Debería comenzar con "gsk_".');
      return;
    }
    saveStudioApiKey(course.id, trimmed);
    setStudioApiKey(trimmed);
    setIngestionProvider("groq");
    setStudioKeyInput("");
    setShowStudioKey(false);
    setStatus("IA docente configurada en esta sesión del navegador.");
  }

  function forgetTeacherKey() {
    clearStudioApiKey(course.id);
    setStudioApiKey("");
    setStudioKeyInput("");
    setShowStudioKey(false);
    setStatus("Se eliminó la clave de IA docente de esta sesión.");
  }

  function downloadExternalKnowledgeSource() {
    if (!externalPassages.length) {
      setStatus("No hay pasajes activos para preparar. Revisá la bibliografía y el alcance de las secciones.");
      return;
    }
    const pack = createExternalKnowledgePackage({ course: draft, passages: externalPassages });
    downloadJsonFile(pack, slug(draft.title) + "-aulia-para-ia-externa.json");
    setStatus("Archivo preparado. Subilo a la IA que prefieras y pegá las instrucciones copiadas desde Studio.");
  }

  async function copyExternalPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("El navegador no habilitó el portapapeles.");
      await navigator.clipboard.writeText(externalPrompt);
      setShowExternalPrompt(false);
      setStatus("Instrucciones copiadas. Pegalas en el chat de la IA externa después de adjuntar el archivo JSON.");
    } catch {
      setShowExternalPrompt(true);
      setStatus("No se pudo copiar automáticamente. Seleccioná el texto de instrucciones que aparece abajo y copialo manualmente.");
    }
  }

remove obsolete external page-analysis handlers  async function importExternalKnowledge(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    setBusy(true);
    setStatus("Validando los archivos de análisis externo…");
    const expectedSignature = knowledgeCorpusSignature(draft.corpus || []);
    const legacyIndexCanResume = draft.knowledgeBase?.version === 1 &&
      draft.knowledgeBase?.sourceSignature === legacyKnowledgeCorpusSignature(draft.corpus || []);
    let nextIndex = draft.knowledgeBase &&
      draft.knowledgeBase.sourceSignature === expectedSignature &&
      draft.knowledgeBase.version === KNOWLEDGE_BASE_VERSION
      ? cloneCourse(draft.knowledgeBase)
      : legacyIndexCanResume
        ? {
            ...cloneCourse(draft.knowledgeBase),
            version: KNOWLEDGE_BASE_VERSION,
            sourceSignature: expectedSignature,
            status: "partial",
            totalPassages: externalPassages.length,
            processedPassageIds: (draft.knowledgeBase.processedPassageIds || [])
              .filter(id => externalPassages.some(passage => passage.passageId === id)),
            updatedAt: new Date().toISOString(),
          }
        : null;
    const passagesById = new Map(externalPassages.map(passage => [passage.passageId, passage]));
    const passagePosition = new Map(externalPassages.map((passage, index) => [passage.passageId, index]));
    const failures = [];
    let importedFiles = 0;
    let importedConcepts = 0;

    try {
      for (const file of files) {
        try {
          const rawText = await file.text();
          let parsed;
          try {
            const cleanedJson = rawText.replace(/^\uFEFF/, "").trim()
              .replace(/^\x60{3}(?:json)?\s*/i, "")
              .replace(/\s*\x60{3}$/, "")
              .trim();
            parsed = JSON.parse(cleanedJson);
          } catch {
            throw new Error("El archivo no contiene JSON válido. Guardá la respuesta de la IA como .json, sin texto adicional.");
          }

          if (parsed?.format !== EXTERNAL_KNOWLEDGE_OUTPUT_FORMAT) {
            throw new Error("No reconoce el formato de salida de AULIA. Copiá las instrucciones del Studio y pedile a la IA que respete el formato JSON indicado.");
          }
          if (parsed?.version !== KNOWLEDGE_BASE_VERSION) {
            throw new Error("La versión del archivo no es compatible con esta versión de AULIA.");
          }
          if (parsed?.sourceSignature !== expectedSignature) {
            throw new Error("Este resultado corresponde a otra versión de la bibliografía. Volvé a exportar el material y generar el análisis.");
          }
          if (Number(parsed?.totalPassages) !== externalPassages.length) {
            throw new Error("El total de pasajes del archivo no coincide con la bibliografía actual.");
          }
          if (!Array.isArray(parsed?.processedPassageIds) || !Array.isArray(parsed?.entries)) {
            throw new Error("Faltan processedPassageIds o entries en el archivo JSON.");
          }

          const processedIds = parsed.processedPassageIds.map(value => String(value || "").trim()).filter(Boolean);
          const uniqueProcessedIds = Array.from(new Set(processedIds));
          if (!uniqueProcessedIds.length) {
            throw new Error("El archivo no declara ningún pasaje revisado.");
          }
          const unknownIds = uniqueProcessedIds.filter(id => !passagesById.has(id));
          if (unknownIds.length) {
            throw new Error("El resultado contiene IDs de pasajes que no pertenecen a esta bibliografía: " + unknownIds.slice(0, 3).join(", "));
          }
          if (uniqueProcessedIds.length !== processedIds.length) {
            throw new Error("El archivo repite IDs dentro de processedPassageIds. Pedile a la IA que devuelva cada ID una sola vez.");
          }
          const positions = uniqueProcessedIds.map(id => passagePosition.get(id)).sort((a, b) => a - b);
          if (positions[positions.length - 1] - positions[0] + 1 !== positions.length) {
            throw new Error("Los IDs de este archivo no forman una tanda consecutiva. Pedile a la IA que procese los pasajes en orden y no mezcle tandas.");
          }

          const processedSet = new Set(uniqueProcessedIds);
          const relevantPassages = uniqueProcessedIds.map(id => passagesById.get(id));
          for (const [entryIndex, entry] of parsed.entries.entries()) {
            if (!String(entry?.term || "").trim()) {
              throw new Error("La entrada conceptual " + (entryIndex + 1) + " no tiene term.");
            }
            if (!Array.isArray(entry?.evidence) || !entry.evidence.length) {
              throw new Error("La entrada “" + String(entry.term).slice(0, 80) + "” no incluye evidencia bibliográfica.");
            }
            for (const evidence of entry.evidence) {
              const passageId = String(evidence?.passageId || "");
              if (!passagesById.has(passageId) || !processedSet.has(passageId)) {
                throw new Error("La entrada “" + String(entry.term).slice(0, 80) + "” cita un pasaje que no fue declarado como revisado en este archivo.");
              }
              if (!isSupportedKnowledgeExcerpt(passagesById.get(passageId).text, evidence?.excerpt)) {
                throw new Error("La cita de evidencia de “" + String(entry.term).slice(0, 80) + "” no coincide literalmente con el pasaje original. Pedile a la IA que use una cita breve copiada del archivo.");
              }
            }
          }

          const normalizedEntries = normalizeExternalKnowledgeEntries(parsed.entries, relevantPassages);
          if (parsed.entries.length && !normalizedEntries.length) {
            throw new Error("No se pudo validar ninguna entrada. Revisá que cada concepto tenga term y evidencia vinculada a un ID real.");
          }

          if (!nextIndex) {
            nextIndex = {
              version: KNOWLEDGE_BASE_VERSION,
              sourceSignature: expectedSignature,
              status: "partial",
              totalPassages: externalPassages.length,
              processedPassageIds: [],
              entries: [],
              requestCount: 0,
              updatedAt: new Date().toISOString(),
            };
          }

          const mergedProcessed = new Set([
            ...(nextIndex.processedPassageIds || []),
            ...uniqueProcessedIds,
          ]);
          const allPassageIds = externalPassages.map(passage => passage.passageId);
          const orderedProcessed = allPassageIds.filter(id => mergedProcessed.has(id));
          const mergedEntries = mergeKnowledgeBaseEntries(nextIndex.entries || [], normalizedEntries);
          const complete = orderedProcessed.length === allPassageIds.length;

          nextIndex = {
            ...nextIndex,
            version: KNOWLEDGE_BASE_VERSION,
            sourceSignature: expectedSignature,
            status: complete ? "complete" : "partial",
            totalPassages: externalPassages.length,
            processedPassageIds: orderedProcessed,
            entries: mergedEntries,
            model: "Análisis externo",
            updatedAt: new Date().toISOString(),
          };
          importedFiles += 1;
          importedConcepts += normalizedEntries.length;
        } catch (err) {
          failures.push(file.name + ": " + (err?.message || "No se pudo importar el archivo."));
        }
      }

      if (!importedFiles || !nextIndex) {
        throw new Error(failures.join("\n") || "No se pudo importar ningún archivo.");
      }

      const nextDraft = { ...cloneCourse(draft), knowledgeBase: nextIndex };
      setDraft(nextDraft);
      setValidation(null);
      setKnowledgeBaseReport({
        status: nextIndex.status === "complete" ? "complete" : "partial",
        processed: nextIndex.processedPassageIds.length,
        total: nextIndex.totalPassages,
        entries: nextIndex.entries.length,
        requests: nextIndex.requestCount || 0,
        model: "Análisis externo",
        error: "",
      });
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          version: courseMeta?.updatedAt || "",
          draft: nextDraft,
        }));
      } catch {}

      const coverage = nextIndex.processedPassageIds.length + "/" + nextIndex.totalPassages + " pasajes";
      const failureText = failures.length
        ? " No se importaron " + failures.length + " archivo(s): " + failures.slice(0, 2).join(" · ")
        : "";
      setStatus(
        "Se importaron " + importedFiles + " archivo(s) de análisis externo (" + importedConcepts +
        " entradas revisadas). Cobertura acumulada: " + coverage + ". " +
        (nextIndex.status === "complete"
          ? "La base conceptual está completa. Guardá la cátedra para conservarla y después publicá."
          : "Podés importar más resultados de la misma conversación de IA hasta completar todos los pasajes.") +
        failureText
      );
    } catch (err) {
      setStatus(err?.message || "No se pudo importar el análisis externo.");
    } finally {
      setBusy(false);
    }
  }

  async function buildFullKnowledgeBase() {
    if (!draft.corpus?.length) {
      setStep("material");
      setStatus("Primero cargá bibliografía.");
      return;
    }
    if (!studioApiKey) {
      setKnowledgeProvider("groq");
      setShowStudioKey(true);
      setStep("material");
      setStatus("Para analizar con Groq, configurá tu clave de IA docente en el paso Bibliografía. También podés elegir análisis externo.");
      return;
    }

    const analyzableFragments = (draft.corpus || []).filter((item) =>
      String(item?.content || item?.explanation || item?.summary || "").trim()
    );
    if (!analyzableFragments.length) {
      setStatus("No hay texto extraíble en la bibliografía. Revisá la carga de los documentos antes de analizarlos.");
      return;
    }

    const courseSnapshot = cloneCourse(draft);
    let latestIndex = courseSnapshot.knowledgeBase || null;
    localStorage.removeItem(knowledgeRetryStorageKey);
    setKnowledgeRetryAt("");
    setBusy(true);
    setKnowledgeBaseReport({
      status: "processing",
      processed: latestIndex?.processedPassageIds?.length || 0,
      total: latestIndex?.totalPassages || 0,
      entries: latestIndex?.entries?.length || 0,
      requests: latestIndex?.requestCount || 0,
      error: "",
    });
    setStatus("Preparando la base conceptual de toda la bibliografía. El proceso se realiza por tandas y se puede reanudar si hay límites temporales.");

    const persistProgress = (index) => {
      latestIndex = index;
      const next = { ...courseSnapshot, knowledgeBase: index };
      setDraft(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          version: courseMeta?.updatedAt || "",
          draft: next,
        }));
      } catch {}
    };

    try {
      const result = await buildKnowledgeBase({
        apiKey: studioApiKey,
        course: courseSnapshot,
        corpus: courseSnapshot.corpus || [],
        endpoint: courseSnapshot.llm?.endpoint,
        models: courseSnapshot.llm?.models,
        existingIndex: courseSnapshot.knowledgeBase,
        onProgress: (progress) => {
          persistProgress(progress.index);
          const complete = Boolean(progress.complete);
          setKnowledgeBaseReport({
            status: complete ? "complete" : progress.error ? "partial" : "processing",
            processed: progress.processed || 0,
            total: progress.total || 0,
            entries: progress.entries || 0,
            requests: progress.requests || 0,
            model: progress.model || "",
            error: progress.error || "",
          });
          if (complete) {
            setStatus("Base conceptual completa. Ahora revisá el alcance y la prioridad pedagógica de cada sección; después guardá y publicá.");
          } else if (progress.error) {
            setStatus(progress.error);
          } else {
            setStatus("Analizando bibliografía: " + (progress.processed || 0) + "/" + (progress.total || 0) +
              " pasajes · " + (progress.entries || 0) + " entradas conceptuales.");
          }
        },
      });

      const next = { ...courseSnapshot, knowledgeBase: result };
      latestIndex = result;
      setDraft(next);
      setValidation(null);
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          version: courseMeta?.updatedAt || "",
          draft: next,
        }));
      } catch {}
      localStorage.removeItem(knowledgeRetryStorageKey);
      setKnowledgeRetryAt("");
      setKnowledgeBaseReport({
        status: "complete",
        processed: result.processedPassageIds?.length || 0,
        total: result.totalPassages || 0,
        entries: result.entries?.length || 0,
        requests: result.requestCount || 0,
        model: result.model || "",
        error: "",
      });
      setStatus("Base conceptual completa: " + (result.entries?.length || 0) +
        " entradas con referencias a la bibliografía. Guardá la cátedra y después publicá la versión actualizada.");
    } catch (err) {
      const isRateLimit = Number(err?.status) === 429;
      if (isRateLimit) {
        const retryDelayMs = Math.max(0, Number(err?.retryAfterMs || 0));
        const fallbackDelayMs = err?.isDailyLimit ? 24 * 60 * 60 * 1000 : 30 * 1000;
        const retryAt = new Date(Date.now() + (retryDelayMs > 0 ? retryDelayMs + 1500 : fallbackDelayMs)).toISOString();
        localStorage.setItem(knowledgeRetryStorageKey, retryAt);
        setKnowledgeRetryAt(retryAt);
      } else {
        localStorage.removeItem(knowledgeRetryStorageKey);
        setKnowledgeRetryAt("");
      }
      if (latestIndex) {
        const next = { ...courseSnapshot, knowledgeBase: latestIndex };
        setDraft(next);
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            version: courseMeta?.updatedAt || "",
            draft: next,
          }));
        } catch {}
      }
      setKnowledgeBaseReport({
        status: "partial",
        processed: latestIndex?.processedPassageIds?.length || 0,
        total: latestIndex?.totalPassages || 0,
        entries: latestIndex?.entries?.length || 0,
        requests: latestIndex?.requestCount || 0,
        model: latestIndex?.model || "",
        error: err?.message || "No se pudo completar el índice conceptual.",
      });
      const retryAtMs = Date.parse(localStorage.getItem(knowledgeRetryStorageKey) || "");
      const scheduledMessage = isRateLimit && Number.isFinite(retryAtMs)
        ? " AULIA reanudará automáticamente alrededor de " + new Date(retryAtMs).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) +
          (err?.isDailyLimit && !(Number(err?.retryAfterMs) > 0) ? ". Groq no informó la hora exacta; para evitar reintentos repetidos, la volverá a comprobar en 24 horas." : ".")
        : " El avance se conservó en el borrador local y se puede reanudar sin reprocesar los pasajes ya completados.";
      setStatus((err?.message || "No se pudo completar el índice conceptual.") + scheduledMessage);
    } finally {
      setBusy(false);
    }
  }

  async function analyzeWithAI() {
    if (!draft.corpus?.length) {
      setStep("material");
      setStatus("Primero cargá material.");
      return;
    }
    if (!studioApiKey) {
      setKnowledgeProvider("groq");
      setShowStudioKey(true);
      setStep("material");
      setStatus("Configurá tu clave de IA docente en Bibliografía o elegí una IA externa.");
      return;
    }

    setBusy(true);
    setAnalysisReport(null);
    setStatus("Analizando la estructura disponible y preparando una propuesta pedagógica…");
    try {
      const result = await requestTeacherProposal({
        apiKey: studioApiKey,
        course: draft,
        corpus: draft.corpus,
        bibliography: draft.bibliography,
        endpoint: draft.llm?.endpoint,
        models: draft.llm?.models,
      });
      const merged = mergeTeacherProposal(draft, result.proposal);
      const proposedUnits = (result.proposal?.pedagogicalUnits || []).length;
      const proposedConcepts = (result.proposal?.concepts || []).length;
      const suffix = result.truncated
        ? "Se revisaron " + result.usedFragments + " de " + result.totalFragments + " secciones representativas."
        : "Se revisaron " + result.totalFragments + " secciones.";
      const requestSuffix = result.requestCount ? " · " + result.requestCount + " consulta a Groq" : "";
      const cacheSuffix = result.cached ? " · sin consumir una consulta nueva" : "";
      const warningSuffix = result.warning ? " · " + result.warning : "";

      setAnalysisReport({
        ok: true,
        model: result.model || "",
        usedFragments: result.usedFragments || 0,
        totalFragments: result.totalFragments || 0,
        sampled: Boolean(result.truncated),
        requestCount: result.requestCount || 0,
        cached: Boolean(result.cached),
        units: proposedUnits,
        concepts: proposedConcepts,
      });

      mutate(() => merged.course,
        "Propuesta IA incorporada: " +
        proposedUnits + " unidades pedagógicas · " +
        merged.stats.concepts + " conceptos · " +
        suffix + requestSuffix + cacheSuffix + warningSuffix);
      setStatus(
        "Propuesta IA incorporada: " +
        proposedUnits + " unidades pedagógicas · " +
        merged.stats.concepts + " conceptos · " +
        suffix + requestSuffix + warningSuffix
      );
      setStep("proposal");
    } catch (err) {
      setAnalysisReport({
        ok: false,
        message: err.message || "No se pudo generar la propuesta con IA.",
      });
      setStatus(err.message || "No se pudo generar la propuesta con IA.");
    } finally {
      setBusy(false);
    }
  }

  const externalPassages = useMemo(() => buildKnowledgePassages(draft.corpus || []), [draft.corpus]);
  const externalSourceSignature = useMemo(() => knowledgeCorpusSignature(draft.corpus || []), [draft.corpus]);
  const externalPrompt = useMemo(() => createExternalKnowledgePrompt({
    courseTitle: draft.title,
    sourceSignature: externalSourceSignature,
    totalPassages: externalPassages.length,
  }), [draft.title, externalSourceSignature, externalPassages.length]);

  const knowledgeBaseCurrent = isKnowledgeBaseCurrent(draft);
  const knowledgeBaseStats = summarizeKnowledgeBase(draft.knowledgeBase);
  const currentKnowledgeSignature = knowledgeCorpusSignature(draft.corpus || []);
  const legacyKnowledgeSignature = legacyKnowledgeCorpusSignature(draft.corpus || []);
  const knowledgeBaseResumable = Boolean(
    (
      draft.knowledgeBase?.sourceSignature === currentKnowledgeSignature &&
      draft.knowledgeBase?.version === KNOWLEDGE_BASE_VERSION
    ) ||
    (
      draft.knowledgeBase?.sourceSignature === legacyKnowledgeSignature &&
      draft.knowledgeBase?.version === 1
    )
  ) && (draft.knowledgeBase?.processedPassageIds || []).length > 0;
  const materialSections = useMemo(() => buildMaterialStructure(draft), [draft.documents, draft.corpus]);
  const materialDocumentGroups = useMemo(() => {
    const documents = Array.isArray(draft.documents) ? draft.documents : [];
    const groups = [];

    for (const document of documents) {
      const id = String(document?.id || "");
      const sections = materialSections.filter((section) => String(section.documentId || "") === id);
      const fragments = (draft.corpus || []).filter((chunk) => String(chunk.documentId || "") === id);

      if (!sections.length && !fragments.length) continue;

      groups.push({
        id: id || "document-" + groups.length,
        title: document.title || document.sourceName || "Material",
        sourceName: document.sourceName || "",
        format: document.format || "",
        pages: document.pages || document.analysis?.pageCount || null,
        analysis: document.analysis || null,
        sections,
        fragmentCount: fragments.length,
      });
    }

    const knownDocumentIds = new Set(documents.map((document) => String(document?.id || "")));
    const orphanSections = materialSections.filter(
      (section) => !knownDocumentIds.has(String(section.documentId || ""))
    );

    if (orphanSections.length) {
      groups.push({
        id: "legacy-material",
        title: "Material sin documento identificado",
        sourceName: "",
        format: "",
        pages: null,
        analysis: null,
        sections: orphanSections,
        fragmentCount: orphanSections.reduce((sum, section) => sum + Number(section.fragmentCount || 0), 0),
      });
    }

    return groups;
  }, [draft.documents, draft.corpus, materialSections]);
  const counts = {
    overview: 1,
    material: materialSections.length,
    proposal: draft.pedagogicalUnits?.length || draft.concepts?.length || 0,
    interaction: draft.modes?.length || 0,
    commissions: draft.commissions?.length || 0,
  };
  const pending = (draft.pedagogicalUnits || []).filter((x) => x.suggested && x.reviewStatus === "pending").length;
  const curriculumSequence = Array.isArray(draft.curriculumMap?.sequence)
    ? draft.curriculumMap.sequence
    : [];
  const curriculumUnits = curriculumSequence
    .map((id) => draft.pedagogicalUnits?.find((unit) => unit.id === id))
    .filter(Boolean);
  const curriculumPending = draft.curriculumMap?.reviewStatus === "pending";

  return <section className="studio-wf-shell">
    <header className="studio-wf-toolbar">
      <div className="studio-wf-toolbar-title"><div className="brand">AULIA · STUDIO</div><strong>{draft.title || "Nueva cátedra"}</strong><span>Autoría de course pack · v{VERSION}</span></div>
      <div className="studio-wf-toolbar-actions">
        <label className={"ghost studio-file" + (!canEdit ? " disabled" : "")}>Importar JSON<input type="file" accept="application/json,.json" onChange={importPack} disabled={!canEdit || busy}/></label>
        <button className="ghost" type="button" onClick={restore} disabled={!canEdit || busy}>Restaurar</button>
        <button className="ghost" type="button" onClick={validate}>Validar</button>
        {onReloadCourse && <button className="ghost" type="button" onClick={onReloadCourse} disabled={busy}>Recargar remoto</button>}
        <button className="primary" type="button" onClick={save} disabled={!canEdit || busy}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </header>

    <div className="studio-wf-local-note">
      <span><b>Flujo de autoría:</b> Cátedra → Material → Organización pedagógica + mapa curricular → Interacción → Comisiones.</span>
      <small>
        {canEdit
          ? courseMeta?.status === "published"
            ? "Versión publicada activa. Los cambios que guardes quedan como borrador hasta volver a publicar."
            : courseMeta?.status === "changes-pending"
              ? "Hay cambios guardados que todavía no fueron publicados. Los estudiantes siguen usando la versión anterior."
              : "Los cambios se guardan como borrador en el backend."
          : "Esta cátedra está disponible en modo solo lectura."}
      </small>
    </div>

    <nav className="studio-wf-steps">{STEPS.map(([id, n, label], i) => <button key={id} type="button" className={step === id ? "active" : ""} onClick={() => setStep(id)}><b>{n}</b><span>{label}</span>{counts[id] > 0 && <i>{counts[id]}</i>}{i < STEPS.length - 1 && <em>→</em>}</button>)}</nav>

    <fieldset className="studio-wf-editor-fieldset" disabled={!canEdit}>
    <main className="studio-wf-main">
      {step === "overview" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 01 · CÁTEDRA</div><h1>Primero definí qué cátedra estás construyendo.</h1><p>Solo configuramos la identidad que necesita el estudiante. La estructura técnica del course pack queda fuera del camino.</p></div>
        <Panel eyebrow="IDENTIDAD" title="Datos de la cátedra" description="Estos datos organizan la instancia y presentan el curso."><div className="studio-wf-grid">
          <Field label="Nombre de la cátedra" value={draft.title} onChange={(v) => mutate({ title: v })} placeholder="Ej. Sonido para Medios Audiovisuales"/>
          <Field label="Docente / autoría" value={draft.author} onChange={(v) => mutate({ author: v })} placeholder="Nombre de la cátedra o docente"/>
          <Field label="Idioma" value={draft.language} onChange={(v) => mutate({ language: v })}/><Field label="Nivel" value={draft.level} onChange={(v) => mutate({ level: v })}/>
          <Field label="Descripción" value={draft.description} onChange={(v) => mutate({ description: v })} multiline placeholder="Una frase que explique qué trabaja la cátedra."/>
        </div></Panel>
        <Panel eyebrow="ASISTENTE" title="La identidad que tendrá AULIA" description="Solo configuramos lo visible. Las instrucciones internas quedan en Avanzado."><div className="studio-wf-grid">
          <Field label="Nombre del asistente" value={draft.assistant?.name} onChange={(v) => mutate({ assistant: { ...draft.assistant, name: v } })} placeholder="Ej. AULIA"/>
          <Field label="Subtítulo" value={draft.assistant?.shortTitle} onChange={(v) => mutate({ assistant: { ...draft.assistant, shortTitle: v } })}/>
          <Field label="Mensaje de bienvenida" value={draft.assistant?.welcomeMessage} onChange={(v) => mutate({ assistant: { ...draft.assistant, welcomeMessage: v } })} multiline/>
          <Field label="Sugerencias iniciales" value={(draft.assistant?.suggestions || []).join(", ")} onChange={(v) => mutate({ assistant: { ...draft.assistant, suggestions: list(v) } })} multiline hint="Separalas con comas."/>
        </div></Panel>
        <div className="studio-wf-next"><button className="primary" type="button" onClick={() => setStep("material")}>Continuar con el material →</button></div>
      </>}

      {step === "material" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 02 · BIBLIOGRAFÍA</div><h1>Una sola carga para preparar la base de conocimiento.</h1><p>Primero cargá los documentos: AULIA extrae el texto y detecta capítulos y secciones localmente. Después generá el índice conceptual con Groq o una IA externa, y revisá qué podrá consultar el chatbot.</p></div>
        <details className="studio-wf-source-details">
          <summary>Datos bibliográficos opcionales <span>· título, autor, editorial y año</span></summary>
          <Panel eyebrow="BIBLIOGRAFÍA" title="Referencias de la cátedra" description="Estos datos ayudan a identificar las fuentes, pero no hace falta completarlos para empezar a cargar y analizar los documentos." actions={<button className="ghost" type="button" onClick={addBibliography} disabled={!canEdit}>+ Agregar fuente</button>}>
          {draft.bibliography?.length ? <div className="studio-wf-stack">{draft.bibliography.map((x, i) => <Row key={x.id || i} title={x.title} meta={[x.author, x.year].filter(Boolean).join(" · ")} onRemove={() => remove("bibliography", i)}><div className="studio-wf-grid">
            <Field label="Título" value={x.title} onChange={(v) => edit("bibliography", i, { title: v })}/><Field label="Autor" value={x.author} onChange={(v) => edit("bibliography", i, { author: v })}/><Field label="Editorial" value={x.publisher} onChange={(v) => edit("bibliography", i, { publisher: v })}/><Field label="Año" value={x.year} onChange={(v) => edit("bibliography", i, { year: v })}/><Field label="Rol" value={x.role} onChange={(v) => edit("bibliography", i, { role: v })}/>
          </div></Row>)}</div> : <Empty title="Todavía no cargaste fuentes." text="Podés agregarlas manualmente o incorporarlas desde un JSON." action={<button className="ghost" type="button" onClick={addBibliography}>Agregar primera fuente</button>}/>}
          </Panel>
        </details>
        <Panel
          eyebrow="PREPARACIÓN DEL MATERIAL"
          title="Extracción local y lectura visual selectiva"
          description="AULIA extrae el texto y detecta capítulos y secciones localmente. Groq solo se usa, de forma opcional, para páginas escaneadas o elementos gráficos seleccionados; el índice conceptual se construye en un paso independiente."
        >
          <div className="studio-wf-knowledge-provider">
            <button type="button" className={ingestionProvider === "local" ? "active" : ""} onClick={() => setIngestionProvider("local")} disabled={!canEdit || busy} aria-pressed={ingestionProvider === "local"}>
              <strong>Extracción local</strong><span>Lectura y segmentación sin cuota de IA</span>
            </button>
            <button type="button" className={ingestionProvider === "groq" ? "active" : ""} onClick={() => setIngestionProvider("groq")} disabled={!canEdit || busy} aria-pressed={ingestionProvider === "groq"}>
              <strong>OCR y visión selectiva · Groq</strong><span>Solo para páginas sin texto suficiente o gráficos relevantes</span>
            </button>
          </div>

          {ingestionProvider === "groq" && <>
            {studioApiKey
              ? <div className="studio-wf-ai-ready"><span>● Visión selectiva disponible</span><small>El texto, los títulos y la estructura principal se procesan localmente. Groq solo recibirá imágenes de páginas seleccionadas.</small><button className="ghost" type="button" onClick={() => setShowStudioKey(true)} disabled={busy}>Cambiar clave</button></div>
              : <div className="studio-wf-ai-setup">
                  <div><strong>Clave personal de Groq</strong><span>Necesaria únicamente si el PDF contiene páginas escaneadas o elementos visuales que requieren lectura asistida.</span></div>
                  <div className="studio-wf-ai-key-row">
                    <input type="password" value={studioKeyInput} placeholder="gsk_…" autoComplete="off" onChange={(event) => setStudioKeyInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveTeacherKey(); }}/>
                    <button className="ghost" type="button" onClick={saveTeacherKey} disabled={!studioKeyInput.trim() || !canEdit || busy}>Guardar clave</button>
                  </div>
                </div>}
            {showStudioKey && studioApiKey && <div className="studio-wf-ai-setup">
              <div><strong>Cambiar clave de Groq</strong><span>Ingresá una nueva clave o quitá la actual.</span></div>
              <div className="studio-wf-ai-key-row">
                <input type="password" value={studioKeyInput} placeholder="gsk_…" autoComplete="off" onChange={(event) => setStudioKeyInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveTeacherKey(); }}/>
                <button className="ghost" type="button" onClick={saveTeacherKey} disabled={!studioKeyInput.trim() || !canEdit || busy}>Guardar clave</button>
                <button className="ghost" type="button" onClick={() => { forgetTeacherKey(); setIngestionProvider("local"); }} disabled={busy}>Quitar</button>
              </div>
            </div>}
          </>}
          {ingestionProvider === "local" && <div className="studio-wf-security-note">
            El PDF se lee y se segmenta en este navegador. Si detectamos un escaneo sin texto legible, AULIA pedirá que habilites la lectura visual con Groq o que uses OCR previamente.
          </div>}

          {uploadProgress && <div className={"studio-wf-ai-report " + (uploadProgress.phase === "complete" ? "ok" : uploadProgress.phase === "paused" || uploadProgress.phase === "quota-wait" || uploadProgress.phase === "error" ? "error" : "")}>
            <strong>{uploadProgress.phase === "complete" ? "✓ Carga completada" : uploadProgress.phase === "paused" ? "Análisis pausado; el trabajo está guardado" : uploadProgress.phase === "quota-wait" ? (uploadProgress.isDailyLimit ? "Cuota diaria de Groq agotada" : "Límite temporal de Groq; reanudación controlada") : uploadProgress.phase === "error" ? "No se pudo completar la carga" : uploadProgress.phase === "rate-wait" ? "Esperando renovación de cuota…" : uploadProgress.phase === "restoring" ? "Recuperando la preparación guardada…" : uploadProgress.phase === "processing" || uploadProgress.phase === "processing-batch" ? "IA leyendo páginas seleccionadas…" : uploadProgress.phase === "rendering" ? "Preparando páginas visuales pendientes…" : "Preparando documento…"}</strong>
            {uploadProgress.fileName && <span>{uploadProgress.fileName}</span>}
            {Number(uploadProgress.total) > 0 && <>
              <span>{uploadProgress.processed || 0} de {uploadProgress.total} {uploadProgress.phase === "restoring" ? "páginas recuperadas" : uploadProgress.phase === "rendering" ? "páginas preparadas" : uploadProgress.phase === "extracting" ? "páginas leídas" : "páginas seleccionadas analizadas"}{uploadProgress.activePages?.length ? " · ahora: " + uploadProgress.activePages.join(", ") : ""}</span>
              <progress className="studio-wf-progress" max={uploadProgress.total} value={Math.min(uploadProgress.processed || 0, uploadProgress.total)}/>
            </>}
            {uploadProgress.message && <small>{uploadProgress.message}</small>}
            {uploadProgress.model && <small>Modelo: {uploadProgress.model}</small>}
            {uploadProgress.error && <small>{uploadProgress.error}</small>}
            {(uploadProgress.phase === "paused" || uploadProgress.phase === "quota-wait") && uploadProgress.pendingId && <button className="primary" type="button" onClick={() => resumePendingPdf({ id: uploadProgress.pendingId, fileName: uploadProgress.fileName })} disabled={!canEdit || busy || Boolean(uploadProgress.blockedUntil && Date.parse(uploadProgress.blockedUntil) > rateLimitClock)}>{uploadProgress.blockedUntil && Date.parse(uploadProgress.blockedUntil) > rateLimitClock ? "Esperar restablecimiento" : "Reanudar páginas pendientes"}</button>}
          </div>}

          {pendingPdfs.length > 0 && <div className="studio-wf-stack">
            <strong>PDF guardados para reanudar</strong>
            {pendingPdfs.map(pending => <div className="studio-wf-ai-ready" key={pending.id}>
              <span>{pending.fileName}</span>
              {pending.blockedUntil && Date.parse(pending.blockedUntil) > rateLimitClock
                ? <small>{pending.isDailyLimit ? "Cuota diaria agotada." : "Límite temporal de Groq."} Reanudación habilitada después de {new Date(pending.blockedUntil).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}.</small>
                : <small>{pending.prepared
                    ? "La extracción local y el texto de las páginas ya están guardados; solo se reanudarán las páginas visuales pendientes."
                    : "PDF guardado para reanudar la extracción y la lectura visual sin volver a seleccionarlo."}</small>}
              {pending.lastError && <small>{pending.lastError}</small>}
              <div className="studio-wf-panel-actions">
                <button className="primary" type="button" onClick={() => resumePendingPdf(pending)} disabled={!canEdit || busy || Boolean(pending.blockedUntil && Date.parse(pending.blockedUntil) > rateLimitClock)}>{pending.blockedUntil && Date.parse(pending.blockedUntil) > rateLimitClock ? "Esperar restablecimiento" : pending.prepared ? "Reanudar páginas pendientes" : "Preparar y reanudar"}</button>
                <button className="ghost" type="button" onClick={() => discardPendingPdf(pending)} disabled={busy}>Descartar</button>
              </div>
            </div>)}
          </div>}
        </Panel>

        <Panel
          eyebrow="MATERIAL"
          title="Bibliografía y corpus de la cátedra"
          description="El texto y la estructura se preparan localmente. Después se genera un índice conceptual sobre los fragmentos extraídos; revisá las secciones, el alcance y la prioridad antes de publicar."
          actions={<label className={"primary studio-wf-file-btn" + (busy || (ingestionProvider === "groq" && !studioApiKey) ? " disabled" : "")}>{busy ? "Procesando…" : ingestionProvider === "groq" ? "Cargar material + lectura visual selectiva" : "Cargar material (extracción local)"}<input type="file" accept=".txt,.md,.markdown,.json,.pdf,.docx,text/plain,text/markdown,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={importMaterial} disabled={busy || (ingestionProvider === "groq" && !studioApiKey)}/></label>}
        >
          {materialSections.length ? <>
            <div className="studio-wf-stats">
              <div><strong>{materialSections.length}</strong><span>secciones estructurales</span></div>
              <div><strong>{materialDocumentGroups.length}</strong><span>documentos relevados</span></div>
              <div><strong>{draft.corpus?.length || 0}</strong><span>fragmentos de recuperación</span></div>
            </div>

            <div className="studio-wf-material-legend">
              <span><b>Incluido</b> · la IA del curso puede usarlo.</span>
              <span><b>Referencial</b> · queda disponible en Studio pero no se usa por defecto para responder a estudiantes.</span>
              <span><b>Excluir</b> · permanece en el libro cargado, pero queda fuera del corpus activo.</span>
            </div>

            <div className="studio-wf-structure-note">
              La IA analiza primero <strong>toda la bibliografía cargada</strong>. Después podés cambiar el alcance y la prioridad sin repetir el análisis: esas decisiones se aplican al recuperar información para el chatbot. Todo comienza como Incluido, con prioridad Complementario.
            </div>

            <section className="studio-wf-knowledge-setup">
              <div className="studio-wf-knowledge-setup-head">
                <div className="eyebrow">BASE DE CONOCIMIENTO · PASO 1</div>
                <h3>Analizá toda la bibliografía</h3>
                <p>Este análisis identifica conceptos y sus referencias antes de que decidas qué secciones podrá utilizar el chatbot. Se analiza todo el material cargado; el alcance y la prioridad que selecciones abajo se aplicarán después, durante la consulta.</p>
              </div>

              <div className="studio-wf-knowledge-provider">
                <button type="button" className={knowledgeProvider === "groq" ? "active" : ""} onClick={() => setKnowledgeProvider("groq")} disabled={!canEdit || busy} aria-pressed={knowledgeProvider === "groq"}>
                  <strong>IA interna · Groq</strong><span>Analizar desde AULIA con tu clave personal</span>
                </button>
                <button type="button" className={knowledgeProvider === "external" ? "active" : ""} onClick={() => setKnowledgeProvider("external")} disabled={!canEdit || busy} aria-pressed={knowledgeProvider === "external"}>
                  <strong>IA externa</strong><span>Usar ChatGPT, Claude, Gemini u otro servicio</span>
                </button>
              </div>

              {knowledgeProvider === "groq" ? <>
                <p className="studio-wf-knowledge-explainer">AULIA procesa los pasajes en tandas, conserva el progreso y reintenta los límites temporales. La clave es personal: no se publica ni se incluye en el archivo de la cátedra.</p>
                {(showStudioKey || !studioApiKey) && <div className="studio-wf-ai-setup">
                  <div><strong>Clave de IA docente</strong><span>Ingresá tu API key de Groq. Si no tenés una, podés elegir la opción de IA externa.</span></div>
                  <div className="studio-wf-ai-key-row">
                    <input type="password" value={studioKeyInput} placeholder="gsk_…" autoComplete="off" onChange={(e) => setStudioKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveTeacherKey(); }}/>
                    <button className="ghost" type="button" onClick={saveTeacherKey} disabled={!studioKeyInput.trim() || !canEdit}>Guardar clave</button>
                    {studioApiKey && <button className="ghost" type="button" onClick={forgetTeacherKey}>Quitar</button>}
                  </div>
                </div>}
                {studioApiKey && !showStudioKey && <div className="studio-wf-ai-ready"><span>● IA docente lista</span><small>La clave está en este navegador y no se exporta.</small><button className="ghost" type="button" onClick={() => setShowStudioKey(true)}>Cambiar clave</button></div>}
                <div className="studio-wf-tool-row">
                  <button className="primary" type="button" onClick={buildFullKnowledgeBase} disabled={!canEdit || !draft.corpus?.length || busy || knowledgeBaseCurrent}>
                    {busy ? "Analizando bibliografía…" : knowledgeBaseCurrent ? "Base conceptual completa" : knowledgeBaseResumable ? "Continuar análisis" : "Analizar bibliografía con Groq"}
                  </button>
                </div>
              </> : <>
                <p className="studio-wf-knowledge-explainer">AULIA prepara el texto segmentado con identificadores y referencias. La IA externa crea el índice y podés importar sus resultados por tandas, sin configurar una API key.</p>
                <details className="studio-wf-external-help">
                  <summary>Ver instrucciones paso a paso</summary>
                  <ol>
                    <li><strong>Descargá el paquete.</strong> Incluye los pasajes de todos los documentos, sus IDs, páginas y secciones. El archivo no decide qué se excluye: esa decisión se toma después en Studio.</li>
                    <li><strong>Adjuntalo a una IA.</strong> Abrí el servicio que prefieras, adjuntá el JSON y pulsá «Copiar instrucciones». Pegá las instrucciones en ese mismo chat.</li>
                    <li><strong>Procesá por tandas.</strong> Si la IA no termina en una respuesta, escribí «CONTINUAR». Guardá cada resultado como archivo .json independiente. Si solo muestra texto, copiá el JSON al Bloc de notas y guardalo como <code>resultado-01.json</code> seleccionando «Todos los archivos» y UTF-8.</li>
                    <li><strong>Importá los resultados.</strong> Podés seleccionar varios JSON a la vez. AULIA verifica la firma, los IDs y las citas, y suma la cobertura de cada archivo.</li>
                    <li><strong>Revisá las decisiones.</strong> Cuando todos los pasajes estén cubiertos, elegí Incluido, Referencial o Excluir y ajustá la prioridad en la lista de secciones que sigue.</li>
                  </ol>
                  <div className="studio-wf-tool-row">
                    <button className="primary" type="button" onClick={downloadExternalKnowledgeSource} disabled={!canEdit || !externalPassages.length || busy}>1. Descargar paquete (.json)</button>
                    <button className="ghost" type="button" onClick={copyExternalPrompt} disabled={!canEdit || !externalPassages.length || busy}>2. Copiar instrucciones</button>
                    <label className={"ghost studio-file" + (!canEdit || busy ? " disabled" : "")}>3. Importar resultado(s)<input type="file" accept="application/json,.json,text/plain,.txt" multiple onChange={importExternalKnowledge} disabled={!canEdit || busy}/></label>
                  </div>
                  <small className="studio-wf-external-note">El análisis se realiza en el servicio que elijas y queda sujeto a sus límites y políticas. No compartas material que no estés autorizado a subir a ese proveedor.</small>
                  {showExternalPrompt && <label className="studio-wf-external-prompt"><span>Instrucciones para copiar manualmente</span><textarea value={externalPrompt} readOnly onFocus={event => event.target.select()} rows={11}/></label>}
                </details>
              </>}

              <div className={"studio-wf-ai-report " + (knowledgeBaseCurrent ? "ok" : knowledgeBaseReport?.status === "partial" ? "error" : "")}>
                <strong>
                  {knowledgeBaseCurrent
                    ? "✓ Análisis conceptual completo"
                    : knowledgeBaseReport?.status === "processing"
                      ? "Analizando toda la bibliografía…"
                      : knowledgeBaseReport?.status === "partial" || draft.knowledgeBase?.status === "partial"
                        ? "Análisis parcial; se puede continuar"
                        : "Todavía no hay un análisis completo"}
                </strong>
                <span>{knowledgeBaseReport?.processed ?? knowledgeBaseStats.processedPassages}/{knowledgeBaseReport?.total ?? knowledgeBaseStats.totalPassages} pasajes analizados · {knowledgeBaseReport?.entries ?? knowledgeBaseStats.entries} entradas conceptuales</span>
                {knowledgeBaseReport?.status === "processing" && (knowledgeBaseReport.total || 0) > 0 && <progress className="studio-wf-progress" max={knowledgeBaseReport.total} value={Math.min(knowledgeBaseReport.processed || 0, knowledgeBaseReport.total)}/>}
                {(knowledgeBaseReport?.model || draft.knowledgeBase?.model) && <small>Método: {knowledgeBaseReport?.model || draft.knowledgeBase?.model}</small>}
                {knowledgeBaseReport?.error && <small>{knowledgeBaseReport.error}</small>}
                {knowledgeBaseCurrent && <small>La base corresponde al texto actual. Las decisiones de alcance y prioridad que hagas debajo se aplican sin volver a analizar la bibliografía.</small>}
                {!knowledgeBaseCurrent && <small>Antes de publicar, completá el análisis de todos los pasajes para que las respuestas puedan rastrearse hasta la bibliografía.</small>}
              </div>
            </section>

            <div className="studio-wf-material-documents">
              {materialDocumentGroups.map((documentGroup, documentIndex) => (
                <section className="studio-wf-material-document" key={documentGroup.id || documentIndex}>
                  <div className="studio-wf-material-document-head">
                    <div>
                      <span className="eyebrow">DOCUMENTO {documentIndex + 1}</span>
                      <h3>{documentGroup.title}</h3>
                      {documentGroup.sourceName && <small>{documentGroup.sourceName}{documentGroup.pages ? " · " + documentGroup.pages + " páginas" : ""}</small>}
                    </div>
                    <div className="studio-wf-material-document-count">
                      <strong>{documentGroup.sections.length}</strong>
                      <span>secciones</span>
                      <small>{documentGroup.fragmentCount} fragmentos</small>
                    </div>
                  </div>

                  {documentGroup.analysis && (
                    <div className={"studio-wf-pdf-diagnostic confidence-" + structureConfidenceLabel(documentGroup.analysis.confidence).toLowerCase()}>
                      <div className="studio-wf-pdf-diagnostic-head">
                        <div>
                          <span className="eyebrow">RELEVAMIENTO DEL PDF</span>
                          <strong>{documentGroup.title}</strong>
                          <small>{documentGroup.analysis.documentType} · método: {materialSegmentationLabel(documentGroup.analysis.method)}</small>
                        </div>
                        <div className="studio-wf-pdf-confidence">
                          <strong>{Math.round(Number(documentGroup.analysis.confidence || 0) * 100)}%</strong>
                          <span>confianza global</span>
                        </div>
                      </div>
                      <div className="studio-wf-pdf-diagnostic-grid">
                        <div><span>Páginas</span><strong>{documentGroup.analysis.pageCount || documentGroup.pages || "—"}</strong></div>
                        <div><span>Índice</span><strong>{documentGroup.analysis.tocDetected ? "Detectado" : "No detectado"}</strong></div>
                        <div><span>Marcadores</span><strong>{documentGroup.analysis.outlineDetected ? "Detectados" : "No detectados"}</strong></div>
                        <div><span>Columnas</span><strong>{documentGroup.analysis.columns?.two ? (documentGroup.analysis.columns?.one ? "Mixto" : "Dos") : "Una"}</strong></div>
                        <div><span>Secciones</span><strong>{documentGroup.analysis.sectionCount || documentGroup.sections.length}</strong></div>
                        <div><span>Revisión</span><strong>{documentGroup.analysis.lowConfidenceSections ? documentGroup.analysis.lowConfidenceSections + " requiere(n) atención" : "Sin alertas"}</strong></div>
                      </div>
                      {documentGroup.analysis.warnings?.length > 0 && (
                        <details className="studio-wf-details">
                          <summary>Advertencias del relevamiento ({documentGroup.analysis.warnings.length})</summary>
                          <ul className="studio-wf-pdf-warning-list">{documentGroup.analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                        </details>
                      )}
                    </div>
                  )}

                  <div className="studio-wf-corpus-list">
                    {documentGroup.sections.length ? documentGroup.sections.map((section, i) => (
                      <article key={section.id || i} className={"studio-wf-material-section level-" + Math.min(Number(section.level || 1), 6) + " scope-" + (section.scope || "included")}>
                        <div className="studio-wf-material-section-head">
                          <div>
                            <strong>{section.title || "Sección"}</strong>
                            {section.needsReview && <small className="studio-wf-security-note">⚠ Revisión docente recomendada{section.reviewNotes ? ": " + section.reviewNotes : ""}</small>}
                            <span>
                              {section.path?.length ? section.path.join(" › ") : "Sin jerarquía detectada"}
                              {section.printedPageStart ? " · libro pp. " + section.printedPageStart + (section.printedPageEnd && section.printedPageEnd !== section.printedPageStart ? "–" + section.printedPageEnd : "") : section.sourcePageStart ? " · PDF pp. " + section.sourcePageStart + (section.sourcePageEnd && section.sourcePageEnd !== section.sourcePageStart ? "–" + section.sourcePageEnd : "") : ""}
                            </span>
                          </div>
                          <div className="studio-wf-material-scope">
                            {MATERIAL_SCOPE_OPTIONS.map(([value, label]) => (
                              <button
                                key={value}
                                className={"studio-wf-scope-btn " + ((section.scope || "included") === value ? "active" : "")}
                                type="button"
                                onClick={() => setMaterialScope(section.id, value)}
                                disabled={!canEdit || busy}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <p>{section.preview || "Sin vista previa disponible."}{section.preview?.length >= 180 ? "…" : ""}</p>
                        {section.fullText && <details className="studio-wf-extracted-text">
                          <summary>Revisar texto que usará el chatbot ({section.fullText.length.toLocaleString("es-AR")} caracteres)</summary>
                          <pre>{section.fullText}</pre>
                        </details>}
                        {section.sourceTextOriginal && <details className="studio-wf-extracted-text">
                          <summary>Comparar con el texto original extraído automáticamente</summary>
                          <pre>{section.sourceTextOriginal}</pre>
                        </details>}
                        {section.visualElementCount > 0 && <small className="studio-wf-security-note">{section.visualElementCount} elemento(s) visual(es) interpretado(s) por IA; verificá tablas y valores antes de publicar.</small>}

                        <div className="studio-wf-material-meta">
                          <small>
                            {section.fragmentCount || 0} fragmento(s) de recuperación · {section.segmentationLabel}
                            {section.confidence ? " · confianza " + Math.round(section.confidence * 100) + "%" : ""}
                            {section.childrenCount ? " · " + section.childrenCount + " subsección(es)" : ""}
                          </small>
                          <div className="studio-wf-material-priority">
                            <span>Prioridad</span>
                            {MATERIAL_PRIORITY_OPTIONS.map(([value, label]) => (
                              <button
                                key={value}
                                className={"studio-wf-priority-btn " + ((section.priority || "normal") === value ? "active" : "")}
                                type="button"
                                onClick={() => setMaterialPriority(section.id, value)}
                                disabled={!canEdit || busy}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <details className="studio-wf-material-focus">
                          <summary>Definir foco docente</summary>
                          <div className="studio-wf-grid">
                            <Field label="Tema" value={section.teacherTopic} onChange={(v) => updateMaterialSection(section.id, { teacherTopic: v })} placeholder="Ej. Escucha audiovisual" />
                            <Field label="Conceptos" value={(section.teacherConcepts || []).join(", ")} onChange={(v) => updateMaterialSection(section.id, { teacherConcepts: list(v) })} placeholder="Ej. escucha, imagen, sincronismo" />
                            <Field label="Límite / indicación docente" value={section.teacherLimit} onChange={(v) => updateMaterialSection(section.id, { teacherLimit: v })} placeholder="Qué abordar, qué dejar en segundo plano o qué evitar" multiline />
                          </div>
                        </details>
                      </article>
                    )) : (
                      <Empty title="No se detectaron secciones estructurales." text="El documento quedó incorporado al corpus, pero todavía no hay una estructura confiable para mostrar como secciones."/>
                    )}
                    {documentGroup.sections.length > 60 && <small>Mostrando 60 de {documentGroup.sections.length} secciones de este documento.</small>}
                  </div>
                </section>
              ))}
            </div>
          </> : <Empty title="El corpus está vacío." text="Empezá cargando un PDF, DOCX, TXT, Markdown o JSON. AULIA conservará toda la estructura detectada y la dejará incluida por defecto."/>}
        </Panel>
        <div className="studio-wf-next"><button className="primary" type="button" onClick={() => setStep("proposal")}>Continuar al diseño pedagógico →</button></div>
      </>}

      {step === "proposal" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 03 · DISEÑO PEDAGÓGICO</div><h1>Diseñá la experiencia de aprendizaje.</h1><p>La base de conocimiento y su alcance se preparan en Bibliografía. Esta etapa es opcional y reúne la propuesta pedagógica y el mapa curricular; no hace falta completarla para organizar el material.</p></div>

        <Panel eyebrow="ORGANIZACIÓN PEDAGÓGICA" title="Revisión automática opcional" description="Esta revisión no reemplaza la selección docente. Sirve para experimentar con una organización posible después de haber preparado la base de conocimiento y marcado prioridades, temas y límites en Bibliografía." actions={<>
          <button className="primary" type="button" onClick={analyzeWithAI} disabled={!canEdit || !draft.corpus?.length || busy}>{busy ? "IA ocupada…" : "Revisar propuesta pedagógica"}</button>
          <button className="ghost" type="button" onClick={() => { setStep("material"); setKnowledgeProvider("groq"); setShowStudioKey(true); }} disabled={!canEdit || busy}>{studioApiKey ? "Cambiar clave IA" : "Configurar IA docente"}</button>
        </>}>
          {studioApiKey && <div className="studio-wf-ai-ready"><span>● IA docente lista</span><small>La clave se configura en Bibliografía.</small></div>}

          {analysisReport && (
            <div className={"studio-wf-ai-report " + (analysisReport.ok ? "ok" : "error")}>
              {analysisReport.ok ? (
                <>
                  <strong>✓ Análisis incorporado al borrador</strong>
                  <span>
                    {analysisReport.units} unidades pedagógicas · {analysisReport.concepts} conceptos
                    {analysisReport.usedFragments ? " · " + analysisReport.usedFragments + "/" + analysisReport.totalFragments + " secciones analizadas" : ""}
                    {analysisReport.requestCount ? " · " + analysisReport.requestCount + " consulta a Groq" : ""}
                    {analysisReport.cached ? " · reutilizado desde la sesión" : ""}
                  </span>
                  <small>{analysisReport.sampled ? "Como el material supera el tamaño práctico de una consulta gratuita, se usó una muestra representativa. La estructura completa sigue disponible localmente." : "La IA recibió todas las secciones estructurales disponibles para esta revisión."}</small>
                </>
              ) : (
                <>
                  <strong>⚠ No se pudo completar el análisis</strong>
                  <span>{analysisReport.message}</span>
                </>
              )}
            </div>
          )}

          <details className="studio-wf-details">
            <summary>Alternativas sin IA</summary>
            <div className="studio-wf-tool-row">
              <button className="ghost" type="button" onClick={proposeConceptsLocal} disabled={!canEdit || !draft.corpus?.length || busy}>Propuesta rápida por títulos y capítulos</button>
              <button className="ghost" type="button" onClick={() => mutate((c) => ({...c, concepts:[...(c.concepts || []), {id:uniqueId("concepto",c.concepts), title:"Nuevo concepto", aliases:[], keywords:[], summary:"", explanation:""}]}))}>Agregar concepto manualmente</button>
            </div>
          </details>

          <Panel
            eyebrow="MAPA CURRICULAR"
            title="Secuencia de enseñanza sugerida"
            description="AULIA ordena las unidades según una progresión conceptual y señala posibles prerrequisitos. Podés cambiar el orden y corregir las dependencias sin modificar el material original."
            actions={draft.curriculumMap?.sequence?.length ? <>
              <button className="primary" type="button" onClick={approveCurriculumMap} disabled={!canEdit || busy || !curriculumPending}>✓ Aprobar mapa</button>
              <button className="ghost" type="button" onClick={buildLocalCurriculumMap} disabled={!canEdit || busy || !draft.pedagogicalUnits?.length}>Reordenar desde el material</button>
            </> : (draft.pedagogicalUnits?.length ? <button className="primary" type="button" onClick={buildLocalCurriculumMap} disabled={!canEdit || busy}>Generar mapa inicial</button> : null)}
          >
            {curriculumUnits.length ? (
              <div className="studio-wf-stack">
                {curriculumUnits.map((unit, index) => {
                  const prerequisiteTitles = (unit.prerequisiteUnitIds || [])
                    .map((id) => draft.pedagogicalUnits?.find((candidate) => candidate.id === id)?.title)
                    .filter(Boolean);
                  return (
                    <article className="studio-wf-concept" key={unit.id || index}>
                      <div className="studio-wf-concept-head">
                        <div>
                          <strong>{index + 1}. {unit.title || "Unidad sin título"}</strong>
                          <span>{unit.phase || "Etapa curricular"}{unit.reviewStatus === "approved" ? " · Unidad aprobada" : " · Unidad pendiente"}</span>
                        </div>
                        <div className="studio-wf-panel-actions">
                          <button className="ghost" type="button" onClick={() => moveCurriculumUnit(index, -1)} disabled={!canEdit || busy || index === 0}>↑</button>
                          <button className="ghost" type="button" onClick={() => moveCurriculumUnit(index, 1)} disabled={!canEdit || busy || index === curriculumUnits.length - 1}>↓</button>
                        </div>
                      </div>
                      {unit.learningGoal && <p>{unit.learningGoal}</p>}
                      <Field
                        label="Requiere antes"
                        value={prerequisiteTitles.join(", ")}
                        onChange={(value) => setCurriculumPrerequisites(unit.id, value)}
                        placeholder="Ej. Conceptos iniciales, percepción y escucha"
                        hint="Escribí títulos de otras unidades separadas por coma. AULIA las vincula por unidad, no por texto libre."
                      />
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="Todavía no hay un mapa curricular."
                text="Revisá el material con IA para que AULIA genere una secuencia. También podés construir un orden inicial con las unidades existentes."
                action={<button className="ghost" type="button" onClick={buildLocalCurriculumMap} disabled={!canEdit || busy || !draft.pedagogicalUnits?.length}>Generar orden inicial</button>}
              />
            )}
          </Panel>

          <Panel
            eyebrow="ORGANIZACIÓN PEDAGÓGICA"
            title="Mapa sugerido por AULIA"
            description="Estas unidades son la propuesta principal. Revisá el sentido de cada bloque y aprobalo, editá el nombre/objetivo o descartalo. Descartar una unidad no elimina el material original."
            actions={pending > 0 ? <button className="primary" type="button" onClick={approveAllPedagogicalUnits} disabled={!canEdit || busy}>✓ Aprobar todas ({pending})</button> : null}
          >
            {draft.pedagogicalUnits?.length ? (
              <div className="studio-wf-stack">
                {draft.pedagogicalUnits.map((unit, i) => {
                  const unitConcepts = (unit.conceptIds || [])
                    .map((id) => draft.concepts?.find((concept) => concept.id === id)?.title)
                    .filter(Boolean);
                  const approved = unit.reviewStatus === "approved";
                  return (
                    <article className="studio-wf-concept" key={unit.id || i}>
                      <div className="studio-wf-concept-head">
                        <div>
                          <strong>{unit.title || "Unidad sin título"}</strong>
                          <span>
                            {approved ? "✓ Aprobada" : "Pendiente de revisión"}
                            {unit.sourceCorpusIds?.length ? " · " + unit.sourceCorpusIds.length + " unidad(es) de fuente" : ""}
                          </span>
                        </div>
                        <div className="studio-wf-panel-actions">
                          {!approved && (
                            <button className="ghost" type="button" onClick={() => edit("pedagogicalUnits", i, { reviewStatus: "approved" })} disabled={!canEdit || busy}>
                              ✓ Aprobar
                            </button>
                          )}
                          {approved && (
                            <button className="ghost" type="button" onClick={() => edit("pedagogicalUnits", i, { reviewStatus: "pending" })} disabled={!canEdit || busy}>
                              Marcar para revisar
                            </button>
                          )}
                          <button className="studio-wf-danger" type="button" onClick={() => remove("pedagogicalUnits", i)} disabled={!canEdit || busy}>
                            Descartar
                          </button>
                        </div>
                      </div>
                      <div className="studio-wf-grid">
                        <Field
                          label="Nombre de la unidad"
                          value={unit.title}
                          onChange={(v) => edit("pedagogicalUnits", i, { title: v })}
                          placeholder="Ej. El valor añadido y la sincronización"
                        />
                        <Field
                          label="Qué debería comprender el estudiante"
                          value={unit.learningGoal}
                          onChange={(v) => edit("pedagogicalUnits", i, { learningGoal: v })}
                          multiline
                        />
                        <Field
                          label="Por qué AULIA propone esta unidad"
                          value={unit.rationale}
                          onChange={(v) => edit("pedagogicalUnits", i, { rationale: v })}
                          multiline
                        />
                      </div>
                      {unitConcepts.length > 0 && (
                        <div className="studio-wf-concept-source">
                          <strong>Conceptos relacionados:</strong> {unitConcepts.join(" · ")}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="Todavía no hay una organización pedagógica."
                text="Cargá material y usá “Revisar material con IA”."
              />
            )}
          </Panel>

          {draft.concepts?.length ? <div className="studio-wf-stack">{draft.concepts.map((x, i) => {
            const sourceNames = (x.sourceBibliographyIds || [])
              .map((id) => draft.bibliography?.find((ref) => ref.id === id))
              .filter(Boolean)
              .map((ref) => [ref.title, ref.author, ref.year].filter(Boolean).join(" · "));
            return <article className="studio-wf-concept" key={x.id || i}><div className="studio-wf-concept-head"><div><strong>{x.title || "Sin título"}</strong><span>{x.suggested ? "Propuesto por AULIA" : "Editado por la cátedra"}{x.chapter ? " · " + x.chapter : ""}</span></div><button className="studio-wf-danger" type="button" onClick={() => remove("concepts", i)}>Eliminar</button></div>
            {sourceNames.length > 0 && <div className="studio-wf-concept-source"><strong>Bibliografía:</strong> {sourceNames.join(" · ")}</div>}
            <div className="studio-wf-grid"><Field label="Título" value={x.title} onChange={(v) => edit("concepts", i, {title:v, suggested:false})}/><Field label="Unidad / capítulo" value={x.chapter} onChange={(v) => edit("concepts", i, {chapter:v})}/><Field label="Resumen" value={x.summary} onChange={(v) => edit("concepts", i, {summary:v})} multiline/><Field label="Explicación docente (opcional)" value={x.explanation} onChange={(v) => edit("concepts", i, {explanation:v})} multiline/></div>
            {x.confusionCriteria?.length > 0 && <details className="studio-wf-details"><summary>Criterios de posible confusión</summary><ul className="studio-wf-concept-criteria">{x.confusionCriteria.map((item, j) => <li key={j}>{item}</li>)}</ul></details>}
            <details className="studio-wf-details"><summary>Detalles opcionales de recuperación</summary><div className="studio-wf-grid"><Field label="Aliases" value={(x.aliases || []).join(", ")} onChange={(v) => edit("concepts", i, {aliases:list(v)})} hint="Sinónimos o formas alternativas."/><Field label="Palabras clave" value={(x.keywords || []).join(", ")} onChange={(v) => edit("concepts", i, {keywords:list(v)})}/></div></details></article>; })}</div> : <Empty title="Todavía no hay una propuesta." text="Cargá material y elegí “Analizar con IA”. También podés usar una propuesta rápida sin IA."/>}
        </Panel>
        <Panel eyebrow="EJEMPLOS" title="Ejemplos y obras" description="Conectan el corpus con escenas, obras o casos. Son opcionales al comienzo." actions={<button className="ghost" type="button" onClick={() => mutate((c) => ({...c, examples:[...(c.examples || []), {id:uniqueId("ejemplo",c.examples), title:"Nuevo ejemplo", director:"", concepts:[]}]}))}>+ Agregar ejemplo</button>}>
          {draft.examples?.length ? <div className="studio-wf-stack">{draft.examples.map((x, i) => <Row key={x.id || i} title={x.title} meta={x.director} onRemove={() => remove("examples", i)}><div className="studio-wf-grid"><Field label="Obra / ejemplo" value={x.title} onChange={(v) => edit("examples", i, {title:v})}/><Field label="Autor / director" value={x.director} onChange={(v) => edit("examples", i, {director:v})}/><Field label="Descripción" value={x.description} onChange={(v) => edit("examples", i, {description:v})} multiline/><Field label="Conceptos relacionados" value={(x.concepts || []).join(", ")} onChange={(v) => edit("examples", i, {concepts:list(v)})}/></div></Row>)}</div> : <Empty title="Todavía no hay ejemplos." text="Podés agregarlos después, cuando tengas una selección de escenas o casos."/>}
        </Panel>
        <div className="studio-wf-next"><button className="primary" type="button" onClick={() => setStep("interaction")}>Configurar interacción →</button></div>
      </>}

      {step === "interaction" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 04 · INTERACCIÓN</div><h1>Definí cómo va a trabajar AULIA con el estudiante.</h1><p>Elegís una modalidad pedagógica. El nombre de la estrategia técnica queda escondido en la configuración avanzada.</p></div>
        <Panel eyebrow="MODOS" title="Modalidades de interacción" description="Todas las modalidades pueden compartir corpus y unidades." actions={<div className="studio-wf-mode-add">{Object.entries(MODES).slice(0,4).map(([id, p]) => <button className="ghost" key={id} type="button" onClick={() => addMode(id)}>+ {p[0]}</button>)}</div>}>
          <div className="studio-wf-stack">{(draft.modes || []).map((x, i) => <article className="studio-wf-mode-card" key={x.id || i}><div className="studio-wf-mode-head"><div><strong>{x.title}</strong><span>{MODES[x.strategy]?.[0] || "Interacción"} · objetivo: {x.pedagogicalGoal}</span></div><button className="studio-wf-danger" type="button" onClick={() => removeMode(i)}>Eliminar</button></div><div className="studio-wf-grid"><Field label="Nombre visible" value={x.title} onChange={(v) => edit("modes", i, {title:v})}/><label className="studio-wf-field"><span>Objetivo pedagógico</span><select value={x.pedagogicalGoal || "comprender"} onChange={(e) => edit("modes", i, {pedagogicalGoal:e.target.value})}><option>comprender</option><option>aplicar</option><option>elaborar</option><option>experimentar</option><option>diagnosticar</option></select></label><Field label="Descripción" value={x.description} onChange={(v) => edit("modes", i, {description:v})} multiline/><Field label="Texto guía del campo" value={x.placeholder} onChange={(v) => edit("modes", i, {placeholder:v})}/></div><details className="studio-wf-details"><summary>Configuración técnica</summary><div className="studio-wf-grid"><Field label="ID interno" value={x.id} onChange={(v) => edit("modes", i, {id:v})}/><Field label="Estrategia CORE" value={x.strategy} onChange={(v) => edit("modes", i, {strategy:v})}/><Field label="Instrucciones específicas" value={x.instructions} onChange={(v) => edit("modes", i, {instructions:v})} multiline/></div></details></article>)}</div>
        </Panel>
        <Panel eyebrow="ACTIVIDADES" title="Actividades de aprendizaje" description="Tareas que utilizan los modos anteriores." actions={<button className="ghost" type="button" onClick={addActivity}>+ Agregar actividad</button>}>
          {draft.activities?.length ? <div className="studio-wf-stack">{draft.activities.map((x, i) => <Row key={x.id || i} title={x.title} meta={draft.modes?.find((m) => m.id === x.modeId)?.title || "Sin modo"} onRemove={() => remove("activities", i)}><div className="studio-wf-grid"><Field label="Nombre de la actividad" value={x.title} onChange={(v) => edit("activities", i, {title:v})}/><label className="studio-wf-field"><span>Modalidad que utiliza</span><select value={x.modeId || ""} onChange={(e) => edit("activities", i, {modeId:e.target.value})}><option value="">Seleccionar…</option>{(draft.modes || []).map((m) => <option value={m.id} key={m.id}>{m.title}</option>)}</select></label><Field label="Descripción" value={x.description} onChange={(v) => edit("activities", i, {description:v})} multiline/></div></Row>)}</div> : <Empty title="Todavía no hay actividades." text="Podés sumarlas cuando definas la dinámica de la cursada."/>}
        </Panel>
        <div className="studio-wf-next"><button className="primary" type="button" onClick={() => setStep("commissions")}>Configurar comisiones →</button></div>
      </>}

      {step === "commissions" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 05 · COMISIONES</div><h1>Separá la organización de la cursada del contenido.</h1><p>Las comisiones comparten bibliografía, corpus y pedagogía. Solo registramos la organización administrativa.</p></div>
        <Panel eyebrow="CURSADA" title="Comisiones" description="Agregar una comisión no duplica el contenido." actions={<button className="ghost" type="button" onClick={addCommission} disabled={!canEdit}>+ Agregar comisión</button>}>
          {draft.commissions?.length ? <div className="studio-wf-stack">{draft.commissions.map((x, i) => <Row key={x.id || i} title={x.title} meta={x.code} onRemove={() => remove("commissions", i)}><div className="studio-wf-grid"><Field label="Nombre" value={x.title} onChange={(v) => edit("commissions", i, {title:v})}/><Field label="Código" value={x.code} onChange={(v) => edit("commissions", i, {code:v})} placeholder="Ej. A · lunes 18:00"/></div></Row>)}</div> : <Empty title="Todavía no definiste comisiones." text="Podés hacerlo ahora o dejarlo para la publicación."/>}
        </Panel>
        <Panel
          eyebrow="CIERRE"
          title="Probar, ajustar y publicar"
          description={courseMeta?.status === "published"
            ? "La versión publicada sigue activa mientras trabajás sobre el borrador. Guardá los cambios, probá nuevamente y publicá cuando estén listos."
            : "Validá la cátedra antes de publicar. Una vez publicada podés probarla como estudiante y volver al Studio para seguir editando."}
        >
          <div className="studio-wf-review-grid">
            <div><span>Cátedra</span><strong>{draft.title || "Sin definir"}</strong></div>
            <div><span>Fuentes</span><strong>{draft.bibliography?.length || 0}</strong></div>
            <div><span>Fragmentos</span><strong>{draft.corpus?.length || 0}</strong></div>
            <div><span>Unidades pedagógicas</span><strong>{draft.pedagogicalUnits?.length || 0}</strong></div>
            <div><span>Mapa curricular</span><strong>{draft.curriculumMap?.sequence?.length || 0}</strong></div>
            <div><span>Modos</span><strong>{draft.modes?.length || 0}</strong></div>
            <div><span>Actividades</span><strong>{draft.activities?.length || 0}</strong></div>
            <div><span>Comisiones</span><strong>{draft.commissions?.length || 0}</strong></div>
            <div><span>Estado</span><strong>{courseMeta?.status === "published" ? "Publicada" : courseMeta?.status === "changes-pending" ? "Cambios pendientes" : "Borrador"}</strong></div>
          </div>

          {courseMeta?.status === "published" && courseMeta?.publicUrl && (
            <div className="studio-wf-ai-ready studio-wf-publish-status">
              <span>✓ Versión publicada disponible</span>
              <small>{courseMeta.publicUrl}</small>
            </div>
          )}

          {courseMeta?.studentSheetUrl && (
            <div className="studio-wf-ai-ready studio-wf-publish-status">
              <span>✓ Padrón de alumnos vinculado</span>
              <small>La Sheet de alumnos es independiente de la administración de AULIA.</small>
              <button
                className="ghost"
                type="button"
                onClick={() => window.open(courseMeta.studentSheetUrl, "_blank", "noopener,noreferrer")}
                disabled={busy}
              >
                Abrir padrón de alumnos ↗
              </button>
            </div>
          )}

          {courseMeta?.status === "changes-pending" && (
            <div className="studio-wf-ai-ready">
              <span>• Cambios guardados sin publicar</span>
              <small>Los estudiantes todavía utilizan la versión publicada anterior.</small>
            </div>
          )}

          <div className="studio-wf-legal-acceptance">
            <label>
              <input
                type="checkbox"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
                disabled={!canEdit || busy}
              />
              <span>
                Declaro que tengo los derechos, permisos, licencias o autorizaciones necesarios para utilizar y poner a disposición los materiales incorporados en esta cátedra. Entiendo que soy responsable de su selección y uso, y que AULIA no verifica dichos derechos.
              </span>
            </label>
            <LegalNotice compact />
          </div>

          <div className="studio-wf-final-actions">
            <button className="primary" type="button" onClick={save} disabled={!canEdit || busy}>Guardar cambios</button>
            <button className="ghost" type="button" onClick={validate} disabled={busy}>Validar</button>
            <button className="ghost" type="button" onClick={() => {
              const r = validateCourse(draft);
              setValidation(r);
              if (r.valid) downloadCoursePack(draft);
              else setStatus("Corregí los problemas antes de exportar.");
            }} disabled={busy}>Exportar course pack</button>
            {courseMeta?.status === "published" && courseMeta?.publicUrl && (
              <button className="ghost" type="button" onClick={() => window.open(courseMeta.publicUrl, "_blank", "noopener,noreferrer")} disabled={busy}>
                Probar versión publicada ↗
              </button>
            )}
            <button className="primary" type="button" onClick={publish} disabled={!canEdit || courseMeta?.role !== "owner" || busy || !legalAccepted}>
              {courseMeta?.status === "published" ? "Publicar nueva versión" : "Publicar cátedra"}
            </button>
          </div>

          {courseMeta?.role !== "owner" && canEdit && (
            <p className="studio-wf-security-note">Solo el responsable de la cátedra puede publicar. Un editor puede preparar y guardar cambios para que el responsable los publique.</p>
          )}
        </Panel>
      </>}

      <section className="studio-wf-advanced"><button type="button" onClick={() => setAdvanced((x) => !x)}><span>AVANZADO</span><small>{advanced ? "Ocultar configuración técnica" : "Mostrar configuración técnica"}</small><b>{advanced ? "−" : "+"}</b></button>{advanced && <div className="studio-wf-advanced-body"><div className="studio-wf-grid"><Field label="ID interno" value={draft.id} onChange={(v) => mutate({id:v})} hint="No hace falta modificarlo durante el trabajo normal."/><Field label="Proveedor LLM" value={draft.llm?.provider} onChange={(v) => mutate({llm:{...(draft.llm || {}), provider:v}})}/><Field label="Endpoint LLM" value={draft.llm?.endpoint} onChange={(v) => mutate({llm:{...(draft.llm || {}), endpoint:v}})}/><Field label="Tracking endpoint" value={draft.tracking?.endpoint} onChange={(v) => mutate({tracking:{...(draft.tracking || {}), endpoint:v}})}/><Field label="Instrucciones internas" value={draft.assistant?.instructions} onChange={(v) => mutate({assistant:{...draft.assistant, instructions:v}})} multiline/></div><div className="studio-wf-security-note">AULIA Studio no guarda claves de API. La clave de Groq del estudiante sigue siendo local del navegador y no forma parte del course pack.</div></div>}</section>
      <footer className="studio-wf-footer">
        <span>{status || "Borrador listo para editar."}</span>
        <span>AULIA · Studio local · <LegalNotice compact /></span>
      </footer>
      {validation && <section className={"studio-wf-validation " + (validation.valid ? "valid" : "invalid")}><strong>{validation.valid ? "✓ Course pack válido" : "Hay elementos que revisar"}</strong>{!validation.valid && <ul>{validation.errors.map((x) => <li key={x}>{x}</li>)}</ul>}</section>}
    </main>
    </fieldset>
  </section>;
}
