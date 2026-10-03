import { useEffect, useMemo, useState } from "react";
import { cloneCourse, validateCourse } from "../core/courseContract.js";
import {
  downloadCoursePack,
  readCoursePackFile,
} from "../core/coursePackIO.js";

const STORAGE_PREFIX = "aulia:studio:";
const STUDIO_VERSION = "0.1";

const defaults = {
  bibliography: {
    id: "bibliografia-1",
    title: "Nueva referencia",
    author: "",
    publisher: "",
    year: "",
    role: "complementaria",
  },
  concepts: {
    id: "concepto-1",
    title: "Nuevo concepto",
    aliases: [],
    keywords: [],
    summary: "",
    explanation: "",
  },
  modes: {
    id: "modo-1",
    title: "Nueva modalidad",
    description: "",
    pedagogicalGoal: "comprender",
    strategy: "generic",
    placeholder: "Escribí tu consulta...",
  },
  activities: {
    id: "actividad-1",
    title: "Nueva actividad",
    modeId: "",
    description: "",
  },
  examples: {
    id: "ejemplo-1",
    title: "Nuevo ejemplo",
    director: "",
    concepts: [],
  },
};

function uniqueId(prefix, items) {
  const used = new Set(items.map((item) => item.id));
  let i = 1;
  let id = `${prefix}-${i}`;
  while (used.has(id)) {
    i += 1;
    id = `${prefix}-${i}`;
  }
  return id;
}

