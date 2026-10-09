import { isKnowledgeBaseCurrent } from "./knowledgeBase.js";

const STOP_WORDS = new Set([
  "a", "al", "algo", "algunas", "algunos", "ante", "antes", "asi", "aun",
  "aunque", "bajo", "bien", "cada", "casi", "como", "con", "contra", "cual",
  "cuando", "de", "del", "desde", "donde", "dos", "durante", "e", "el", "ella",
  "ellas", "ello", "ellos", "en", "entre", "era", "eramos", "eran", "es", "esa",
  "esas", "ese", "eso", "esos", "esta", "estaba", "estaban", "estado", "estamos",
  "estan", "estar", "este", "esto", "estos", "fue", "fueron", "ha", "hace", "hacen",
  "hacer", "hacia", "han", "hasta", "hay", "la", "las", "le", "les", "lo", "los",
  "mas", "me", "mi", "mis", "mismo", "mucho", "muy", "no", "nos", "nuestra",
  "nuestro", "o", "otra", "otras", "otro", "otros", "para", "pero", "poco", "por",
  "porque", "que", "quien", "se", "sea", "segun", "ser", "si", "sin", "sobre",
  "son", "su", "sus", "tambien", "te", "tiene", "tienen", "todo", "todos", "tras",
  "tu", "tus", "un", "una", "unas", "uno", "unos", "y", "ya"
]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawTokens(value) {
  return normalize(value).split(" ").filter(token => token.length >= 3);
}

function termStem(token) {
  if (token.length > 6 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function queryTokens(value) {
  const seen = new Set();
  return rawTokens(value)
    .filter(token => !STOP_WORDS.has(token))
    .map(termStem)
    .filter(token => {
      if (token.length < 3 || seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function fieldsFor(item) {
  const path = Array.isArray(item?.sectionPath) ? item.sectionPath.join(" ") : "";
  const keywords = [
    ...(Array.isArray(item?.teacherConcepts) ? item.teacherConcepts : []),
    ...(Array.isArray(item?.aliases) ? item.aliases : []),
    ...(Array.isArray(item?.keywords) ? item.keywords : []),
  ].join(" ");
  return {
    title: normalize([item?.title, item?.chapter, path].filter(Boolean).join(" ")),
    keywords: normalize([item?.teacherTopic, keywords].filter(Boolean).join(" ")),
    summary: normalize([item?.summary, item?.explanation, item?.teacherLimit].filter(Boolean).join(" ")),
    content: normalize(item?.content || ""),
    source: normalize(item?.source || item?.sourceName || ""),
  };
}

function stemmedField(value) {
  return new Set(rawTokens(value).map(termStem));
}

function score(question, item, corpusStats) {
  const normalizedQuestion = normalize(question);
  const query = queryTokens(question);
  if (!query.length) return 0;

  const fields = fieldsFor(item);
  const stemmed = Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, stemmedField(value)])
  );
  const weights = { title: 5.2, keywords: 4.6, summary: 2.7, content: 1.15, source: 0.45 };

  let scoreValue = 0;
  let matched = 0;
  for (const token of query) {
    let bestWeight = 0;
    for (const [fieldName, terms] of Object.entries(stemmed)) {
      if (terms.has(token)) bestWeight = Math.max(bestWeight, weights[fieldName]);
    }
    if (bestWeight > 0) {
      matched += 1;
      const idf = corpusStats?.idf?.get(token) ?? 1;
      scoreValue += bestWeight * idf;
    }
  }

  // Explicit phrases and aliases are stronger signals than isolated word matches.
  const titleAndKeywords = fields.title + " " + fields.keywords;
  if (normalizedQuestion && titleAndKeywords.includes(normalizedQuestion)) scoreValue += 10;
  if (normalizedQuestion && fields.content.includes(normalizedQuestion)) scoreValue += 4;

  const aliases = [
    ...(Array.isArray(item?.aliases) ? item.aliases : []),
    ...(Array.isArray(item?.keywords) ? item.keywords : []),
    ...(Array.isArray(item?.teacherConcepts) ? item.teacherConcepts : []),
  ];
  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias.length >= 3 && normalizedQuestion.includes(normalizedAlias)) {
      scoreValue += 6;
    }
  }

  // Reward coverage of the question without favoring longer chapter fragments.
  scoreValue += matched / query.length * 5;
  return scoreValue;
}

function buildCorpusStats(items, question) {
  const query = queryTokens(question);
  const df = new Map(query.map(token => [token, 0]));
  for (const item of items || []) {
    const text = normalize([
      item?.title, item?.chapter,
      ...(Array.isArray(item?.sectionPath) ? item.sectionPath : []),
      item?.summary, item?.explanation, item?.content,
      item?.teacherTopic, item?.teacherLimit,
      ...(Array.isArray(item?.teacherConcepts) ? item.teacherConcepts : []),
      ...(Array.isArray(item?.aliases) ? item.aliases : []),
      ...(Array.isArray(item?.keywords) ? item.keywords : []),
    ].filter(Boolean).join(" "));
    const unique = new Set(rawTokens(text).map(termStem));
    for (const token of query) if (unique.has(token)) df.set(token, df.get(token) + 1);
  }

  const count = Math.max(1, (items || []).length);
  const idf = new Map();
  for (const token of query) {
    const frequency = df.get(token) || 0;
    idf.set(token, Math.log(1 + (count - frequency + 0.5) / (frequency + 0.5)));
  }
  return { idf };
}

function splitIntoPassages(item, maxChars = 1100, overlap = 170) {
  const text = String(item?.content || item?.explanation || item?.summary || "");
  if (text.length <= maxChars) return [{ ...item, content: text, _passageIndex: 0 }];

  const passages = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      // Prefer a natural boundary in the final third of the window.
      const minEnd = start + Math.floor(maxChars * 0.68);
      const paraBoundary = text.lastIndexOf("\n", end);
      const sentenceBoundary = Math.max(
        text.lastIndexOf(". ", end),
        text.lastIndexOf("? ", end),
        text.lastIndexOf("! ", end),
        text.lastIndexOf("; ", end)
      );
      const naturalBoundary = Math.max(paraBoundary, sentenceBoundary);
      if (naturalBoundary >= minEnd) end = naturalBoundary + 1;
      else {
        const wordBoundary = text.lastIndexOf(" ", end);
        if (wordBoundary > minEnd) end = wordBoundary;
      }
    }

    const passage = text.slice(start, end).trim();
    if (passage) passages.push({ ...item, content: passage, _passageIndex: index++ });
    if (end >= text.length) break;

    const nextStart = Math.max(start + 1, end - overlap);
    start = nextStart;
  }

  return passages.length ? passages : [{ ...item, content: text.slice(0, maxChars), _passageIndex: 0 }];
}

