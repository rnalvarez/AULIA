import test from "node:test";
import assert from "node:assert/strict";
import { preserveTeacherMaterialDecisions, measureLocalTextQuality, shouldRunLocalPdfOcr } from "./materialIO.js";
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


test("detecta palabras fragmentadas en la capa de texto y propone OCR, sin corregirlas a ciegas", () => {
 const broken = [
  "En el an áli sis de la ima gen so no ra, el mon ta je ar ti cu la la per cep ción del es pa cio y el tiem po.",
  "La con ti nui dad na rra ti va de pen de de de ci sio nes téc ni cas para cons truir el sen ti do de la es ce na.",
  "El pro ce sa mien to de la voz y la mú si ca de ben con si de rar la re la ción en tre la ima gen y el so ni do."
 ].join("\n");
 const quality = measureLocalTextQuality(broken, 65);
 assert.equal(quality.brokenSpacing, true);
 assert.ok(quality.fragmentRuns >= 4);
});

test("no confunde prosa académica normal con palabras fragmentadas", () => {
 const clean = [
  "En el análisis de la imagen sonora, el montaje articula la percepción del espacio y el tiempo.",
  "La continuidad narrativa depende de decisiones técnicas para construir el sentido de cada escena.",
  "El procesamiento de la voz y la música debe considerar la relación entre la imagen y el sonido."
 ].join("\n");
 const quality = measureLocalTextQuality(clean, 65);
 assert.equal(quality.brokenSpacing, false);
});


test("el OCR local se ejecuta aunque se pidan páginas de texto para análisis semántico",()=>{
 assert.equal(shouldRunLocalPdfOcr({includeAIPageText:true}),true);
 assert.equal(shouldRunLocalPdfOcr({includeAIPageText:true,includePageImagesForLowText:false}),true);
 assert.equal(shouldRunLocalPdfOcr({includePageImages:true,includeAIPageText:true}),false);
 assert.equal(shouldRunLocalPdfOcr({includePageImagesForLowText:true,includeAIPageText:true}),false);
});
