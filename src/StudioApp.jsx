import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { COURSE_REGISTRY } from "./core/courseRegistry.js";
import { createBlankCourse } from "./core/courseFactory.js";
import Studio from "./components/Studio.jsx";

function getInitialCourseId() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("course");
  return COURSE_REGISTRY.some((course) => course.id === requested)
    ? requested
    : COURSE_REGISTRY[0]?.id || "";
}

export default function StudioApp() {
  const [courseId, setCourseId] = useState(getInitialCourseId);
  const [customCourse, setCustomCourse] = useState(null);

  const currentCourse = useMemo(
    () => customCourse || COURSE_REGISTRY.find((course) => course.id === courseId) || createBlankCourse(),
    [courseId, customCourse]
  );

  function selectCourse(id) {
    setCustomCourse(null);
    setCourseId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("course", id);
    window.history.replaceState({}, "", url);
  }

  function startNewCourse() {
    const fresh = createBlankCourse();
    setCustomCourse(fresh);
    setCourseId(fresh.id);
    const url = new URL(window.location.href);
    url.searchParams.set("course", fresh.id);
    window.history.replaceState({}, "", url);
  }

  return (
    <div className="studio-root">
      <aside className="studio-coursebar">
        <div className="studio-sidebar-brand">
          <div className="eyebrow">AULIA</div>
          <strong>STUDIO</strong>
          <span>Gestión de cátedras</span>
        </div>

        <div className="studio-coursebar-section">
          <div className="studio-sidebar-label">CÁTEDRAS</div>
          <div className="studio-course-list">
            {COURSE_REGISTRY.map((course) => (
              <button
                type="button"
                key={course.id}
                className={!customCourse && courseId === course.id ? "active" : ""}
                onClick={() => selectCourse(course.id)}
              >
                <strong>{course.title}</strong>
                <span>{course.id}</span>
              </button>
            ))}
          </div>
          <button type="button" className="studio-new-course" onClick={startNewCourse}>
            + Nueva cátedra
          </button>
        </div>

        <div className="studio-sidebar-note">
          <strong>Prototype</strong>
          <span>Los packs editados se guardan localmente y se exportan. La publicación docente vendrá con el backend del Studio.</span>
        </div>
      </aside>

      <div className="studio-content">
        <Studio
          course={currentCourse}
          onCourseChanged={(next) => {
            if (customCourse) setCustomCourse(next);
          }}
        />
      </div>
    </div>
  );
}


createRoot(document.getElementById("root")).render(<StudioApp />);
