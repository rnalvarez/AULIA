/**
 * Browser-local PDFium rendering fallback for PDFs whose scanned raster is not
 * painted by PDF.js. The WASM engine is loaded only if a page needs recovery.
 */
export function canvasInkRatio(source) {
  if (!source?.width || !source?.height) return 0;
  const sampleScale = Math.min(1, 600 / Math.max(source.width, source.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.ceil(source.width * sampleScale));
  sample.height = Math.max(1, Math.ceil(source.height * sampleScale));
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;

  context.fillStyle = "#fff";
  context.fillRect(0, 0, sample.width, sample.height);
  context.drawImage(source, 0, 0, sample.width, sample.height);

  let pixels;
  try {
    pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  } catch {
    sample.width = 0;
    sample.height = 0;
    return 0;
  }

  let sampled = 0;
  let foreground = 0;
  for (let y = 2; y < sample.height - 2; y += 2) {
    for (let x = 2; x < sample.width - 2; x += 2) {
      const i = (y * sample.width + x) * 4;
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sampled += 1;
      if (gray < 210) foreground += 1;
    }
  }

  sample.width = 0;
  sample.height = 0;
  return foreground / Math.max(1, sampled);
}

export function hasMeaningfulInk(canvas, threshold = 0.0007) {
  return canvasInkRatio(canvas) >= threshold;
}

export async function createPdfiumRenderer(file) {
  const [pdfiumModule, wasmModule] = await Promise.all([
    import("@hyzyla/pdfium"),
    import("@hyzyla/pdfium/pdfium.wasm?url"),
  ]);
  const wasmUrl = new URL(wasmModule.default, document.baseURI).href;
  const library = await pdfiumModule.PDFiumLibrary.init({ wasmUrl });
  let documentHandle = null;

  try {
    documentHandle = await library.loadDocument(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    try { library.destroy(); } catch {}
    throw error;
  }

  let disposed = false;
  return {
    async renderPage(pageNumber, { scale = 1, width = 0, height = 0, rotation = 0 } = {}) {
      if (disposed || !documentHandle) throw new Error("El renderizador PDFium ya fue cerrado.");
      const page = documentHandle.getPage(Number(pageNumber) - 1);
      let rawCanvas = null;
      try {
        const rendered = await page.render({ scale, colorSpace: "RGBA", render: "bitmap" });
        rawCanvas = document.createElement("canvas");
        rawCanvas.width = rendered.width;
        rawCanvas.height = rendered.height;
        const rawContext = rawCanvas.getContext("2d", { alpha: false });
        if (!rawContext) throw new Error("PDFium no pudo crear el contexto de imagen.");
        const imageData = rawContext.createImageData(rendered.width, rendered.height);
        imageData.data.set(rendered.data);
        rawContext.putImageData(imageData, 0, 0);

        const targetWidth = Math.max(1, Math.floor(width || rendered.width));
        const targetHeight = Math.max(1, Math.floor(height || rendered.height));
        const rawLandscape = rawCanvas.width > rawCanvas.height;
        const targetLandscape = targetWidth > targetHeight;
        const needsQuarterTurn = Number(rotation) % 180 !== 0 && rawLandscape !== targetLandscape;
        let canvas = rawCanvas;
        if (needsQuarterTurn) {
          canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("No se pudo preparar la imagen rotada de PDFium.");
          if (Number(rotation) === 270) {
            context.translate(0, targetHeight);
            context.rotate(-Math.PI / 2);
          } else {
            context.translate(targetWidth, 0);
            context.rotate(Math.PI / 2);
          }
          context.drawImage(rawCanvas, 0, 0, targetHeight, targetWidth);
          rawCanvas.width = 0;
          rawCanvas.height = 0;
          rawCanvas = null;
        } else if (rawCanvas.width !== targetWidth || rawCanvas.height !== targetHeight) {
          canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("No se pudo ajustar el tamaño de la imagen de PDFium.");
          context.drawImage(rawCanvas, 0, 0, targetWidth, targetHeight);
          rawCanvas.width = 0;
          rawCanvas.height = 0;
          rawCanvas = null;
        }

        // Transfer canvas ownership to the caller; the temporary-bitmap
        // cleanup in finally must not clear the returned image.
        if (canvas === rawCanvas) rawCanvas = null;
        return {
          canvas,
          diagnostics: {
            renderer: "PDFium WebAssembly",
            width: rendered.width,
            height: rendered.height,
            rotation: Number(rotation) || 0,
            rotationApplied: needsQuarterTurn ? Number(rotation) : 0,
          },
        };
      } finally {
        if (rawCanvas) {
          rawCanvas.width = 0;
          rawCanvas.height = 0;
        }
        page.close();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { documentHandle?.destroy(); } catch {}
      documentHandle = null;
      try { library.destroy(); } catch {}
    },
  };
}
