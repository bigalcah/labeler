## MODIFIED Requirements

### Requirement: Importación robusta del CSV

El sistema SHALL importar registros lógicos desde un CSV con encabezado, campos entrecomillados, comas internas, saltos de línea y JSON incrustado, sin confundir líneas físicas con registros. La importación SHALL validar el conteo esperado persistido del estudio, que solo puede ser 30 o 300.

#### Scenario: Importación de la muestra
- **WHEN** el perfil del estudio actual importa el CSV canónico con 300 registros válidos
- **THEN** el sistema crea exactamente 300 tarjetas, conserva el orden de la fuente y muestra un resumen de importación

#### Scenario: Importación de la fixture de validación
- **WHEN** el perfil de validación importa la fixture determinista con 30 registros válidos
- **THEN** el sistema crea exactamente 30 tarjetas, conserva el orden de la fixture y muestra un resumen de importación

#### Scenario: Fila inválida
- **WHEN** una fila tiene JSON inválido o carece de `card_id` y URL suficientes
- **THEN** el sistema registra el error de esa fila y no crea una tarjeta parcial silenciosamente

### Requirement: Importación idempotente

El sistema MUST reutilizar una tarjeta existente solo cuando `source_card_id` y el contenido canónico coinciden con la fuente del estudio. Un cambio de contenido o checksum para un ID existente MUST fallar sin actualizar, borrar ni sobrescribir la tarjeta, su membresía o sus clasificaciones. La idempotencia SHALL estar acotada al `study_id` y a su conteo esperado persistido.

#### Scenario: Reimportación idéntica
- **WHEN** se ejecuta de nuevo el bootstrap de un perfil de 30 o 300 con el mismo CSV
- **THEN** conserva una sola tarjeta por `source_card_id`, conserva sus clasificaciones y deja la membresía sin duplicados

#### Scenario: Reimportación
- **WHEN** se importa dos veces el mismo CSV sin cambios en su contenido canónico
- **THEN** el sistema conserva una sola tarjeta por `source_card_id` y no actualiza, borra ni reemplaza su procedencia o sus clasificaciones

#### Scenario: Conflicto canónico
- **WHEN** cambia el contenido de una fila con un `source_card_id` ya persistido
- **THEN** falla con un conflicto explícito y no ejecuta `UPDATE`, borrado ni reemplazo de datos clasificados

## ADDED Requirements

### Requirement: Fixture de validación determinista

La fixture de validación SHALL derivarse exclusivamente del CSV canónico de 300 tarjetas mediante un selector reproducible y SHALL verificar el checksum SHA-256 aprobado `4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef`. SHALL contener exactamente 30 `source_card_id` únicos, seis tarjetas de cada agente `Copilot`, `Devin`, `OpenAI_Codex`, `Cursor` y `Claude_Code`, conservar las columnas de origen y registrar checksums y distribución sin depender de aleatoriedad, GitHub o muestras por participante.

#### Scenario: Selección estable
- **WHEN** se ejecuta el selector sobre el CSV canónico sin cambios
- **THEN** produce las mismas 30 filas, en el mismo orden, con seis tarjetas por cada agente requerido y un checksum estable

#### Scenario: Fuente modificada
- **WHEN** el checksum del CSV canónico no coincide con el checksum aprobado o falta un agente requerido
- **THEN** el selector falla antes de escribir la fixture o su manifiesto

### Requirement: Validación completa antes de escribir

El sistema MUST leer y validar todo el CSV antes de iniciar cualquier escritura. Debe validar encabezado, comillas, campos multilinea, JSON incrustado, campos requeridos, unicidad de `source_card_id` y exactamente el `expectedCardCount` persistido, que SHALL ser 30 o 300. La validación SHALL comprobar también el checksum y la pertenencia de la fixture de validación a la fuente canónica.

#### Scenario: CSV válido
- **WHEN** el CSV contiene el número esperado de registros lógicos válidos y IDs únicos para el estudio actual o de validación
- **THEN** la validación termina antes de la transacción de persistencia y el bootstrap puede continuar

#### Scenario: Conteo incorrecto
- **WHEN** el CSV contiene menos o más registros que el `expectedCardCount` persistido, o declara un conteo distinto de 30 o 300
- **THEN** el bootstrap falla antes de escribir tarjetas o membresías y la web no queda lista

### Requirement: Bootstrap transaccional

El sistema MUST ejecutar la preparación de tarjetas y membresía de cada estudio en una transacción, con rollback completo ante cualquier error y sin eliminación automática de datos previos. La preparación de varios perfiles SHALL ejecutar las transacciones en orden, después de validar todos los insumos y antes de permitir readiness pública.

