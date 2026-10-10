const DB_NAME = "aulia-studio-persistence";
const DB_VERSION = 1;
const STORE_NAME = "records";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("Este navegador no permite guardar una carga pendiente. Mantené esta pestaña abierta hasta terminar el análisis."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento local de AULIA."));
  });
}

async function withStore(mode, operation) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error || new Error("Falló el almacenamiento local de AULIA."));
      tx.onabort = () => reject(tx.error || new Error("La operación de almacenamiento fue interrumpida."));
    });
  } finally {
    db.close();
  }
}

function safePart(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "material";
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function pendingPdfId(courseId, fileName) {
  return "pending-pdf::" + safePart(courseId) + "::" + safePart(fileName) + "::" + stableHash(fileName);
}

export async function savePendingPdf(courseId, file) {
  const id = pendingPdfId(courseId, file.name);
  const existing = await readStudioRecord(id);
  const sameFile = existing?.kind === "pending-pdf" &&
    Number(existing.fileSize) === Number(file.size) &&
    Number(existing.lastModified) === Number(file.lastModified || 0);
  const record = {
    ...(sameFile ? existing : {}),
    id,
    kind: "pending-pdf",
    courseId: String(courseId || ""),
    fileName: file.name || "material.pdf",
    fileType: file.type || "application/pdf",
    fileSize: Number(file.size || 0),
    lastModified: Number(file.lastModified || 0),
    blob: file,
    updatedAt: new Date().toISOString(),
    blockedUntil: sameFile ? String(existing.blockedUntil || "") : "",
    pauseReason: sameFile ? String(existing.pauseReason || "") : "",
    lastError: sameFile ? String(existing.lastError || "") : "",
    isDailyLimit: sameFile ? Boolean(existing.isDailyLimit) : false,
  };
  await withStore("readwrite", store => store.put(record));
  return record;
}

export async function getPendingPdf(id) {
  const record = await withStore("readonly", store => store.get(id));
  if (!record || record.kind !== "pending-pdf" || !record.blob) return null;
  return new File([record.blob], record.fileName, {
    type: record.fileType || "application/pdf",
    lastModified: Number.isFinite(Number(record.lastModified)) ? Number(record.lastModified) : Date.now(),
  });
}

export async function getPendingPdfStatus(id) {
  const record = await readStudioRecord(id);
  if (!record || record.kind !== "pending-pdf") return null;
  return {
    id: record.id,
    fileName: record.fileName,
    fileSize: Number(record.fileSize || 0),
    lastModified: Number(record.lastModified || 0),
    blockedUntil: String(record.blockedUntil || ""),
    pauseReason: String(record.pauseReason || ""),
    lastError: String(record.lastError || ""),
    isDailyLimit: Boolean(record.isDailyLimit),
  };
}

export async function listPendingPdfs(courseId) {
  const records = await withStore("readonly", store => store.getAll());
  const preparedIds = new Set(
    (records || []).filter(record => record.kind === "prepared-pdf").map(record => record.id)
  );
  return (records || [])
    .filter(record => record.kind === "pending-pdf" && record.courseId === String(courseId || ""))
    .map(record => ({
      id: record.id,
      fileName: record.fileName,
      updatedAt: record.updatedAt,
      blockedUntil: String(record.blockedUntil || ""),
      pauseReason: String(record.pauseReason || ""),
      lastError: String(record.lastError || ""),
      isDailyLimit: Boolean(record.isDailyLimit),
      prepared: preparedIds.has(preparedPdfCacheId(record.id)),
    }))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

export async function deletePendingPdf(id) {
  await withStore("readwrite", store => {
    store.delete(id);
    store.delete(preparedPdfCacheId(id));
  });
}

function preparedPdfCacheId(id) {
  return "prepared-pdf::" + String(id || "");
}

/**
 * Persist the locally extracted corpus and compact per-page text needed for
 * selective OCR/vision. Images are omitted to avoid storing large data URLs;
 * on resume, only still-pending visual pages need to be rendered again.
 */
export async function savePreparedPdf(id, file, material) {
  const aiPages = (material?.aiPages || []).map(page => ({
    pageNumber: Number(page.pageNumber),
    extractedText: String(page.extractedText || ""),
    needsVisualAnalysis: Boolean(page.needsVisualAnalysis),
  }));
  const { sections: _redundantSections, ...compactAnalysis } = material?.analysis || {};
  const payload = {
    sourceName: String(material?.sourceName || file?.name || "material.pdf"),
    pages: Number(material?.pages || aiPages.length || 0),
    document: material?.document || null,
    analysis: compactAnalysis,
    bibliography: Array.isArray(material?.bibliography) ? material.bibliography : [],
    warnings: Array.isArray(material?.warnings) ? material.warnings : [],
    // Persist the complete locally extracted corpus, not just page previews.
    // This is the authoritative text needed to resume OCR/indexing after a quota pause.
    corpus: Array.isArray(material?.corpus) ? material.corpus : [],
    aiPages,
  };
  const record = {
    id: preparedPdfCacheId(id),
    kind: "prepared-pdf",
    sourceId: String(id || ""),
    fileName: String(file?.name || ""),
    fileSize: Number(file?.size || 0),
    lastModified: Number(file?.lastModified || 0),
    payload,
    updatedAt: new Date().toISOString(),
  };
  await withStore("readwrite", store => store.put(record));
  return record;
}

export async function getPreparedPdf(id, file) {
  const record = await readStudioRecord(preparedPdfCacheId(id));
  if (!record || record.kind !== "prepared-pdf" || !record.payload) return null;
  if (file && (
    record.fileName !== String(file.name || "") ||
    Number(record.fileSize) !== Number(file.size || 0) ||
    Number(record.lastModified) !== Number(file.lastModified || 0)
  )) return null;
  return record.payload;
}

export async function updatePendingPdfStatus(id, {
  blockedUntil = "",
  pauseReason = "",
  lastError = "",
  isDailyLimit = false,
} = {}) {
  const record = await readStudioRecord(id);
  if (!record || record.kind !== "pending-pdf") return false;
  await writeStudioRecord({
    ...record,
    blockedUntil: String(blockedUntil || ""),
    pauseReason: String(pauseReason || ""),
    lastError: String(lastError || ""),
    isDailyLimit: Boolean(isDailyLimit),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function readStudioRecord(id) {
  return withStore("readonly", store => store.get(id));
}

export async function writeStudioRecord(record) {
  return withStore("readwrite", store => store.put(record));
}
