import test from "node:test";
import assert from "node:assert/strict";
import { retrieveFromCourse } from "./retrieval.js";
import { knowledgeCorpusSignature, KNOWLEDGE_BASE_VERSION } from "./knowledgeBase.js";
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
