# AULIA — Roadmap

## Etapa 1 · Fundación
- [x] Separar CORE y course packs.
- [x] Cargar automáticamente múltiples cursos.
- [x] Validar referencias entre entidades.
- [x] Declarar estrategias pedagógicas en los modos.
- [x] Crear Studio local de autoría.
- [x] Importar/exportar course packs.

## Etapa 2 · Validación pedagógica
- [ ] Incorporar los aprendizajes observados en el piloto CHIONIA.
- [ ] Definir mejor qué debe responder el modelo y qué debe resolver el motor.
- [ ] Sustituir recuperación lexical por recuperación semántica controlada.
- [ ] Diseñar trazabilidad de fuentes y unidades recuperadas.
- [ ] Versionar corpus y configuración.

## Etapa 3 · Plataforma institucional
- [ ] Backend/API — piloto CHIONIA preparado; falta despliegue y prueba extremo a extremo.
- [ ] Proxy para proveedores LLM — primera capa server-side preparada para el piloto.
- [ ] Autenticación con sesión temporal y bloqueo básico — implementada, pendiente de prueba real.
- [ ] Padrón aislado por cátedra — preparado para una instancia backend por Sheet/cátedra.
- [ ] Tracking aislado por curso — preparado server-side; pendiente de prueba real.
- [ ] Sesiones y exportación de datos.
- [ ] Roles docente / administrador / estudiante.

## Etapa 4 · Creación y publicación
- [x] Crear una cátedra como borrador desde STUDIO.
- [x] Rediseñar STUDIO como flujo docente: Cátedra → Material → Propuesta → Interacción → Comisiones.
- [x] Editar bibliografía y corpus; importar TXT/Markdown/JSON.
- [x] Generar una primera propuesta automática de unidades a partir del corpus, para revisión docente.
- [x] Configurar conceptos, ejemplos, modalidades y actividades.
- [x] Configurar comisiones sin duplicar el contenido de la cátedra.
- [x] Validar el course pack antes de exportarlo.
- [x] Extracción local de PDF/DOCX con trazabilidad de archivo y página.
- [ ] OCR para PDFs escaneados sin capa de texto.
- [ ] Análisis semántico asistido para proponer conceptos, relaciones y referencias.
- [ ] Revisión pedagógica más rica antes de publicar.
- [ ] Publicar una instancia del asistente desde STUDIO.
- [ ] Administrar versiones del course pack.

## Implementación actual

Studio v0.2 reorganiza la autoría alrededor de la tarea docente y deja la estructura técnica en una capa avanzada. El backend piloto está documentado en `docs/BACKEND_PILOT.md`.

## Criterio de arquitectura

La plataforma debe permitir cambiar el corpus, la bibliografía, las modalidades y las actividades sin modificar el CORE.

La experiencia de uso puede evolucionar; la separación entre CORE, COURSE PACK, ACCESS y TRACKING debe mantenerse.
