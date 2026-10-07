import { useState } from "react";
import Avatar from "./Avatar.jsx";
import LegalNotice from "./LegalNotice.jsx";
import { saveApiKey } from "../utils/storage.js";

export default function ApiKeySetup({ course, onReady }) {
  const assistant = course.assistant || {};
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  function submit() {
    const trimmed = key.trim();
    if (!/^gsk_[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
      setError('La clave no parece ser una API key de Groq. Debería comenzar con "gsk_".');
      return;
    }
    saveApiKey(course.id, trimmed);
    onReady(trimmed);
  }

  return (
    <div className="access-screen">
      <div className="access-wrap">
        <div className="access-heading">
          <Avatar initials={assistant.initials} size={56} />
          <h1>{assistant.name || course.title}</h1>
          <p>{course.title}</p>
        </div>

        <div className="access-card">
          <div className="access-body">
            <div className="access-welcome">
              <strong>Configurá tu acceso a la IA</strong>
              <span>Usás tu propia cuenta y tus propios límites del proveedor.</span>
            </div>

            <p className="access-copy">
              AULIA no guarda esta clave en la cátedra ni en la Google Sheet.
              Se utiliza desde tu navegador para realizar las consultas.
            </p>

            <label className="access-field">
              <span>API key de Groq</span>
              <input
                type="password"
                value={key}
                placeholder="gsk_..."
                autoComplete="off"
                onChange={e => { setKey(e.target.value); setError(""); }}
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
              />
            </label>

            {error && <div className="access-error">⚠ {error}</div>}

            <button
              className="access-primary"
              disabled={!key.trim()}
              onClick={submit}
            >
              Comenzar →
            </button>

            <p className="access-hint">
              Necesitás una API key propia de Groq. Podés obtenerla desde console.groq.com.
            </p>
          </div>
        </div>

        <p className="access-footer">
          La clave se guarda únicamente en este navegador para esta instancia de AULIA.
        </p>
      </div>
    </div>
  );
}
