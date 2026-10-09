import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { STUDIO_API_ENDPOINT } from "./core/studioConfig.js";
import {
  createTeacherCourse,
  getTeacherCourse,
  listTeacherCourses,
  loginTeacher,
  logoutTeacher,
  resumeTeacherSession,
  saveTeacherCourse,
  publishTeacherCourse,
  deleteTeacherCourse,
  prepareTeacherCourseDeletion,
} from "./services/auth/studioAccess.js";
import StudioLogin from "./components/StudioLogin.jsx";
import Studio from "./components/Studio.jsx";
import LegalNotice from "./components/LegalNotice.jsx";

function courseCacheKey(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized ? "aulia:studio:courses:" + encodeURIComponent(normalized) : "";
}

function readCachedCourses(email) {
  const key = courseCacheKey(email);
  if (!key) return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((item) => item && item.courseId).map((item) => ({
          courseId: String(item.courseId),
          title: String(item.title || "Sin título"),
          status: String(item.status || "draft"),
          role: String(item.role || "viewer"),
          publicSlug: String(item.publicSlug || ""),
          updatedAt: String(item.updatedAt || ""),
        }))
      : [];
  } catch {
    return [];
  }
}

function writeCachedCourses(email, courses) {
  const key = courseCacheKey(email);
  if (!key) return;
  try {
    const summaries = (courses || []).filter((item) => item?.courseId).map((item) => ({
      courseId: String(item.courseId),
      title: String(item.title || "Sin título"),
      status: String(item.status || "draft"),
      role: String(item.role || "viewer"),
      publicSlug: String(item.publicSlug || ""),
      updatedAt: String(item.updatedAt || ""),
    }));
    localStorage.setItem(key, JSON.stringify(summaries));
  } catch {}
}

function BackendUnavailable() {
  return (
    <>
      <div className="studio-access-screen">
        <div className="studio-access-wrap">
          <div className="studio-access-heading">
            <div className="eyebrow">AULIA</div>
            <h1>STUDIO</h1>
            <p>El espacio docente está esperando la conexión con su backend.</p>
          </div>
          <div className="studio-access-card">
            <div className="studio-access-body">
              <div className="studio-access-welcome">
                <strong>Backend no configurado</strong>
                <span>Definí la URL del Web App de Google Apps Script en <code>src/core/studioConfig.js</code> antes de publicar Studio.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="aulia-global-legal"><LegalNotice compact /></div>
    </>
  );
}

function LoadingScreen({ text = "Cargando Studio…" }) {
  return (
    <div className="studio-access-screen">
      <div className="studio-access-loading">{text}</div>
    </div>
  );
}

