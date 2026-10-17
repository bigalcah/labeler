# Runbook de comparación CSV

La exportación vigente es una descarga desde la aplicación para participantes autenticados. El
contrato está implementado, pero continúa `IMPLEMENTED-UNVERIFIED` hasta conservar evidencia de
runtime aprobada. Este runbook no acredita por sí solo aceptación HTTP o de VPS.

## Acceso y autorización

Abre `GET /export` con una sesión válida. La página calcula el estado actual a partir del
participante y estudio ligados a la sesión. No acepta IDs de estudio o participante desde URL,
query, formulario o cabeceras. GET es de solo lectura y no requiere CSRF.

El botón de descarga envía `POST /export/download` same-origin, con cookie de sesión y token CSRF.
El servidor valida `Origin` y CSRF antes de procesar la acción, requiere sesión y vuelve a
comprobar la elegibilidad. No existe selector de estudio o participante ni rol de operador para
esta exportación.

El solicitante debe haber completado todas las tarjetas canónicas de su estudio, exactamente 30 o
300 según su configuración, con exactamente una decisión terminal (`CLASSIFIED` o `DISCARDED`)
por tarjeta. También debe existir al menos otra persona distinta, del mismo estudio, que haya
completado todas esas tarjetas. La vista GET solo es informativa: el POST revalida el gate.

## Estados y errores

- Si el solicitante aún tiene tarjetas pendientes, la página le indica completar su trabajo sin
  revelar estado, identidad ni progreso de otras personas.
- Si el solicitante terminó y espera a otra persona, la página indica que la comparación aún no
  está disponible, sin contar ni identificar a participantes incompletos.
- Cuando cumple el gate, la página indica qué datos incluirá y muestra `Download CSV`.
- Mientras se prepara, el botón se desactiva y la página anuncia una espera indeterminada, sin
  porcentaje. Al iniciar la descarga, no afirma que el navegador ya guardó el archivo.
- Un error recuperable muestra un mensaje genérico y permite reintento manual. No se repite el
  POST automáticamente.

La sesión ausente o vencida responde 401 y no crea archivo. `Origin`/CSRF inválido o gate
incumplido responde 403. Datos persistidos inconsistentes responden 409. Un error interno responde
500 sanitizado. Ninguna respuesta de error incluye adjunto ni contenido CSV. El cliente verifica
éxito HTTP y `text/csv` antes de crear una descarga; nunca convierte HTML de login o error en CSV.

## Archivo

El servidor reúne las filas en una única instantánea de solo lectura y crea el CSV completo en
memoria antes de responder. No modifica datos del estudio ni consulta GitHub durante la descarga.
Hay una fila por PR, en orden de muestra. El encabezado empieza exactamente por `pr_id,pr_url`;
cada participante incluido aporta, en orden ordinal persistido, estas columnas:
`categoria_usuario_N`, `descripcion_categoria_usuario_N` y
`comentario_clasificacion_usuario_N`. `N` conserva el ordinal de origen, incluso si hay huecos por
participantes no incluidos. Con dos participantes hay 8 columnas; con tres, 11.

`pr_id` es el ID de la tarjeta de origen y `pr_url` usa la URL efectiva persistida. Una
clasificación aporta nombre de categoría, definición y comentario en campos separados. Un
descarte aparece como `DESCARTADO` y deja descripción y comentario vacíos. También quedan vacías
las definiciones y comentarios opcionales ausentes. El archivo no contiene participantes
incompletos, motivos de descarte, categorías sin uso ni métricas de progreso.

La salida es UTF-8, separada por comas, con quoting RFC 4180 y terminaciones CRLF. Comas,
comillas, saltos de línea y Unicode se conservan mediante el escape CSV. Los valores textuales que
empiezan con un prefijo interpretable como fórmula, incluso tras espacios iniciales, reciben un
apóstrofo protector solo en la salida; la base de datos conserva el original.

La respuesta correcta es `text/csv; charset=utf-8`, con nombre
`pr-classifications.csv`, `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff`.

## Comando retirado y preservación

El comando `export:study`, el paquete `results.csv`/`categories.csv`/`manifest.json` y el secreto
HMAC exclusivo de ese exportador fueron retirados. No existe un comando offline alternativo ni una
vía para reconstruir ese paquete. No restaures instrucciones antiguas como solución operativa.
Los backups operativos y los archivos históricos ya descargados se conservan sin cambios.

## Evidencia pendiente

No presentes la existencia de este runbook o de rutas como evidencia runtime. Backup y restore
externos verificables, E2E hostil histórico, E2E completo en VPS o entorno público, cierre
documental histórico y captura live de GitHub siguen teniendo su estado de evidencia independiente.
