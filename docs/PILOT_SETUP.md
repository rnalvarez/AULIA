# AULIA — CHIONIA pilot · Setup del primer backend

## 1. Crear la Sheet de prueba

Duplica la Google Sheet que actualmente usa CHIONIA y trabajá exclusivamente sobre esa copia.

## 2. Crear el Apps Script

En la copia: Extensiones → Apps Script.

Crear/reemplazar estos 4 archivos:
- Code.gs
- chion-config.gs
- chion-auth.gs
- chion-tracking.gs

No hace falta crear chion-llm.gs.

## 3. Script Properties

COURSE_ID = chion
SHEET_ID = ID de la copia de la Sheet
SESSION_TTL_SECONDS = 21600 (opcional)

No configurar ninguna propiedad LLM.
La API key de IA la introduce cada alumno en AULIA y se utiliza directamente desde su navegador.

## 4. Desplegar

Publicar el proyecto como Web App y copiar la URL de implementación.

## 5. Conectar AULIA

Colocar esa URL en src/courses/chion/tracking.json → endpoint.
No usar la URL del backend real de CHIONIA.

## 6. Prueba funcional

Comprobar el circuito: DNI → PIN → sesión → API key propia → chat → registro.
La consulta se envía directamente desde el navegador al proveedor de IA.

La interacción debe aparecer en Interacciones, Por alumno, Conceptos, comisión y Resumen.

## 7. Criterio para pasar a main

No fusionar el piloto hasta verificar el circuito completo utilizando exclusivamente la copia de la Sheet.