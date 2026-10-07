import { useState } from "react";
import Avatar from "./Avatar.jsx";
import LegalNotice from "./LegalNotice.jsx";
import { checkStudent, createStudentPin, verifyStudentPin, saveVerifiedStudent } from "../services/auth/studentAccess.js";

export default function StudentLogin({ course, onReady }) {
  const assistant = course.assistant || {};
  const [step, setStep] = useState("dni");
  const [dni, setDni] = useState("");
  const [pin, setPin] = useState("");
  const [pinConf, setPinConf] = useState("");
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endpointReady = Boolean(course && course.tracking && course.tracking.endpoint);

  async function run(action) {
    setLoading(true);
    setError("");
    try { return await action(); }
    catch (err) { setError(err.message || "No se pudo completar la operación."); return null; }
    finally { setLoading(false); }
  }

  async function handleCheckDNI() {
    const clean = dni.replace(/\D/g, "");
    if (!clean || clean.length < 6) { setError("Ingresá un DNI válido (solo números, mínimo 6 dígitos)."); return; }
    const data = await run(() => checkStudent(course, clean));
    if (!data) return;
    if (!data.found) { setError("Tu DNI no figura en el padrón de la cátedra. Consultá con el docente."); return; }
    if (data.activo === false || String(data.activo).toLowerCase() === "no") { setError("Tu acceso está deshabilitado. Contactá al docente de tu comisión."); return; }
    const record = { dni: clean, apellido: data.apellido || "", nombre: data.nombre || "", comision: data.comision || "" };
    setStudent(record); setPin(""); setPinConf("");
    setStep(data.hasPin ? "enterPin" : "createPin");
  }

  async function handleCreatePin() {
    if (!/^\d{4,6}$/.test(pin)) { setError("El PIN debe tener entre 4 y 6 dígitos numéricos."); return; }
    if (pin !== pinConf) { setError("Los PINs no coinciden. Volvé a ingresarlos."); return; }
    const data = await run(() => createStudentPin(course, student.dni, pin));
    if (!data || data.success === false) { setError((data && data.msg) || "No se pudo registrar el PIN."); return; }
    onReady(saveVerifiedStudent(course, student, data["token"]));
  }

  async function handleVerifyPin() {
    if (!/^\d{4,6}$/.test(pin)) { setError("Ingresá tu PIN (4 a 6 dígitos)."); return; }
    const data = await run(() => verifyStudentPin(course, student.dni, pin));
    if (!data) return;
    if (!data.allowed) { setError("PIN incorrecto. Si lo olvidaste, contactá al docente para que lo resetee."); return; }
    onReady(saveVerifiedStudent(course, student, data["token"]));
  }

  const buttonLabel = loading ? "Verificando…" : step === "dni" ? "Verificar DNI →" : step === "createPin" ? "Crear PIN y acceder →" : "Acceder →";

  return (
    <div className="access-screen">
      <div className="access-wrap">
        <div className="access-heading">
          <Avatar initials={assistant.initials} size={56} />
          <h1>{assistant.name || course.title}</h1>
          <p>{course.title}</p>
        </div>

        <div className="access-card">
          <div className="access-steps">
            <div className={"access-step " + (step === "dni" ? "active" : "")}>
              <span className={"step-circle " + (step !== "dni" ? "done" : "")}>{step !== "dni" ? "✓" : "1"}</span>
              <span>Identificación</span>
              <i />
            </div>
            <div className={"access-step " + (step !== "dni" ? "active" : "")}>
              <span className="step-circle">{step === "dni" ? "2" : "2"}</span>
              <span>PIN de acceso</span>
            </div>
          </div>

          {!endpointReady && <div className="access-error">⚠ Esta instancia todavía no tiene configurado el sistema de acceso de la cátedra.</div>}

          <div className="access-body">
            {step === "dni" && <>
              <p className="access-copy">Ingresá tu número de DNI para verificar si estás habilitado en esta cátedra.</p>
              <label className="access-field">
                <span>Número de DNI</span>
                <input type="tel" inputMode="numeric" value={dni} maxLength={9} placeholder="30123456" disabled={loading || !endpointReady} autoFocus
                  onChange={e => { setDni(e.target.value.replace(/\D/g, "")); setError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") handleCheckDNI(); }} />
              </label>
            </>}

            {step === "createPin" && student && <>
              <div className="access-welcome"><strong>{"¡Bienvenido" + (student.apellido ? ", " + student.apellido + "!" : "!")}</strong>{student.comision && <span>{student.comision}</span>}</div>
              <p className="access-copy">Es tu primera vez. Creá un PIN de <strong>4 a 6 dígitos</strong> que vas a usar cada vez que accedas.</p>
              <label className="access-field"><span>Nuevo PIN</span><input type="password" inputMode="numeric" value={pin} maxLength={6} placeholder="••••" onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }} /></label>
              <label className="access-field"><span>Confirmar PIN</span><input type="password" inputMode="numeric" value={pinConf} maxLength={6} placeholder="••••" onChange={e => { setPinConf(e.target.value.replace(/\D/g, "")); setError(""); }} onKeyDown={e => { if (e.key === "Enter") handleCreatePin(); }} /></label>
            </>}

            {step === "enterPin" && student && <>
              <div className="access-welcome"><strong>{"Bienvenido" + (student.apellido ? ", " + student.apellido : "")}</strong>{student.comision && <span>{student.comision}</span>}</div>
              <label className="access-field"><span>Tu PIN de acceso</span><input type="password" inputMode="numeric" value={pin} maxLength={6} placeholder="••••" autoFocus onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }} onKeyDown={e => { if (e.key === "Enter") handleVerifyPin(); }} /></label>
              <p className="access-hint">¿Olvidaste tu PIN? Contactá al docente para que lo resetee.</p>
            </>}

            {error && <div className="access-error">⚠ {error}</div>}
            <button className="access-primary" disabled={loading || !endpointReady} onClick={step === "dni" ? handleCheckDNI : step === "createPin" ? handleCreatePin : handleVerifyPin}>{buttonLabel}</button>
          </div>
        </div>
        <p className="access-footer">Acceso gestionado por la cátedra · Las consultas se registran para seguimiento docente</p>
      </div>
    </div>
  );
}