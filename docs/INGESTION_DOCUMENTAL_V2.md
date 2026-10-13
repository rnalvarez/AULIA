# Prueba de ingestión documental para AULIA

## Objetivo

Comparar de forma reproducible la extracción de texto de un PDF y el OCR de Tesseract.js y PaddleOCR.js en español antes de sustituir el motor de lectura utilizado por las cátedras. Esta herramienta no modifica todavía la ingestión ni la publicación de los asistentes.

## Uso

1. Abrir `ocr-benchmark.html` desde una compilación de AULIA.
2. Seleccionar el PDF a evaluar.
3. Elegir páginas que representen distintos casos (portada, texto corrido, páginas enfrentadas, índice, imágenes, baja calidad y páginas con poca tinta).
4. Para libros digitalizados como dobles páginas, activar la comparación por mitades. Para páginas individuales convencionales, desactivarla.
5. Comparar la extracción incrustada, Tesseract.js en español y PaddleOCR.js con PP-OCRv5 en español.
6. Cuando sea posible, introducir una transcripción corregida en el área de referencia. Para varias páginas, usar marcadores `=== N ===` con el número físico de página en cada línea.
7. Exportar el informe JSON. El archivo contiene transcripciones OCR; tratarlo como material bibliográfico potencialmente protegido.

## Privacidad y dependencias

El código lee y procesa el PDF en el navegador. No envía el PDF ni sus transcripciones a servicios de AULIA. En la primera ejecución, los motores pueden descargar código de ejecución, datos de idioma y modelos desde sus fuentes públicas. PaddleOCR.js utiliza ONNX Runtime Web y el modelo de reconocimiento configurado para español.

La página de diagnóstico debe mantenerse como entrada independiente. No debe cargarse en el chat estudiantil ni convertirse en requisito del flujo de ingestión de producción.

## Datos registrados

- nombre y tamaño del archivo, cantidad de páginas y páginas de prueba;
- motor, estrategia (página completa o mitades), duración y confianza declarada por el motor cuando existe;
- texto resultante y errores de ejecución;
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
