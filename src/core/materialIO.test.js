import test from "node:test";
import assert from "node:assert/strict";
import { preserveTeacherMaterialDecisions } from "./materialIO.js";
test("el reprocesamiento conserva elecciones explícitas de alcance y prioridad",()=>{
 const oldDocument={id:"doc-synthetic",title:"Libro sintético",sourceName:"libro-sintetico.pdf",priority:"central",sections:[{id:"references-section",title:"Referencias",path:["Referencias"],role:"referencias",roleSource:"rules",roleConfidence:0.98,scope:"included",scopeSource:"teacher",priority:"context",prioritySource:"teacher",sourcePageStart:8,sourcePageEnd:9}]};
 const oldCorpus=[{id:"old-reference",sectionId:"references-section",documentId:"doc-synthetic",title:"Referencias",sectionPath:["Referencias"],role:"referencias",roleSource:"rules",roleConfidence:0.98,scope:"included",scopeSource:"teacher",priority:"context",prioritySource:"teacher",sourcePageStart:8,sourcePageEnd:9,content:"Cita sintética inventada."}];
 const incoming={sourceName:"libro-sintetico.pdf",document:{id:"doc-synthetic",title:"Libro sintético",sourceName:"libro-sintetico.pdf",priority:"normal",sections:[{id:"references-section",title:"Referencias",path:["Referencias"],sourcePageStart:8,sourcePageEnd:9}]},corpus:[{id:"new-reference",sectionId:"references-section",documentId:"doc-synthetic",title:"Referencias",sectionPath:["Referencias"],sourcePageStart:8,sourcePageEnd:9,content:"Cita sintética inventada."}]};
 const result=preserveTeacherMaterialDecisions(incoming,[oldDocument],oldCorpus,[]);
 assert.equal(result.document.priority,"central");
 assert.equal(result.document.sections[0].scope,"included");
 assert.equal(result.document.sections[0].scopeSource,"teacher");
 assert.equal(result.document.sections[0].priority,"context");
 assert.equal(result.document.sections[0].prioritySource,"teacher");
 assert.equal(result.corpus[0].scopeSource,"teacher");
 assert.equal(result.corpus[0].prioritySource,"teacher");
});
