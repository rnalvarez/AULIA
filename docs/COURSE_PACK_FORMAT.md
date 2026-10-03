# AULIA — Course Pack Format

Un course pack es la unidad portable de contenido y configuración de una cátedra.

## Estructura

En el repositorio puede existir como:

src/courses/<course-id>/
  course.json
  bibliography.json
  concepts.json
  examples.json
  modes.json
  activities.json
  tracking.json

STUDIO utiliza además un formato portable único:

{
  "format": "aulia-course-pack",
  "version": "1.0",
  "course": {},
  "bibliography": [],
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
