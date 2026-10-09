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
  const record = {
    id,
    kind: "pending-pdf",
    courseId: String(courseId || ""),
    fileName: file.name || "material.pdf",
    fileType: file.type || "application/pdf",
    lastModified: Number(file.lastModified || Date.now()),
    blob: file,
    updatedAt: new Date().toISOString(),
  };
  await withStore("readwrite", store => store.put(record));
  return record;
}

export async function getPendingPdf(id) {
  const record = await withStore("readonly", store => store.get(id));
  if (!record || record.kind !== "pending-pdf" || !record.blob) return null;
  return new File([record.blob], record.fileName, {
    type: record.fileType || "application/pdf",
    lastModified: record.lastModified || Date.now(),
  });
}

export async function listPendingPdfs(courseId) {
  const records = await withStore("readonly", store => store.getAll());
  return (records || [])
    .filter(record => record.kind === "pending-pdf" && record.courseId === String(courseId || ""))
    .map(record => ({
      id: record.id,
      fileName: record.fileName,
      updatedAt: record.updatedAt,
    }))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

export async function deletePendingPdf(id) {
  await withStore("readwrite", store => store.delete(id));
}

export async function saveExternalAnalysisBatch(courseId, sourceName, batch) {
  const id = "external-analysis::" + safePart(courseId) + "::" + safePart(sourceName) + "::" + stableHash(sourceName);
  const current = await withStore("readonly", store => store.get(id));
  if (current && current.kind === "external-analysis" && current.sourceName === sourceName && Number(current.totalPages) !== Number(batch.totalPages)) {
    throw new Error("El total de páginas no coincide con las tandas externas que ya guardaste para este documento. Revisá totalPages antes de importar otra tanda.");
  }
  const sameDocument = current &&
    current.kind === "external-analysis" &&
    Number(current.totalPages) === Number(batch.totalPages) &&
    current.sourceName === sourceName;
  const pages = sameDocument && current.pages ? { ...current.pages } : {};
  for (const page of batch.pages || []) pages[String(page.pageNumber)] = page;
  const record = {
    id,
    kind: "external-analysis",
    courseId: String(courseId || ""),
    sourceName,
    totalPages: Number(batch.totalPages),
    pages,
    updatedAt: new Date().toISOString(),
  };
  await withStore("readwrite", store => store.put(record));
  const pageNumbers = Object.keys(pages).map(Number).sort((a, b) => a - b);
  return { id, pageNumbers, processed: pageNumbers.length, totalPages: record.totalPages };
}

export async function listExternalAnalysisBatches(courseId) {
  const records = await withStore("readonly", store => store.getAll());
  return (records || [])
    .filter(record => record.kind === "external-analysis" && record.courseId === String(courseId || ""))
    .map(record => ({
      id: record.id,
      sourceName: record.sourceName,
      processed: Object.keys(record.pages || {}).length,
      totalPages: Number(record.totalPages || 0),
      updatedAt: record.updatedAt,
    }));
}

export async function getExternalAnalysisBatch(id) {
  return withStore("readonly", store => store.get(id));
}

export async function deleteExternalAnalysisBatch(id) {
  await withStore("readwrite", store => store.delete(id));
}


export async function readStudioRecord(id) {
  return withStore("readonly", store => store.get(id));
}

export async function writeStudioRecord(record) {
  return withStore("readwrite", store => store.put(record));
}