function rankCorpusPassages(items, question, includeReference, limit) {
  const passages = [];
  for (const item of items || []) {
    const scope = item.scope || "included";
    if (scope === "excluded") continue;
    if (scope === "reference" && !includeReference) continue;
    const text = String(item?.content || item?.explanation || item?.summary || "");
    if (!text.trim()) continue;
    passages.push(...splitIntoPassages(item));
  }

  const ranked = rank(passages, question, includeReference);
  const bestBySource = new Map();
  for (const item of ranked) {
    const key = String(item.id || item.title || "");
    if (!bestBySource.has(key)) bestBySource.set(key, item);
  }
  return Array.from(bestBySource.values()).slice(0, limit);
}

function rank(items, question, optionsIncludeReference = false) {
  const available = (items || []).filter(item => {
    const scope = item.scope || "included";
    if (scope === "excluded") return false;
    if (scope === "reference" && !optionsIncludeReference) return false;
    return true;
  });
  const corpusStats = buildCorpusStats(available, question);
  return available
    .map(item => {
      const value = score(question, item, corpusStats);
      let adjusted = value;
      if (item.priority === "central") adjusted += 1.5;
      if (item.priority === "context") adjusted += 0.15;
      return { item, score: adjusted };
    })
    .filter(({ score: value }) => value > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item, score: value }) => ({ ...item, _score: value }));
}

export function retrieveFromCourse(course, question, options = {}) {
  const modeId = options.modeId || "";
  const conceptLimit = options.conceptLimit ?? (modeId === "socratico" ? 2 : 3);
  const corpusLimit = options.corpusLimit ?? (modeId === "socratico" ? 3 : 4);

  // Rank against the entire loaded corpus locally. The LLM only receives a few
  // relevant excerpts so the book is searchable in full without sending the book
  // on every request or overrunning the student's Groq token budget.
  const includeReference = options.includeReference === true;
  const concepts = rank(course.concepts || [], question, includeReference).slice(0, conceptLimit);
  // A generated concept index gives paraphrases and related terminology a second
  // retrieval path, while every indexed item carries page/section evidence.
  const indexIsCurrent = isKnowledgeBaseCurrent(course);
  const knowledgeItems = indexIsCurrent
    ? rank((course.knowledgeBase.entries || []).map(entry => {
        const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
        const first = evidence[0] || {};
        return {
          id: entry.id,
          title: entry.term,
          aliases: entry.aliases || [],
          keywords: [
            entry.category,
            ...(entry.relatedTerms || []),
            ...(entry.distinctions || []),
          ].filter(Boolean),
          summary: entry.definition || "",
          explanation: entry.explanation || "",
          content: [
            entry.definition || "",
            entry.explanation || "",
            ...(entry.distinctions || []),
            ...(entry.relatedTerms || []),
            ...(entry.examples || []),
          ].filter(Boolean).join(" "),
          priority: "central",
          scope: "included",
          _retrievalKind: "knowledge",
          knowledgeEntry: entry,
          source: first.sourceName || "",
          sectionPath: Array.isArray(first.sectionPath) ? first.sectionPath : [],
          sourcePageStart: first.pageStart || first.printedPageStart || null,
          sourcePageEnd: first.pageEnd || first.printedPageEnd || null,
          sourceIds: Array.from(new Set(evidence.map(item => item.sourceId).filter(Boolean))),
        };
      }), question, true).slice(0, options.knowledgeLimit ?? 4)
    : [];
  // Rank overlapping passages, not whole chapters. This prevents a concept
  // mentioned halfway through a long section from being lost when the prompt
  // later trims the text to fit the student's Groq budget.
  const corpus = rankCorpusPassages(course.corpus || [], question, includeReference, corpusLimit);

  const seen = new Set();
  return knowledgeItems.concat(concepts, corpus).filter(item => {
    const key = item.id || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
