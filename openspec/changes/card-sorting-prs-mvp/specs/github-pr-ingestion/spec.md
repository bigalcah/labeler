## MODIFIED Requirements

### Requirement: Importación robusta del CSV

El sistema SHALL importar registros lógicos desde un CSV con encabezado, campos entrecomillados, comas internas, saltos de línea y JSON incrustado, sin confundir líneas físicas con registros.

#### Scenario: Importación de la muestra
- **WHEN** el investigador importa el CSV real con 300 registros válidos
- **THEN** el sistema crea exactamente 300 tarjetas y muestra un resumen de importación

#### Scenario: Fila inválida
- **WHEN** una fila tiene JSON inválido o carece de `card_id` y URL suficientes
- **THEN** el sistema registra el error de esa fila y no crea una tarjeta parcial silenciosamente

### Requirement: Importación idempotente

El sistema MUST reutilizar una tarjeta existente solo cuando `source_card_id` y el contenido canónico coinciden. Un cambio de contenido o checksum para un ID existente MUST fallar sin actualizar, borrar ni sobrescribir la tarjeta o sus clasificaciones.

#### Scenario: Reimportación idéntica
- **WHEN** se ejecuta de nuevo el bootstrap con el mismo CSV
- **THEN** conserva una sola tarjeta por `source_card_id`, conserva sus clasificaciones y deja la membresía sin duplicados

#### Scenario: Reimportación
- **WHEN** se importa dos veces el mismo CSV sin cambios en su contenido canónico
- **THEN** el sistema conserva una sola tarjeta por `source_card_id` y no actualiza, borra ni reemplaza su procedencia o sus clasificaciones

#### Scenario: Conflicto canónico
- **WHEN** cambia el contenido de una fila con un `source_card_id` ya persistido
- **THEN** falla con un conflicto explícito y no ejecuta `UPDATE`, borrado ni reemplazo de datos clasificados

## ADDED Requirements

### Requirement: Validación completa antes de escribir

El sistema MUST leer y validar todo el CSV antes de iniciar cualquier escritura. Debe validar encabezado, comillas, campos multilinea, JSON incrustado, campos requeridos, unicidad de `source_card_id` y exactamente 300 IDs para este MVP.

#### Scenario: CSV válido
- **WHEN** el CSV contiene 300 registros lógicos válidos y IDs únicos
- **THEN** la validación termina antes de la transacción de persistencia y el bootstrap puede continuar

#### Scenario: Conteo incorrecto
- **WHEN** el CSV contiene menos o más de 300 IDs únicos
- **THEN** el bootstrap falla antes de escribir tarjetas o membresías y la web no queda lista

### Requirement: Bootstrap transaccional

El sistema MUST ejecutar la preparación de tarjetas y membresía en una única transacción, con rollback completo ante cualquier error y sin eliminación automática de datos previos.

#### Scenario: Error durante persistencia
- **WHEN** falla la creación de una tarjeta, reviewer o `study_card`
- **THEN** se revierte toda la transacción, se conserva el estado previo y el servicio permanece no listo

### Requirement: Readiness pública condicionada a la preparación coordinada

El sistema MUST validar completamente el CSV y el manifiesto de cuentas antes de iniciar escrituras. El orquestador SHALL mantener una única transacción coordinada: esta capability crea o reutiliza tarjetas y membresías, y después la fase de cuentas definida por `study-management` provisiona las cuentas ausentes vinculadas a las membresías ya existentes. La autenticación Argon2id y las sesiones PostgreSQL permanecen fuera del contrato de ingestión. La preparación solo SHALL confirmar `READY` después de validar ambas fases.

#### Scenario: Cuentas de participantes presentes
- **WHEN** la importación transaccional, las membresías y la fase de cuentas son válidas
- **THEN** la transacción confirma y el servicio puede avanzar hacia readiness interna y posterior exposición pública

#### Scenario: Falta una cuenta requerida
- **WHEN** falta una cuenta requerida o el manifiesto o una cuenta existente no cumple el contrato
- **THEN** se revierte la transacción coordinada, se conservan los datos anteriores y el despliegue permanece no listo

#### Scenario: Reejecución sin reimportación destructiva
- **WHEN** se repite la preparación con datos compatibles
- **THEN** conserva cuentas, hashes, versiones, tarjetas, membresías y clasificaciones existentes sin borrado, sobrescritura ni reset implícito

### Requirement: Propiedad del bootstrap

El sistema MUST reservar al bootstrap la importación CSV y la creación de `pr_cards` y `study_card`; las migraciones solo crean estructura y categorías o clasificaciones no se siembran.

#### Scenario: Arranque limpio
- **WHEN** PostgreSQL está saludable y el volumen no contiene datos del estudio
- **THEN** el bootstrap importa el CSV y crea la membresía canónica antes de anunciar readiness
