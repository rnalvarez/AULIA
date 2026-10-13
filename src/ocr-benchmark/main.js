import "./style.css";

const root = document.getElementById("root");
root.innerHTML = `
  <main class="shell">
    <header>
      <div class="eyebrow">AULIA · HERRAMIENTA DE DIAGNÓSTICO</div>
      <h1>Evaluación de lectura bibliográfica</h1>
      <p class="lede">Compará la capa de texto del PDF con dos lectores OCR en español, usando las mismas páginas y el mismo tratamiento de imagen. Esta herramienta es una prueba aislada: no cambia el proceso de ingestión de las cátedras.</p>
      <div class="warning"><strong>Privacidad:</strong> el PDF se procesa dentro de este navegador y no se envía a AULIA. La primera prueba puede descargar modelos de OCR desde sus proveedores. No publiques ni compartas el informe si contiene texto bibliográfico con derechos reservados.</div>
    </header>

    <section class="panel">
      <h2>1. Elegí el documento y las páginas</h2>
      <p class="subtle">Probá varias clases de página del mismo archivo. Para tu libro, empezá por 4,35: la página 4 tiene texto corrido en doble página y la 35 contiene un índice con puntos de guía y una mitad vacía.</p>
      <label for="pdfFile">PDF para probar</label>
      <input id="pdfFile" type="file" accept="application/pdf,.pdf" />
      <div class="grid">
        <div>
          <label for="pageNumbers">Páginas físicas a probar</label>
          <input id="pageNumbers" type="text" value="4,35" placeholder="Ej. 2,4,12,35" />
          <p class="subtle">Separá números con comas. No se procesará el libro completo salvo que enumeres todas sus páginas.</p>
        </div>
        <div>
          <label for="renderLimit">Resolución máxima de prueba</label>
          <select id="renderLimit">
            <option value="1800">Rápida · 1800 px</option>
            <option value="2400" selected>Equilibrada · 2400 px</option>
            <option value="3000">Alta · 3000 px</option>
          </select>
          <p class="subtle">Más píxeles no garantizan por sí solos mejor OCR y pueden consumir bastante memoria.</p>
        </div>
      </div>
      <label class="check"><input id="splitSpread" type="checkbox" checked /> <span>Comparar también las dos mitades por separado, leyendo primero la izquierda y después la derecha. Desmarcá esto para páginas individuales convencionales.</span></label>
      <div class="grid">
        <label class="check"><input id="useTesseract" type="checkbox" checked /> <span><strong>Tesseract.js · español</strong><br><span class="subtle">Motor utilizado actualmente por AULIA.</span></span></label>
        <label class="check"><input id="usePaddle" type="checkbox" checked /> <span><strong>PaddleOCR.js · PP-OCRv5 · español</strong><br><span class="subtle">Motor alternativo, ejecutado en el navegador. Requiere descargar sus modelos al iniciar.</span></span></label>
      </div>
      <label for="referenceText">Transcripción de referencia (opcional)</label>
      <textarea id="referenceText" placeholder="Pegá una transcripción corregida para calcular errores. Para varias páginas, separalas así:
=== 4 ===
Texto corregido de la página 4...
=== 35 ===
Texto corregido del índice..."></textarea>
      <p class="subtle">Si ingresás la transcripción corregida, el informe calcula tasa de error de palabras (WER) y caracteres (CER). Sin referencia, solo compara texto recuperado, confianza y tiempo; eso no constituye por sí solo una medición de exactitud.</p>
      <div class="actions">
        <button id="run" class="primary" disabled>Comparar motores</button>
        <button id="download" class="secondary" disabled>Exportar informe JSON</button>
        <button id="clear" class="secondary">Limpiar resultados</button>
      </div>
      <progress id="progress" class="progress" max="1" value="0" hidden></progress>
      <div id="status" role="status" aria-live="polite">Seleccioná un PDF para comenzar.</div>
    </section>

    <section class="panel">
      <div class="results-head">
        <h2>2. Resultados de la comparación</h2>
        <span id="summary" class="badge">Sin pruebas</span>
      </div>
      <p class="subtle">Cada resultado conserva el texto de salida y su procedencia. Revisá especialmente las tildes, palabras unidas o separadas, el orden de las columnas y los números de página en los índices.</p>
      <div id="results"><p class="subtle">Los resultados aparecerán aquí. No se considerará ganador a un motor hasta revisar el texto contra la página original.</p></div>
    </section>
    <footer>Herramienta experimental de AULIA. No modifica archivos, no publica materiales ni contacta servicios de modelos de lenguaje. Diseñado para evaluar ingestión de bibliografía en español.</footer>
  </main>
`;

