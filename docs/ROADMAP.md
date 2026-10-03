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
- [ ] Backend/API.
- [ ] Proxy seguro para proveedores LLM.
- [ ] Autenticación institucional.
- [ ] Padrón aislado por cátedra.
- [ ] Tracking aislado por curso.
- [ ] Sesiones y exportación de datos.
- [ ] Roles docente / administrador / estudiante.

## Etapa 4 · Creación y publicación
- [ ] Crear una cátedra desde STUDIO.
- [ ] Subir bibliografía y corpus.
- [ ] Asistir la estructuración de conceptos.
- [ ] Configurar modalidades y actividades.
- [ ] Validar el curso antes de publicar.
- [ ] Publicar una instancia del asistente.
- [ ] Administrar versiones del course pack.

## Criterio de arquitectura

La plataforma debe permitir cambiar el corpus, la bibliografía, las modalidades y las actividades sin modificar el CORE.

La experiencia de uso puede evolucionar; la separación entre CORE, COURSE PACK, ACCESS y TRACKING debe mantenerse.
