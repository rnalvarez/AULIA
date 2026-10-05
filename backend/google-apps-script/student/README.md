# AULIA — shared student backend

Este backend sirve a todas las cátedras publicadas de AULIA desde un único Web App.

## Propiedades del script

- `AULIA_ADMIN_SHEET_ID`: ID del Google Sheet administrativo utilizado por Teacher Studio.
- `SESSION_TTL_SECONDS`: opcional, por defecto 21600.

## Flujo

El cliente envía `courseId`. El backend busca esa cátedra en `📚 Cátedras`, verifica que esté publicada y obtiene el `Student Sheet ID`. Todas las operaciones posteriores usan exclusivamente esa Sheet.

No contiene ninguna API key de LLM.

## Publicación

Teacher Studio crea automáticamente la Sheet de alumnos al publicar por primera vez y coloca su ID en la hoja administrativa. El course pack publicado recibe el mismo endpoint de este backend.

## Estructura mínima de cada Sheet de alumnos

`📋 Padrón`:
DNI | Apellido | Nombre | Comisión | Activo (Sí/No) | PIN Hash (no tocar) | Fecha registro PIN

También se crean:

`📝 Interacciones`, `👤 Por alumno`, `📊 Resumen`.

## Prueba

Agregar al menos un alumno en `📋 Padrón` con Activo = Sí y dejar PIN Hash vacío. El alumno podrá crear su PIN en el primer acceso.

Este backend es la base multi-cátedra; el análisis pedagógico más rico de CHION puede seguir en su backend piloto separado mientras se migra de forma progresiva.
