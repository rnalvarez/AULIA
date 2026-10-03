import { useMemo, useState } from "react";
import "./styles.css";
import { COURSE_REGISTRY } from "./core/courseRegistry.js";
import { retrieveFromCourse } from "./core/retrieval.js";
import { buildPedagogicalResponse } from "./core/pedagogy.js";
import { createInteractionEvent } from "./core/tracking.js";

const initialCourse = COURSE_REGISTRY[0];

export default function App() {
  const [courseId, setCourseId] = useState(initialCourse.id);
  const [modeId, setModeId] = useState(initialCourse.modes[0].id);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Este es el núcleo experimental de AULIA. Elegí una modalidad y consultá el corpus del curso.",
    },
  ]);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState([]);

  const course = useMemo(
    () => COURSE_REGISTRY.find((item) => item.id === courseId) || initialCourse,
    [courseId]
  );

  const mode = useMemo(
    () => course.modes.find((item) => item.id === modeId) || course.modes[0],
    [course, modeId]
  );

  function changeCourse(nextId) {
    const nextCourse =
      COURSE_REGISTRY.find((item) => item.id === nextId) || initialCourse;
    setCourseId(nextCourse.id);
    setModeId(nextCourse.modes[0].id);
    setMessages([
      {
        role: "assistant",
        content:
          "Curso cargado. La interfaz y el motor son los mismos; cambió el course pack.",
      },
    ]);
    setEvents([]);
  }

  function send() {
    const question = input.trim();
    if (!question) return;

    const retrieved = retrieveFromCourse(course, question);
    const response = buildPedagogicalResponse({
      course,
      mode,
      retrieved,
    });

    const event = createInteractionEvent({
      courseId: course.id,
      modeId: mode.id,
      question,
      response,
      retrievedIds: retrieved.map((item) => item.id),
    });

    setMessages((current) => current.concat([
      { role: "user", content: question },
      { role: "assistant", content: response },
    ]));
    setEvents((current) => current.concat(event));
    setInput("");
  }

  function reset() {
    setMessages([
      {
        role: "assistant",
        content:
          "Conversación reiniciada. Elegí otra modalidad para cambiar la estrategia pedagógica.",
      },
    ]);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">AULIA</div>
          <div className="subtitle">
            Núcleo para asistentes pedagógicos configurables
          </div>
        </div>
        <div className="status">FOUNDATION 0.1</div>
      </header>

      <section className="control-grid">
        <label>
          <span>Cátedra / curso</span>
          <select value={course.id} onChange={(event) => changeCourse(event.target.value)}>
            {COURSE_REGISTRY.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Modalidad de interacción</span>
          <select value={mode.id} onChange={(event) => setModeId(event.target.value)}>
            {course.modes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <div className="course-card">
          <div className="eyebrow">COURSE PACK</div>
          <strong>{course.title}</strong>
          <span>{course.author}</span>
        </div>
      </section>

      <main className="main-grid">
        <section className="chat-card">
          <div className="chat-head">
            <div>
              <strong>{course.title}</strong>
              <div>{mode.description}</div>
            </div>
            <button type="button" className="ghost" onClick={reset}>
              Reiniciar
            </button>
          </div>

          <div className="messages">
            {messages.map((message, index) => (
              <div key={index} className={"message " + message.role}>
                <div className="message-label">
                  {message.role === "user" ? "ALUMNO" : "AULIA"}
                </div>
                <div className="message-body">{message.content}</div>
              </div>
            ))}
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={mode.placeholder}
              rows={3}
            />
            <button type="button" className="primary" onClick={send} disabled={!input.trim()}>
              Enviar
            </button>
          </div>
        </section>

        <aside className="side-column">
          <section className="info-card">
            <div className="eyebrow">BIBLIOGRAFÍA</div>
            {course.bibliography.map((book) => (
              <div className="book" key={book.id}>
                <strong>{book.title}</strong>
                <span>{book.author} · {book.year}</span>
              </div>
            ))}
          </section>

          <section className="info-card">
            <div className="eyebrow">RECUPERACIÓN</div>
            <p>
              {events.length
                ? "Última consulta: " + events[events.length - 1].retrievedIds.length + " unidad(es) del corpus."
                : "Todavía no hay interacciones."}
            </p>
            <div className="small-note">
              La recuperación está desacoplada del proveedor de LLM.
            </div>
          </section>

          <section className="info-card">
            <div className="eyebrow">ARQUITECTURA</div>
            <div className="architecture">
              <div>CORE</div>
              <span>↓</span>
              <div>COURSE PACK</div>
              <span>↓</span>
              <div>LLM / RULES</div>
              <span>↓</span>
              <div>TRACKING</div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
