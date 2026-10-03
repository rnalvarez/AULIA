# AULIA backend — Google Apps Script · CHIONIA pilot

Esta carpeta contiene el backend de transición para probar AULIA con el modelo real de gestión de CHIONIA.

## Estructura

Apps Script carga todos los archivos `.gs` de este proyecto:

- `Code.gs` — dispatcher HTTP.
- `chion-config.gs` — configuración, hojas, comisiones y conceptos.
- `chion-auth.gs` — padrón, PIN, bloqueo temporal y sesiones.
- `chion-llm.gs` — proxy server-side al proveedor LLM y registro automático.
- `chion-tracking.gs` — Interacciones, Por alumno, Conceptos, comisiones y Resumen.

## Hojas compatibles

El piloto conserva las hojas actuales de CHIONIA:

- 📋 Padrón
- 📝 Interacciones
- 👤 Por alumno
- 🧠 Conceptos
- 🗓 Lunes
- 🗓 Miércoles
- 🗓 Jueves
- 📊 Resumen

## Acciones HTTP

### `check`

`{ action: "check", courseId, dni }`

Comprueba el padrón y devuelve identidad, comisión, estado y existencia de PIN.

### `registrar`

`{ action: "registrar", courseId, dni, pin }`

Crea el PIN por primera vez y devuelve una sesión temporal.

### `verificar`

`{ action: "verificar", courseId, dni, pin }`

Valida el PIN y devuelve una sesión temporal.

### `chat`

`{ action: "chat", courseId, token, sid, assistant, mode, messages, retrieved }`

Valida la sesión, llama al LLM desde Apps Script y registra la interacción en la Sheet.

### `log`

`{ action: "log", courseId, token, sid, q, r, model, modeId }`

Registra una interacción de forma explícita. El flujo normal debería usar `chat`, que ya registra server-side.

## Propiedades

En **Project Settings → Script Properties**:

- `COURSE_ID` — por ejemplo `chion`
- `SHEET_ID` — opcional si el script está vinculado a la Sheet
- `LLM_ENDPOINT`
- `LLM_API_KEY`
- `LLM_MODEL`
- `SESSION_TTL_SECONDS` — opcional; por defecto 6 horas

La clave del LLM no se almacena en la Sheet ni en el frontend.

## Prueba

Para el piloto:

1. duplicar la Sheet real de CHIONIA;
2. trabajar únicamente sobre esa copia;
3. desplegar este Apps Script como Web app;
4. configurar las Script Properties;
5. probar DNI, PIN, sesión, chat y tracking;
6. comparar el resultado contra el comportamiento conocido de CHIONIA.

## Importante sobre la migración

El hash de PIN de esta rama sigue siendo compatible con CHIONIA v4.8. Se lo considera una solución de transición: antes de un despliegue institucional habrá que reforzar almacenamiento de credenciales, gestión de sesiones y controles de acceso.

Además, en este piloto el course pack todavía llega desde el cliente. La versión institucional deberá resolver assistant, modes y corpus del lado servidor para que el navegador no pueda sustituir la configuración pedagógica de la cátedra.

No conectar esta rama a la Sheet utilizada actualmente por los alumnos.
