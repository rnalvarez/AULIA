function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return normalize(value).split(" ").filter(token => token.length >= 4);
}

function score(question, item) {
  const q = normalize(question);
  const qTokens = tokens(question);
  const haystack = normalize([
    item.title,
    item.summary,
    item.explanation,
    item.content,
    ...(item.aliases || []),
    ...(item.keywords || []),
  ].join(" "));

  if (!q || !haystack) return 0;

  let value = 0;
  for (const token of qTokens) {
    if (haystack.includes(token)) value += 1;
  }

  for (const alias of item.aliases || []) {
    const aliasText = normalize(alias);
    if (aliasText && q.includes(aliasText)) value += 5;
  }

  return value;
}

function rank(items, question) {
  return items
    .map(item => ({ item, score: score(question, item) }))
    .filter(({ score: value }) => value > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item, score: value }) => ({ ...item, _score: value }));
}

export function retrieveFromCourse(course, question, options = {}) {
  const modeId = options.modeId || "";
  const conceptLimit = options.conceptLimit ?? (modeId === "socratico" ? 2 : 3);
  const corpusLimit = options.corpusLimit ?? (modeId === "socratico" ? 1 : modeId === "analisis" ? 2 : 2);

  const concepts = rank(course.concepts || [], question).slice(0, conceptLimit);
  const corpus = rank(course.corpus || [], question).slice(0, corpusLimit);

  const seen = new Set();
  return concepts.concat(corpus).filter(item => {
    const key = item.id || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
