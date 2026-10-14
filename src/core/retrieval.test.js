import test from "node:test";
import assert from "node:assert/strict";
import { retrieveFromCourse } from "./retrieval.js";
const reference={id:"synthetic-reference",title:"Referencias",chapter:"Referencias",sectionPath:["Referencias"],role:"referencias",roleSource:"rules",roleConfidence:0.98,scope:"excluded",scopeSource:"role-default",priority:"normal",prioritySource:"document",content:"Alvarez, R. (2021). Acústica narrativa sintética. DOI 10.1234/synthetic.reference"};
test("las referencias excluidas no contaminan la recuperación léxica",()=>{
 const results=retrieveFromCourse({concepts:[],corpus:[reference],knowledgeBase:null},"Alvarez acústica narrativa",{conceptLimit:0,corpusLimit:5,knowledgeLimit:0});
 assert.equal(results.some(item=>item.id===reference.id),false);
});
test("scope permite recuperar referencias si el docente las incluye",()=>{
 const results=retrieveFromCourse({concepts:[],corpus:[{...reference,scope:"included",scopeSource:"teacher"}],knowledgeBase:null},"Alvarez acústica narrativa",{conceptLimit:0,corpusLimit:5,knowledgeLimit:0});
 assert.equal(results.some(item=>item.id===reference.id),true);
});
