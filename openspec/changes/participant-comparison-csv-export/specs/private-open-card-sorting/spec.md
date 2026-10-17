## Reemplazo del contrato histórico de exportación offline

Esta especificación reemplaza para el MVP únicamente `Exportación offline y gate de
finalización` de
`openspec/changes/card-sorting-prs-mvp/specs/study-management/spec.md` y
`Exportación offline privada y completa` de
`openspec/changes/card-sorting-prs-mvp/specs/private-open-card-sorting/spec.md`.
Esos requisitos pertenecen a artefactos históricos de cambio, no a las especificaciones
principales. Se conservan intactos; cualquier sincronización posterior debe preservar la
excepción de privacidad estrecha de la descarga autorizada definida aquí.

## MODIFIED Requirements

### Requirement: Categorías privadas por participante

El sistema SHALL permitir crear, renombrar y reutilizar categorías planas asociadas al
participante autenticado por la sesión de servidor validada. No SHALL usar un participante
seleccionado por el cliente ni compartir categorías con otros participantes, excepto en
la descarga comparativa autorizada y limitada a quienes completaron el mismo estudio.

#### Scenario: Categorías similares

- **WHEN** dos participantes crean `Missing tests` y `Falta de pruebas`
- **THEN** el sistema conserva dos categorías independientes y cada una solo aparece a su
  creador en páginas ordinarias y solicitudes no autorizadas

#### Scenario: Categorías exportadas con autorización

- **WHEN** una sesión autenticada solicita una descarga comparativa que supera el gate
- **THEN** el archivo contiene las categorías planas originales solo de participantes
  completados del mismo estudio y no las publica en otras páginas

### Requirement: Clasificación con observación opcional

El sistema SHALL permitir guardar una observación textual junto a la categoría sin exigir
confianza ni resultados especiales. SHALL mantenerla oculta para otros participantes en
páginas ordinarias y solicitudes no autorizadas, salvo en la descarga comparativa
autorizada para participantes completados del mismo estudio.

#### Scenario: Observación de causa

- **WHEN** el participante autenticado clasifica un PR y escribe una observación
- **THEN** la observación queda asociada a su clasificación y permanece oculta para los
  demás participantes en páginas ordinarias y solicitudes no autorizadas

#### Scenario: Observación exportada con autorización

- **WHEN** una clasificación de un participante completado aparece en una descarga
  autorizada
- **THEN** se incluye su comentario sin exponerlo en páginas ni descargas no autorizadas

### Requirement: Aislamiento del flujo local

Las rutas de clasificación MUST derivar participante y estudio de la sesión validada por
el servidor. No SHALL ofrecer selector de participante ni selector de estudio. Categorías
y clasificaciones ajenas SHALL permanecer privadas fuera de la descarga comparativa
autorizada.

#### Scenario: Cambio de participante

- **WHEN** una petición de clasificación o descarga proporciona en el cliente una
  identidad de participante distinta de la sesión
- **THEN** el servidor ignora ese valor o rechaza la petición y conserva el ámbito de la
  sesión validada

#### Scenario: Selector de estudio falsificado

- **WHEN** una petición de descarga proporciona un estudio distinto del asociado a la
  sesión
- **THEN** el servidor ignora ese valor o rechaza la petición y limita la lectura al estudio
  de la sesión

## ADDED Requirements

### Requirement: Privacidad de la descarga comparativa

El sistema MUST limitar el CSV a bloques de participantes que hayan completado todas las
tarjetas canónicas persistidas del mismo estudio que el solicitante, exactamente 30 o 300
según su configuración y con exactamente una decisión terminal por tarjeta. SHALL excluir
por completo columnas, decisiones, progreso, contadores e identidades de participantes
incompletos. No SHALL incluir catálogo de categorías sin uso ni razones de descarte. Solo
una clasificación `CLASSIFIED` con exactamente una categoría plana puede aparecer como
categoría; una decisión `DISCARDED` SHALL aparecer como `DESCARTADO` con definición y
observación vacías. La definición SHALL distinguirse de la observación y ocupar una
columna separada. Las categorías similares SHALL permanecer separadas, sin normalización
ni fusión.

#### Scenario: Participante incompleto omitido por completo

- **WHEN** hay participantes incompletos y el solicitante y otra persona completaron
- **THEN** el CSV no contiene columnas, valores, nombres, progreso ni contadores que
  revelen a las personas incompletas

#### Scenario: Categoría existente sin uso

- **WHEN** existe una categoría que no usa ninguna clasificación incluida
- **THEN** el CSV no añade catálogo ni columna para esa categoría

#### Scenario: Descarte sin razón exportable

- **WHEN** una persona incluida descarta una tarjeta con razón o metadatos asociados
- **THEN** el CSV muestra solo `DESCARTADO` en su celda de categoría y deja vacías
  descripción y comentario

#### Scenario: Definición y observación distintas

- **WHEN** una categoría tiene definición y su clasificación tiene observación
- **THEN** aparecen en `descripcion_categoria_usuario_N` y
  `comentario_clasificacion_usuario_N`, respectivamente

### Requirement: Nombres de columnas y orden de participantes

El CSV SHALL contener solo `pr_id,pr_url` y, por participante incluido, el bloque exacto
`categoria_usuario_N,descripcion_categoria_usuario_N,comentario_clasificacion_usuario_N`.
Los bloques SHALL seguir el orden ordinal persistido. `N` SHALL ser un pseudónimo ordinal
estable, basado en el orden persistido y no en login, nombre real, HMAC ni identificador de
cuenta. SHALL conservar el ordinal de origen al omitir participantes, sin renumerar a los
restantes. El ordinal no SHALL presentarse como anonimización criptográfica.

#### Scenario: Bloques de participantes incluidos

- **WHEN** se genera una descarga con dos participantes completados
- **THEN** tras `pr_id,pr_url` aparecen exactamente dos bloques con ordinales persistidos y
  sin identidad real

#### Scenario: Participante omitido entre incluidos

- **WHEN** el orden persistido contiene A, B y C, y solo A y C completaron
- **THEN** los ordinales de A y C conservan su posición de origen sin renumerar ni
  identificar a B

### Requirement: Retirada del exportador anterior

El sistema SHALL retirar el comando de operador `export:study`, su entrada de paquete, el
flujo de entrada exclusivo, el paquete de `results.csv`, `categories.csv` y `manifest.json`,
y la dependencia HMAC usada por ese exportador. No SHALL mantener compatibilidad ni otra
forma de exportar el estudio. No existía un endpoint HTTP de exportación HMAC que deba
retirarse. Los backups operativos y archivos históricos ya descargados SHALL permanecer
intactos.

#### Scenario: Exportador anterior no disponible

- **WHEN** se intenta usar el comando o paquete de exportación anterior
- **THEN** el sistema no lo ofrece ni lo genera como alternativa al CSV comparativo

#### Scenario: Artefactos históricos conservados

- **WHEN** se retira el exportador anterior
- **THEN** los backups operativos y archivos históricos ya descargados permanecen intactos
