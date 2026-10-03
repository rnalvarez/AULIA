# AULIA — CHIONIA pilot · Setup del primer backend

## 1. Crear la Sheet de prueba

Duplicar la Google Sheet que actualmente usa CHIONIA.

Nombre sugerido:

`CHIONIA — AULIA PILOTO`

No usar la planilla que está conectada al curso activo.

La copia debe conservar las hojas que ya existen en CHIONIA:

- 📋 Padrón
- 📝 Interacciones
- 👤 Por alumno
- 🧠 Conceptos
- 🗓 Lunes
- 🗓 Miércoles
- 🗓 Jueves
- 📊 Resumen

## 2. Crear el Apps Script

En Google Apps Script crear un proyecto independiente para esta copia.

Copiar los archivos de esta carpeta:

- `Code.gs`
- `chion-config.gs`
- `chion-auth.gs`
- `chion-llm.gs`
- `chion-tracking.gs`

Apps Script combina los archivos `.gs` del proyecto, por lo que todas las funciones quedan disponibles para `Code.gs`.

## 3. Script Properties

En Project Settings → Script Properties:

`COURSE_ID`
- valor: `chion`

`SHEET_ID`
- ID de la copia de la Sheet.
- Puede omitirse únicamente si el proyecto está vinculado directamente a esa Sheet.

`LLM_ENDPOINT`
- endpoint compatible con Chat Completions.

`LLM_API_KEY`
- clave del proveedor.
- Nunca ponerla en GitHub, en el frontend ni en una celda de la Sheet.

`LLM_MODEL`
- modelo que utilizará la instancia.

`SESSION_TTL_SECONDS`
- opcional.
- sugerido para el piloto: `21600` (6 horas).

## 4. Probar el backend dentro de Apps Script

Ejecutar:

`testAuliaBackend()`

Debe comprobar:

- acceso a la Sheet;
- existencia de 📋 Padrón;
- cantidad de filas del padrón;
- COURSE_ID configurado.

Luego ejecutar:

`testAuth()`

y:

`testChatConfiguration()`

## 5. Desplegar como Web app

Crear una implementación nueva:

- Execute as: la cuenta propietaria del proyecto.
- Who has access: utilizar la configuración mínima necesaria para el alumnado de esta instancia.

Copiar la URL de implementación.

## 6. Conectar AULIA

En la rama `aulia-backend-chion-pilot`, colocar esa URL en:

`src/courses/chion/tracking.json → endpoint`

No usar la URL del backend real de CHIONIA.

Después publicar/probar la rama de AULIA.

## 7. Prueba funcional mínima

Con un alumno de prueba de la copia:

### Acceso
- DNI inexistente → rechazado.
- DNI inactivo → rechazado.
- DNI activo sin PIN → creación de PIN.
- DNI activo con PIN → acceso.
- PIN incorrecto repetido → bloqueo temporal.

### Chat
- enviar una pregunta;
- comprobar que responde el LLM;
- comprobar que la clave del proveedor nunca aparece en el navegador;
- comprobar que se genera una sola interacción.

### Seguimiento
La interacción debe aparecer en:

- 📝 Interacciones
- 👤 Por alumno
- 🧠 Conceptos
- comisión correspondiente
- 📊 Resumen

Nombre, DNI y comisión deben provenir del Padrón, no de los datos enviados por el navegador.

## 8. Criterio de aprobación del piloto

No pasar estos cambios a `main` hasta comprobar:

`DNI → PIN → sesión → chat → LLM → registro → seguimiento docente`

y verificar que una modificación de `Activo` en el Padrón bloquea nuevamente el acceso.

## 9. Próximo bloque después del piloto

Una vez validado el circuito:

`Teacher Studio → autenticación docente → configuración del course pack → publicación`

Ese será el momento de sacar definitivamente la configuración pedagógica del frontend y dejar que el backend resuelva la versión publicada de la cátedra.
