## MODIFIED Requirements

### Requirement: Progreso independiente

El sistema SHALL mostrar el avance del participante autenticado sin mostrar categorías,
respuestas ni progreso de los demás. La única excepción es la descarga comparativa
autorizada definida por este cambio, que solo puede incluir participantes que completaron
todas las tarjetas canónicas de su mismo estudio.

#### Scenario: Avance parcial

- **WHEN** un participante ha completado 25 tarjetas
- **THEN** ve 25 completadas y las restantes pendientes, sin revelar el avance de otra
  persona

#### Scenario: Comparación mediante descarga autorizada

- **WHEN** una sesión vigente solicita una descarga comparativa elegible desde su estudio
- **THEN** solo se incluyen decisiones de participantes que completaron ese mismo estudio
  y no se revela el progreso ni los datos de personas incompletas

## ADDED Requirements

### Requirement: Aislamiento por sesión de participante y estudio

Las rutas y vistas SHALL derivar participante y estudio de la sesión de servidor validada.
No SHALL ofrecer selector de participante, selector de estudio ni rol administrativo para
la comparación. Las rutas de clasificación SHALL operar sobre la identidad autenticada de
la sesión y mantener categorías y clasificaciones de otros participantes privadas,
excepto en la descarga comparativa autorizada.

#### Scenario: Valores de ámbito falsificados por el cliente

- **WHEN** una petición de clasificación o descarga envía un participante o estudio
  distinto del asociado a la sesión
- **THEN** el servidor ignora esos valores o rechaza la petición y conserva el ámbito de
  la sesión validada

### Requirement: Elegibilidad de la exportación comparativa

El sistema MUST permitir descargar la comparación solo cuando el solicitante haya
completado todas las tarjetas canónicas persistidas del estudio de su sesión, exactamente
30 o 300 según su configuración, con exactamente una decisión terminal por tarjeta:
`CLASSIFIED` o `DISCARDED`. Debe haber otra persona distinta que también haya completado
esas tarjetas del mismo estudio. No cuentan estados parciales ni porcentajes redondeados.
Una decisión `CLASSIFIED` tiene exactamente una categoría plana. El servidor SHALL volver
a comprobar identidad, estudio, elegibilidad y finalización al atender la descarga.
El estudio SHALL estar `READY` y conservar una membresía válida con su conteo persistido.

#### Scenario: Solicitante y otra persona completaron

- **WHEN** el solicitante y al menos otra persona distinta completaron todas las tarjetas
  canónicas persistidas de ese mismo estudio
- **THEN** el servidor autoriza la descarga limitada a quienes completaron ese estudio

#### Scenario: Solicitante incompleto con otras dos personas completas

- **WHEN** otras dos personas completaron el estudio, pero al solicitante le falta una
  decisión terminal
- **THEN** el servidor deniega la descarga y no emite archivo

#### Scenario: Cobertura exacta de 30 o 300 tarjetas

- **WHEN** faltan decisiones para una de las 30 o 300 tarjetas canónicas aunque un
  porcentaje redondeado muestre 100 %
- **THEN** el servidor considera incompleto al participante y no lo cuenta para el gate

#### Scenario: Completados de otro estudio

- **WHEN** otras personas completaron un estudio distinto del asociado a la sesión
- **THEN** no satisfacen el mínimo de dos personas completas del estudio solicitado

#### Scenario: Solo el solicitante completó

- **WHEN** el solicitante completó el estudio y ninguna otra persona distinta lo completó
- **THEN** el servidor deniega la descarga y no emite archivo

#### Scenario: Estudio no preparado

- **WHEN** el estudio de la sesión no está `READY` o su membresía no coincide con el conteo persistido
- **THEN** el servidor responde 409 sin archivo, aunque existan decisiones terminales

### Requirement: Estado de la descarga comparativa

El sistema SHALL mostrar una vista autenticada en `GET /export`, con estado recalculado al
cargarla y después de recargar. La vista SHALL derivar el estudio y el participante de la
sesión validada. No SHALL ofrecer selectores ni funciones administrativas.

#### Scenario: Sesión anónima

- **WHEN** una persona sin sesión válida solicita `GET /export`
- **THEN** el servidor responde 401 y no presenta estado ni datos del estudio

#### Scenario: Solicitante incompleto

