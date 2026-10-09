import { useEffect, useMemo, useState } from "react";
import { cloneCourse, validateCourse } from "../core/courseContract.js";
import { downloadCoursePack, readCoursePackFile } from "../core/coursePackIO.js";
import { readMaterialFile, materialToCorpus, mergeImportedBibliography, mergeImportedDocuments } from "../core/materialIO.js";
import { requestTeacherProposal } from "../services/llm/teacherProposal.js";
import { buildKnowledgeBase } from "../services/llm/knowledgeBase.js";
import { isKnowledgeBaseCurrent, summarizeKnowledgeBase, knowledgeCorpusSignature } from "../core/knowledgeBase.js";
import { clearStudioApiKey, isGroqApiKey, loadStudioApiKey, saveStudioApiKey } from "../utils/studioStorage.js";
import LegalNotice from "./LegalNotice.jsx";

const STORAGE_PREFIX = "aulia:studio:";
const VERSION = "0.7";
const STEPS = [
  ["overview", "01", "Cátedra"],
  ["material", "02", "Material"],
  ["proposal", "03", "Organización"],
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
        childrenCount: Number(section.childrenCount || 0),
        scope: section.scope || "included",
        priority: section.priority || "normal",
        teacherTopic: section.teacherTopic || "",
        teacherConcepts: Array.isArray(section.teacherConcepts) ? section.teacherConcepts : [],
        teacherLimit: section.teacherLimit || "",
        fragmentCount: ordered.length,
        preview: preview.slice(0, 180),
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
      preview: String(first.content || "").slice(0, 180),
      analysis: null,
    };
  });
}
export default function Studio({ course, courseMeta = null, canEdit = true, onCourseChanged, onSaveCourse, onPublishCourse, onReloadCourse }) {
  const storageKey = useMemo(() => STORAGE_PREFIX + course.id, [course.id]);
  const [draft, setDraft] = useState(() => cloneCourse(course));
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

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      setDraft(cloneCourse(course));
      setValidation(null);
      setStatus("");
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
        return;
      }

      if (courseMeta?.updatedAt && localVersion && localVersion !== courseMeta.updatedAt) {
        setDraft(cloneCourse(course));
        setValidation(null);
        setStatus("La versión remota cambió. Se descartó el borrador local anterior.");
        localStorage.removeItem(storageKey);
        return;
      }

      setDraft(cloneCourse(localDraft));
      setValidation(null);
      setStatus("Borrador local recuperado.");
    } catch {
      localStorage.removeItem(storageKey);
      setDraft(cloneCourse(course));
    }
  }, [course, storageKey, courseMeta?.updatedAt, canEdit]);

  useEffect(() => {
    setStudioApiKey(loadStudioApiKey(course.id));
    setStudioKeyInput("");
    setShowStudioKey(false);
    setLegalAccepted(false);
    setAnalysisReport(null);
    setKnowledgeBaseReport(null);
  }, [course.id]);

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

  async function importMaterial(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setAnalysisReport(null);
    setBusy(true);
    try {
      const baseIds = [...(draft.corpus || [])];
      const collected = [];
      const bibliography = [];
      const documents = [];
      let warnings = 0;
      let pages = 0;

      for (const file of files) {
        const extracted = await readMaterialFile(file);
        const material = materialToCorpus(extracted, [...baseIds, ...collected]);
        collected.push(...material.corpus);
        bibliography.push(...(material.bibliography || []));
        if (material.document) documents.push(material.document);
        warnings += material.warnings?.length || 0;
        pages += material.pages || 0;
      }

      mutate((current) => ({
        ...current,
        corpus: [...(current.corpus || []), ...collected],
        documents: mergeImportedDocuments(current.documents || [], documents),
        bibliography: mergeImportedBibliography(current.bibliography || [], bibliography),
      }), `${collected.length} fragmentos de recuperación incorporados desde ${files.length} documento${files.length === 1 ? "" : "s"}.` +
        (pages ? ` · ${pages} páginas.` : "") +
        (warnings ? ` · ${warnings} aviso(s) de relevamiento o conversión.` : ""));
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
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

  async function buildFullKnowledgeBase() {
    if (!draft.corpus?.length) {
      setStep("material");
      setStatus("Primero cargá bibliografía.");
      return;
    }
    if (!studioApiKey) {
      setShowStudioKey(true);
      setStatus("Configurá tu clave propia de Groq para construir el índice de toda la bibliografía.");
      return;
    }

    const activeFragments = (draft.corpus || []).filter((item) =>
      (item?.scope || "included") !== "excluded" &&
      String(item?.content || item?.explanation || item?.summary || "").trim()
    );
    if (!activeFragments.length) {
      setStatus("No hay fragmentos activos para indexar. Cambiá el alcance de al menos una sección a Incluido o Referencial.");
      return;
    }

    const courseSnapshot = cloneCourse(draft);
    let latestIndex = courseSnapshot.knowledgeBase || null;
    setBusy(true);
    setKnowledgeBaseReport({
      status: "processing",
      processed: latestIndex?.processedPassageIds?.length || 0,
      total: latestIndex?.totalPassages || 0,
      entries: latestIndex?.entries?.length || 0,
      requests: latestIndex?.requestCount || 0,
      error: "",
    });
    setStatus("Preparando el análisis de toda la bibliografía. El proceso se realiza por lotes y se puede reanudar si Groq limita el uso.");

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
            setStatus("Base conceptual completa. Guardá la cátedra para conservar el índice en el backend antes de publicarla.");
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
      setStatus((err?.message || "No se pudo completar el índice conceptual.") +
        " El avance se conservó en el borrador local; corregí el límite o esperá a que se restablezca Groq y volvé a ejecutar para continuar.");
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
      setShowStudioKey(true);
      setStatus("Configurá tu clave de Groq para generar una propuesta semántica.");
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

  const knowledgeBaseCurrent = isKnowledgeBaseCurrent(draft);
  const knowledgeBaseStats = summarizeKnowledgeBase(draft.knowledgeBase);
  const knowledgeBaseResumable = Boolean(
    draft.knowledgeBase?.sourceSignature === knowledgeCorpusSignature(draft.corpus || []) &&
    (draft.knowledgeBase?.processedPassageIds || []).length > 0
  );
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
        <div className="studio-wf-hero"><div className="eyebrow">PASO 02 · MATERIAL</div><h1>Cargá la bibliografía y el material de trabajo.</h1><p>AULIA primero organiza el documento y después propone su estructura pedagógica. No necesitás crear conceptos ni fragmentos a mano.</p></div>
        <Panel eyebrow="BIBLIOGRAFÍA" title="Fuentes de la cátedra" description="Libros, apuntes o materiales principales." actions={<button className="ghost" type="button" onClick={addBibliography} disabled={!canEdit}>+ Agregar fuente</button>}>
          {draft.bibliography?.length ? <div className="studio-wf-stack">{draft.bibliography.map((x, i) => <Row key={x.id || i} title={x.title} meta={[x.author, x.year].filter(Boolean).join(" · ")} onRemove={() => remove("bibliography", i)}><div className="studio-wf-grid">
            <Field label="Título" value={x.title} onChange={(v) => edit("bibliography", i, { title: v })}/><Field label="Autor" value={x.author} onChange={(v) => edit("bibliography", i, { author: v })}/><Field label="Editorial" value={x.publisher} onChange={(v) => edit("bibliography", i, { publisher: v })}/><Field label="Año" value={x.year} onChange={(v) => edit("bibliography", i, { year: v })}/><Field label="Rol" value={x.role} onChange={(v) => edit("bibliography", i, { role: v })}/>
          </div></Row>)}</div> : <Empty title="Todavía no cargaste fuentes." text="Podés agregarlas manualmente o incorporarlas desde un JSON." action={<button className="ghost" type="button" onClick={addBibliography}>Agregar primera fuente</button>}/>}
        </Panel>
        <Panel
          eyebrow="MATERIAL"
          title="Bibliografía y corpus de la cátedra"
          description="AULIA releva cada PDF antes de segmentarlo. Usa las evidencias disponibles —índice, marcadores, estructura etiquetada, tipografía, geometría y consistencia— y evita inventar secciones cuando la evidencia es insuficiente. Todo queda incluido por defecto."
          actions={<label className="primary studio-wf-file-btn">{busy ? "Procesando…" : "Cargar material"}<input type="file" accept=".txt,.md,.markdown,.json,.pdf,.docx,text/plain,text/markdown,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={importMaterial} disabled={busy}/></label>}
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
              El estado inicial de todo material es <strong>Incluido</strong>. La prioridad organiza el foco docente sin eliminar contenido.
            </div>

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
        <div className="studio-wf-next"><button className="primary" type="button" onClick={() => setStep("proposal")}>Ir a la propuesta pedagógica →</button></div>
      </>}

      {step === "proposal" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 03 · PROPUESTA</div><h1>La organización pedagógica empieza con las decisiones del docente.</h1><p>AULIA conserva la bibliografía original y construye un índice conceptual automático para ayudar al chatbot a encontrar definiciones, sinónimos, distinciones y relaciones entre ideas. La propuesta pedagógica y la base de conocimiento son procesos distintos.</p></div>

        <Panel
          eyebrow="BASE DE CONOCIMIENTO"
          title="Análisis conceptual de toda la bibliografía"
          description="AULIA recorre cada pasaje activo, extrae conceptos y relaciones, y conserva referencias a fuente, sección y páginas. Se procesa por lotes con tu propia clave de Groq; si la cuota se agota, el avance queda guardado y se puede continuar."
          actions={<button className="primary" type="button" onClick={buildFullKnowledgeBase} disabled={!canEdit || !draft.corpus?.length || busy || knowledgeBaseCurrent}>
            {busy ? "Indexando bibliografía…" : knowledgeBaseCurrent ? "Base completa y actualizada" : knowledgeBaseResumable ? "Continuar análisis completo" : "Analizar bibliografía completa"}
          </button>}
        >
          <div className={"studio-wf-ai-report " + (knowledgeBaseCurrent ? "ok" : knowledgeBaseReport?.status === "partial" ? "error" : "")}>
            <strong>
              {knowledgeBaseCurrent
                ? "✓ Base conceptual completa"
                : knowledgeBaseReport?.status === "processing"
                  ? "Analizando toda la bibliografía…"
                  : knowledgeBaseReport?.status === "partial" || draft.knowledgeBase?.status === "partial"
                    ? "⚠ Análisis parcial; se puede reanudar"
                    : draft.knowledgeBase && draft.knowledgeBase.sourceSignature !== undefined
                      ? "La bibliografía cambió: el índice debe actualizarse"
                      : "Todavía no hay una base conceptual completa"}
            </strong>
            <span>
              {knowledgeBaseReport?.processed ?? knowledgeBaseStats.processedPassages}/
              {knowledgeBaseReport?.total ?? knowledgeBaseStats.totalPassages} pasajes procesados ·
              {" "}{knowledgeBaseReport?.entries ?? knowledgeBaseStats.entries} entradas conceptuales ·
              {" "}{knowledgeBaseReport?.requests ?? draft.knowledgeBase?.requestCount ?? 0} consultas a Groq
            </span>
            {knowledgeBaseReport?.status === "processing" && (knowledgeBaseReport.total || 0) > 0 &&
              <progress className="studio-wf-progress" max={knowledgeBaseReport.total} value={Math.min(knowledgeBaseReport.processed || 0, knowledgeBaseReport.total)} />}
            {knowledgeBaseReport?.model && <small>Modelo: {knowledgeBaseReport.model}</small>}
            {knowledgeBaseReport?.error && <small>{knowledgeBaseReport.error}</small>}
            {knowledgeBaseCurrent && <small>El índice corresponde a la bibliografía actual. Si editás o reemplazás material, habrá que actualizarlo. Guardá la cátedra para conservarlo en el backend.</small>}
            {!knowledgeBaseCurrent && <small>La publicación requiere este análisis completo para que el chatbot utilice el índice. Las secciones marcadas como Excluir no se indexan; Incluido y Referencial sí.</small>}
          </div>
        </Panel>
        <Panel eyebrow="ORGANIZACIÓN PEDAGÓGICA" title="Revisión automática opcional" description="Esta revisión no reemplaza la selección docente. Sirve para experimentar con una organización posible después de haber marcado prioridades, temas, conceptos y límites en Material." actions={<>
          <button className="primary" type="button" onClick={analyzeWithAI} disabled={!canEdit || !draft.corpus?.length || busy}>{busy ? "IA ocupada…" : "Revisar propuesta automática · 1 consulta"}</button>
          <button className="ghost" type="button" onClick={() => setShowStudioKey((value) => !value)} disabled={!canEdit}>{studioApiKey ? "Cambiar clave IA" : "Configurar IA docente"}</button>
        </>}>
          {(showStudioKey || !studioApiKey) && <div className="studio-wf-ai-setup">
            <div><strong>IA docente</strong><span>Usá una API key propia de Groq. Se mantiene en la sesión de este navegador y nunca entra al course pack.</span></div>
            <div className="studio-wf-ai-key-row">
              <input type="password" value={studioKeyInput} placeholder="gsk_…" autoComplete="off" onChange={(e) => setStudioKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveTeacherKey(); }}/>
              <button className="ghost" type="button" onClick={saveTeacherKey} disabled={!studioKeyInput.trim()}>Guardar clave</button>
              {studioApiKey && <button className="ghost" type="button" onClick={forgetTeacherKey}>Quitar</button>}
            </div>
          </div>}
          {studioApiKey && !showStudioKey && <div className="studio-wf-ai-ready"><span>● IA docente lista</span><small>La clave está solo en esta sesión.</small></div>}

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
