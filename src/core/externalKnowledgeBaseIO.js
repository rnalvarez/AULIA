import { KNOWLEDGE_BASE_VERSION, knowledgeCorpusSignature } from "./knowledgeBase.js";

export const EXTERNAL_KNOWLEDGE_INPUT_FORMAT = "aulia-external-knowledge-source";
export const EXTERNAL_KNOWLEDGE_OUTPUT_FORMAT = "aulia-external-knowledge-index";

export function createExternalKnowledgePrompt({ courseTitle = "", sourceSignature, totalPassages }) {
  return [
    "Actuá como documentalista académico y analista conceptual. Tu tarea es construir una base de conocimiento fiel a la bibliografía adjunta para un chatbot universitario.",
    "",
    "ARCHIVO DE ENTRADA",
    "Adjunto un JSON de AULIA con formato \"" + EXTERNAL_KNOWLEDGE_INPUT_FORMAT + "\". Usá únicamente los textos de su arreglo \"passages\". Analizá TODOS los pasajes del archivo, incluso los que traigan scope \"excluded\": el docente decidirá después cuáles podrán utilizarse en el chatbot. No agregues conocimiento externo ni atribuyas al autor afirmaciones que no estén respaldadas por el material.",
    "",
    "CÁTEDRA: " + (courseTitle || "No especificada"),
    "FIRMA DE LA BIBLIOGRAFÍA (copiar exactamente): " + sourceSignature,
    "TOTAL DE PASAJES QUE DEBEN CUBRIRSE: " + totalPassages,
    "",
    "CÓMO TRABAJAR",
    "1. Leé los pasajes en el orden del archivo y procesalos en tandas consecutivas de hasta 20 pasajes por respuesta para evitar que la salida quede truncada.",
    "2. En cada respuesta analizá una tanda completa y devolvé un solo objeto JSON válido, sin comentarios ni bloques Markdown. Si tu herramienta permite crear archivos, entregá ese objeto como archivo .json descargable.",
    "3. Si te digo CONTINUAR, analizá los siguientes pasajes todavía no cubiertos. No repitas ni saltees pasajes. Conservá la firma y el total indicados arriba. Cada archivo de salida debe contener solamente los IDs revisados en esa respuesta.",
    "4. En processedPassageIds incluí exactamente los IDs de todos los pasajes que revisaste en esta tanda, incluso los que no contengan conceptos relevantes. No incluyas IDs que no hayas leído por completo.",
    "5. Identificá conceptos técnicos, términos definidos o explicados, categorías, distinciones, principios, métodos, argumentos, fenómenos, relaciones entre ideas y ejemplos relevantes. Conservá matices y sentidos diferentes del mismo término; incluí aliases/sinónimos cuando realmente correspondan. Evitá entradas triviales o duplicadas.",
    "6. Cada entrada debe estar respaldada por al menos una referencia a un pasaje de la tanda. excerpt debe ser una cita literal y breve copiada del texto de ese pasaje, preferentemente de 30 a 140 caracteres. passageId debe coincidir exactamente con un ID del archivo. No inventes citas ni referencias.",
    "7. Para conceptos implícitos, describí la inferencia con cautela. Si un pasaje no aporta ningún concepto identificable, igual incluilo en processedPassageIds; no inventes una entrada para ese pasaje.",
    "8. Al terminar una tanda, verificá que JSON sea válido, que cada evidencia use IDs de esa tanda y que no haya ningún pasaje revisado que falte en processedPassageIds.",
    "",
    "FORMATO DE SALIDA OBLIGATORIO",
    "JSON con esta estructura exacta:",
    JSON.stringify({
      format: EXTERNAL_KNOWLEDGE_OUTPUT_FORMAT,
      version: KNOWLEDGE_BASE_VERSION,
      sourceSignature: sourceSignature,
      totalPassages: totalPassages,
      processedPassageIds: ["ID exacto de cada pasaje revisado en ESTA respuesta"],
      entries: [{
        term: "Nombre del concepto",
        aliases: ["Sinónimo o variante terminológica"],
        category: "Tipo de concepto",
        definition: "Definición fiel a la bibliografía; cadena vacía si no hay una definición explícita",
        explanation: "Explicación contextual que preserve los matices del autor",
        distinctions: ["Diferencia relevante respecto de otro concepto"],
        relatedTerms: ["Otro término relacionado"],
        examples: ["Ejemplo presente en el texto"],
        evidence: [{ passageId: "ID exacto del pasaje", excerpt: "Cita literal breve tomada de ese pasaje" }]
      }]
    }, null, 2),
    "",
    "No incluyas texto antes o después del JSON. Empezá por la primera tanda de pasajes del archivo."
  ].join("\n");
}

export function createExternalKnowledgePackage({ course, passages = [] }) {
  const safePassages = Array.isArray(passages) ? passages : [];
  const sourceSignature = knowledgeCorpusSignature(course?.corpus || []);
  return {
    format: EXTERNAL_KNOWLEDGE_INPUT_FORMAT,
    version: KNOWLEDGE_BASE_VERSION,
    createdAt: new Date().toISOString(),
    course: {
      title: String(course?.title || ""),
      description: String(course?.description || ""),
      language: String(course?.language || "es"),
    },
    sourceSignature,
    totalPassages: safePassages.length,
    recommendedPassagesPerResponse: 20,
    instructions: "Este paquete contiene todos los pasajes de la bibliografía cargada para construir una propuesta inicial de conocimiento. No filtres los pasajes por scope: el docente definirá Incluido, Referencial o Excluir después del análisis. Subí este archivo a un servicio de IA y pegá las instrucciones de AULIA que te proporciona Studio. Trabajá en tandas consecutivas; cada respuesta debe ser un JSON independiente. Importá luego todos los archivos de salida en Studio.",
    passages: safePassages.map(passage => ({
      passageId: passage.passageId,
      sourceId: passage.sourceId,
      sourceName: passage.sourceName,
      title: passage.title,
      sectionPath: passage.sectionPath,
      pageStart: passage.pageStart,
      pageEnd: passage.pageEnd,
      printedPageStart: passage.printedPageStart,
      printedPageEnd: passage.printedPageEnd,
      scope: passage.scope,
      priority: passage.priority,
      text: passage.text,
    })),
  };
}

export function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(text, filename, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(text || "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
