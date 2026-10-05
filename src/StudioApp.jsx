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
} from "./services/auth/studioAccess.js";
import StudioLogin from "./components/StudioLogin.jsx";
import Studio from "./components/Studio.jsx";

function BackendUnavailable() {
  return (
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
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [error, setError] = useState("");

  async function loadCourses(activeSession, preferredCourseId = "") {
    const result = await listTeacherCourses(activeSession.token);
    const available = result.courses || [];
    setCourses(available);

    const params = new URLSearchParams(window.location.search);
    const requested = preferredCourseId || params.get("course") || "";
    const selected = available.find((item) => item.courseId === requested) || available[0];

    if (selected) {
      await selectCourse(selected.courseId, activeSession, available);
    } else {
      setCourse(null);
      setCourseMeta(null);
    }

    return available;
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
        await loadCourses(restored);
      } catch (err) {
        if (mounted) setError(err.message || "No se pudo recuperar la sesión.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    bootstrap();
    return () => { mounted = false; };
  }, []);

  async function handleLogin(email, password) {
    const next = await loginTeacher(email, password);
    setSession(next);
    setError("");
    await loadCourses(next);
    setLoading(false);
  }

  async function handleCreateCourse() {
    if (!session?.token) return;
    setError("");
    setLoadingCourse(true);
    try {
      const result = await createTeacherCourse(session.token, "Nueva cátedra", "");
      setCourse(result.course);
      setCourseMeta(result.meta);
      const refreshed = await listTeacherCourses(session.token);
      setCourses(refreshed.courses || []);
      const url = new URL(window.location.href);
      url.searchParams.set("course", result.meta.courseId);
      window.history.replaceState({}, "", url);
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
  if (loading) return <LoadingScreen />;
  if (!session) return <StudioLogin onReady={handleLogin} error={error} />;

  if (loadingCourse && !course) return <LoadingScreen text="Cargando la cátedra…" />;

  return (
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
            {courses.length ? courses.map((item) => (
              <button
                type="button"
                key={item.courseId}
                className={courseMeta?.courseId === item.courseId ? "active" : ""}
                onClick={() => selectCourse(item.courseId)}
              >
                <strong>{item.title || "Sin título"}</strong>
                <span>{item.role === "owner" ? "Responsable" : item.role === "editor" ? "Editor" : "Solo lectura"} · {item.status === "published" ? "Publicada" : item.status === "changes-pending" ? "Cambios pendientes" : "Borrador"}</span>
              </button>
            )) : (
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
            onReloadCourse={() => selectCourse(courseMeta.courseId)}
          />
        ) : (
          <div className="studio-no-course">
            <div className="eyebrow">AULIA · STUDIO</div>
            <h1>Elegí una cátedra para comenzar.</h1>
            <p>Las cátedras que aparecen aquí son únicamente las que tu cuenta puede administrar o consultar.</p>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StudioApp />);
