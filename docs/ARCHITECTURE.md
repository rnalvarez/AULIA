# AULIA — arquitectura inicial

## Qué se migró desde CHIONIA

Se toma como referencia:

- interfaz de chat y experiencia conversacional;
- concepto de modalidades diferenciadas;
- recuperación por conceptos/aliases;
- registro de interacciones;
- identidad de estudiante como contexto separado;
- integración futura con un servicio externo de seguimiento.

## Qué no se migra

No se incorpora al núcleo:

- identidad de Michel Chion;
- prompt específico del autor;
- bibliografía de una sola cátedra como lógica;
- nombres de comisiones;
- endpoints de una planilla concreta;
- reglas específicas de una actividad.

## Contrato conceptual

Un curso aporta:

course.json
bibliography.json
concepts.json
examples.json
modes.json
activities.json

El CORE aporta:

UI
retrieval
pedagogía
LLM adapter
auth adapter
tracking adapter
sesiones

## Evolución prevista

1. Validar el course pack de Chion.
2. Migrar el seguimiento a un adaptador por curso.
3. Incorporar autenticación real sin fallos permisivos.
4. Sustituir la recuperación lexical por recuperación semántica controlada.
5. Integrar un backend/proxy para LLM.
6. Crear una interfaz docente para generar y validar course packs sin código.


## Prueba de independencia del course pack

AULIA ahora descubre automáticamente los directorios de curso dentro de `src/courses/*/`. El CORE ya no importa de forma explícita a Chion.

Se incorporó un segundo course pack de prueba:

- `src/courses/chion/`
- `src/courses/montaje/`

El curso de montaje utiliza otro corpus, otra bibliografía y una modalidad adicional (`diagnostico`). La interfaz y el motor no contienen lógica específica para ese curso.

Esto establece una prueba básica del contrato:

`CORE + COURSE PACK A` y `CORE + COURSE PACK B` pueden coexistir sin agregar imports ni condiciones específicas de cada cátedra al CORE.

La siguiente evolución será reemplazar el registro de archivos por un mecanismo de administración/publicación de course packs, manteniendo este mismo contrato.
