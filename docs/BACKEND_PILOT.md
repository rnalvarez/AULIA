# AULIA — Backend piloto CHIONIA

## Objetivo

Reproducir el circuito que ya existe en CHIONIA sin modificar CHIONIA/main:

Padrón → DNI/PIN → sesión → API key propia → Chat → Interacciones → seguimiento docente

## Arquitectura de esta etapa

Una instancia de Google Apps Script corresponde a una cátedra y a una Google Sheet de esa cátedra.

El navegador conoce el endpoint de la instancia y mantiene la API key de IA introducida por el alumno. Esa clave no se envía al backend.

El backend:

1. consulta el padrón;
2. valida que el alumno esté activo;
3. emite una sesión temporal después del PIN;
4. valida esa sesión antes de aceptar registros;
5. recibe la interacción ya respondida;
6. resuelve nombre, DNI y comisión desde el padrón;
7. actualiza las vistas docentes.

El proveedor LLM es invocado directamente desde el navegador con la API key del propio alumno.

## Compatibilidad con CHIONIA v4.8

Se conserva la estructura docente existente:

- 📋 Padrón
- 📝 Interacciones
- 👤 Por alumno
- 🧠 Conceptos
- 🗓 Lunes
- 🗓 Miércoles
- 🗓 Jueves
- 📊 Resumen

También se conservan inicialmente las reglas de:

- detección de conceptos;
- detección de confusión;
- niveles de uso;
- observaciones automáticas;
- actualización periódica de vistas.

El modo ya no se adivina a partir del texto: AULIA registra el modeId seleccionado.

## Claves de IA y costos

Cada alumno utiliza su propia cuenta/proveedor y sus propios límites. AULIA no centraliza el consumo de IA en una API key de la cátedra.

La API key se guarda localmente en el navegador para esa instancia y no forma parte del course pack ni de la Google Sheet.

## Seguridad de transición

El formato de PIN actual de CHIONIA se mantiene únicamente para facilitar la migración. La siguiente iteración deberá sustituirlo por un esquema de credenciales más resistente y conservar el bloqueo temporal ante intentos repetidos.

El token de sesión se genera en el backend y se almacena temporalmente en el cache del script. Esto sirve para el piloto; no se considera todavía el mecanismo institucional definitivo.

## Prueba

No conectar esta rama a la Sheet que usa el curso actualmente.

Crear una copia de la Sheet y utilizar esa copia como CHIONIA — AULIA PILOTO.

El primer test debe comprobar, en este orden:

1. DNI existente / inexistente.
2. alumno activo / deshabilitado.
3. creación de PIN.
4. acceso con PIN correcto.
5. ingreso de API key propia.
6. consulta al proveedor.
7. una sola fila de interacción por respuesta.
8. nombre y comisión resueltos desde el padrón.
9. actualización de Por alumno, Conceptos, comisión y Resumen.
10. bloqueo temporal tras intentos incorrectos y sesión vencida.

## Después del piloto

Una vez probado el circuito, el siguiente salto es:

Teacher Studio → Backend → Course Pack → publicación de una cátedra

El docente no tendrá acceso al CORE ni a otras cátedras; administrará únicamente su instancia.
