# AULIA Studio

AULIA Studio es la superficie de autoría de la plataforma. Está separada del acceso del estudiante y trabaja sobre el mismo formato de **course pack** que consume el CORE.

## Flujo de autoría

La interfaz está organizada alrededor de la tarea docente, no del esquema interno de datos:

```text
AUTENTICACIÓN DOCENTE
        ↓
CÁTEDRAS AUTORIZADAS
        ↓
CÁTEDRA
        ↓
MATERIAL
        ↓
PROPUESTA PEDAGÓGICA
        ↓
INTERACCIÓN
        ↓
COMISIONES
        ↓
REVISIÓN / GUARDADO
```

La idea central es que el docente **solo pueda entrar a las cátedras que tiene asignadas**. Cada cátedra tiene un responsable y permisos opcionales para colaboradores.

## Acceso

En GitHub Pages se sirve como:

`/AULIA/studio.html`

Studio ya no construye su lista de cátedras a partir de los course packs públicos del frontend. La lista se obtiene del backend de Teacher Studio después de autenticar al docente.

La URL del backend se configura en:

`src/core/studioConfig.js`

o mediante `VITE_AULIA_STUDIO_API` durante el build.

## Roles

- `owner`: docente responsable de la cátedra.
- `editor`: puede editar y guardar el course pack.
- `viewer`: consulta en modo solo lectura.

El backend vuelve a comprobar el permiso en cada lectura y guardado. El frontend no es la autoridad.

## Persistencia

El backend de Teacher Studio utiliza:

- Google Sheet administrativa: docentes, cátedras, permisos y auditoría.
- Google Drive privado: course packs JSON.

Esto evita almacenar grandes corpus dentro de celdas de la Sheet y mantiene separados contenido y control administrativo.

## Control de concurrencia

Cada cátedra tiene una marca de versión temporal. Studio envía la versión que cargó al intentar guardar.

Si otro editor modificó la cátedra, el backend rechaza el guardado y Studio solicita recargar la versión remota. De esta manera no se sobrescriben cambios silenciosamente.

## Qué hace Studio

- Define identidad de cátedra y asistente.
- Importa PDF, DOCX, TXT, Markdown y JSON como material.
- Mantiene trazabilidad de archivo y página cuando corresponde.
- Genera una propuesta rápida local cuando no se dispone de IA.
- Genera una propuesta semántica asistida por IA usando una API key propia del docente en el navegador.
- Propone conceptos, ejemplos y actividades.
- Permite revisar, editar o eliminar cada propuesta antes de guardar.
- Configura modalidades de interacción, actividades y comisiones.
- Valida el course pack.
- Guarda el course pack en el backend cuando el docente tiene permiso de escritura.
- Exporta una copia JSON cuando hace falta.

## IA docente

La IA no reemplaza la extracción: el material se procesa localmente primero.

El flujo es:

```text
PDF / DOCX / TXT / MD / JSON
    ↓
extracción local
    ↓
fragmentos
    ↓
selección representativa si el corpus es grande
    ↓
LLM del docente
    ↓
conceptos + ejemplos + actividades
    ↓
revisión docente
    ↓
course pack
```

La clave de la IA docente se mantiene en `sessionStorage` y no forma parte del course pack.

La IA estudiantil sigue siendo independiente: cada alumno introduce su propia API key en la aplicación de estudiante.

### Administración de docentes

La hoja `👩‍🏫 Docentes` es el punto de administración del acceso docente. Las columnas visibles permiten gestionar email, nombre, estado y fechas; los campos técnicos de autenticación (hash y salt) permanecen ocultos.

Desde el menú **AULIA** del Sheet se puede:

- abrir el panel de alta/restablecimiento de acceso;
- crear un docente o actualizar su contraseña;
- activar o desactivar el acceso de un docente seleccionado.

La contraseña se introduce en un formulario temporal y no se guarda en texto plano en la Sheet. El backend conserva únicamente hash + salt.

La función `provisionTeacher(...)` sigue existiendo como función interna de soporte; no es necesario editar código para el alta cotidiana de docentes.


## Estado actual

El código del frontend y del backend del modelo multi-docente está implementado.

Para ponerlo operativo todavía hay que:

1. crear una Google Sheet administrativa;
2. crear/desplegar el Apps Script de `backend/google-apps-script/studio/`;
3. ejecutar `initializeStudio()`;
4. abrir el menú **AULIA → Abrir administración de docentes** y crear al menos un docente;
5. configurar el endpoint en `src/core/studioConfig.js`;
6. volver a desplegar GitHub Pages.

La implementación institucional definitiva podrá sustituir la autenticación por email + contraseña por Google Workspace/OAuth y agregar un rol administrador central.


### Archivos del administrador de docentes

En el proyecto de Apps Script, los archivos deben conservar estos nombres distintos:

- `studio-admin.gs`
- `studio-admin-panel.html`