const byId = (id) => document.getElementById(id);
const fileInput = byId("pdfFile");
const runButton = byId("run");
const downloadButton = byId("download");
const statusNode = byId("status");
const resultNode = byId("results");
const progressNode = byId("progress");
const summaryNode = byId("summary");

let selectedFile = null;
let loadedPdf = null;
let results = [];
let reportMetadata = {};
let activeRun = false;

function setStatus(message, kind = "") {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function normalizeForWords(value) {
  return String(value || "")
    .toLocaleLowerCase("es")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function normalizeForChars(value) {
  return String(value || "")
    .toLocaleLowerCase("es")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}

function editDistance(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let previous = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i += 1) previous[i] = i;
  for (let i = 1; i <= b.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= a.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[j - 1] === b[i - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[a.length];
}

function errorMetrics(reference, candidate) {
  const refWords = normalizeForWords(reference);
  const gotWords = normalizeForWords(candidate);
  const refChars = normalizeForChars(reference).replace(/\s+/gu, "");
  const gotChars = normalizeForChars(candidate).replace(/\s+/gu, "");
  return {
    wer: editDistance(refWords, gotWords) / Math.max(1, refWords.length),
    cer: editDistance(refChars, gotChars) / Math.max(1, refChars.length),
    referenceWords: refWords.length,
    recognizedWords: gotWords.length,
    referenceChars: refChars.length,
  };
}

function parseReferences(rawText, pageNumbers) {
  const raw = String(rawText || "").trim();
  if (!raw) return {};
  const markers = Array.from(raw.matchAll(/^===\s*(\d+)\s*===$/gm));
  if (!markers.length) return pageNumbers.length === 1 ? { [pageNumbers[0]]: raw } : {};
  const references = {};
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index + markers[i][0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index : raw.length;
    references[Number(markers[i][1])] = raw.slice(start, end).trim();
  }
  return references;
}

function textStats(value) {
  const text = String(value || "");
  return {
    characters: text.length,
    words: normalizeForWords(text).length,
    lines: text.split(/\r?\n/u).filter((line) => line.trim()).length,
  };
}

function addResult(record) {
  results.push(record);
  renderResults();
}

function showMetric(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(1) + "%";
}

function renderResults() {
  resultNode.replaceChildren();
  if (!results.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    p.textContent = "Los resultados aparecerán aquí.";
    resultNode.append(p);
    summaryNode.textContent = "Sin pruebas";
    downloadButton.disabled = true;
    return;
  }

  const finished = results.filter((item) => item.status === "ok").length;
  summaryNode.textContent = finished + " resultados · " + results.length + " intentos";
  downloadButton.disabled = false;
  for (const item of results) {
    const card = document.createElement("article");
    card.className = "result-card";
    const top = document.createElement("div");
    top.className = "result-title";
    const title = document.createElement("h3");
    title.textContent = item.pageNumber + " · " + item.method;
    const metrics = document.createElement("div");
    metrics.className = "metrics";
    const parts = [
      textStats(item.text).words + " palabras",
      Number(item.elapsedMs || 0).toFixed(0) + " ms",
    ];
    if (Number.isFinite(item.confidence)) parts.push("confianza del motor " + item.confidence.toFixed(1) + "%");
    if (item.errorRates) parts.push("WER " + showMetric(item.errorRates.wer) + " · CER " + showMetric(item.errorRates.cer));
    if (item.status !== "ok") parts.push("ERROR");
    metrics.textContent = parts.join(" · ");
    top.append(title, metrics);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.status === "ok" ? "Listo" : "Falló";
    card.append(top, badge);
    const pre = document.createElement("pre");
    pre.textContent = item.text || item.error || "(Sin texto)";
    card.append(pre);
    resultNode.append(card);
  }
}

function parsePageNumbers(raw, totalPages) {
  const parsed = Array.from(new Set(String(raw || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= totalPages)));
  return parsed.sort((a, b) => a - b);
}

async function loadPdf(file) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

async function renderPdfPage(pdf, pageNumber, maxSide) {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1, maxSide / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No se pudo preparar la imagen de la página " + pageNumber + ".");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const textContent = await page.getTextContent({ normalizeWhitespace: true });
  const embeddedText = textContent.items
    .map((item) => typeof item.str === "string" ? item.str : "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  page.cleanup?.();
  return { canvas, embeddedText, width: viewport.width, height: viewport.height, scale };
}

function cropCanvas(source, startRatio, endRatio) {
  const startX = Math.max(0, Math.floor(source.width * startRatio));
  const endX = Math.min(source.width, Math.ceil(source.width * endRatio));
  const target = document.createElement("canvas");
  target.width = Math.max(1, endX - startX);
  target.height = source.height;
  const context = target.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source, startX, 0, target.width, source.height, 0, 0, target.width, target.height);
  return target;
}

function foregroundRatio(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 1;
  const step = 12;
  const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let sampled = 0;
  let foreground = 0;
  for (let y = 10; y < canvas.height - 10; y += step) {
    for (let x = 10; x < canvas.width - 10; x += step) {
      const i = (y * canvas.width + x) * 4;
      const gray = 0.299 * image[i] + 0.587 * image[i + 1] + 0.114 * image[i + 2];
      sampled += 1;
      if (gray < 210) foreground += 1;
    }
  }
  return foreground / Math.max(1, sampled);
}

function centerOrderedPaddleText(items) {
  return (items || [])
    .map((item) => {
      const poly = item.poly || item.points || [];
      const xs = poly.map((point) => Number(point[0])).filter(Number.isFinite);
      const ys = poly.map((point) => Number(point[1])).filter(Number.isFinite);
      return {
        text: String(item.text || "").trim(),
        x: xs.length ? Math.min(...xs) : 0,
        y: ys.length ? Math.min(...ys) : 0,
        score: Number(item.score),
      };
    })
    .filter((item) => item.text)
    .sort((a, b) => Math.round(a.y / 8) - Math.round(b.y / 8) || a.x - b.x);
}

async function runTesseract(worker, canvas, pageNumber, method) {
  const started = performance.now();
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "3",
      preserve_interword_spaces: "1",
    });
    const result = await worker.recognize(canvas, {}, { blocks: true, tsv: true });
    return {
      pageNumber,
      method,
      status: "ok",
      text: String(result?.data?.text || "").trim(),
      confidence: Number(result?.data?.confidence ?? NaN),
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    return { pageNumber, method, status: "error", text: "", error: error?.message || String(error), elapsedMs: performance.now() - started };
  }
}

async function runPaddle(ocr, canvas, pageNumber, method) {
  const started = performance.now();
  try {
    const [result] = await ocr.predict(canvas);
    const lines = centerOrderedPaddleText(result?.items);
    const scored = lines.filter((item) => Number.isFinite(item.score));
    const confidence = scored.length
      ? 100 * scored.reduce((sum, item) => sum + item.score, 0) / scored.length
      : NaN;
    return {
      pageNumber,
      method,
      status: "ok",
      text: lines.map((item) => item.text).join("\n").trim(),
      confidence,
      elapsedMs: Number(result?.metrics?.totalMs) || performance.now() - started,
      engineMetrics: result?.metrics || null,
      runtime: result?.runtime || null,
    };
  } catch (error) {
    return { pageNumber, method, status: "error", text: "", error: error?.message || String(error), elapsedMs: performance.now() - started };
  }
}

async function ensureTesseract() {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("spa", 1, {
    logger: (message) => {
      if (message?.status === "recognizing text") {
        setStatus("Tesseract.js está reconociendo texto: " + Math.round((message.progress || 0) * 100) + "%.", "");
      } else if (message?.status === "loading language traineddata") {
        setStatus("Descargando/cargando el modelo de español de Tesseract.js.", "");
      }
    },
  });
  await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "3" });
  return worker;
}

