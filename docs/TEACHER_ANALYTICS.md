# AULIA — Analítica docente

La Sheet de alumnos de cada cátedra funciona como capa de seguimiento pedagógico.

## Organización

Cada cátedra publicada tiene una única Sheet de alumnos con:

- `📋 Padrón`: padrón y habilitación.
- `📝 Interacciones`: registro crudo.
- `👤 Por alumno`: agregación individual.
- `🧠 Conceptos`: actividad y dificultad por concepto.
- `📊 Resumen`: visión general.
- una pestaña por comisión declarada, por ejemplo `🟦 Comisión A`, `🟩 Comisión B`.

Las pestañas de comisión no son fuentes independientes de datos: se calculan desde el padrón y las interacciones.

## Conceptos

Los conceptos pertenecen al Course Pack de la cátedra. Cada concepto puede vincularse con:

- `sourceCorpusIds`: fragmentos concretos del material.
- `sourceBibliographyIds`: referencias de la bibliografía declarada.
- `confusionCriteria`: criterios de posible dificultad o confusión fundamentados en ese material.

Esto evita que la analítica trate conceptos como conocimiento universal del modelo: la unidad de análisis es la bibliografía autorizada por la cátedra.

## Interacciones

Cada interacción conserva, además de la pregunta y respuesta:

- modo;
- IDs y nombres de conceptos tratados;
- fuentes bibliográficas de esos conceptos;
- `Confusión`;
- `Nivel confusión`.

El nivel se interpreta como:
- 0: sin indicio;
- 1: posible dificultad;
- 2: confusión clara o reiterada.

La señal es pedagógica y probabilística; no constituye un diagnóstico del alumno.

## Resumen

`📊 Resumen` presenta participación, actividad por comisión y modo, conceptos más trabajados y conceptos con más posibles confusiones.

## Principio de actualización

La información derivada se reconstruye automáticamente a partir de las interacciones y el padrón. El docente no necesita mantener manualmente los contadores.

## Evolución prevista

La estructura deja preparada una evolución posterior hacia análisis temporales, comparación entre comisiones y revisión más fina de evidencia de comprensión/confusión, sin cambiar el modelo de acceso por cátedra.
