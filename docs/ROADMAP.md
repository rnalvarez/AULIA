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
- [x] Diseñar backend de Teacher Studio sobre Google Apps Script.
- [x] Autenticación docente con sesión temporal y bloqueo básico.
- [x] Autorización por cátedra con owner/editor/viewer.
- [x] Persistencia de course packs en Google Drive.
- [x] Control de concurrencia para evitar sobrescritura accidental.
- [ ] Despliegue y prueba extremo a extremo del backend.
- [ ] Padrón aislado por cátedra.
- [ ] Tracking aislado por curso.
- [ ] Sesiones y exportación de datos.
- [ ] Identidad institucional / OAuth.
- [ ] Rol administrador central.

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
- [x] Análisis semántico asistido para proponer conceptos, ejemplos y actividades.
- [ ] Revisión pedagógica más rica antes de publicar.
- [x] Publicar una instancia del asistente desde STUDIO.
- [x] Separar borrador y versión publicada para permitir editar después de probar.
- [x] Resolver instancias estudiantiles dinámicamente desde `?course=<slug>`.
- [ ] Administrar historial de versiones del course pack.

## Implementación actual

Studio tiene autenticación docente y autorización por cátedra preparadas para un backend de Google Apps Script.

El backend de Teacher Studio utiliza una Google Sheet administrativa como panel de control y Google Drive para persistir los course packs. El frontend no recibe cátedras no autorizadas.

El endpoint del backend todavía debe configurarse en:

`src/core/studioConfig.js`

y luego desplegarse como Web App.

## Criterio de arquitectura

La plataforma debe permitir cambiar el corpus, la bibliografía, las modalidades y las actividades sin modificar el CORE.

La experiencia de uso puede evolucionar; la separación entre CORE, COURSE PACK, ACCESS y TRACKING debe mantenerse.
