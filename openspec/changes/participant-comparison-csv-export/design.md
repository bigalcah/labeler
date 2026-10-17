## Context

La motivación, el cambio funcional y sus límites están en `proposal.md`; este documento
concreta el diseño técnico, la descarga y su interfaz sin repetir ese argumento. La
aplicación es Express con rutas por archivos, EJS y PostgreSQL. `app.js` instala la sesión
y la seguridad de mutaciones antes del router. `requireStudySession` ya responde `401`
cuando falta el contexto autenticado.

La superficie visual existente es la tarjeta de inicio en `views/index.ejs`, los enlaces de
`views/partials/header.ejs` y los paneles de `views/progress.ejs`, con Bootstrap y estilos
locales en `public/css/main.css`. Se conserva esa gramática, incluida la tipografía y el
color; no se crea marca, sistema visual, mockup ni componente nuevo en este cambio. El
contenido de la página usa el scroll normal del documento, sin paneles con scroll propio.
Para la estructura se aplican, adaptados a la cuadrícula y al contenedor Bootstrap
existentes, los patrones espaciales [card-grid](https://github.com/changeroa/StyleGallery/blob/main/patterns/grid-repetition/card-grid.md),
[page-grid](https://github.com/changeroa/StyleGallery/blob/main/patterns/grid-repetition/page-grid.md)
y [box](https://github.com/changeroa/StyleGallery/blob/main/patterns/containment/box.md).

## Goals / Non-Goals

**Goals:**

- Autorizar la comparación solo para una sesión válida cuyo participante haya completado
  todas las tarjetas canónicas y cuyo estudio tenga al menos otro participante completo.
- Producir una sola tabla CSV con las decisiones terminales de participantes completos en
  una única instantánea de solo lectura.
- Ofrecer una página SSR accesible que explique la disponibilidad privada e inicie la
  descarga sin revelar el estado de quienes no completaron.

**Non-Goals:**

- Selector de estudio o participante, interfaz administrativa, vista previa de categorías,
  progreso ajeno, exportación JSON ni llamada GitHub desde la aplicación.
- Conservar el comando de exportación offline, el paquete de tres archivos o compatibilidad con su contrato anterior.
- Migración de base de datos, nueva dependencia, cambios en backups o manifests operativos
  y cambios en la canalización de release.

## Decisions

### 1. Identidad, elegibilidad e instantánea

`GET /export` y `POST /export/download` derivan `study_id` y participante exclusivamente
de la sesión validada con `requireStudySession`. No leen IDs de participante o estudio de
URL, query, formulario ni cabeceras. GET requiere sesión, pero no CSRF. El POST reutiliza
el middleware global de `app.js`: primero valida `Origin` y CSRF y después requiere la
sesión. La alternativa de aceptar un selector del cliente se descarta porque permitiría
cambiar el ámbito de acceso.

Para disponibilidad GET, usar una lectura de solo lectura para el estudio, la membresía
y la elegibilidad. Para POST, usar un solo cliente conectado y una transacción
`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. La instantánea queda fijada en la
primera consulta de esa transacción; leer en ella el estudio `READY`, conteo, membresía,
ordinales y decisiones terminales. Solo tras aprobar el gate cargar las decisiones,
definiciones y comentarios de participantes completos. Construir el CSV entero antes de
confirmar la transacción e iniciar la respuesta. No escribir datos del estudio ni archivos;
se permiten los efectos normales del middleware de sesión.

Un participante está completo únicamente si cada tarjeta canónica persistida, 30 o 300
según el estudio, tiene exactamente una decisión terminal: `CLASSIFIED` o `DISCARDED`.
No usar porcentajes redondeados. El solicitante y al menos otra persona del mismo estudio
deben estar completos. El estado GET es solo indicativo; POST vuelve a validar el gate.
Quien termina antes de fijarse el snapshot POST se incluye; quien termina después queda
fuera de esa descarga y puede aparecer en la siguiente. No hay polling, reintento
automático ni WebSocket.

### 2. Contrato CSV

Emitir una fila por PR en el orden persistido de `study_card.ordinal`. El encabezado empieza
exactamente por `pr_id,pr_url`. Después agrega, en orden ascendente de
`study_participant.ordinal`, los grupos
`categoria_usuario_N,descripcion_categoria_usuario_N,comentario_clasificacion_usuario_N`.
`N` es el ordinal persistido más uno; nunca compactar números cuando se omite alguien
incompleto. Con los tres participantes configurados, dos completos producen 8 columnas y
tres producen 11.

- `pr_id`: `study_card.source_card_id`.
- `pr_url`: URL de los metadatos preparados o, si falta, `pr_cards.html_url` existente.
  No consultar GitHub durante la descarga.
- `categoria_usuario_N`: nombre `participant_category.raw_name` para una clasificación o
  el literal `DESCARTADO` para un descarte.
- `descripcion_categoria_usuario_N`: `participant_category.definition`, repetida para cada
  PR clasificado de esa categoría.
- `comentario_clasificacion_usuario_N`: `pr_classification.remarks`.

Para un descarte, descripción y comentario quedan vacíos. Definiciones o comentarios
opcionales ausentes también quedan vacíos. No exportar motivos de descarte, categorías no
utilizadas, bloques de usuarios incompletos ni métricas de progreso.

Serializar como UTF-8, separador coma, terminaciones CRLF y quoting RFC 4180 para comas,
comillas y saltos de línea. Antes del quoting, tratar campos textuales como potenciales
fórmulas: si el primer carácter, o el primero tras espacios iniciales, es `=`, `+`, `-`,
`@`, TAB, CR o LF, anteponer una sola comilla simple protectora. El resto del texto no
cambia y el valor original de la base de datos se conserva sin modificar.

La alternativa de nombres, usernames o pseudónimos HMAC se descarta: `usuario_N` identifica
la posición configurada, no una identidad real, y no requiere secreto. Esa estabilidad
implica que un ordinal omitido deja un hueco visible en los nombres de columna.

### 3. Rutas, respuestas y transporte

`GET /export` renderiza con EJS la disponibilidad actual del participante y es de solo
lectura, salvo los efectos normales del middleware de sesión. Requiere sesión y no CSRF.
`POST /export/download` pasa primero por validación de origen y CSRF, luego por sesión,
reautoriza y devuelve CSV solo si el gate sigue satisfecho.

- Sesión ausente o caducada con origen válido: `401`, sin archivo. El cliente muestra
  **“Your session has expired. Log in to continue.”** y un enlace accesible a Login. No
  prometer una redirección.
- Origen no válido, CSRF incorrecto o gate no satisfecho: `403`, sin archivo. El cliente
  vuelve a consultar `GET /export` tras un gate fallido, sin repetir el POST.
- Membresía, decisión o categoría inconsistente: `409`, con error genérico y reintento
  manual.
- Error de almacenamiento o interno: `500` sanitizado, con el mismo error genérico. No
  usar el renderizador global de `app.js`, que incorpora `err.message`.

La página GET, los errores y la respuesta CSV llevan `Cache-Control: private, no-store`.
La respuesta exitosa conserva `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="pr-classifications.csv"` y
`X-Content-Type-Options: nosniff`. El cliente envía POST same-origin con el token CSRF de
sesión, verifica éxito HTTP y tipo antes de crear un `Blob`, y luego crea y revoca su object
URL. Una respuesta de error HTML nunca se descarga como CSV.

### 4. Entrada, panel y estados de interfaz

La tarjeta `Export` aparece para cada participante autenticado, aunque todavía no sea
elegible; así puede encontrar sus propias instrucciones. Va después de `Progress` en la
cuadrícula actual y abre `/export`. Añadir el enlace `Export` a la navegación existente y
marcarlo activo en esa ruta. Se elige página dedicada, no modal ni panel desplegado en
Home, porque tiene estados, errores y una acción de descarga que deben funcionar con
navegación, recarga y teclado normales.

```text
Home:  [ PR cards ]  [ Progress ]  [ Export ]
                                      |
                                      v
+----------------------------------------------+
| Export                                       |
| [State-specific copy]                        |
|                                              |
| [ Download CSV ]              (ready only)   |
+----------------------------------------------+
```

La página usa el mismo `container py-3`, jerarquía de título, tarjeta/panel y controles
Bootstrap que Progress. La tarjeta nueva respeta la secuencia DOM: una columna en móvil y
las columnas definidas por la cuadrícula de Home en anchos mayores. No añadir iconografía,
colores, marca o decoración nueva. Mantener los estados comprensibles sin depender solo
del color.

Mostrar solo el copy del estado pertinente, en inglés como el resto de la aplicación:

- Solicitante incompleto, sin información de otras personas:
  **“Complete all of your assigned cards in PR cards, then return here.”**
- Solicitante completo, sin otra persona completa:
  **“Your work is complete. The export will be available when at least one other participant
  in this study has completed all assigned cards.”** No mostrar identidades ni cantidades
  de participantes incompletos.
- Descarga disponible:
  **“Only participants who have completed all assigned cards are included. The CSV contains
  PR IDs and URLs, and each included participant’s category, description, and comment.
  Discarded cards are marked DESCARTADO.”** Mostrar un botón **“Download CSV”**. Si se
  muestra una cantidad, contar únicamente a participantes incluidos.
- Generando: desactivar el botón para evitar doble envío y anunciar
  **“Preparing your download…”**. El tiempo es indeterminado; no mostrar porcentaje.
- Respuesta recibida y descarga iniciada en el navegador:
  **“Download started. Check your browser’s downloads. The file may not be saved yet.”**
  No afirmar que se guardó.
- Error `409`/`500`: **“We couldn’t prepare the export. Please try again.”** El reintento
  es manual.

La página y las rutas de descarga no muestran nombre de estudio ni permiten elegirlo. No
renderizar estado, nombre, cantidad o placeholder de una persona incompleta. Las decisiones
y textos de participantes completos solo aparecen en el CSV autorizado.

### 5. Accesibilidad

Usar un `h1` `Export`, una sección con nombre accesible, enlaces y botón nativos y el orden
normal del DOM. El botón debe funcionar con Tab, Enter y Space, con foco visible. Durante
la solicitud, indicar `aria-busy="true"` en el panel y anunciar carga/resultado en una
región `role="status"` con `aria-live="polite"` y `aria-atomic="true"`; exponer errores
con `role="alert"`. No mover el foco por cambios de estado. La espera tiene texto y no
comunica porcentajes falsos. Si usa movimiento, respetar `prefers-reduced-motion`.

La aceptación de interfaz futura incluye anchos 375, 768 y 1280 px, teclado sin mouse y
lectura con lector de pantalla: orden de foco, anuncio de carga, inicio, error y expiración
de sesión, sin desplazamiento horizontal, controles cortados ni saltos de foco.

## Risks / Trade-offs

- La descarga autorizada es una excepción explícita a la privacidad habitual. Limitarla al
  mismo estudio, exigir dos finalizaciones completas y excluir bloques incompletos. No
  escribir CSV, comentarios o categorías en logs.
- Los textos de categoría y comentario no son confiables. RFC 4180 no evita fórmulas;
  aplicar y probar el prefijo simple en valores peligrosos, incluidos espacios iniciales,
  TAB, CR y LF. La base conserva el texto original sin cambios.
- Encabezados variables revelan qué ordinales completaron, pero no nombres ni logins. Es el
  compromiso requerido; no presentar `usuario_N` como anonimización criptográfica.
- Una página puede quedar obsoleta mientras otra persona termina. Revalidar POST y fijar
  una única instantánea mantiene cada archivo coherente; cambios posteriores aparecen en
  solicitudes posteriores.
- El CSV completo se mantiene en memoria antes de responder para evitar descargas parciales
  y distinguir errores de archivos válidos. La muestra limita las filas a 30 o 300, aunque
  textos largos aumenten el buffer.

## Migration Plan

1. Después de la aprobación explícita para aplicar, crear una rama
   `feature/participant-comparison-csv-export` basada en `develop`. No implementar en
   `master`. Este artefacto solo planifica; no ejecuta migraciones, cambios de aplicación ni
   reconciliación de documentación histórica.
2. Implementar rutas protegidas, transacción read-only, gate exacto, serializador y errores
   saneados. No añadir migración ni dependencia. Limitar campos de request a CSRF; no aceptar
   IDs de estudio o participante.
3. Implementar SSR de `/export`, entrada en Home/navegación y POST same-origin a
   `/export/download`. Revalidar en POST, crear Blob solo para respuesta CSV y cubrir los
   estados, teclado y lector de pantalla descritos arriba.
4. Retirar `scripts/export-study.js`, `util/study-export-input.js`, `export:study` de
   `package.json` y contratos/configuración HMAC exclusivos. No mantener exportación offline
   paralela ni compatibilidad. Preservar backups operativos y archivos ya descargados.
5. Sustituir pruebas y harnesses del contrato anterior sin relajar otras protecciones:
   `test/runtime-interface-boundary.test.js`, `test/study-export.test.js`, caller CLI de
   `test/multi-study-hostile-e2e.integration.js`, bloque de exportación de
   `scripts/test-study-deployment.sh`, `test/deployment-harness-contract.test.js`,
   `scripts/check-study-documentation.js` y
   `test/study-documentation-check.test.js`. Actualizar documentación. Probar 30/300,
   8/11 columnas, carreras, sesión, CSRF/Origin, fórmulas, privacidad y errores sin archivo.
6. Ejecutar explícitamente el harness multiestudio hostil. `scripts/run-quality-gates.js` no
   sustituye esa comprobación: excluye casos del descubrimiento de unit tests y sus gates
   de integración/E2E apuntan a otros tests. Actualizar su invocación documentada sin
   cambiar el conjunto protegido de pruebas.
7. Mantener byte por byte los siete workflows de `.github/workflows/`, incluido
   `shared-validation.yml`, y `deployment/docker-compose.release.yml`. No modificar backups,
   manifests, workflows ni compose de release.
8. Esta delta reemplaza el contrato offline del MVP para esta implementación. No editar ni
   sincronizar ahora artefactos históricos o especificaciones principales. Cualquier
   reconciliación posterior debe conservar vigente el contrato browser y no reintroducir
   exportación offline.
9. Verificar interfaz en 375/768/1280 px, estados con teclado/lector de pantalla, anuncios
   `aria-busy`, foco estable, carga indeterminada y el copy “Download started”, sin afirmar
   que el archivo se guardó.

Rollback: volver a una versión aprobada de la aplicación compatible con el esquema actual;
no restaurar ni borrar la base de datos. El código anterior podría restaurar permisos de
exportación offline y requiere revisión antes de volver a habilitarlos. La versión nueva no
incluye una ruta de compatibilidad.
