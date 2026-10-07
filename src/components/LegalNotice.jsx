import { useState } from "react";

const SECTIONS = [
  {
    title: "Responsabilidad sobre los materiales",
    body: "La persona docente o responsable que incorpora archivos, textos, libros, apuntes u otros materiales a AULIA declara que cuenta con los derechos, permisos, licencias, autorizaciones institucionales o demás bases legales que correspondan para utilizarlos en la cátedra y ponerlos a disposición de sus estudiantes a través de la plataforma."
  },
  {
    title: "AULIA como herramienta",
    body: "AULIA es una herramienta tecnológica de apoyo pedagógico. No verifica la titularidad de los materiales cargados, no certifica derechos de autor y no determina si un uso concreto de una obra resulta lícito. La responsabilidad de seleccionar, incorporar, organizar, publicar y utilizar los materiales corresponde a quien administra la cátedra."
  },
  {
    title: "Uso de la plataforma",
    body: "El usuario se compromete a utilizar AULIA de forma lícita y responsable y a no emplearla para infringir derechos de autor, distribuir materiales sin autorización, eludir controles de acceso o realizar actividades contrarias a la normativa aplicable."
  },
  {
    title: "Procesamiento mediante IA",
    body: "AULIA puede analizar los materiales incorporados para generar propuestas pedagógicas, organizar contenidos y responder consultas dentro del corpus autorizado. Las respuestas generadas por IA pueden contener errores y deben entenderse como asistencia, no como autoridad académica, jurídica o profesional."
  },
  {
    title: "Responsabilidad del creador de AULIA",
    body: "En la medida permitida por la legislación aplicable, Ramiro N. Alvarez, como creador de AULIA, no asume responsabilidad por el contenido que los usuarios incorporen, por la falta de derechos o autorizaciones sobre dichos materiales, ni por el uso indebido que terceros hagan de la plataforma o de sus resultados. Esta cláusula no pretende excluir responsabilidades que legalmente no puedan ser excluidas."
  },
  {
    title: "Derechos de terceros",
    body: "Los derechos sobre libros, artículos, textos, imágenes, obras audiovisuales y demás materiales utilizados dentro de una cátedra pertenecen a sus respectivos titulares. La existencia de un archivo en Internet no implica por sí misma que pueda copiarse o redistribuirse libremente."
  },
  {
    title: "Retiro de materiales",
    body: "Si una persona responsable detecta que un material fue incorporado sin la autorización necesaria o recibe un reclamo de un titular de derechos, deberá retirarlo de la cátedra y gestionar la situación correspondiente antes de volver a publicarlo."
  },
  {
    title: "Sin asesoramiento jurídico",
    body: "Este texto constituye una política informativa de uso de AULIA y no reemplaza el asesoramiento de un profesional del derecho. La legalidad del uso de una obra puede depender de su licencia, autorización, finalidad, forma de acceso y legislación aplicable."
  }
];

export default function LegalNotice({ compact = false }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="aulia-legal-link"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Legales y uso responsable
      </button>

      {open && (
        <div className="aulia-legal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <section className={"aulia-legal-dialog" + (compact ? " compact" : "")} role="dialog" aria-modal="true" aria-labelledby="aulia-legal-title">
            <header className="aulia-legal-head">
              <div>
                <div className="eyebrow">AULIA</div>
                <h2 id="aulia-legal-title">Legales y uso responsable</h2>
                <p>Condiciones básicas para el uso de materiales y de la plataforma.</p>
              </div>
              <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label="Cerrar">×</button>
            </header>

            <div className="aulia-legal-body">
              <div className="aulia-legal-alert">
                <strong>Importante:</strong> quien carga y publica material en una cátedra es responsable de contar con los derechos, permisos o autorizaciones necesarios para utilizarlo.
              </div>

              {SECTIONS.map((section) => (
                <article key={section.title}>
                  <h3>{section.title}</h3>
                  <p>{section.body}</p>
                </article>
              ))}
            </div>

            <footer className="aulia-legal-footer">
              <span>Última actualización: octubre de 2026.</span>
              <button type="button" className="primary" onClick={() => setOpen(false)}>Entendido</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