function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ListSection({ title, description, items, emptyLabel, onAdd, onRemove, renderItem }) {
  return (
    <section className="studio-section">
      <div className="studio-section-head">
        <div>
          <div className="eyebrow">{title}</div>
          <div className="studio-description">{description}</div>
        </div>
        <button type="button" className="ghost" onClick={onAdd}>+ Agregar</button>
      </div>

      {items.length ? (
        <div className="studio-list">
          {items.map((item, index) => (
            <div className="studio-item" key={item.id || index}>
              {renderItem(item, index)}
              <button type="button" className="studio-remove" onClick={() => onRemove(index)}>
                Eliminar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="studio-empty">{emptyLabel}</div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, multiline = false, disabled = false, placeholder = "" }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <label className="studio-field">
      <span>{label}</span>
      <Tag
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={multiline ? 3 : undefined}
      />
    </label>
  );
}

export default function Studio({ course }) {
  const storageKey = useMemo(() => STORAGE_PREFIX + course.id, [course.id]);
  const [draft, setDraft] = useState(() => cloneCourse(course));
  const [status, setStatus] = useState("");
  const [validation, setValidation] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      setDraft(cloneCourse(course));
      setValidation(null);
      setStatus("");
      return;
    }

    try {
      setDraft(JSON.parse(saved));
      setStatus("Borrador local recuperado.");
      setValidation(null);
    } catch {
      setDraft(cloneCourse(course));
      localStorage.removeItem(storageKey);
    }
  }, [course, storageKey]);

  function updateRoot(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidation(null);
    setStatus("Cambios sin guardar en el borrador.");
  }

  function updateItem(collection, index, key, value) {
    setDraft((current) => {
      const items = [...current[collection]];
      items[index] = { ...items[index], [key]: value };
      return { ...current, [collection]: items };
    });
    setValidation(null);
    setStatus("Cambios sin guardar en el borrador.");
  }

  function addItem(collection) {
    setDraft((current) => ({
      ...current,
      [collection]: [
        ...current[collection],
        {
          ...defaults[collection],
          id: uniqueId(collection.slice(0, -1), current[collection]),
        },
      ],
    }));
    setValidation(null);
  }

  function removeItem(collection, index) {
    setDraft((current) => ({
      ...current,
      [collection]: current[collection].filter((_, itemIndex) => itemIndex !== index),
    }));
    setValidation(null);
  }

  function saveDraft() {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    setStatus("Borrador guardado en este navegador.");
  }

  function restoreCourse() {
    const fresh = cloneCourse(course);
    localStorage.removeItem(storageKey);
    setDraft(fresh);
    setValidation(null);
    setStatus("Se restauró la versión del course pack cargada por AULIA.");
  }

  function validateDraft() {
    const result = validateCourse(draft);
    setValidation(result);
    setStatus(result.valid ? "Course pack válido." : "Hay problemas que revisar.");
  }

  async function importPack(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const imported = await readCoursePackFile(file);
      setDraft(imported);
      setValidation({ valid: true, errors: [] });
      setStatus("Course pack importado al Studio. Todavía no está publicado.");
    } catch (error) {
      setValidation({ valid: false, errors: [error.message] });
      setStatus("No se pudo importar el archivo.");
    }
  }

  return (
    <section className="studio-shell">
      <div className="studio-toolbar">
        <div>
          <div className="brand">STUDIO</div>
          <div className="subtitle">Configuración de course packs · prototipo {STUDIO_VERSION}</div>
        </div>
        <div className="studio-actions">
          <label className="ghost studio-file">
            Importar
            <input type="file" accept="application/json,.json" onChange={importPack} />
          </label>
          <button type="button" className="ghost" onClick={restoreCourse}>Restaurar</button>
          <button type="button" className="ghost" onClick={validateDraft}>Validar</button>
          <button type="button" className="primary" onClick={() => {
            validateDraft();
            if (validateCourse(draft).valid) downloadCoursePack(draft);
          }}>
            Exportar
          </button>
        </div>
      </div>

      <div className="studio-notice">
        <strong>Modo de trabajo local.</strong> Este Studio todavía no publica cursos en un servidor.
        El borrador queda guardado en este navegador y puede exportarse como un <code>course-pack.json</code>.
      </div>

      <section className="studio-section">
        <div className="eyebrow">IDENTIDAD DEL CURSO</div>
        <div className="studio-grid">
          <Field label="ID interno" value={draft.id} onChange={(value) => updateRoot("id", value)} />
          <Field label="Título" value={draft.title} onChange={(value) => updateRoot("title", value)} />
          <Field label="Cátedra / autoría" value={draft.author} onChange={(value) => updateRoot("author", value)} />
          <Field label="Idioma" value={draft.language} onChange={(value) => updateRoot("language", value)} />
          <Field label="Nivel" value={draft.level} onChange={(value) => updateRoot("level", value)} />
          <Field label="Descripción" value={draft.description} onChange={(value) => updateRoot("description", value)} multiline />
        </div>
      </section>

      <ListSection
        title="BIBLIOGRAFÍA"
        description="Fuentes que pertenecen al curso."
        items={draft.bibliography}
        emptyLabel="Todavía no hay referencias."
        onAdd={() => addItem("bibliography")}
        onRemove={(index) => removeItem("bibliography", index)}
        renderItem={(item, index) => (
          <div className="studio-grid">
            <Field label="Título" value={item.title} onChange={(value) => updateItem("bibliography", index, "title", value)} />
            <Field label="Autor" value={item.author} onChange={(value) => updateItem("bibliography", index, "author", value)} />
            <Field label="Editorial" value={item.publisher} onChange={(value) => updateItem("bibliography", index, "publisher", value)} />
            <Field label="Año" value={item.year} onChange={(value) => updateItem("bibliography", index, "year", value)} />
            <Field label="Rol" value={item.role} onChange={(value) => updateItem("bibliography", index, "role", value)} />
          </div>
        )}
      />

      <ListSection
        title="CONCEPTOS / UNIDADES"
        description="Núcleo de conocimiento que AULIA recuperará y podrá citar."
        items={draft.concepts}
        emptyLabel="Todavía no hay conceptos."
        onAdd={() => addItem("concepts")}
        onRemove={(index) => removeItem("concepts", index)}
        renderItem={(item, index) => (
          <div className="studio-grid">
            <Field label="Título" value={item.title} onChange={(value) => updateItem("concepts", index, "title", value)} />
            <Field label="Aliases" value={(item.aliases || []).join(", ")} onChange={(value) => updateItem("concepts", index, "aliases", parseList(value))} />
            <Field label="Palabras clave" value={(item.keywords || []).join(", ")} onChange={(value) => updateItem("concepts", index, "keywords", parseList(value))} />
            <Field label="Resumen" value={item.summary} onChange={(value) => updateItem("concepts", index, "summary", value)} multiline />
            <Field label="Explicación" value={item.explanation} onChange={(value) => updateItem("concepts", index, "explanation", value)} multiline />
            <Field label="Capítulo / unidad" value={item.chapter} onChange={(value) => updateItem("concepts", index, "chapter", value)} />
          </div>
        )}
      />

      <ListSection
        title="MODOS DE INTERACCIÓN"
        description="Define cómo interactúa AULIA; el contenido sigue perteneciendo al course pack."
        items={draft.modes}
        emptyLabel="Todavía no hay modalidades."
        onAdd={() => addItem("modes")}
        onRemove={(index) => removeItem("modes", index)}
        renderItem={(item, index) => (
          <div className="studio-grid">
            <Field label="ID" value={item.id} onChange={(value) => updateItem("modes", index, "id", value)} />
            <Field label="Título" value={item.title} onChange={(value) => updateItem("modes", index, "title", value)} />
            <Field label="Objetivo pedagógico" value={item.pedagogicalGoal} onChange={(value) => updateItem("modes", index, "pedagogicalGoal", value)} />
            <Field label="Estrategia" value={item.strategy} onChange={(value) => updateItem("modes", index, "strategy", value)} placeholder="retrieve · socratic · ..." />
            <Field label="Descripción" value={item.description} onChange={(value) => updateItem("modes", index, "description", value)} multiline />
            <Field label="Placeholder" value={item.placeholder} onChange={(value) => updateItem("modes", index, "placeholder", value)} />
          </div>
        )}
      />

      <ListSection
        title="ACTIVIDADES"
        description="Tareas docentes que utilizan los modos."
        items={draft.activities}
        emptyLabel="Todavía no hay actividades."
        onAdd={() => addItem("activities")}
        onRemove={(index) => removeItem("activities", index)}
        renderItem={(item, index) => (
          <div className="studio-grid">
            <Field label="ID" value={item.id} onChange={(value) => updateItem("activities", index, "id", value)} />
            <Field label="Título" value={item.title} onChange={(value) => updateItem("activities", index, "title", value)} />
            <Field label="Modo asociado" value={item.modeId} onChange={(value) => updateItem("activities", index, "modeId", value)} />
            <Field label="Descripción" value={item.description} onChange={(value) => updateItem("activities", index, "description", value)} multiline />
          </div>
        )}
      />

      <ListSection
        title="EJEMPLOS"
        description="Casos, obras o situaciones que relacionan el corpus con la práctica."
        items={draft.examples}
        emptyLabel="Todavía no hay ejemplos."
        onAdd={() => addItem("examples")}
        onRemove={(index) => removeItem("examples", index)}
        renderItem={(item, index) => (
          <div className="studio-grid">
            <Field label="Título" value={item.title} onChange={(value) => updateItem("examples", index, "title", value)} />
            <Field label="Autor / director" value={item.director} onChange={(value) => updateItem("examples", index, "director", value)} />
            <Field label="Conceptos relacionados" value={(item.concepts || []).join(", ")} onChange={(value) => updateItem("examples", index, "concepts", parseList(value))} />
          </div>
        )}
      />

      <section className="studio-section">
        <div className="eyebrow">TRACKING</div>
        <div className="studio-grid">
          <Field label="Proveedor" value={draft.tracking?.provider} onChange={(value) => updateRoot("tracking", { ...draft.tracking, provider: value })} />
          <Field label="Endpoint" value={draft.tracking?.endpoint} onChange={(value) => updateRoot("tracking", { ...draft.tracking, endpoint: value })} />
          <Field label="Fuente de identidad" value={draft.tracking?.identitySource} onChange={(value) => updateRoot("tracking", { ...draft.tracking, identitySource: value })} />
          <Field label="Interacciones" value={draft.tracking?.interactionSource} onChange={(value) => updateRoot("tracking", { ...draft.tracking, interactionSource: value })} />
          <Field label="Sesiones" value={draft.tracking?.sessionSource} onChange={(value) => updateRoot("tracking", { ...draft.tracking, sessionSource: value })} />
        </div>
      </section>

      <div className="studio-footer-actions">
        <button type="button" className="ghost" onClick={saveDraft}>Guardar borrador</button>
        <span className="studio-status">{status}</span>
      </div>

      {validation && (
        <section className={"studio-validation " + (validation.valid ? "valid" : "invalid")}>
          <strong>{validation.valid ? "✓ Course pack válido" : "Hay elementos que revisar"}</strong>
          {!validation.valid && (
            <ul>
              {validation.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
