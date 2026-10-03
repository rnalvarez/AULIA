# AULIA

**AULIA** es una plataforma experimental para crear asistentes pedagógicos configurables por cátedra.

La idea central es separar tres capas:

- **CORE**: interfaz, recuperación, pedagogía, sesiones, LLM, autenticación y tracking.
- **COURSE PACK**: bibliografía, conceptos, ejemplos, actividades y modalidades propias de cada curso.
- **ACCESS / TRACKING**: identidad de estudiantes y registro de uso, configurados por curso.

## Estado actual

AULIA se encuentra en una etapa de fundación y validación arquitectónica.

Incluye dos course packs de prueba:

- `chion`: Audiovisión · Michel Chion.
- `montaje`: Fundamentos del montaje audiovisual.

El selector de cursos demuestra que distintos contenidos pueden convivir sobre el mismo CORE. El CORE no importa directamente un autor, una bibliografía ni una cátedra concreta.

También incluye **STUDIO**, un prototipo de configuración docente. Permite editar un course pack en el navegador, validarlo, guardar un borrador local e importar/exportar un archivo `course-pack.json`.

## Importante

STUDIO todavía no publica cursos en un servidor y no reemplaza una futura administración multiusuario. La publicación, autenticación institucional, almacenamiento y proxy de LLM pertenecen a la siguiente etapa.

## Desarrollo local

npm install

npm run dev

Build:

npm run build

## Arquitectura

Ver `docs/ARCHITECTURE.md` y `docs/COURSE_PACK_FORMAT.md`.

## Relación con CHIONIA

CHIONIA es el caso piloto pedagógico. AULIA es la plataforma general que toma lo aprendido allí y lo convierte en componentes reutilizables.

El objetivo es que una nueva cátedra pueda crear su asistente sin clonar un repositorio ni programar el CORE.