- **WHEN** al solicitante le faltan decisiones terminales
- **THEN** la vista muestra solo una instrucción para que complete sus tarjetas, sin nombres,
  conteos ni progreso de otros participantes

#### Scenario: Solicitante completo esperando otra persona

- **WHEN** el solicitante completó todas sus tarjetas y todavía no hay otra persona elegible
- **THEN** la vista indica que la comparación aún no está disponible, sin detalles de otras
  personas ni sus datos

#### Scenario: Comparación disponible

- **WHEN** el solicitante y al menos otra persona distinta completaron el mismo estudio
- **THEN** la vista muestra el botón de descarga y solo la cantidad de participantes
  completados que se incluirán y el tamaño configurado de la muestra

#### Scenario: Generación de archivo

- **WHEN** el usuario activa la descarga
- **THEN** el botón queda deshabilitado y marcado `aria-busy`, y una región viva anuncia
  estado indeterminado sin mover el foco ni mostrar porcentajes ficticios

#### Scenario: Descarga iniciada o error recuperable

- **WHEN** el navegador recibe un CSV válido o una respuesta de error
- **THEN** la vista indica que la descarga se inició, no que se guardó, o presenta un error
  recuperable con opción de reintento y permite volver a solicitar el estado

#### Scenario: Otra persona completa mientras el solicitante espera

- **WHEN** el solicitante ya completo espera, otra persona termina ese mismo estudio y el solicitante recarga
- **THEN** el estado se recalcula y muestra la acción disponible para incluir a ambas personas completas

### Requirement: Respuesta segura de exportación comparativa

El sistema SHALL servir la vista de estado mediante `GET /export`, protegido por sesión,
y la descarga mediante `POST /export/download`, protegido además por validación de origen y CSRF.
La validación de origen SHALL ocurrir antes de procesar la acción POST. Una
petición de descarga SHALL usar solo identidad y estudio de la sesión; un estado de interfaz
no sustituye la comprobación del servidor.

#### Scenario: Sesión ausente o vencida

- **WHEN** una petición con origen válido llega sin sesión vigente
- **THEN** el servidor responde 401 y no crea un adjunto ni contenido CSV

#### Scenario: Origen o CSRF inválido

- **WHEN** una petición usa origen no válido o una sesión válida con token CSRF incorrecto
- **THEN** el middleware de origen o CSRF responde 403 antes de generar la descarga

#### Scenario: Gate de elegibilidad incumplido

- **WHEN** una sesión válida pasa origen y CSRF pero no cumple el gate de finalización
- **THEN** el servidor responde 403 sin cabecera de adjunto ni contenido CSV

#### Scenario: Datos persistidos inválidos

- **WHEN** la muestra o una referencia de categoría no satisface el contrato de datos
- **THEN** el servidor responde 409 sin publicar CSV ni adjunto parcial

#### Scenario: Error interno

- **WHEN** falla internamente la lectura o generación
- **THEN** el servidor responde 500 con error sanitizado, sin SQL, stack, secretos ni
  contenido CSV en respuesta o logs

#### Scenario: Respuesta válida y verificación en cliente

- **WHEN** la generación completa y la respuesta es satisfactoria
- **THEN** el servidor entrega un adjunto UTF-8 privado con `no-store` y `nosniff`, y el
  cliente solo crea una descarga tras verificar éxito HTTP y tipo `text/csv`

#### Scenario: Respuesta HTML de login o error

- **WHEN** el cliente recibe HTML de login, una página de error o cualquier respuesta no
  satisfactoria en lugar del CSV
- **THEN** no lo convierte en Blob ni lo descarga como archivo CSV

### Requirement: Descarga CSV comparativa consistente

El sistema MUST producir un CSV de una instantánea consistente de tarjetas canónicas y
participantes completos del estudio de sesión. La primera fila SHALL contener
`pr_id,pr_url`; después SHALL aparecer, en orden ordinal persistido, un bloque de
`categoria_usuario_N`, `descripcion_categoria_usuario_N` y
`comentario_clasificacion_usuario_N` por participante incluido. `N` SHALL ser un ordinal
estable desde 1, sin nombres, logins ni identificadores reales; no SHALL renumerar
participantes omitidos. Cada fila SHALL representar una tarjeta canónica en orden de
muestra; `pr_id` SHALL ser `source_card_id` y `pr_url` SHALL ser la URL efectiva persistida
de la promoción preparada o, si falta, la URL del CSV de origen. No se SHALL consultar la
red durante la descarga.

