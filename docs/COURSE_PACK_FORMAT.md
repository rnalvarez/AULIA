# AULIA — Course Pack Format

Un course pack es la unidad portable de contenido y configuración de una cátedra.

## Estructura

AULIA puede conservar una colección ligera de `documents` para registrar qué materiales fueron incorporados. Las unidades del `corpus` pueden incluir `documentId`, `sectionPath`, `sourcePageStart` y `sourcePageEnd`, de modo que la recuperación conserve el contexto de la fuente sin convertir cada página en una unidad pedagógica.

En el repositorio puede existir como:

src/courses/<course-id>/
  course.json
  bibliography.json
  concepts.json
  examples.json
  modes.json
  activities.json
  tracking.json

Además del perfil del curso, cada pack puede incluir un perfil de asistente en `assistant.json`. Allí viven la identidad, bienvenida, sugerencias e instrucciones generales del asistente. Las instrucciones específicas de cada modalidad viven en `modes.json`.

STUDIO utiliza además un formato portable único:

{
  "format": "aulia-course-pack",
  "version": "1.0",
  "course": {},
  "bibliography": [],
  "documents": [],
  "concepts": [],
  "examples": [],
  "modes": [],
  "activities": [],
  "tracking": {}
}

## Reglas

Cada entidad debe tener un id único dentro de su colección.

Los modos deben declarar id, title, description, pedagogicalGoal, strategy y placeholder.

Las actividades pueden asociarse a un modo mediante modeId.

Los ejemplos pueden relacionarse con conceptos mediante sus IDs.

## Estrategias

La propiedad strategy describe el comportamiento pedagógico general del motor sin asociarlo a un autor concreto.

Estrategias actualmente disponibles: retrieve, scene-analysis, socratic, guided-analysis, diagnostic y generic.

En una etapa posterior las estrategias también podrán ser extensibles mediante configuración, evitando que el conjunto quede limitado a las implementadas hoy.