async function ensurePaddle() {
  setStatus("Cargando PaddleOCR.js y el modelo de reconocimiento para español. En la primera ejecución puede tardar.", "");
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  const ocr = await PaddleOCR.create({
    lang: "es",
    ocrVersion: "PP-OCRv5",
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 1,
    ortOptions: {
      backend: "wasm",
      numThreads: 1,
      simd: true,
    },
  });
  return ocr;
}

function clearCanvas(canvas) {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function runComparison() {
  if (!selectedFile) return;
  if (activeRun) return;
  activeRun = true;
  runButton.disabled = true;
  fileInput.disabled = true;
  results = [];
  renderResults();

  let tesseract = null;
  let paddle = null;
  const referenceByPage = {};
  const started = new Date().toISOString();
  let currentPage = 0;
  const maxSide = Number(byId("renderLimit").value) || 2400;
  const splitSpread = byId("splitSpread").checked;
  const useTesseract = byId("useTesseract").checked;
  const usePaddle = byId("usePaddle").checked;

  try {
    loadedPdf = await loadPdf(selectedFile);
    const pageNumbers = parsePageNumbers(byId("pageNumbers").value, loadedPdf.numPages);
    if (!pageNumbers.length) throw new Error("Ingresá al menos un número de página válido entre 1 y " + loadedPdf.numPages + ".");
    if (!useTesseract && !usePaddle) throw new Error("Elegí al menos un motor OCR para comparar.");

    Object.assign(referenceByPage, parseReferences(byId("referenceText").value, pageNumbers));
    reportMetadata = {
      schema: "aulia-ocr-benchmark",
      schemaVersion: 1,
      fileName: selectedFile.name,
      fileSizeBytes: selectedFile.size,
      pageCount: loadedPdf.numPages,
      selectedPages: pageNumbers,
      renderedMaxSide: maxSide,
      splitSpread,
      engines: {
        embeddedText: true,
        tesseractJs: useTesseract,
        paddleOcrJs: usePaddle,
      },
      startedAt: started,
      localOnly: true,
      referencesProvidedForPages: Object.keys(referenceByPage).map(Number),
    };

    progressNode.hidden = false;
    progressNode.max = pageNumbers.length;
    progressNode.value = 0;
    setStatus("Documento abierto. Se probarán " + pageNumbers.length + " página(s); la capa de texto del PDF se analizará como referencia.", "");

    if (useTesseract) {
      setStatus("Inicializando Tesseract.js en español…", "");
      tesseract = await ensureTesseract();
    }
    if (usePaddle) {
      try {
        paddle = await ensurePaddle();
      } catch (error) {
        addResult({
          pageNumber: "—",
          method: "Inicialización PaddleOCR.js (español)",
          status: "error",
          text: "",
          error: error?.message || String(error),
          elapsedMs: 0,
        });
      }
    }

    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      currentPage = pageNumber;
      setStatus("Procesando página física " + pageNumber + " (" + (index + 1) + " de " + pageNumbers.length + ").", "");
      const pageResult = await renderPdfPage(loadedPdf, pageNumber, maxSide);
      const reference = referenceByPage[pageNumber] || "";
      const embedStats = textStats(pageResult.embeddedText);
      addResult({
        pageNumber,
        method: "Capa de texto incrustada (PDF.js)",
        status: pageResult.embeddedText ? "ok" : "error",
        text: pageResult.embeddedText,
        error: pageResult.embeddedText ? "" : "La página no contiene texto extraíble.",
        elapsedMs: 0,
        sourceMetrics: { ...embedStats, imageWidth: pageResult.width, imageHeight: pageResult.height },
        ...(reference ? { errorRates: errorMetrics(reference, pageResult.embeddedText) } : {}),
      });

      if (useTesseract && tesseract) {
        const full = await runTesseract(tesseract, pageResult.canvas, pageNumber, "Tesseract.js · página completa");
        if (reference && full.status === "ok") full.errorRates = errorMetrics(reference, full.text);
        addResult(full);
        if (splitSpread) {
          const splitTexts = [];
          let splitElapsedMs = 0;
          for (const [side, startRatio, endRatio] of [["mitad izquierda", 0.015, 0.49], ["mitad derecha", 0.51, 0.985]]) {
            const crop = cropCanvas(pageResult.canvas, startRatio, endRatio);
            const ink = foregroundRatio(crop);
            if (ink < 0.0007) {
              addResult({
                pageNumber, method: "Tesseract.js · " + side, status: "ok", text: "",
                elapsedMs: 0, skippedBlankCrop: true, inkRatio: ink,
              });
              splitTexts.push("");
            } else {
              const part = await runTesseract(tesseract, crop, pageNumber, "Tesseract.js · " + side);
              part.inkRatio = ink;
              splitElapsedMs += Number(part.elapsedMs || 0);
              splitTexts.push(part.text || "");
              addResult(part);
            }
            clearCanvas(crop);
          }
          const combined = {
            pageNumber,
            method: "Tesseract.js · mitades reunidas (orden izquierda → derecha)",
            status: splitTexts.some(Boolean) ? "ok" : "error",
            text: splitTexts.filter(Boolean).join(String.fromCharCode(10)),
            elapsedMs: splitElapsedMs,
          };
          if (reference && combined.status === "ok") combined.errorRates = errorMetrics(reference, combined.text);
          addResult(combined);
        }
      }

      if (paddle) {
        const full = await runPaddle(paddle, pageResult.canvas, pageNumber, "PaddleOCR.js · página completa");
        if (reference && full.status === "ok") full.errorRates = errorMetrics(reference, full.text);
        addResult(full);
        if (splitSpread) {
          const splitTexts = [];
          let splitElapsedMs = 0;
          for (const [side, startRatio, endRatio] of [["mitad izquierda", 0.015, 0.49], ["mitad derecha", 0.51, 0.985]]) {
            const crop = cropCanvas(pageResult.canvas, startRatio, endRatio);
            const ink = foregroundRatio(crop);
            if (ink < 0.0007) {
              addResult({
                pageNumber, method: "PaddleOCR.js · " + side, status: "ok", text: "",
                elapsedMs: 0, skippedBlankCrop: true, inkRatio: ink,
              });
              splitTexts.push("");
            } else {
              const part = await runPaddle(paddle, crop, pageNumber, "PaddleOCR.js · " + side);
              part.inkRatio = ink;
              splitElapsedMs += Number(part.elapsedMs || 0);
              splitTexts.push(part.text || "");
              addResult(part);
            }
            clearCanvas(crop);
          }
          const combined = {
            pageNumber,
            method: "PaddleOCR.js · mitades reunidas (orden izquierda → derecha)",
            status: splitTexts.some(Boolean) ? "ok" : "error",
            text: splitTexts.filter(Boolean).join(String.fromCharCode(10)),
            elapsedMs: splitElapsedMs,
          };
          if (reference && combined.status === "ok") combined.errorRates = errorMetrics(reference, combined.text);
          addResult(combined);
        }
      }

      clearCanvas(pageResult.canvas);
      progressNode.value = index + 1;
    }

    reportMetadata.completedAt = new Date().toISOString();
    reportMetadata.durationMs = new Date(reportMetadata.completedAt).getTime() - new Date(started).getTime();
    reportMetadata.results = results.map((item) => ({ ...item }));
    reportMetadata.note = "Resultados experimentales. Las métricas de error solo aparecen si se entregó una transcripción de referencia por página.";
    setStatus(
      "Comparación terminada. " + results.filter((item) => item.status === "ok").length + " resultados listos; " +
      results.filter((item) => item.status !== "ok").length + " errores o fallos de inicialización. Revisá visualmente cada transcripción antes de elegir un motor.",
      "ok"
    );
  } catch (error) {
    setStatus("La prueba se interrumpió" + (currentPage ? " en la página " + currentPage : "") + ": " + (error?.message || String(error)), "error");
  } finally {
    if (loadedPdf) {
      try { await loadedPdf.destroy?.(); } catch {}
      loadedPdf = null;
    }
    if (tesseract) {
      try { await tesseract.terminate(); } catch {}
    }
    if (paddle) {
      try { await paddle.dispose(); } catch {}
    }
    activeRun = false;
    runButton.disabled = !selectedFile;
    fileInput.disabled = false;
    progressNode.hidden = true;
    renderResults();
    if (reportMetadata.results) reportMetadata.results = results.map((item) => ({ ...item }));
  }
}

