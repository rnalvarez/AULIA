# AULIA — shared student backend

Este backend sirve a todas las cátedras publicadas de AULIA desde un único Web App. Cada cátedra mantiene su propia Sheet de alumnos.

## Propiedades del script

- `AULIA_ADMIN_SHEET_ID`: ID del Google Sheet administrativo utilizado por Teacher Studio.
- `SESSION_TTL_SECONDS`: opcional, por defecto 21600.

## Flujo

El cliente envía `courseId`. El backend busca esa cátedra en `📚 Cátedras`, verifica que esté publicada, obtiene el `Student Sheet ID` y carga el Course Pack publicado para validar conceptos y bibliografía analítica.

No contiene ninguna API key de LLM.

## Publicación y organización de la Sheet

Teacher Studio crea automáticamente la Sheet de alumnos al publicar por primera vez. Si la Sheet ya existe, una nueva publicación también crea las pestañas de las comisiones que falten.

Estructura base:

`📋 Padrón`  
DNI | Apellido | Nombre | Comisión | Activo (Sí/No) | PIN Hash (no tocar) | Fecha registro PIN

`📝 Interacciones`  
Registro crudo de cada interacción, incluyendo modo, conceptos tratados, fuentes bibliográficas y nivel de posible confusión.

`👤 Por alumno`  
Agregación por estudiante: consultas, sesiones, modos, conceptos, posibles/confusiones reiteradas y actividad.

`🧠 Conceptos`  
Resumen de los conceptos definidos en el Course Pack publicado, su bibliografía de referencia, cantidad de alumnos, interacciones y posibles confusiones.

`📊 Resumen`  
Lectura general de la cátedra: participación, actividad por comisión y modo, conceptos más trabajados y conceptos con mayor posible confusión.

`🟦 Comisión A`, `🟩 Comisión B`, etc.  
Una pestaña por comisión declarada en la cátedra, con análisis de los alumnos de esa comisión. Las hojas se derivan automáticamente del padrón y las interacciones.

## Conceptos y bibliografía

Los conceptos no son globales de AULIA. Pertenecen al Course Pack de cada cátedra.

La propuesta pedagógica de Studio puede asociar cada concepto con:
- fragmentos concretos del corpus mediante `sourceCorpusIds`;
- una o más referencias de la bibliografía declarada mediante `sourceBibliographyIds`;
- criterios de posible confusión mediante `confusionCriteria`.

La analítica de una interacción solo acepta conceptos que existan en la versión publicada del Course Pack y resuelve las fuentes bibliográficas desde ese mismo Course Pack.

## Confusión

`Nivel confusión`:
- `0` = sin indicio;
- `1` = posible dificultad, comprensión incompleta o pedido de aclaración;
- `2` = confusión clara o reiterada.

La clasificación es un indicador pedagógico, no un diagnóstico. Como refuerzo, una pregunta que contenga expresiones explícitas de no comprensión puede elevar una marca 0 a 1 cuando existe un concepto asociado.

## Prueba

Agregar al menos un alumno en `📋 Padrón` con Activo = Sí y dejar PIN Hash vacío. El alumno podrá crear su PIN en el primer acceso.

Para probar la analítica, interactuar con un concepto de la bibliografía publicada y revisar `📝 Interacciones`, `🧠 Conceptos` y `📊 Resumen`.

Este backend es la base multi-cátedra de AULIA. CHIONIA permanece sin modificaciones.
