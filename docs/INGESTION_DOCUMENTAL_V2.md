# Prueba de ingestión documental para AULIA

## Objetivo

Comparar de forma reproducible la extracción de texto de un PDF y el OCR de Tesseract.js y PaddleOCR.js en español antes de sustituir el motor de lectura utilizado por las cátedras. Esta herramienta no modifica todavía la ingestión ni la publicación de los asistentes.

## Uso

1. Abrir `ocr-benchmark.html` desde una compilación de AULIA.
2. Seleccionar el PDF a evaluar.
3. Elegir páginas que representen distintos casos (portada, texto corrido, páginas enfrentadas, índice, imágenes, baja calidad y páginas con poca tinta).
4. Para libros digitalizados como dobles páginas, activar la comparación por mitades. Para páginas individuales convencionales, desactivarla.
5. Comparar la extracción incrustada, Tesseract.js en español y PaddleOCR.js con PP-OCRv6 y el modelo multilingüe para español.
6. Cuando sea posible, introducir una transcripción corregida en el área de referencia. Para varias páginas, usar marcadores `=== N ===` con el número físico de página en cada línea.
7. Exportar el informe JSON. El archivo contiene transcripciones OCR; tratarlo como material bibliográfico potencialmente protegido.

## Privacidad y dependencias

El código lee y procesa el PDF en el navegador. No envía el PDF ni sus transcripciones a servicios de AULIA. Para renderizar las páginas, el diagnóstico usa PDF.js con `ImageDecoder` y `OffscreenCanvas` desactivados, e indica explícitamente `canvas: null` con `canvasContext`. Si el lienzo sigue vacío pese a que PDF.js detecta la imagen, intenta renderizar esa página con PDFium WebAssembly, una segunda implementación del motor PDF que también se ejecuta en el navegador. El informe registra qué motor produjo la imagen, su proporción de píxeles oscuros y los errores del fallback. El archivo y sus páginas se procesan localmente; el WASM se sirve desde los recursos estáticos de AULIA. En la primera ejecución, los motores pueden descargar código de ejecución, datos de idioma y modelos desde sus fuentes públicas. PaddleOCR.js utiliza ONNX Runtime Web. Para español se configura PP-OCRv6, cuyo selector de idioma admite `es`; PP-OCRv5 no admite esa combinación en la versión del SDK probada.

La página de diagnóstico debe mantenerse como entrada independiente. No debe cargarse en el chat estudiantil ni convertirse en requisito del flujo de ingestión de producción.

## Datos registrados

- nombre y tamaño del archivo, cantidad de páginas y páginas de prueba;
- motor, estrategia (página completa o mitades), duración y confianza declarada por el motor cuando existe;
- texto resultante y errores de ejecución;
- porcentaje de píxeles oscuros detectado antes del OCR, motor de renderizado usado (PDF.js o fallback PDFium) y errores de renderizado;
- vista previa de la imagen que reciben los motores (solo en pantalla; no se incluye en el informe exportado);
- WER y CER cuando hay una transcripción de referencia;
- metadatos de tiempo de la comparación.

La confianza informada por el motor no equivale a la tasa de acierto. La evaluación debe mirar el texto y, para comparar objetivamente los motores, usar referencias transcritas manualmente.

## Primer conjunto de pruebas

Para `EL DISEÑO DE LA BANDA SONORA v2.pdf`:

- Página física 4: página apaisada que contiene dos páginas impresas enfrentadas y texto corrido.
- Página física 35: índice con puntos de guía, numeración y una mitad prácticamente vacía.
- Páginas 1 y 2: portadas con tipografía y composición distintas.
- Después: páginas elegidas para representar fórmulas, gráficos, tablas, fotos inclinadas o escaneos de una sola página.

No se debe subir ese libro al repositorio ni incluir páginas del mismo como fixtures de un test automatizado.

## Puerta de aceptación para integrar un motor

La integración en producción queda pendiente hasta que:

1. los motores se hayan ejecutado con este documento real en un navegador compatible;
2. se disponga de una transcripción de referencia para al menos un fragmento de texto corrido y una sección del índice;
3. se compare el WER/CER, la integridad de líneas, el orden de lectura y el coste de memoria/tiempo;
4. se compruebe al menos un PDF digital, un escaneo de página única y un PDF mixto;
5. el resultado no sea considerado correcto solamente porque el proceso termine sin errores.

## Arquitectura objetivo de ingestión

Cada formato debe tener un adaptador propio que produzca un modelo documental común. Cada página conserva, como mínimo:

- identidad de archivo y página física;
- dimensiones, rotación y geometría;
- texto original extraído y texto OCR alternativo cuando sea necesario;
- origen del texto (`native`, `tesseract`, `paddle` u otro adaptador);
- señales de calidad y causas de revisión;
- bloques en orden de lectura y referencias de página.

El motor debe clasificar y tratar cada página individualmente; una sola estrategia no puede imponerse a todo el archivo. El índice temático generado por IA, el corpus recuperable y la publicación del asistente son etapas distintas. Si la interpretación temática se interrumpe por cuota, el corpus recuperado debe seguir disponible y el análisis tiene que poder reanudarse sin descartar el trabajo terminado.

## Geometría y detección de índice

La geometría del texto se normaliza según la rotación que el PDF declara y se expresa en las mismas coordenadas visibles que utiliza el renderizado. Así, los documentos con páginas físicas apaisadas almacenadas con rotación de 90° o 270° no se agrupan como si sus renglones fueran verticales. La detección del índice requiere una línea que actúe como título independiente (por ejemplo, «ÍNDICE»), no una mención de la palabra en el cuerpo del texto. El índice puede aparecer tanto al principio como al final del libro; si está al final, sus entradas se contrastan con encabezados reales anteriores y no se permite que el propio índice se convierta en una sección del cuerpo.

## Renderizado de páginas PDF en producción

La extracción primaria continúa en PDF.js. Cuando una página necesita OCR local o una imagen para visión, AULIA comprueba si el lienzo realmente contiene tinta visible. Si PDF.js falla o devuelve un lienzo vacío, se carga de forma diferida PDFium WebAssembly y se intenta recuperar solo esa página. El PDF se procesa dentro del navegador y el renderizador alternativo se cierra al terminar el documento. Las páginas recuperadas se registran en el análisis para que el docente sepa qué contenido necesitó una ruta alternativa.

El fallback de renderizado no garantiza que el OCR sea correcto. La aceptación depende también de la calidad del texto recuperado, del orden de lectura, de la separación de páginas enfrentadas y de la conservación de las referencias a páginas. El motor OCR alternativo del benchmark no debe activarse en producción por defecto: en la primera prueba, PaddleOCR.js fue sustancialmente más lento que Tesseract.js en este entorno.

