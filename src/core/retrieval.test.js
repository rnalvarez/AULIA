import test from "node:test";
import assert from "node:assert/strict";
import { retrieveFromCourse } from "./retrieval.js";
import { knowledgeCorpusSignature, KNOWLEDGE_BASE_VERSION } from "./knowledgeBase.js";
import { buildKnowledgePassages } from "../services/llm/knowledgeBase.js";
const reference={id:"synthetic-reference",title:"Referencias",chapter:"Referencias",sectionPath:["Referencias"],role:"referencias",roleSource:"rules",roleConfidence:0.98,scope:"excluded",scopeSource:"role-default",priority:"normal",prioritySource:"document",content:"Alvarez, R. (2021). Acústica narrativa sintética. DOI 10.1234/synthetic.reference"};
test("las referencias excluidas no contaminan la recuperación léxica",()=>{
 const results=retrieveFromCourse({concepts:[],corpus:[reference],knowledgeBase:null},"Alvarez acústica narrativa",{conceptLimit:0,corpusLimit:5,knowledgeLimit:0});
 assert.equal(results.some(item=>item.id===reference.id),false);
});
test("scope permite recuperar referencias si el docente las incluye",()=>{
 const results=retrieveFromCourse({concepts:[],corpus:[{...reference,scope:"included",scopeSource:"teacher"}],knowledgeBase:null},"Alvarez acústica narrativa",{conceptLimit:0,corpusLimit:5,knowledgeLimit:0});
 assert.equal(results.some(item=>item.id===reference.id),true);
});


function priorityCorpusItem(id, priority) {
 return {
  id, title:"Resonancia sonora", chapter:"Resonancia sonora",
  sectionPath:["Resonancia sonora"],
  content:"La resonancia sonora describe la vibración y el sonido en un sistema acústico.",
  scope:"included", priority
 };
}

test("la prioridad ordena fragmentos: central, complementario y contexto",()=>{
 const corpus=[
  priorityCorpusItem("contexto","context"),
  priorityCorpusItem("complementario","normal"),
  priorityCorpusItem("central","central")
 ];
 const results=retrieveFromCourse({concepts:[],corpus,knowledgeBase:null},"resonancia sonora",{
  conceptLimit:0,corpusLimit:3,knowledgeLimit:0
 });
 assert.deepEqual(results.map(item=>item.id),["central","complementario","contexto"]);
});

test("la prioridad ordena conceptos con la misma consulta",()=>{
 const concepts=[
  {...priorityCorpusItem("concepto-contexto","context"),summary:""},
  {...priorityCorpusItem("concepto-complementario","normal"),summary:""},
  {...priorityCorpusItem("concepto-central","central"),summary:""}
 ];
 const results=retrieveFromCourse({concepts,corpus:[],knowledgeBase:null},"resonancia sonora",{
  conceptLimit:3,corpusLimit:0,knowledgeLimit:0
 });
 assert.deepEqual(results.map(item=>item.id),[
  "concepto-central","concepto-complementario","concepto-contexto"
 ]);
});

test("la prioridad heredada de las fuentes ordena entradas del índice conceptual",()=>{
 const corpus=[
  priorityCorpusItem("fuente-contexto","context"),
  priorityCorpusItem("fuente-complementaria","normal"),
  priorityCorpusItem("fuente-central","central")
 ];
 const priorities=["context","normal","central"];
 const entries=priorities.map((priority,index)=>({
  id:"indice-"+priority,
  term:"Resonancia sonora",
  definition:"La resonancia sonora describe la vibración y el sonido en un sistema acústico.",
  explanation:"Concepto de acústica.",
  aliases:[],relatedTerms:[],distinctions:[],examples:[],
  evidence:[{
   sourceId:["fuente-contexto","fuente-complementaria","fuente-central"][index],
   sourceName:"Manual de acústica",sectionPath:["Resonancia sonora"],
   pageStart:1,pageEnd:1
  }]
 }));
 const course={
  concepts:[],corpus,
  knowledgeBase:{
   version:KNOWLEDGE_BASE_VERSION,status:"complete",
   entries,processedPassageIds:["p1","p2","p3"],totalPassages:3,
   sourceSignature:knowledgeCorpusSignature(corpus)
  }
 };
 const results=retrieveFromCourse(course,"resonancia sonora",{
  conceptLimit:0,corpusLimit:0,knowledgeLimit:3
 });
 assert.deepEqual(results.map(item=>item.id),[
  "indice-central","indice-normal","indice-context"
 ]);
 assert.deepEqual(results.map(item=>item.priority),["central","normal","context"]);
});


test("contexto sigue siendo recuperable cuando la penalización lo baja al final",()=>{
 const context=priorityCorpusItem("contexto-relevante","context");
 context.title="Material complementario";
 context.chapter="";
 context.sectionPath=[];
 context.content="vibración";
 const longQuery="alfa bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra vibración";
 const results=retrieveFromCourse({concepts:[],corpus:[context],knowledgeBase:null},longQuery,{
  conceptLimit:0,corpusLimit:3,knowledgeLimit:0
 });
 assert.equal(results.some(item=>item.id==="contexto-relevante"),true);
});


