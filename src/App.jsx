import { useEffect, useState } from "react";
import "./styles.css";
import { loadRuntimeCourse } from "./core/runtimeCourse.js";
import { loadStudent } from "./core/studentSession.js";
import { logoutStudent } from "./services/auth/studentAccess.js";
import { loadApiKey, clearApiKey } from "./utils/storage.js";
import StudentLogin from "./components/StudentLogin.jsx";
import ApiKeySetup from "./components/ApiKeySetup.jsx";
import ChatInterface from "./components/ChatInterface.jsx";

function LoadingScreen() {
  return (
    <div className="unavailable-screen">
      <div className="unavailable-card">
        <div className="eyebrow">AULIA</div>
        <h1>Cargando cátedra…</h1>
        <p>Estamos preparando la instancia correspondiente.</p>
      </div>
    </div>
  );
}

function Unavailable({ status }) {
  const messages = {
    missing: "Este enlace necesita identificar la cátedra.",
    "not-published": "Esta cátedra no está publicada o el enlace no es válido.",
    error: "No se pudo cargar la cátedra en este momento.",
  };

  return (
    <div className="unavailable-screen">
      <div className="unavailable-card">
        <div className="eyebrow">AULIA</div>
        <h1>Instancia no disponible</h1>
        <p>{messages[status] || messages.error}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadRuntimeCourse()
      .then(result => {
        if (mounted) setRuntime(result);
      })
      .catch(error => {
        if (mounted) setRuntime({ course: null, status: "error", error });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  if (loading) return <LoadingScreen />;

  const course = runtime?.course;
  if (!course) return <Unavailable status={runtime?.status} />;

  const student = loadStudent(course.id);
  const apiKey = loadApiKey(course.id);

  return <StudentRuntime course={course} initialStudent={student} initialApiKey={apiKey} />;
}

function StudentRuntime({ course, initialStudent, initialApiKey }) {
  const [student, setStudent] = useState(initialStudent);
  const [apiKey, setApiKey] = useState(initialApiKey);

  if (!student) {
    return <StudentLogin course={course} onReady={setStudent} />;
  }

  if (!apiKey) {
    return <ApiKeySetup course={course} onReady={setApiKey} />;
  }

  return (
    <ChatInterface
      course={course}
      student={student}
      apiKey={apiKey}
      onLogoutApiKey={() => {
        clearApiKey(course.id);
        setApiKey("");
      }}
      onLogoutStudent={() => {
        clearApiKey(course.id);
        logoutStudent(course.id);
        setStudent(null);
        setApiKey("");
      }}
    />
  );
}
