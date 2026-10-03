// AULIA — CHIONIA pilot configuration
const AULIA_BACKEND_VERSION = "0.2.0-aulia-chion-pilot";
const TIMEZONE = "America/Argentina/Buenos_Aires";
const DEFAULT_SESSION_TTL_SECONDS = 6 * 60 * 60;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_SECONDS = 10 * 60;
const LOGIN_LOCK_SECONDS = 15 * 60;

const SHEETS = {
  padron: "📋 Padrón",
  resumen: "📊 Resumen",
  lunes: "🗓 Lunes",
  miercoles: "🗓 Miércoles",
  jueves: "🗓 Jueves",
  alumno: "👤 Por alumno",
  conceptos: "🧠 Conceptos",
  log: "📝 Interacciones",
};

const COMISIONES_NOMBRES = [
  "Comisión 1 — Lunes",
  "Comisión 2 — Miércoles",
  "Comisión 3 — Jueves",
];

const MODE_LABELS = {
  consulta: "Consulta",
  analisis: "Análisis",
  socratico: "Socrático",
  ocultadores: "Paso a paso",
};

const CONCEPTOS = [
  "síncresis","sincrésis","synchrésis",
  "acúsmetro","acusmétrico","acusmática","acusmático",
  "valor añadido","valeur ajoutée",
  "escucha reducida","escucha causal","escucha semántica",
  "música empática","anempática","empática",
  "contrato audiovisual",
  "fuera de campo","sonido in","sonido off","sonido interno",
  "punto de escucha","extensión","suspensión",
  "ism","indicios sonoros materializadores",
  "supercampo","temporalización","vectorización","linealización",
  "vococentrismo","verbocentrismo",
  "imantación espacial","cronografía","silencio",
  "desacusmatización","renderizado",
];

const CONFUSION_PATTERNS = [
  "no entend","no comprend","no sé","no se","qué significa","que significa",
  "me confund","me perdí","me perdi","no sé si","no se si","estoy confund",
  "es lo mismo","cuál es la diferencia","cual es la diferencia",
  "no me queda claro","no queda claro","no entiendo bien",
];

function normalizeText(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeDni(value) {
  return String(value == null ? "" : value).replace(/\D/g, "");
}

function isActiveValue(value) {
  return ["si","sí","1","true","yes"].includes(normalizeText(value));
}

function findColumn(headers, candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const target = normalizeText(candidates[i]);
    const index = headers.findIndex(h => normalizeText(h) === target);
    if (index >= 0) return index;
  }
  return -1;
}

function cell(row, index) {
  return index >= 0 && row[index] != null ? String(row[index]).trim() : "";
}

function getSheet(name, createIfMissing) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet && createIfMissing) sheet = ss.insertSheet(name);
  if (!sheet) throw new Error("Falta la hoja " + name + ".");
  return sheet;
}

function requireCourse(body) {
  const configured = requiredProperty("COURSE_ID");
  const requested = String(body.courseId || "");
  if (requested && requested !== configured) throw new Error("Instancia de cátedra no válida.");
  return configured;
}
