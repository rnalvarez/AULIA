import { useState } from "react";
import "./styles.css";
import { resolveRuntimeCourse } from "./core/runtimeCourse.js";
import { loadStudent } from "./core/studentSession.js";
import { logoutStudent } from "./services/auth/studentAccess.js";
import { loadApiKey, clearApiKey } from "./utils/storage.js";
import StudentLogin from "./components/StudentLogin.jsx";
import ApiKeySetup from "./components/ApiKeySetup.jsx";
import ChatInterface from "./components/ChatInterface.jsx";

const course = resolveRuntimeCourse();

function Unavailable() {
  return (
    <div className="unavailable-screen">
      <div className="unavailable-card">
        <div className="eyebrow">AULIA</div>
        <h1>Instancia no disponible</h1>
        <p>Este enlace no corresponde a una cátedra publicada o la instancia no está habilitada.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [student, setStudent] = useState(() => course ? loadStudent(course.id) : null);
  const [apiKey, setApiKey] = useState(() => course ? loadApiKey(course.id) : "");

  if (!course) return <Unavailable />;

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