test("recupera bibliografía relevante en una pregunta de seguimiento breve", () => {
  const corpus = [
    { id: "funcion-sustitutiva", title: "Función sustitutiva", sectionPath: ["Funciones de la música"], content: "La función sustitutiva permite que la música ocupe el lugar de una acción o elemento que no se muestra directamente.", scope: "included", priority: "central" },
    { id: "resonancia", title: "Resonancia sonora", sectionPath: ["Acústica"], content: "La resonancia describe la respuesta vibratoria de un sistema ante determinadas frecuencias.", scope: "included", priority: "normal" },
  ];
  const contextMessages = [
    { role: "user", content: "En la escena, la música reemplaza una acción que no vemos. ¿Qué función cumple?" },
    { role: "assistant", content: "Eso corresponde a la función sustitutiva: la música ocupa el lugar de esa acción no mostrada." },
  ];
  const withoutContext = retrieveFromCourse({ concepts: [], corpus, knowledgeBase: null }, "¿Y por qué?", { conceptLimit: 0, corpusLimit: 2, knowledgeLimit: 0 });
  const withContext = retrieveFromCourse({ concepts: [], corpus, knowledgeBase: null }, "¿Y por qué?", { conceptLimit: 0, corpusLimit: 2, knowledgeLimit: 0, contextMessages });
  assert.equal(withoutContext.some(item => item.id === "funcion-sustitutiva"), false);
  assert.equal(withContext[0]?.id, "funcion-sustitutiva");
});

test("una consulta específica no queda desviada por el contexto anterior", () => {
  const corpus = [
    { id: "funcion-sustitutiva", title: "Función sustitutiva", content: "La función sustitutiva permite que la música ocupe el lugar de una acción no mostrada.", scope: "included", priority: "normal" },
    { id: "resonancia", title: "Resonancia sonora", content: "La resonancia sonora describe la respuesta vibratoria de un sistema ante determinadas frecuencias.", scope: "included", priority: "normal" },
  ];
  const results = retrieveFromCourse({ concepts: [], corpus, knowledgeBase: null }, "resonancia sonora", {
    conceptLimit: 0, corpusLimit: 2, knowledgeLimit: 0,
    contextMessages: [{ role: "assistant", content: "La función sustitutiva es una función de la música." }],
  });
  assert.equal(results[0]?.id, "resonancia");
});

test("knowledge index version changes when corpus scope changes", () => {
  const included = [{ id: "p1", title: "Sección", content: "Contenido suficiente." }];
  const excluded = [{ ...included[0], scope: "excluded" }];
  assert.equal(KNOWLEDGE_BASE_VERSION, 3);
  assert.notEqual(knowledgeCorpusSignature(included), knowledgeCorpusSignature(excluded));
});

test("knowledge index builder omits excluded material by default", () => {
  const corpus = [
    { id: "included", title: "Incluido", content: "Texto autorizado." },
    { id: "excluded", title: "Excluido", scope: "excluded", content: "Texto que no debe indexarse." },
  ];
  assert.deepEqual(buildKnowledgePassages(corpus).map(p => p.sourceId), ["included"]);
  assert.deepEqual(
    buildKnowledgePassages(corpus, { includeExcluded: true }).map(p => p.sourceId),
    ["included", "excluded"]
  );
});

test("retrieval keeps valid evidence when another reference is excluded or missing", () => {
  const corpus = [
    { id: "active", title: "Sección válida", source: "Libro", content: "Definición útil.", scope: "included", priority: "central", sourcePageStart: 12 },
    { id: "excluded", title: "Sección excluida", source: "Libro", content: "Texto excluido.", scope: "excluded" },
    { id: "reference", title: "Sección referencial", source: "Libro", content: "Texto referencial.", scope: "reference" },
  ];
  const entries = [{
    id: "kb-concepto",
    term: "Concepto relevante",
    aliases: ["idea pertinente"],
    category: "categoría",
    definition: "Definición sustentada en el material.",
    explanation: "Explicación.",
    distinctions: [],
    relatedTerms: [],
    examples: [],
    evidence: [
      { sourceId: "excluded", sourceName: "Libro", excerpt: "evidencia excluida" },
      { sourceId: "active", sourceName: "Libro", excerpt: "evidencia válida", pageStart: 5 },
      { sourceId: "reference", sourceName: "Libro", excerpt: "evidencia referencial" },
      { sourceId: "missing", sourceName: "Fuente inexistente", excerpt: "evidencia no disponible" },
    ],
  }];
  const passages = buildKnowledgePassages(corpus);
  const course = {
    concepts: [],
    corpus,
    knowledgeBase: {
      version: KNOWLEDGE_BASE_VERSION,
      sourceSignature: knowledgeCorpusSignature(corpus),
      status: "complete",
      totalPassages: passages.length,
      processedPassageIds: passages.map(p => p.passageId),
      entries,
    },
  };

  const result = retrieveFromCourse(course, "Concepto relevante", { includeReference: false });
  const item = result.find(value => value.id === "kb-concepto");
  assert.ok(item, "the concept should remain retrievable through its valid evidence");
  assert.deepEqual(item.knowledgeEntry.evidence.map(ref => ref.sourceId), ["active"]);
  assert.deepEqual(item.sourceIds, ["active"]);
  assert.equal(item.priority, "central");
  assert.equal(item.sourcePageStart, 12);
});
