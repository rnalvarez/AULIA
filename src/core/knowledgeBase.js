export const KNOWLEDGE_BASE_VERSION = 1;

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function knowledgeCorpusSignature(corpus = []) {
  const active = (Array.isArray(corpus) ? corpus : [])
    .filter((item) => (item?.scope || "included") !== "excluded")
    .map((item) => [
      item?.id,
      item?.scope || "included",
      item?.priority || "normal",
      item?.title,
      item?.source,
      item?.documentId,
      item?.sourcePageStart,
      item?.sourcePageEnd,
      item?.sectionPath,
      item?.content,
      item?.summary,
      item?.explanation,
    ]);
  return "kb" + KNOWLEDGE_BASE_VERSION + "-" + hashString(JSON.stringify(active));
}

export function isKnowledgeBaseCurrent(course) {
  const index = course?.knowledgeBase;
  if (!index || index.version !== KNOWLEDGE_BASE_VERSION) return false;
  if (index.status !== "complete") return false;
  if (!Array.isArray(index.entries) || !Array.isArray(index.processedPassageIds)) return false;
  if (!index.sourceSignature || index.sourceSignature !== knowledgeCorpusSignature(course?.corpus || [])) return false;
  return Number(index.totalPassages || 0) === index.processedPassageIds.length;
}

export function summarizeKnowledgeBase(index) {
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  const evidenceCount = entries.reduce(
    (total, entry) => total + (Array.isArray(entry?.evidence) ? entry.evidence.length : 0),
    0
  );
  return {
    entries: entries.length,
    evidence: evidenceCount,
    processedPassages: Array.isArray(index?.processedPassageIds) ? index.processedPassageIds.length : 0,
    totalPassages: Number(index?.totalPassages || 0),
    status: String(index?.status || "empty"),
    updatedAt: String(index?.updatedAt || ""),
  };
}
