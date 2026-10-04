# AULIA Studio

AULIA Studio es la superficie de autoría de la plataforma. Está separada del acceso del estudiante y trabaja sobre el mismo formato de **course pack** que consume el CORE.

## Flujo de autoría

La interfaz está organizada alrededor de la tarea docente, no del esquema interno de datos:

```text
CÁTEDRA
  ↓
MATERIAL
  ↓
PROPUESTA PEDAGÓGICA
  ↓
INTERACCIÓN
  ↓
COMISIONES
  ↓
REVISIÓN / EXPORTACIÓN
```

La idea central es que el docente **carga material primero**. AULIA propone una estructura pedagógica y el docente la revisa, edita o elimina antes de usarla.

## Acceso

En GitHub Pages se sirve como:

`/AULIA/studio.html`

También acepta `?course=chion` o `?course=montaje`.

## Qué hace Studio v0.3

- Define identidad de cátedra y la identidad visible del asistente.
- Registra bibliografía sin exigir la carga manual de conceptos.
- Importa PDF, DOCX, TXT, Markdown y JSON como material de trabajo.
- Divide material de texto en fragmentos reutilizables y los incorpora al corpus.
- Acepta course packs JSON completos para importar/exportar.
- Genera una **propuesta rápida local** usando títulos y capítulos del corpus existente; sirve como fallback y no necesita conexión de IA.
- Genera una **propuesta semántica asistida por IA** que puede proponer conceptos, ejemplos y actividades a partir del material.
- La propuesta semántica usa una API key propia del docente en el navegador. La clave se mantiene en `sessionStorage`, no se envía al backend y no forma parte del course pack.
- La salida del LLM se recibe como JSON estructurado mediante Structured Outputs cuando el modelo lo soporta y se incorpora como elementos marcados como sugeridos para revisión.
- Configura modalidades de interacción desde presets pedagógicos, escondiendo la estrategia CORE en Avanzado.
- Configura actividades y comisiones.
- Guarda borradores del course pack en `localStorage`.
- Valida referencias antes de exportar.
- Mantiene separadas las claves del docente y de cada estudiante.

## Cómo funciona la propuesta con IA

El proceso es:

```text
PDF / DOCX / TXT / MD / JSON
    ↓
extracción local
    ↓
fragmentos del corpus
    ↓
selección representativa si el material es muy grande
    ↓
LLM del docente
    ↓
conceptos + ejemplos + actividades
    ↓
revisión docente
    ↓
course pack
```

La IA no reemplaza la extracción: el material se procesa localmente primero. Tampoco publica automáticamente la propuesta.

Para reducir consumo, Studio puede seleccionar una representación del corpus cuando el material excede el tamaño de contexto elegido para esta primera versión. El estado de la interfaz informa cuando se analizó una selección en lugar de todo el corpus.

El servicio de propuesta usa el endpoint LLM configurado en el course pack y, para la configuración de Groq actual de AULIA, prioriza los modelos definidos allí. Groq documenta Structured Outputs con JSON Schema y soporte estricto para `openai/gpt-oss-20b`, `openai/gpt-oss-120b` y `qwen/qwen3.8-27b`. citeturn257822view0

## Seguridad del piloto

La clave del docente se utiliza directamente desde el navegador para la operación de Studio. No se guarda en el course pack ni en Google Sheets. La clave del estudiante continúa siendo independiente y se utiliza exclusivamente desde la aplicación de estudiante.

Este modelo sigue siendo apropiado para el piloto de AULIA, donde cada usuario aporta su propia clave de proveedor.

## Qué todavía no hace

- OCR para PDFs escaneados sin capa de texto.
- Autenticación institucional de docentes.
- Publicación remota del course pack.
- Versionado institucional.
- Revisión semántica multi-etapa o comparación entre versiones de una propuesta.

La separación entre CORE, COURSE PACK, ACCESS y TRACKING se mantiene.
