import test from "node:test";
import assert from "node:assert/strict";
import {
  createExternalDocumentAnalysisPackage as makeSource,
  validateExternalDocumentAnalysisBatch as validate,
  mergeExternalDocumentAnalysis as merge,
  applyExternalDocumentAnalysis as apply,
  EXTERNAL_DOCUMENT_ANALYSIS_OUTPUT_FORMAT as FORMAT,
} from "./externalDocumentAnalysisIO.js";

function fixture() {
 return {
  id:"c",title:"Curso",knowledgeBase:{status:"complete"},
  documents:[{id:"d",title:"Manual",sourceName:"manual.pdf",pages:3,priority:"normal",sections:[]}],
  corpus:[
   {id:"s1",documentId:"d",source:"manual.pdf",title:"Inicio",sourcePageStart:1,sourcePageEnd:1,sectionPath:["Inicio"],scope:"included",scopeSource:"role-default",priority:"normal",prioritySource:"document",content:"Texto uno."},
   {id:"s2",documentId:"d",source:"manual.pdf",title:"Inicio",sourcePageStart:2,sourcePageEnd:2,sectionPath:["Inicio"],scope:"included",scopeSource:"role-default",priority:"normal",prioritySource:"document",content:"Texto dos."},
   {id:"s3",documentId:"d",source:"manual.pdf",title:"Referencias",sourcePageStart:3,sourcePageEnd:3,sectionPath:["Referencias"],scope:"included",scopeSource:"role-default",priority:"normal",prioritySource:"document",content:"Cita (2020)."},
   {id:"s4",documentId:"d",source:"manual.pdf",title:"Caso",sourcePageStart:3,sourcePageEnd:3,sectionPath:["Caso"],scope:"included",scopeSource:"teacher",priority:"context",prioritySource:"teacher",content:"Caso aplicado."}
  ],
  concepts:[]
 };
}
function item(id,title="Inicio",role="contenido",path=[title]) {
 return {segmentId:id,sectionTitle:title,sectionPath:path,level:path.length,role,confidence:.9,rationale:"Evidencia textual."};
}
function batch(source,ids,overrides={}) {
 return {format:FORMAT,version:1,documentId:"d",sourceSignature:source.sourceSignature,totalSegments:source.totalSegments,
  processedSegmentIds:ids,assignments:ids.map(id=>({...item(id),...(overrides[id]||{})}))};
}

test("exporta solo un documento con firma repetible",()=>{
 const c=fixture(),a=makeSource({course:c,documentId:"d"}),b=makeSource({course:c,documentId:"d"});
 assert.equal(a.totalSegments,4);assert.equal(a.sourceSignature,b.sourceSignature);assert.equal(a.segments[0].segmentId,"s1");
});
test("valida consecutividad y asignaciones uno a uno",()=>{
 const s=makeSource({course:fixture(),documentId:"d"});
 assert.equal(validate(batch(s,["s1","s2"]),s).assignments.length,2);
 assert.throws(()=>validate(batch(s,["s1","s3"]),s),/consecutivos/);
 const bad=batch(s,["s1"]);bad.assignments=[];
 assert.throws(()=>validate(bad,s),/exactamente una asignación/);
});
test("conserva texto y decisiones docentes tras completar la estructura",()=>{
 const c=fixture(),s=makeSource({course:c,documentId:"d"});
 const all=batch(s,["s1","s2","s3","s4"],{
  s1:item("s1","Capítulo 1", "contenido",["Capítulo 1"]),
  s2:item("s2","Capítulo 1", "contenido",["Capítulo 1"]),
  s3:item("s3","Referencias","referencias",["Referencias"]),
  s4:item("s4","Caso","contenido",["Caso"])
 });
 const checked=validate(all,s);
 const partial=merge(null,validate(batch(s,["s1","s2"]),s),s);
 const done=merge(partial,validate(batch(s,["s3","s4"],{
  s3:item("s3","Referencias","referencias",["Referencias"]),s4:item("s4","Caso","contenido",["Caso"])
 }),s),s);
 assert.equal(done.status,"complete");
 const next=apply(c,"d",s,checked);
 assert.deepEqual(next.corpus.map(x=>x.content),c.corpus.map(x=>x.content));
 assert.equal(next.corpus.find(x=>x.id==="s3").scope,"excluded");
 assert.equal(next.corpus.find(x=>x.id==="s4").priority,"context");
 assert.equal(next.knowledgeBase,null);
});
