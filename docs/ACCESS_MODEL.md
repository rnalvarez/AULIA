# AULIA — Access model

## Student runtime

La aplicación estudiantil representa una sola instancia de cátedra, pero la instancia se resuelve dinámicamente a partir del enlace público.

Formato:

`https://rnalvarez.github.io/AULIA/?course=<slug>`

El cliente no presenta un selector de cátedras. La raíz sin `course` no elige una cátedra por defecto.

El acceso del alumno se valida contra el endpoint externo configurado por ese course pack.

Flujo:

DNI → padrón de la cátedra → PIN → sesión del curso → chat

Las sesiones locales caducan y vuelven a requerir validación del padrón después de 24 horas.

El cliente nunca acepta un acceso libre cuando el endpoint falla.

## Tracking

Cada interacción se envía al endpoint de la cátedra con courseId, sesión, identidad del alumno, modalidad, actividad, modelo, pregunta, respuesta y unidades recuperadas.

Si el envío falla, la interacción se guarda temporalmente en una cola local para reintento.

El docente sigue controlando el padrón y consultando las interacciones desde su Google Sheet. AULIA no reemplaza esa fuente de autoridad.

## STUDIO

STUDIO tiene ahora una capa de acceso docente separada del runtime estudiantil.

Flujo:

```text
email + contraseña
        ↓
Google Apps Script
        ↓
sesión docente temporal
        ↓
cátedras autorizadas
        ↓
course pack en Google Drive
        ↓
Studio
```

El frontend **no carga una lista pública de todas las cátedras**. La lista que aparece en Studio proviene del backend después de autenticar al docente.

Cada cátedra tiene un `Owner Email`. Ese docente obtiene automáticamente el rol `owner`.

Los accesos adicionales se registran en la hoja `👥 Permisos` y pueden ser:

- `owner`: responsable de la cátedra.
- `editor`: puede modificar y guardar.
- `viewer`: puede consultar sin guardar cambios.

La autorización se comprueba nuevamente en el backend en cada operación de curso. No depende de que el frontend oculte botones.

## Persistencia

La Google Sheet administrativa mantiene:

- docentes;
- cátedras;
- permisos;
- auditoría.

Los course packs se guardan como JSON en una carpeta privada de Google Drive accesible por el backend.

La Sheet no se utiliza para almacenar corpus completos.

## Control de concurrencia

Cada course pack tiene una marca `Actualizado`.

Cuando Studio guarda:

1. envía la versión que había cargado;
2. el backend compara esa versión con la versión actual;
3. si cambió, rechaza el guardado;
4. Studio debe recargar la versión remota antes de continuar.

Esto evita que dos sesiones sobrescriban silenciosamente el trabajo.

## Seguridad del piloto

La autenticación docente del piloto usa email + contraseña con hash SHA-256 y salt por docente, sesión temporal en `CacheService` y bloqueo básico ante intentos repetidos.

La implementación institucional definitiva podrá sustituir este acceso por Google Workspace/OAuth u otro proveedor de identidad.

Google Apps Script permite desplegar Web Apps con distintas identidades de ejecución; para este diseño se evita depender de `Session.getActiveUser().getEmail()` porque Google indica que el email puede quedar vacío en determinados contextos, entre ellos Web Apps ejecutadas como el propietario. citeturn912173search1turn912173search0

## Publicación y ciclo de edición

Una cátedra tiene una versión de trabajo y, cuando corresponde, una versión publicada separada.

```
BORRADOR
  ↓ guardar
STUDIO
  ↓ probar
PUBLICAR
  ↓
VERSIÓN PUBLICADA
```

Al guardar cambios sobre una cátedra ya publicada, la versión pública anterior no se modifica. El estado pasa a `changes-pending`. El docente puede probar la versión publicada, volver al Studio, editar y publicar una nueva versión cuando esté conforme.

La publicación crea o actualiza un segundo course pack privado en Google Drive. El runtime estudiantil solo puede cargar ese archivo publicado.

La URL pública no requiere una nueva página ni una nueva aplicación por cátedra. Cada cátedra utiliza la misma aplicación de GitHub Pages y un identificador en la query:

`https://rnalvarez.github.io/AULIA/?course=montaje`

El acceso del estudiante sigue dependiendo del padrón configurado en el course pack.

## Principio central

**Una cuenta docente no implica acceso a todas las cátedras.**

El acceso efectivo es:

```text
DOCENTE
  ↓
PERMISO
  ↓
CÁTEDRA
  ↓
COURSE PACK
```

El backend es la autoridad final para leer y modificar esos recursos.