#### Scenario: Matriz de tamaños y participantes

- **WHEN** se descarga cada combinación elegible de 30 tarjetas con dos o tres personas y
  300 tarjetas con dos o tres personas
- **THEN** el CSV tiene respectivamente 30 o 300 filas y 8 u 11 columnas según el número
  de participantes incluidos

#### Scenario: Orden persistido con hueco

- **WHEN** el orden persistido es A, B, C y solo A y C completaron
- **THEN** los bloques usan los ordinales originales de A y C y no renumeran ni identifican
  a B

#### Scenario: URL efectiva sin consulta en vivo

- **WHEN** una tarjeta tiene URL persistida por la promoción preparada
- **THEN** se exporta esa URL, o la URL del CSV de origen si falta, sin llamada a red

### Requirement: Representación de decisiones y textos opcionales

El CSV SHALL incluir una fila por tarjeta canónica de la muestra, también si todas las
personas incluidas la descartan. `DISCARDED` SHALL aparecer como `DESCARTADO`, con
descripción y comentario vacíos. `CLASSIFIED` SHALL exportar la categoría plana original,
su definición y la observación de clasificación en columnas separadas. Textos opcionales
nulos SHALL ser celdas vacías. La protección contra fórmulas SHALL anteponer apóstrofo a
valores textuales que comiencen con `=`, `+`, `-`, `@`, tabulador, CR o LF, o cuyo primer
carácter significativo tras espacios iniciales sea uno de ellos, antes del escape CSV y
solo en la salida.

#### Scenario: Descarte y textos nulos

- **WHEN** una persona incluida descarta la tarjeta o una clasificación carece de
  definición u observación
- **THEN** el descarte muestra solo `DESCARTADO` y los textos nulos se representan en sus
  propias celdas vacías

#### Scenario: Categorías independientes y páginas ordinarias

- **WHEN** dos participantes crean categorías similares o una clasificación contiene una
  observación
- **THEN** las categorías siguen siendo independientes y cada observación permanece
  privada en las páginas ordinarias y en solicitudes no autorizadas

#### Scenario: Categoría y observación en descarga autorizada

- **WHEN** una clasificación de una persona incluida aparece en una descarga autorizada
- **THEN** definición y observación ocupan sus columnas distintas sin normalizar ni fusionar
  categorías

#### Scenario: Texto interpretable como fórmula

- **WHEN** un valor textual comienza con un prefijo peligroso, incluso tras espacios
- **THEN** la salida antepone un apóstrofo antes del escape y la persistencia no cambia

### Requirement: Formato CSV descargable

El sistema MUST emitir UTF-8 separado por comas conforme a RFC 4180, con registros CRLF
y escape correcto de comillas, comas y campos multilínea. SHALL conservar texto Unicode.

#### Scenario: Texto con caracteres CSV y Unicode

- **WHEN** categoría, definición o comentario contiene comas, comillas, saltos de línea o
  Unicode
- **THEN** el CSV conserva el texto escapado y puede analizarse sin desplazar columnas

### Requirement: Instantánea y publicación íntegra

El sistema MUST fijar cabeceras y filas desde el mismo snapshot de membresía elegible,
tarjetas y decisiones. Solo SHALL publicar el adjunto privado y no cacheable cuando el CSV
esté completo. Si falla la generación, no SHALL entregar bytes CSV ni un adjunto parcial.

#### Scenario: Tercera persona completa antes del snapshot

- **WHEN** una tercera persona completa todas las tarjetas antes de fijarse el snapshot
- **THEN** se incluye en cabeceras y filas de esa descarga si pertenece al mismo estudio

#### Scenario: Tercera persona completa después del snapshot

- **WHEN** una tercera persona completa después de fijarse el snapshot de una descarga
- **THEN** queda enteramente excluida de esa respuesta y puede aparecer en una solicitud
  posterior

#### Scenario: Error antes de completar el archivo

- **WHEN** falla la generación antes de completar el CSV
- **THEN** no se publica adjunto ni byte CSV parcial