#### Scenario: Error durante persistencia
- **WHEN** falla la creación de una tarjeta, reviewer o `study_card` de un perfil
- **THEN** se revierte la transacción de ese intento, se conserva el estado previo y el servicio permanece no listo

#### Scenario: Error del perfil posterior
- **WHEN** el perfil actual de 300 es compatible pero el perfil de validación de 30 falla después de su preflight
- **THEN** se detiene la preparación, no se borra ni reescribe el estudio actual y la aplicación y Caddy no quedan listos

### Requirement: Readiness pública condicionada a la preparación coordinada

El sistema MUST validar completamente los CSV, manifiestos, checksums, conteos admitidos, claves de estudio y mapeos de login antes de iniciar escrituras. El orquestador SHALL mantener la preparación coordinada: esta capability crea o reutiliza tarjetas y membresías para cada `study_id`, y después la fase de cuentas definida por `study-management` provisiona las cuentas ausentes vinculadas a las membresías ya existentes. La autenticación Argon2id y las sesiones PostgreSQL permanecen fuera del contrato de ingestión. La preparación solo SHALL confirmar cada `READY` después de validar ambas fases y SHALL permitir dos estudios `READY` distintos en una misma base.

#### Scenario: Cuentas de participantes presentes
- **WHEN** la importación transaccional, las membresías y la fase de cuentas son válidas para los perfiles de 300 y 30
- **THEN** las transacciones confirman, existen dos filas `READY` distintas y el servicio puede avanzar hacia readiness interna y posterior exposición pública

#### Scenario: Falta una cuenta requerida
- **WHEN** falta una cuenta requerida o el manifiesto o una cuenta existente no cumple el contrato
- **THEN** se revierte la preparación coordinada, se conservan los datos anteriores y el despliegue permanece no listo

#### Scenario: Reejecución sin reimportación destructiva
- **WHEN** se repite la preparación con datos compatibles
- **THEN** conserva cuentas, hashes, versiones, tarjetas, membresías y clasificaciones existentes sin borrado, sobrescritura ni reset implícito

### Requirement: Propiedad del bootstrap

El sistema MUST reservar al bootstrap la importación CSV y la creación de `pr_cards` y `study_card`; las migraciones solo crean estructura y categorías o clasificaciones no se siembran. El bootstrap SHALL aceptar únicamente las cardinalidades 30 y 300 y SHALL mantener la selección separada de cualquier captura GitHub live.

#### Scenario: Arranque limpio
- **WHEN** PostgreSQL está saludable y el volumen no contiene datos del estudio
- **THEN** el bootstrap importa el CSV del perfil, crea la membresía canónica de 30 o 300 tarjetas y solo después anuncia readiness

#### Scenario: Captura no autorizada
- **WHEN** una ruta web, una vista o el navegador intenta solicitar tarjetas a GitHub durante la clasificación
- **THEN** no se inicia ninguna llamada y la aplicación usa únicamente snapshots locales

### Requirement: Enriquecimiento GitHub opcional y preparado por estudio

El enriquecimiento GitHub SHALL ser opcional por perfil, ejecutarse solo mediante una preparación operator-only y cargar el `study_id`, `expectedCardCount`, checksum de fuente y membresía ordenada persistidos. La cobertura, los runs, snapshots, mappings, promoción y reportes SHALL exigir exactamente 30 o 300 tarjetas del estudio seleccionado. Las credenciales de solo lectura SHALL permanecer en la fase de preparación y nunca llegar al servidor web, navegador, logs o exportación.

#### Scenario: Perfil de 30 enriquecido
- **WHEN** el operador habilita GitHub para el estudio de validación
- **THEN** el run exige exactamente 30 mappings y snapshots compatibles con ese `study_id`, y solo se promociona tras completar la evidencia requerida

#### Scenario: Perfil de 300 enriquecido
- **WHEN** el operador habilita GitHub para el estudio actual
- **THEN** el run exige exactamente 300 mappings y snapshots compatibles y no altera la membresía ni la promoción existente si la cobertura falla

#### Scenario: Perfil CSV-only
- **WHEN** el operador prepara un perfil con enriquecimiento deshabilitado
- **THEN** la preparación no exige token GitHub, no crea un run promovido y deja disponible el estudio desde sus snapshots CSV

#### Scenario: Evidencia incompleta o cruzada
- **WHEN** un run usa el conteo equivocado, el checksum equivocado, otro estudio, páginas incompletas, pausa de cuota o autorización fallida
- **THEN** no se promociona, la preparación falla de forma no lista y se conserva la promoción previa