export default function StudioApp() {
  const [session, setSession] = useState(null);
  const [courses, setCourses] = useState([]);
  const [course, setCourse] = useState(null);
  const [courseMeta, setCourseMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [deletingCourseId, setDeletingCourseId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCourses(activeSession, preferredCourseId = "") {
    if (!activeSession?.token) {
      setCourses([]);
      setCourse(null);
      setCourseMeta(null);
      setLoadingCourses(false);
      return [];
    }

    setLoadingCourses(true);
    try {
      const result = await listTeacherCourses(activeSession.token);
      const available = result.courses || [];
      setCourses(available);
      writeCachedCourses(activeSession.teacher?.email, available);

      const params = new URLSearchParams(window.location.search);
      const requested = preferredCourseId || params.get("course") || "";
      const selected = available.find((item) => item.courseId === requested) || available[0];

      if (selected) {
        // Start fetching the selected course in the background. Do not block
        // the sidebar on a separate and potentially slower get-course request.
        void selectCourse(selected.courseId, activeSession, available);
      } else {
        setCourse(null);
        setCourseMeta(null);
      }

      return available;
    } catch (err) {
      setError(err.message || "No se pudieron actualizar las cátedras.");
      return readCachedCourses(activeSession.teacher?.email);
    } finally {
      setLoadingCourses(false);
    }
  }

  async function selectCourse(courseId, activeSession = session, availableCourses = courses) {
    if (!activeSession?.token || !courseId) return;
    setLoadingCourse(true);
    setError("");
    try {
      const result = await getTeacherCourse(activeSession.token, courseId);
      setCourse(result.course);
      setCourseMeta(result.meta);
      const url = new URL(window.location.href);
      url.searchParams.set("course", courseId);
      window.history.replaceState({}, "", url);
      if (availableCourses.length) setCourses(availableCourses);
    } catch (err) {
      setError(err.message || "No se pudo cargar la cátedra.");
      setCourse(null);
      setCourseMeta(null);
    } finally {
      setLoadingCourse(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      if (!STUDIO_API_ENDPOINT) {
        setLoading(false);
        return;
      }
      try {
        const restored = await resumeTeacherSession();
        if (!mounted) return;
        if (!restored) {
          setLoading(false);
          return;
        }
        setSession(restored);

        // The previous list contains only course labels/statuses, not course
        // content or credentials. Show it immediately while refreshing remote
        // permissions and metadata for this validated teacher session.
        setCourses(readCachedCourses(restored.teacher?.email));
        const refresh = loadCourses(restored);
        setLoading(false);
        await refresh;
      } catch (err) {
        if (mounted) {
          setError(err.message || "No se pudo recuperar la sesión.");
          setLoadingCourses(false);
          setLoading(false);
        }
      }
    }
    bootstrap();
    return () => { mounted = false; };
  }, []);

  async function handleLogin(email, password) {
    const next = await loginTeacher(email, password);
    setSession(next);
    setCourses(readCachedCourses(next.teacher?.email || email));
    setError("");

    // Render the cached list immediately. The remote list refreshes it, while
    // the selected course content loads independently in the main panel.
    const refresh = loadCourses(next);
    setLoading(false);
    await refresh;
  }

  async function handleCreateCourse() {
    if (!session?.token || loadingCourse) return;
    setError("");
    setLoadingCourse(true);
    try {
      const result = await createTeacherCourse(session.token, "Nueva cátedra", "");
      setCourse(result.course);
      setCourseMeta(result.meta);

      const createdSummary = {
        courseId: result.meta.courseId,
        title: result.meta.title || result.course?.title || "Nueva cátedra",
        status: result.meta.status || "draft",
        role: result.meta.role || "owner",
        publicSlug: result.meta.publicSlug || "",
        updatedAt: result.meta.updatedAt || "",
      };

      // Reflect creation immediately; a background refresh reconciles the
      // sidebar with the backend without making the interaction feel stale.
      setCourses((current) => {
        const next = [createdSummary, ...current.filter((item) => item.courseId !== createdSummary.courseId)];
        writeCachedCourses(session.teacher?.email, next);
        return next;
      });

      const url = new URL(window.location.href);
      url.searchParams.set("course", result.meta.courseId);
      window.history.replaceState({}, "", url);

      listTeacherCourses(session.token)
        .then((refreshed) => setCourses(refreshed.courses || []))
        .catch(() => {});
    } catch (err) {
      setError(err.message || "No se pudo crear la cátedra.");
    } finally {
      setLoadingCourse(false);
    }
  }

  async function handleSaveCourse(nextCourse, expectedUpdatedAt) {
    if (!session?.token || !courseMeta?.courseId) throw new Error("Sesión docente no disponible.");
    const result = await saveTeacherCourse(
      session.token,
      courseMeta.courseId,
      nextCourse,
      expectedUpdatedAt
    );
    setCourse(result.course);
    setCourseMeta(result.meta);
    setCourses((current) => {
      const next = current.map((item) =>
        item.courseId === result.meta.courseId
          ? {
              ...item,
              title: result.meta.title,
              status: result.meta.status,
              publicSlug: result.meta.publicSlug,
              updatedAt: result.meta.updatedAt,
            }
          : item
      );
      writeCachedCourses(session.teacher?.email, next);
      return next;
    });
    return result;
  }

  async function handlePublishCourse(nextCourse, expectedUpdatedAt) {
    if (!session?.token || !courseMeta?.courseId) throw new Error("Sesión docente no disponible.");
    if (courseMeta.role !== "owner") throw new Error("Solo el responsable de la cátedra puede publicar.");

    const result = await publishTeacherCourse(
      session.token,
      courseMeta.courseId,
      nextCourse,
      expectedUpdatedAt
    );

    setCourse(result.course);
    setCourseMeta(result.meta);
    setCourses((current) =>
      current.map((item) =>
        item.courseId === result.meta.courseId
          ? {
              ...item,
              title: result.meta.title,
              status: result.meta.status,
              publicSlug: result.meta.publicSlug,
              updatedAt: result.meta.updatedAt,
            }
          : item
      )
    );
    return result;
  }

  async function handleDeleteCourse(courseId, title = "esta cátedra") {
    if (!session?.token || !courseId || deletingCourseId === courseId) return;

    const confirmed = window.confirm(
      'Vas a eliminar la cátedra "' + String(title || "Nueva cátedra") + '".\n\n' +
      "Solo puede eliminarse porque todavía está en borrador y no fue publicada. " +
      "Su Course Pack se enviará a la papelera de Drive.\n\n¿Continuar?"
    );

    if (!confirmed) return;

    const removedIndex = courses.findIndex((item) => item.courseId === courseId);
    const removedItem = removedIndex >= 0 ? courses[removedIndex] : null;
    const wasSelected = courseMeta?.courseId === courseId;
    const previousCourse = course;
    const previousCourseMeta = courseMeta;

    // Optimistic UI: the draft disappears from the sidebar immediately.
    setCourses((current) => {
      const next = current.filter((item) => item.courseId !== courseId);
      writeCachedCourses(session.teacher?.email, next);
      return next;
    });
    if (wasSelected) {
      setCourse(null);
      setCourseMeta(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("course");
      window.history.replaceState({}, "", url);
    }

    setDeletingCourseId(courseId);
    setError("");

    try {
      await deleteTeacherCourse(session.token, courseId);
    } catch (err) {
      // Roll back only when the backend rejects the deletion.
      if (removedItem) {
        setCourses((current) => {
          if (current.some((item) => item.courseId === courseId)) return current;
          const next = [...current];
          next.splice(Math.max(0, removedIndex), 0, removedItem);
          writeCachedCourses(session.teacher?.email, next);
          return next;
        });
      }
      if (wasSelected) {
        setCourse(previousCourse);
        setCourseMeta(previousCourseMeta);
        const url = new URL(window.location.href);
        url.searchParams.set("course", courseId);
        window.history.replaceState({}, "", url);
      }
      setError(err.message || "No se pudo eliminar la cátedra.");
    } finally {
      setDeletingCourseId("");
    }
  }

  async function handleLogout() {
    await logoutTeacher();
    setSession(null);
    setCourses([]);
    setCourse(null);
    setCourseMeta(null);
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("course");
    window.history.replaceState({}, "", url);
  }

  if (!STUDIO_API_ENDPOINT) return <BackendUnavailable />;
  if (loading) return <LoadingScreen text={session ? "Cargando tus cátedras…" : "Cargando Studio…"} />;
  if (!session) return (
    <>
      <StudioLogin onReady={handleLogin} error={error} />
      <div className="aulia-global-legal"><LegalNotice compact /></div>
    </>
  );

  return (
    <>
    <div className="studio-root">
      <aside className="studio-coursebar">
        <div className="studio-sidebar-brand">
          <div className="eyebrow">AULIA</div>
          <strong>STUDIO</strong>
          <span>Gestión docente</span>
        </div>

        <div className="studio-teacher-card">
          <strong>{session.teacher?.name || "Docente"}</strong>
          <span>{session.teacher?.email}</span>
        </div>

        <div className="studio-coursebar-section">
          <div className="studio-sidebar-label">MIS CÁTEDRAS</div>
          <div className="studio-course-list">
            {courses.length ? (
              <>
                {loadingCourses && <div className="studio-course-empty">Actualizando cátedras…</div>}
                {courses.map((item) => (
                  <div
                    className={"studio-course-item" + (courseMeta?.courseId === item.courseId ? " active" : "")}
                    key={item.courseId}
                  >
                    <button
                      type="button"
                      className="studio-course-select"
                      onClick={() => selectCourse(item.courseId)}
                      disabled={loadingCourse || deletingCourseId === item.courseId}
                    >
                      <strong>{item.title || "Sin título"}</strong>
                      <span>{item.role === "owner" ? "Responsable" : item.role === "editor" ? "Editor" : "Solo lectura"} · {item.status === "published" ? "Publicada" : item.status === "changes-pending" ? "Cambios pendientes" : "Borrador"}</span>
                    </button>
                    {item.status === "draft" && item.role === "owner" && (
                      <button
                        type="button"
                        className="studio-course-delete"
                        title="Eliminar cátedra"
                        aria-label={'Eliminar cátedra ' + (item.title || "sin título")}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteCourse(item.courseId, item.title);
                        }}
                        disabled={deletingCourseId === item.courseId}
                      >
                        {deletingCourseId === item.courseId ? "…" : "×"}
                      </button>
                    )}
                  </div>
                ))}
              </>
            ) : loadingCourses ? (
              <div className="studio-course-empty">Cargando cátedras guardadas…</div>
            ) : (
              <div className="studio-course-empty">Todavía no tenés cátedras asignadas.</div>
            )}
          </div>
          <button type="button" className="studio-new-course" onClick={handleCreateCourse}>
            + Nueva cátedra
          </button>
        </div>

        <div className="studio-sidebar-footer">
          <button type="button" onClick={handleLogout}>Cerrar sesión</button>
          <span>El acceso a cada cátedra se verifica en el backend.</span>
        </div>
      </aside>

      <div className="studio-content">
        {error && <div className="studio-global-error">⚠ {error}</div>}
        {loadingCourse && course && <div className="studio-global-loading">Cargando versión remota…</div>}
        {course && courseMeta ? (
          <Studio
            course={course}
            courseMeta={courseMeta}
            canEdit={courseMeta.role !== "viewer"}
            onCourseChanged={() => {}}
            onSaveCourse={handleSaveCourse}
            onPublishCourse={handlePublishCourse}
            onDeleteCourse={handleDeleteCourse}
            onReloadCourse={() => selectCourse(courseMeta.courseId)}
          />
        ) : loadingCourse ? (
          <div className="studio-no-course">
            <div className="eyebrow">AULIA · STUDIO</div>
            <h1>Cargando cátedra…</h1>
            <p>Tu lista de cátedras está disponible a la izquierda. Estamos recuperando el contenido de la selección inicial.</p>
          </div>
        ) : loadingCourses ? (
          <div className="studio-no-course">
            <div className="eyebrow">AULIA · STUDIO</div>
            <h1>Actualizando tus cátedras…</h1>
            <p>Estamos verificando las cátedras autorizadas de tu cuenta.</p>
          </div>
        ) : (
          <div className="studio-no-course">
            <div className="eyebrow">AULIA · STUDIO</div>
            <h1>Elegí una cátedra para comenzar.</h1>
            <p>Las cátedras que aparecen aquí son únicamente las que tu cuenta puede administrar o consultar.</p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<StudioApp />);
