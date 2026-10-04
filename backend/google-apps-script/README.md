# Backend AULIA — piloto CHIONIA

Este backend de Apps Script administra exclusivamente el acceso de alumnos y el seguimiento docente de la instancia.

## Qué hace

- valida DNI contra la hoja Padrón;
- crea y verifica PIN;
- mantiene una sesión temporal del alumno;
- registra interacciones;
- actualiza las vistas por alumno, conceptos, comisión y resumen.

## Qué NO hace

El backend no llama al proveedor LLM y no almacena ninguna API key de IA.

Cada alumno introduce su propia API key de Groq en el navegador. AULIA usa esa clave para llamar directamente al proveedor. La clave no se envía al Apps Script ni se guarda en la Sheet.

## Archivos

- Code.gs — dispatcher HTTP.
- chion-config.gs — configuración de la instancia y nombres de hojas.
- chion-auth.gs — padrón, PIN y sesiones.
- chion-tracking.gs — registro y agregaciones.

No hace falta chion-llm.gs en esta variante.

## Propiedades del script

- COURSE_ID → chion
- SHEET_ID → ID de la copia de la Sheet
- SESSION_TTL_SECONDS → opcional; por defecto 6 horas

No configurar LLM_API_KEY, LLM_ENDPOINT ni LLM_MODEL.

## Despliegue

Publicar como Web App y usar la URL resultante únicamente en src/courses/chion/tracking.json.
La URL del backend de la copia debe ser distinta de la utilizada por CHIONIA en producción.