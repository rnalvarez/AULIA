# AULIA Studio

AULIA Studio es la superficie de autoría de la plataforma. Está separada del acceso del estudiante y trabaja sobre el mismo formato de **course pack** que consume el CORE.

## Acceso

En GitHub Pages se sirve como:

`/AULIA/studio.html`

También acepta `?course=chion` o `?course=montaje` para abrir una cátedra concreta.

## Modelo de trabajo

El Studio organiza la cátedra así:

```text
CÁTEDRA
├── Identidad
├── CONTENIDO
│   ├── Bibliografía
│   ├── Corpus
│   ├── Conceptos
│   ├── Ejemplos
│   └── Actividades
├── ASISTENTE
│   └── identidad + instrucciones generales
├── MODOS
├── COMISIONES
└── CONFIGURACIÓN
    ├── LLM (sin API key)
    └── Tracking
```

Una cátedra puede tener varias comisiones. El contenido pedagógico no se duplica por comisión.

## Qué hace esta primera versión

- Selecciona entre las cátedras existentes del registry.
- Crea una nueva cátedra como borrador local.
- Edita identidad, bibliografía, corpus, conceptos, ejemplos y actividades.
- Configura identidad e instrucciones generales del asistente.
- Configura modos a partir de las estrategias disponibles en el CORE.
- Define comisiones como capa administrativa.
- Importa y exporta course packs JSON.
- Guarda borradores en `localStorage`.
- Importa TXT/Markdown y JSON de corpus y los convierte en fragmentos editables.
- Valida referencias entre modos, actividades, conceptos, corpus y comisiones.
- Mantiene la regla de que el Studio **no guarda claves de LLM**.

## Qué todavía no hace

Esta versión no publica una cátedra en el backend y no autentica docentes. Tampoco extrae todavía contenido de PDF/DOCX. Esa extracción queda como una siguiente capa del Studio: documento → texto → fragmentos → conceptos/referencias → revisión docente → publicación.

El Studio actual es, por diseño, una herramienta de autoría local y no un panel institucional de producción.