fileInput.addEventListener("change", async () => {
  selectedFile = fileInput.files?.[0] || null;
  loadedPdf = null;
  results = [];
  renderResults();
  if (!selectedFile) {
    runButton.disabled = true;
    setStatus("Seleccioná un PDF para comenzar.");
    return;
  }
  setStatus("Archivo seleccionado. Comprobando número de páginas…");
  try {
    const pdf = await loadPdf(selectedFile);
    loadedPdf = pdf;
    runButton.disabled = false;
    setStatus("Archivo listo: " + selectedFile.name + " · " + pdf.numPages + " páginas. La lectura del contenido aún no comenzó.", "ok");
    await pdf.destroy?.();
    loadedPdf = null;
  } catch (error) {
    runButton.disabled = true;
    setStatus("No se pudo abrir el PDF: " + (error?.message || String(error)), "error");
  }
});

runButton.addEventListener("click", runComparison);
byId("clear").addEventListener("click", () => {
  if (activeRun) return;
  results = [];
  reportMetadata = {};
  renderResults();
  setStatus(selectedFile ? "Resultados borrados; el archivo sigue seleccionado." : "Seleccioná un PDF para comenzar.");
});

downloadButton.addEventListener("click", () => {
  const report = {
    ...reportMetadata,
    results: results.map((item) => ({ ...item })),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = (selectedFile?.name || "aulia-documento").replace(/\.pdf$/i, "") + "-ocr-comparison.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});
