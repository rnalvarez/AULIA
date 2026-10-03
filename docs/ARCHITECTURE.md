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
