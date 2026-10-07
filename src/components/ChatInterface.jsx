import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { retrieveFromCourse } from "../core/retrieval.js";
import { createLLMClient } from "../services/llm/llmClient.js";
import { createSheetsClient } from "../services/tracking/sheetsClient.js";

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = event => setMobile(event.matches);
    setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function ThinkingDots() {
  return <div className="thinking-dots"><span /><span /><span /></div>;
}

function cleanText(value) { return String(value || "").trim(); }

function browserSpeechAvailable() {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

function createRecognition() {
  if (!browserSpeechAvailable()) return null;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = "es-AR";
  recognition.interimResults = true;
  recognition.continuous = false;
  return recognition;
}

function speakText(text, onStart, onEnd) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-AR";
  utterance.onstart = onStart || null;
  utterance.onend = onEnd || null;
  window.speechSynthesis.speak(utterance);
}

export default function ChatInterface({ course, student, apiKey, onLogoutApiKey, onLogoutStudent }) {
  const mobile = useIsMobile();
  const assistant = course.assistant || {};
  const modes = course.modes || [];
  const firstMode = modes[0] || { id: "consulta", title: "Consulta", description: "", placeholder: "Escribí tu consulta...", strategy: "retrieve" };
  const [activeMode, setActiveMode] = useState(firstMode);
  const [messages, setMessages] = useState([{ role: "assistant", content: assistant.welcomeMessage || "Elegí una modalidad para comenzar." }]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [serviceStatus, setServiceStatus] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);
  const abortRef = useRef(false);

  const sheets = useMemo(() => createSheetsClient(course, student), [course, student]);

  const llm = useMemo(() => createLLMClient({
    courseId: course.id,
    apiKey,
    endpoint: course.llm?.endpoint || "",
    models: course.llm?.models || [],
    generation: course.llm?.generation || {},
  }), [course, apiKey]);

  useEffect(() => {
    bottomRef.current && bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    sheets.flushPending().catch(() => {});
    return () => {
      recognitionRef.current && recognitionRef.current.stop();
      window.speechSynthesis && window.speechSynthesis.cancel();
    };
  }, []);

  const currentModeStyle = activeMode || firstMode;

  const exportConversation = () => {
    const lines = [
      "AULIA — " + assistant.name,
      "Curso: " + course.title,
      "Fecha: " + new Date().toLocaleString("es-AR"),
      "Modo: " + activeMode.title,
      "",
      ...messages.map(message => "[" + (message.role === "user" ? "ALUMNO" : assistant.name) + "]\n" + message.content + "\n"),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (course.id || "aulia") + "-conversacion-" + Date.now() + ".txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const stopAudio = useCallback(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const send = useCallback(async (override) => {
    const text = cleanText(override === undefined ? input : override);
    if (!text || generating) return;
    stopAudio();
    setTranscript("");
    const userMessage = { role: "user", content: text };
    const updated = messages.concat(userMessage);
    setMessages(updated.concat({ role: "assistant", content: "" }));
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "26px";
    setGenerating(true);
    setServiceStatus("");
    abortRef.current = false;

    const retrieved = retrieveFromCourse(course, text, { modeId: activeMode.id });
    const history = updated.slice(1).slice(-6);

    try {
      const result = await llm.generate({
        course,
        mode: activeMode,
        assistant,
        messages: history,
        retrieved,
        signal: undefined,
      });
      const reply = result && result.reply ? result.reply : "";
      if (!reply) throw new Error("Respuesta vacía.");
      if (!abortRef.current) {
        setMessages(current => current.slice(0, -1).concat({ role: "assistant", content: reply }));

        const logResult = await sheets.logInteraction({
          courseId: course.id,
          sessionId: undefined,
          question: text,
          response: reply,
          retrievedIds: retrieved.map(item => item.id),
          conceptIds: result.analytics?.conceptIds || [],
          confusionLevel: result.analytics?.confusionLevel || 0,
          studentId: student?.dni || null,
          model: result.model || "",
          modeId: activeMode.id,
        });

        if (!logResult.ok && logResult.queued) {
          setServiceStatus("La consulta se respondió, pero quedó en cola para registrarse en la cátedra.");
        } else if (!logResult.ok && !logResult.disabled) {
          setServiceStatus("La consulta se respondió, pero no pudo registrarse en la cátedra.");
        }

        if (voiceMode && window.speechSynthesis) {
          setIsSpeaking(true);
          speakText(reply, () => setIsSpeaking(true), () => setIsSpeaking(false));
        }
      }
    } catch (error) {
      if (abortRef.current) return;
      const message = String(error?.message || "");
      const sessionInvalid = /sesión.*(vencida|inválida)|sesion.*(vencida|invalida)/i.test(message);
      if (sessionInvalid) {
        setMessages(current => current.slice(0, -1).concat({
          role: "assistant",
          content: "Tu sesión ya no es válida. Volvé a ingresar para continuar.",
        }));
        setServiceStatus("Sesión vencida. Iniciá sesión nuevamente.");
        setTimeout(() => onLogoutStudent(), 800);
      } else {
        setMessages(current => current.slice(0, -1).concat({
          role: "assistant",
          content: "No se pudo procesar la consulta. Intentá nuevamente en unos segundos.",
        }));
        setServiceStatus(message || "El servicio de IA no está disponible.");
      }
    } finally {
      setGenerating(false);
    }
  }, [activeMode, apiKey, assistant, course, generating, input, llm, messages, sheets, stopAudio, student, voiceMode]);

  function handleModeChange(mode, force) {
    if (mode.id === activeMode.id && !force) return;
    stopAudio();
    recognitionRef.current && recognitionRef.current.stop();
    setIsListening(false);
    setTranscript("");
    abortRef.current = true;
    setGenerating(false);
    setActiveMode(mode);
    setInput("");
    const welcomes = {
      consulta: assistant.welcomeMessage || "¿Sobre qué querés conversar?",
      analisis: "Decime qué película, escena o situación estás mirando. Cuanto más describís, más preciso puede ser el análisis.",
      socratico: "Bien. No voy a darte la respuesta directamente: voy a ayudarte a construirla. ¿Sobre qué concepto o escena querés trabajar?",
      ocultadores: "Vamos a analizar una escena paso a paso. Paso 1 de 6 — ¿Qué película y qué escena vas a analizar?",
    };
    setMessages([{ role: "assistant", content: welcomes[mode.id] || "Trabajemos con esta modalidad. Describí tu problema o hipótesis." }]);
    if (textareaRef.current) textareaRef.current.style.height = "26px";
  }

  function reset() { handleModeChange(activeMode, true); }

  function handleTextarea(event) {
    setInput(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = Math.min(event.target.scrollHeight, 120) + "px";
  }

  function toggleVoiceMode() {
    if (voiceMode) { stopAudio(); recognitionRef.current && recognitionRef.current.stop(); setIsListening(false); setTranscript(""); }
    setVoiceMode(value => !value);
    setVoiceError("");
  }

  function toggleMic() {
    if (isListening) { recognitionRef.current && recognitionRef.current.stop(); setIsListening(false); return; }
    const recognition = createRecognition();
    if (!recognition) { setVoiceError("Tu navegador no soporta reconocimiento de voz."); return; }
    setVoiceError("");
    let finalText = "";
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      setTranscript(finalText + interim);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (finalText.trim()) { setTranscript(""); send(finalText.trim()); }
    };
    recognition.onerror = event => {
      setIsListening(false);
      if (event.error !== "aborted") setVoiceError(event.error === "not-allowed" ? "Permiso de micrófono denegado." : "Error de reconocimiento: " + event.error);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  const showSuggestions = messages.length === 1 && !generating && activeMode.id === firstMode.id && (assistant.suggestions || []).length > 0;

  return (
    <div className="chat-app">
      <header className="ch-header">
        <Avatar initials={assistant.initials} size={32} />
        <div className="ch-title">
          <div>{assistant.name || course.title}</div>
          {!mobile && <span>{course.title} · {activeMode.title}</span>}
        </div>
        <div className="ch-actions">
          {!mobile && <div className="online"><span />En línea</div>}
          {browserSpeechAvailable() && (
            <button className={"ch-icon-button " + (voiceMode ? "active" : "")} onClick={toggleVoiceMode} title={voiceMode ? "Volver a texto" : "Activar voz"}>🎙{!mobile && <em>{voiceMode ? "Voz activa" : "Voz"}</em>}</button>
          )}
          <button className="ch-icon-button" onClick={exportConversation} title="Exportar conversación">⬇{!mobile && <em>Exportar</em>}</button>
          <button className="ch-icon-button" onClick={reset} title="Nueva conversación">↺{!mobile && <em>Reiniciar</em>}</button>
          <button className="ch-icon-button" onClick={() => onLogoutApiKey?.()} title="Cambiar API key">🔑</button>
          <button className="ch-icon-button" onClick={() => { if (window.confirm("¿Cerrar tu sesión?")) onLogoutStudent(); }} title="Cerrar sesión">⏻</button>
        </div>
      </header>

      <div className="ch-modebar">
        {modes.map(mode => {
          const active = mode.id === activeMode.id;
          return <button key={mode.id} className={"ch-mode " + (active ? "active" : "")} style={{ "--mode-color": mode.color || "#d4843c", "--mode-bg": mode.bg || "#1c0e04", "--mode-border": mode.border || "#8a4a14" }} onClick={() => handleModeChange(mode)} title={mode.description}>{mode.title}</button>;
        })}
      </div>

      <main className="ch-messages">
        <div className="ch-message-list">
          {activeMode.id !== "consulta" && <div className="ch-mode-badge" style={{ "--mode-color": activeMode.color || "#d4843c", "--mode-bg": activeMode.bg || "#1c0e04", "--mode-border": activeMode.border || "#8a4a14" }}>{activeMode.title}</div>}
          {messages.map((message, index) => {
            const user = message.role === "user";
            const loading = !message.content && generating && index === messages.length - 1;
            return <div key={index} className={"ch-row " + (user ? "user" : "assistant")}>
              {!user && <Avatar initials={assistant.initials} size={mobile ? 24 : 28} />}
              <div className={"ch-bubble " + (user ? "user" : "assistant")}>{loading ? <ThinkingDots /> : message.content}</div>
            </div>;
          })}

          {showSuggestions && <div className="ch-suggestions">
            <p>Preguntas sugeridas</p>
            <div>{assistant.suggestions.map((suggestion, index) => <button key={index} onClick={() => send(suggestion)}>{suggestion}</button>)}</div>
          </div>}
          {serviceStatus && <div className="ch-service-status">ⓘ {serviceStatus}</div>}
          <div ref={bottomRef} className="ch-bottom-space" />
        </div>
      </main>

      <footer className="ch-composer-wrap">
        <div className="ch-composer-inner">
          {!voiceMode && <div className="ch-composer-box">
            <textarea ref={textareaRef} rows={1} value={input} placeholder={activeMode.placeholder || "Escribí tu consulta..."} onChange={handleTextarea} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} />
            <button onClick={() => send()} disabled={!input.trim() || generating} title="Enviar">{generating ? "…" : "↑"}</button>
          </div>}

          {voiceMode && <div className="ch-voice">
            {transcript && <div className="voice-transcript">{transcript}</div>}
            {voiceError && <div className="voice-error">⚠ {voiceError}</div>}
            {isSpeaking ? <div className="voice-speaking"><div className="voice-wave">{[0,1,2,3,4,5,6].map(i => <span key={i} style={{ animationDelay: i * 0.09 + "s" }} />)}</div><span>{assistant.name || "El asistente"} está hablando…</span><button onClick={stopAudio}>⏹ Detener</button></div>
            : generating ? <div className="voice-speaking"><ThinkingDots /><span>Generando respuesta…</span></div>
            : <div className="voice-ready"><button onClick={toggleMic} className={isListening ? "listening" : ""}>{isListening ? "⏹" : "🎙"}</button><span>{isListening ? "Escuchando… click para enviar" : "Click para hablar"}</span></div>}
          </div>}

          <p className="ch-footer-note">{course.title} · Consultas registradas para seguimiento docente</p>
        </div>
      </footer>
    </div>
  );
}