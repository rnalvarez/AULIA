import { useEffect, useMemo, useState } from "react";
import { cloneCourse, validateCourse } from "../core/courseContract.js";
import { downloadCoursePack, readCoursePackFile } from "../core/coursePackIO.js";
import { readMaterialFile, materialToCorpus, mergeImportedBibliography } from "../core/materialIO.js";
import { requestTeacherProposal } from "../services/llm/teacherProposal.js";
import { clearStudioApiKey, isGroqApiKey, loadStudioApiKey, saveStudioApiKey } from "../utils/studioStorage.js";

const STORAGE_PREFIX = "aulia:studio:";
const VERSION = "0.4";
const STEPS = [
  ["overview", "01", "Cátedra"],
  ["material", "02", "Material"],
  ["proposal", "03", "Propuesta"],
  ["interaction", "04", "Interacción"],
  ["commissions", "05", "Comisiones"],
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
  const concepts = [...(course.concepts || [])];
  const conceptByKey = new Map(concepts.map((item) => [slug(item.title), item]));
  const newConcepts = [];
  let skippedConcepts = 0;

  for (const item of proposal.concepts || []) {
    const title = String(item?.title || "").trim();
    const key = slug(title);
    if (!title || conceptByKey.has(key)) {
      skippedConcepts += 1;
      continue;
    }
    const sourceCorpusIds = (item.sourceIds || []).filter((id) => corpusIds.has(id));
    const concept = {
      id: uniqueId(key || "concepto", [...concepts, ...newConcepts]),
      title,
      chapter: String(item.chapter || "").trim(),
      summary: String(item.summary || "").trim(),
      explanation: String(item.explanation || "").trim(),
      aliases: Array.isArray(item.aliases) ? item.aliases.filter(Boolean).slice(0, 8) : [],
      keywords: Array.isArray(item.keywords) ? item.keywords.filter(Boolean).slice(0, 12) : [],
      sourceCorpusIds,
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

  return {
    course: {
      ...course,
      concepts: allConcepts,
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

export default function Studio({ course, courseMeta = null, canEdit = true, onCourseChanged, onSaveCourse, onReloadCourse }) {
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
  async function importMaterial(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const baseIds = [...(draft.corpus || [])];
      const collected = [];
      const bibliography = [];
      let warnings = 0;
      let pages = 0;

      for (const file of files) {
        const extracted = await readMaterialFile(file);
        const material = materialToCorpus(extracted, [...baseIds, ...collected]);
        collected.push(...material.corpus);
        bibliography.push(...(material.bibliography || []));
        warnings += material.warnings?.length || 0;
        pages += material.pages || 0;
      }

      mutate((current) => ({
        ...current,
        corpus: [...(current.corpus || []), ...collected],
        bibliography: mergeImportedBibliography(current.bibliography || [], bibliography),
      }), `${collected.length} fragmentos incorporados desde ${files.length} documento${files.length === 1 ? "" : "s"}.` +
        (pages ? ` · ${pages} páginas.` : "") +
        (warnings ? ` · ${warnings} aviso(s) de conversión.` : ""));
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
    mutate((c) => ({ ...c, [collection]: (c[collection] || []).filter((_, i) => i !== index) }));
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
    setStatus("La IA está leyendo el material y preparando una propuesta pedagógica…");
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
      const suffix = result.truncated
        ? " · se analizó una selección representativa del corpus"
        : " · se analizó todo el corpus disponible";
      mutate(() => merged.course,
        "Propuesta IA incorporada: " +
        merged.stats.concepts + " conceptos · " +
        merged.stats.examples + " ejemplos · " +
        merged.stats.activities + " actividades" +
        suffix +
        ".");
      setStatus(
        "Propuesta IA incorporada: " +
        merged.stats.concepts + " conceptos · " +
        merged.stats.examples + " ejemplos · " +
        merged.stats.activities + " actividades" +
        suffix +
        "."
      );
      setStep("proposal");
    } catch (err) {
      setStatus(err.message || "No se pudo generar la propuesta con IA.");
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    overview: 1,
    material: draft.corpus?.length || 0,
    proposal: draft.concepts?.length || 0,
    interaction: draft.modes?.length || 0,
    commissions: draft.commissions?.length || 0,
  };
  const pending = (draft.concepts || []).filter((x) => x.suggested).length;

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

    <div className="studio-wf-local-note"><span><b>Flujo de autoría:</b> Cátedra → Material → Propuesta pedagógica → Interacción → Comisiones.</span><small>{canEdit ? "Los cambios se guardan en el backend." : "Esta cátedra está disponible en modo solo lectura."}</small></div>

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
        <div className="studio-wf-hero"><div className="eyebrow">PASO 02 · MATERIAL</div><h1>Cargá la bibliografía y el material de trabajo.</h1><p>La bibliografía identifica las fuentes; el corpus contiene los fragmentos que AULIA puede recuperar. No necesitás crear conceptos a mano.</p></div>
        <Panel eyebrow="BIBLIOGRAFÍA" title="Fuentes de la cátedra" description="Libros, apuntes o materiales principales." actions={<button className="ghost" type="button" onClick={addBibliography} disabled={!canEdit}>+ Agregar fuente</button>}>
          {draft.bibliography?.length ? <div className="studio-wf-stack">{draft.bibliography.map((x, i) => <Row key={x.id || i} title={x.title} meta={[x.author, x.year].filter(Boolean).join(" · ")} onRemove={() => remove("bibliography", i)}><div className="studio-wf-grid">
            <Field label="Título" value={x.title} onChange={(v) => edit("bibliography", i, { title: v })}/><Field label="Autor" value={x.author} onChange={(v) => edit("bibliography", i, { author: v })}/><Field label="Editorial" value={x.publisher} onChange={(v) => edit("bibliography", i, { publisher: v })}/><Field label="Año" value={x.year} onChange={(v) => edit("bibliography", i, { year: v })}/><Field label="Rol" value={x.role} onChange={(v) => edit("bibliography", i, { role: v })}/>
          </div></Row>)}</div> : <Empty title="Todavía no cargaste fuentes." text="Podés agregarlas manualmente o incorporarlas desde un JSON." action={<button className="ghost" type="button" onClick={addBibliography}>Agregar primera fuente</button>}/>}
        </Panel>
        <Panel eyebrow="CORPUS" title="Material que AULIA podrá recuperar" description="PDF, DOCX, TXT, Markdown y JSON se convierten en fragmentos. Podés seleccionar varios documentos; la extracción ocurre localmente en este navegador." actions={<label className="primary studio-wf-file-btn">{busy ? "Procesando…" : "Cargar material"}<input type="file" accept=".txt,.md,.markdown,.json,.pdf,.docx,text/plain,text/markdown,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={importMaterial} disabled={busy}/></label>}>
          {draft.corpus?.length ? <><div className="studio-wf-stats"><div><strong>{draft.corpus.length}</strong><span>fragmentos</span></div><div><strong>{new Set(draft.corpus.map((x) => x.chapter).filter(Boolean)).size}</strong><span>unidades de origen</span></div><div><strong>{pending}</strong><span>propuestas pendientes</span></div></div><div className="studio-wf-corpus-list">{draft.corpus.slice(0, 18).map((x, i) => <article key={x.id || i}><div><strong>{x.title || "Fragmento"}</strong><span>{x.chapter || (x.sourcePage ? "Página " + x.sourcePage : "Sin unidad de origen")}{x.source ? " · " + x.source : ""}</span></div><p>{String(x.content || "").slice(0, 240)}{String(x.content || "").length > 240 ? "…" : ""}</p></article>)}{draft.corpus.length > 18 && <small>Mostrando 18 de {draft.corpus.length} fragmentos.</small>}</div></> : <Empty title="El corpus está vacío." text="Empezá cargando un PDF, DOCX, TXT, Markdown o JSON."/>}
        </Panel>
        <div className="studio-wf-next"><button className="primary" type="button" onClick={() => setStep("proposal")}>Ir a la propuesta pedagógica →</button></div>
      </>}

      {step === "proposal" && <>
        <div className="studio-wf-hero"><div className="eyebrow">PASO 03 · PROPUESTA</div><h1>Ahora AULIA propone cómo organizar ese material.</h1><p>La IA puede detectar conceptos, relaciones, ejemplos y actividades a partir del material. Nada se publica automáticamente: todo queda como propuesta editable para la cátedra.</p></div>
        <Panel eyebrow="UNIDADES / CONCEPTOS" title="Núcleo pedagógico" description="La propuesta semántica usa tu propia clave de IA docente. AULIA no envía esa clave al backend ni la guarda en el course pack." actions={<>
          <button className="primary" type="button" onClick={analyzeWithAI} disabled={!canEdit || !draft.corpus?.length || busy}>{busy ? "Analizando…" : "Analizar con IA"}</button>
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

          <details className="studio-wf-details">
            <summary>Alternativas sin IA</summary>
            <div className="studio-wf-tool-row">
              <button className="ghost" type="button" onClick={proposeConceptsLocal} disabled={!canEdit || !draft.corpus?.length || busy}>Propuesta rápida por títulos y capítulos</button>
              <button className="ghost" type="button" onClick={() => mutate((c) => ({...c, concepts:[...(c.concepts || []), {id:uniqueId("concepto",c.concepts), title:"Nuevo concepto", aliases:[], keywords:[], summary:"", explanation:""}]}))}>Agregar concepto manualmente</button>
            </div>
          </details>

          {draft.concepts?.length ? <div className="studio-wf-stack">{draft.concepts.map((x, i) => <article className="studio-wf-concept" key={x.id || i}><div className="studio-wf-concept-head"><div><strong>{x.title || "Sin título"}</strong><span>{x.suggested ? "Propuesto por AULIA" : "Editado por la cátedra"}{x.chapter ? " · " + x.chapter : ""}</span></div><button className="studio-wf-danger" type="button" onClick={() => remove("concepts", i)}>Eliminar</button></div><div className="studio-wf-grid"><Field label="Título" value={x.title} onChange={(v) => edit("concepts", i, {title:v, suggested:false})}/><Field label="Unidad / capítulo" value={x.chapter} onChange={(v) => edit("concepts", i, {chapter:v})}/><Field label="Resumen" value={x.summary} onChange={(v) => edit("concepts", i, {summary:v})} multiline/><Field label="Explicación docente (opcional)" value={x.explanation} onChange={(v) => edit("concepts", i, {explanation:v})} multiline/></div><details className="studio-wf-details"><summary>Detalles opcionales de recuperación</summary><div className="studio-wf-grid"><Field label="Aliases" value={(x.aliases || []).join(", ")} onChange={(v) => edit("concepts", i, {aliases:list(v)})} hint="Sinónimos o formas alternativas."/><Field label="Palabras clave" value={(x.keywords || []).join(", ")} onChange={(v) => edit("concepts", i, {keywords:list(v)})}/></div></details></article>)}</div> : <Empty title="Todavía no hay una propuesta." text="Cargá material y elegí “Analizar con IA”. También podés usar una propuesta rápida sin IA."/>}
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
        <Panel eyebrow="CIERRE" title="Antes de publicar" description="La publicación docente todavía no está conectada. Guardá, validá y exportá el borrador.">
          <div className="studio-wf-review-grid"><div><span>Cátedra</span><strong>{draft.title || "Sin definir"}</strong></div><div><span>Fuentes</span><strong>{draft.bibliography?.length || 0}</strong></div><div><span>Fragmentos</span><strong>{draft.corpus?.length || 0}</strong></div><div><span>Unidades</span><strong>{draft.concepts?.length || 0}</strong></div><div><span>Modos</span><strong>{draft.modes?.length || 0}</strong></div><div><span>Actividades</span><strong>{draft.activities?.length || 0}</strong></div><div><span>Comisiones</span><strong>{draft.commissions?.length || 0}</strong></div></div>
          <div className="studio-wf-final-actions"><button className="primary" type="button" onClick={save}>Guardar borrador</button><button className="ghost" type="button" onClick={validate}>Validar</button><button className="ghost" type="button" onClick={() => { const r = validateCourse(draft); setValidation(r); if (r.valid) downloadCoursePack(draft); else setStatus("Corregí los problemas antes de exportar."); }}>Exportar course pack</button><button className="ghost" type="button" disabled>Publicar (próximamente)</button></div>
        </Panel>
      </>}

      <section className="studio-wf-advanced"><button type="button" onClick={() => setAdvanced((x) => !x)}><span>AVANZADO</span><small>{advanced ? "Ocultar configuración técnica" : "Mostrar configuración técnica"}</small><b>{advanced ? "−" : "+"}</b></button>{advanced && <div className="studio-wf-advanced-body"><div className="studio-wf-grid"><Field label="ID interno" value={draft.id} onChange={(v) => mutate({id:v})} hint="No hace falta modificarlo durante el trabajo normal."/><Field label="Proveedor LLM" value={draft.llm?.provider} onChange={(v) => mutate({llm:{...(draft.llm || {}), provider:v}})}/><Field label="Endpoint LLM" value={draft.llm?.endpoint} onChange={(v) => mutate({llm:{...(draft.llm || {}), endpoint:v}})}/><Field label="Tracking endpoint" value={draft.tracking?.endpoint} onChange={(v) => mutate({tracking:{...(draft.tracking || {}), endpoint:v}})}/><Field label="Instrucciones internas" value={draft.assistant?.instructions} onChange={(v) => mutate({assistant:{...draft.assistant, instructions:v}})} multiline/></div><div className="studio-wf-security-note">AULIA Studio no guarda claves de API. La clave de Groq del estudiante sigue siendo local del navegador y no forma parte del course pack.</div></div>}</section>
      <footer className="studio-wf-footer"><span>{status || "Borrador listo para editar."}</span><span>AULIA · Studio local</span></footer>
      {validation && <section className={"studio-wf-validation " + (validation.valid ? "valid" : "invalid")}><strong>{validation.valid ? "✓ Course pack válido" : "Hay elementos que revisar"}</strong>{!validation.valid && <ul>{validation.errors.map((x) => <li key={x}>{x}</li>)}</ul>}</section>}
    </main>
    </fieldset>
  </section>;
}
