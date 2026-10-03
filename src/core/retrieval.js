function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function score(question, item) {
  const q = normalize(question);
  const haystack = normalize([
    item.title,
    item.summary,
    item.explanation,
    ...(item.aliases || []),
    ...(item.keywords || []),
  ].join(" "));

  if (!q || !haystack) return 0;

  let value = 0;
  for (const token of q.split(" ")) {
    if (token.length >= 4 && haystack.includes(token)) value += 1;
  }
  if ((item.aliases || []).some((alias) => q.includes(normalize(alias)))) value += 5;
  return value;
}

export function retrieveFromCourse(course, question, limit = 4) {
  return course.concepts
    .map((item) => ({ item, score: score(question, item) }))
    .filter(({ score: value }) => value > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
