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

## Base de conocimiento bibliográfica

La propuesta pedagógica automática no es lo mismo que el índice de conocimiento del chatbot. Para que cada cátedra pueda recuperar conceptos expresados con sinónimos, paráfrasis y relaciones entre ideas, Studio permite construir una **base de conocimiento conceptual** desde todos los pasajes activos de la bibliografía.

En el paso **Bibliografía**, Studio reúne tres tareas en una sola pantalla: cargar documentos, preparar el índice conceptual y luego revisar alcance y prioridad docente. La extracción de PDF/DOCX/TXT/Markdown se hace localmente con métodos estructurales; después se puede analizar el texto completo con Groq usando la API key del docente o llevar el paquete preparado a una IA externa. Cada entrada del índice contiene término, variantes, definición, desarrollo, distinciones, conceptos relacionados, ejemplos y referencias a pasajes fuente, con sección y páginas cuando están disponibles.

El trabajo interno con Groq es incremental: Studio guarda el avance en el borrador local tras cada lote y puede continuar si hay límites temporales. La clave permanece en la sesión del docente; no se guarda en el course pack ni se envía a Google Sheets. La firma de la base conceptual corresponde al contenido e identidad de todos los pasajes, pero no a los controles de alcance y prioridad; por eso el docente puede cambiar esas decisiones después del análisis sin regenerar el índice.

**Incluido**, **Referencial** y **Excluir** se aplican durante la recuperación de información del chatbot. AULIA no recupera entradas cuyo soporte bibliográfico incluya material excluido; para ser conservadora, una entrada conceptual con referencias mezcladas entre material excluido y activo también queda fuera de la recuperación. La prioridad Central/Complementario/Contexto ajusta el orden de recuperación, sin eliminar contenido por sí sola.

La publicación con material consultable requiere un índice completo que corresponda al contenido actual de toda la bibliografía. Después de revisar los controles, el docente debe guardar la cátedra en el backend y publicar. En las respuestas estudiantiles, AULIA usa el índice conceptual junto con pasajes originales; el índice no sustituye el texto bibliográfico y la precisión debe verificarse con pruebas sobre cada corpus.

### Alternativa con una IA externa

En el mismo paso, Studio ofrece una alternativa para docentes que prefieran usar otra IA sin configurar una API key de Groq. La acción **Descargar paquete (.json)** exporta todos los pasajes (incluidos los que estén marcados Excluir en ese momento), sus IDs estables y las referencias disponibles junto con una firma del contenido del corpus. El docente toma las decisiones de alcance después del análisis.

El botón **Copiar instrucciones** entrega un prompt contextualizado con el formato de salida, la firma y el número esperado de pasajes. La IA externa debe devolver uno o más JSON con el formato `aulia-external-knowledge-index`, identificando los pasajes cubiertos por cada archivo y enlazando cada concepto con citas literales verificables. Studio admite importar varios resultados y acumula conceptos, evidencias y cobertura.

La importación comprueba formato, versión, firma del corpus, IDs de pasaje y que los extractos declarados aparezcan en el texto original. No se marca el índice como completo hasta cubrir todos los IDs esperados. Después de importar, el docente debe guardar y publicar la cátedra. Si modifica el corpus o el alcance de las secciones, los resultados externos anteriores dejan de corresponder a esa bibliografía y deben regenerarse.

La revisión técnica comprueba estructura y trazabilidad; no garantiza que una IA externa haya interpretado todos los conceptos correctamente. El docente debe revisar una muestra sustantiva de las entradas antes de publicar.

## Eliminación segura de cátedras

Solo el responsable (owner) puede borrar una cátedra. Studio solicita una primera confirmación y luego exige escribir el título exacto como segunda autorización. El backend emite un permiso temporal de un solo uso, ligado a la sesión docente, la cátedra y su versión; si la cátedra cambia o el permiso vence, hay que iniciar de nuevo.

En una cátedra publicada, el enlace público queda deshabilitado y las versiones de Course Pack se envían a la papelera de Drive. La planilla de alumnos se conserva intencionalmente para no destruir el padrón ni el historial de interacciones. La operación se registra en la auditoría del backend.

**Importante:** el despliegue de GitHub Pages solo publica el frontend. Para habilitar el borrado de cátedras publicadas, el backend ya desplegado en Google Apps Script también debe actualizarse con los archivos backend/google-apps-script/studio/Code.gs y backend/google-apps-script/studio/studio-data.gs, y luego hay que volver a implementar el Web App. La interfaz mantiene compatibilidad con el borrado de borradores mientras el backend anterior siga desplegado, pero no habilita el borrado de publicadas hasta que el backend actualizado responda.

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
