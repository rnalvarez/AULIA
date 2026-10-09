export const EXTERNAL_DOCUMENT_ANALYSIS_FORMAT = "aulia-multimodal-document-analysis";
export const EXTERNAL_DOCUMENT_ANALYSIS_VERSION = 1;

export function createExternalDocumentAnalysisPrompt() {
  const example = {
    format: EXTERNAL_DOCUMENT_ANALYSIS_FORMAT,
    version: EXTERNAL_DOCUMENT_ANALYSIS_VERSION,
    sourceName: "NOMBRE-EXACTO-DEL-PDF.pdf",
    totalPages: 120,
    processedPageNumbers: [1, 2],
    pages: [{
      pageNumber: 1,
      originalText: "Transcripción fiel del texto legible de esta página, conservando títulos, párrafos, listas y fórmulas.",
      sectionTitle: "Nombre de la sección o capítulo",
      sectionPath: ["Parte", "Capítulo", "Sección"],
      transcription: "",
      visualElements: [{
        kind: "table",
        title: "Título breve de la tabla",
        description: "Qué presenta y cómo interpretar sus datos, sin agregar información externa.",
        tableMarkdown: "| Variable | Valor |\\n|---|---|\\n| A | 12 |",
        transcribedText: "Unidades o etiquetas visibles que no estén en la tabla."
      }],
      confidence: 0.9,
      needsReview: false,
      reviewNotes: ""
    }]
  };

  return [
    "INSTRUCCIONES PARA ANALIZAR UNA BIBLIOGRAFÍA PARA AULIA",
    "",
    "Adjunté el PDF original a este chat. Actuá como especialista en lectura documental académica, OCR, análisis semántico y comprensión visual. Leé las páginas visualmente; no dependas solo de la extracción automática de texto.",
    "",
    "OBJETIVO",
    "Preparar un JSON que permita a AULIA incorporar el material de forma fiel y consultable. Interpretá el texto, proponé una jerarquía semántica coherente entre capítulos y secciones, y recuperá información relevante de tablas, gráficos, diagramas, fórmulas, mapas e imágenes anotadas.",
    "",
    "REGLAS DE FIDELIDAD",
    "1. Incluí el texto legible completo de cada página en originalText, conservando encabezados, párrafos, listas, notas, fórmulas, unidades y referencias. No hagas un resumen en lugar de la transcripción.",
    "2. Usá transcription solo cuando necesites proponer una corrección/OCR alternativo al texto que ya figura en originalText. Si no hay corrección necesaria, usá una cadena vacía.",
    "3. No inventes texto, valores, títulos, citas, fuentes ni relaciones. Para gráficos, describí variables/ejes/leyendas/tendencias y registrá cifras solo si son legibles. Para tablas, mantené encabezados, columnas, filas, unidades y valores en tableMarkdown.",
    "4. Asigná sectionTitle y sectionPath según la jerarquía real del documento. No conviertas mecánicamente cada página en una unidad temática nueva; las páginas sucesivas de un mismo capítulo deben compartir la misma ruta cuando corresponda.",
    "5. Cada página debe conservar su número de página del PDF, comenzando en 1. No confundas páginas impresas del libro con el número de página del PDF.",
    "6. Si el documento contiene muchas páginas, trabajá en tandas consecutivas (por ejemplo, páginas 1–10, luego 11–20). En cada tanda devolvé un JSON independiente con solo las páginas efectivamente analizadas, sus números exactos en processedPageNumbers y el mismo sourceName y totalPages. Cuando el usuario te diga CONTINUAR, procesá las páginas siguientes sin repetir ni saltear páginas.",
    "7. No marques una página como procesada si no pudiste leerla. En ese caso incluí una entrada con needsReview=true, confidence baja y una nota que explique la limitación.",
    "8. No añadas conocimiento externo. El contenido debe salir del PDF adjunto.",
    "",
    "FORMATO DE RESPUESTA",
    "Devolvé únicamente un objeto JSON válido, sin Markdown ni comentarios fuera del JSON. No cambies nombres de campos ni agregues texto antes o después. processedPageNumbers debe coincidir exactamente con pageNumber de cada elemento de pages. sourceName debe ser siempre el nombre exacto del archivo PDF adjunto y totalPages, el total real del PDF.",
    JSON.stringify(example, null, 2),
    "",
    "Si procesás una tanda parcial, guardá esa respuesta en un archivo .json independiente. AULIA permitirá importar varias tandas de este mismo documento y las reunirá antes de incorporarlo al corpus. No elimines del JSON el formato, la versión, sourceName, totalPages ni processedPageNumbers."
  ].join("\n");
}
