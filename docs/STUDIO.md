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

La idea central es que el docente **carga material primero**. AULIA puede proponer unidades/conceptos a partir de ese material y el docente los revisa, edita o elimina.

## Acceso

En GitHub Pages se sirve como:

`/AULIA/studio.html`

También acepta `?course=chion` o `?course=montaje`.

## Qué hace Studio v0.2

- Define identidad de cátedra y la identidad visible del asistente.
- Registra bibliografía sin exigir la carga manual de conceptos.
- Importa PDF, DOCX, TXT, Markdown y JSON como material de trabajo.
- Divide material de texto en fragmentos reutilizables y los incorpora al corpus.
- Acepta course packs JSON completos para importar/exportar.
- Genera una **primera propuesta conservadora de unidades/conceptos** usando títulos y capítulos del corpus existente; no llama a ningún LLM y no inventa contenido.
- Permite revisar las propuestas y abrir solo los campos técnicos de recuperación cuando hacen falta.
- Configura modalidades de interacción desde presets pedagógicos, escondiendo la estrategia CORE en Avanzado.
- Configura actividades y comisiones.
- Guarda borradores en `localStorage`.
- Valida referencias antes de exportar.
- Mantiene la regla de que Studio **no guarda claves de LLM**.

## Qué significa “propuesta”

La propuesta actual es una primera capa de automatización, no todavía un análisis semántico completo.

El proceso actual es:

```text
documento TXT/MD/JSON
    ↓
texto
    ↓
fragmentos
    ↓
títulos / capítulos detectados
    ↓
unidades sugeridas
    ↓
revisión docente
```

La extracción de PDF y DOCX ya está integrada en el flujo local. La siguiente evolución será:

```text
PDF / DOCX
    ↓
extracción local de texto
    ↓
fragmentación
    ↓
identificación asistida de conceptos, relaciones y referencias
    ↓
revisión docente
    ↓
publicación
```

## Qué todavía no hace

- OCR para PDFs escaneados sin capa de texto.
- Análisis semántico con LLM durante la creación del course pack.
- Autenticación de docentes.
- Publicación remota del course pack.
- Versionado institucional.

La separación entre CORE, COURSE PACK, ACCESS y TRACKING se mantiene.
