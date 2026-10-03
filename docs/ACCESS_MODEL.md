# AULIA — Access model

## Student runtime

La aplicación estudiantil representa una sola instancia de cátedra.

En producción, `VITE_AULIA_COURSE_ID` fija el course pack que puede utilizar esa instancia. El cliente no presenta un selector de cátedras.

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

STUDIO no forma parte del runtime estudiantil ni aparece en su navegación.

Su objetivo es preparar y validar course packs. La futura versión institucional deberá protegerlo mediante autenticación docente del lado servidor.

## Seguridad

El ocultamiento de rutas o botones en un frontend no constituye control de acceso seguro. Un despliegue institucional debe mantener la autorización y las credenciales LLM del lado servidor.

Por eso el repositorio público contiene la plataforma y ejemplos de course packs, mientras que el backend de cada cátedra debe proteger el acceso efectivo y las credenciales del proveedor LLM.
