# AULIA backend — Google Apps Script

Esta plantilla propone una instancia backend por cátedra vinculada a su Google Sheet.

## Hojas

`PADRON`
`DNI | APELLIDO | NOMBRE | COMISION | ACTIVO | PIN_HASH`

`INTERACCIONES`
`TS | COURSE_ID | SID | DNI | APELLIDO | NOMBRE | COMISION | MODE_ID | ACTIVITY_ID | MODEL | QUESTION | RESPONSE | RETRIEVED_IDS`

## Propiedades del script

`SHEET_ID` — ID de la hoja si el script no está vinculado directamente.
`LLM_ENDPOINT` — endpoint compatible con un chat API.
`LLM_API_KEY` — clave almacenada en Script Properties, nunca en el frontend.
`LLM_MODEL` — modelo que utilizará esta cátedra.

## Acciones

`check`, `registrar`, `verificar`, `log`, `chat`.

El frontend de AULIA conoce únicamente el endpoint de la instancia y el contrato de estas acciones. El docente controla el padrón desde la Sheet y puede consultar las interacciones allí.

Esta carpeta es una plantilla de backend. No contiene ninguna credencial ni debe utilizarse con la clave de un curso real hasta revisar y desplegar la instancia correspondiente.