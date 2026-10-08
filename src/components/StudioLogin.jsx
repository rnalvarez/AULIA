import { useState } from "react";

export default function StudioLogin({ onReady, error: externalError = "" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await onReady(email.trim(), password);
    } catch (err) {
      setError(err.message || "No se pudo iniciar sesión.");
      setSubmitting(false);
    }
  }

  return (
    <div className="studio-access-screen">
      <div className="studio-access-wrap">
        <div className="studio-access-heading">
          <div className="eyebrow">AULIA</div>
          <h1>STUDIO</h1>
          <p>Espacio de autoría y gestión de cátedras.</p>
        </div>

        <form className="studio-access-card" onSubmit={submit}>
          <div className="studio-access-body">
            <div className="studio-access-welcome">
              <strong>Ingresá como docente</strong>
              <span>Solo vas a ver las cátedras que tenés autorizadas.</span>
            </div>

            <label className="studio-access-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                autoComplete="username"
                placeholder="docente@universidad.edu"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="studio-access-field">
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {(error || externalError) && (
              <div className="studio-access-error">⚠ {error || externalError}</div>
            )}

            <button className="access-primary" type="submit" disabled={!email.trim() || !password || submitting}>
              {submitting ? "Cargando tus cátedras…" : "Entrar →"}
            </button>
          </div>
        </form>

        <p className="studio-access-footer">
          Las autorizaciones las administra el backend de AULIA Studio.
        </p>
      </div>
    </div>
  );
}
