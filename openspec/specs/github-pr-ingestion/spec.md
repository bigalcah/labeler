# github-pr-ingestion Specification

## Purpose

Importar la muestra histórica de Pull Requests desde el CSV local y transformarla en tarjetas persistentes, dejando un contrato preparado para una fuente GitHub posterior.

## Requirements

### Requirement: Importación robusta del CSV
El sistema SHALL importar registros lógicos desde un CSV con encabezado, campos entrecomillados, comas internas, saltos de línea y JSON incrustado, sin confundir líneas físicas con registros.

#### Scenario: Importación de la muestra
- **WHEN** el investigador importa el CSV real con 300 registros válidos
- **THEN** el sistema crea exactamente 300 tarjetas y muestra un resumen de importación

#### Scenario: Fila inválida
- **WHEN** una fila tiene JSON inválido o carece de `card_id` y URL suficientes
- **THEN** el sistema registra el error de esa fila y no crea una tarjeta parcial silenciosamente

### Requirement: Importación idempotente
El sistema MUST reutilizar o actualizar una tarjeta cuando se importa nuevamente el mismo `card_id`, sin duplicarla.

#### Scenario: Reimportación
- **WHEN** se importa dos veces el mismo CSV
- **THEN** el sistema conserva una sola tarjeta por `card_id` y actualiza su procedencia de forma determinista

### Requirement: Contrato de proveedor de tarjetas
El sistema SHALL transformar cualquier fuente aceptada a un contrato de tarjeta que incluya resumen, evidencia, lenguaje, métricas disponibles, URL y procedencia.

#### Scenario: Proveedor CSV activo
- **WHEN** la tarjeta se crea desde el CSV
- **THEN** su `source_type` indica `CSV` y el payload original queda conservado

#### Scenario: Proveedor GitHub futuro
- **WHEN** una futura fuente GitHub produce una tarjeta con el mismo contrato
- **THEN** el explorador puede consumirla sin cambiar la estructura de la vista

### Requirement: Fuente GitHub inactiva durante el MVP
El sistema MUST realizar la demostración únicamente con datos locales y no debe consultar GitHub desde el navegador ni exigir credenciales GitHub para importar el CSV.

#### Scenario: Clasificación sin red externa
- **WHEN** un participante navega y clasifica una tarjeta importada
- **THEN** la aplicación usa los datos persistidos y no realiza una solicitud GitHub

### Requirement: Lenguaje informado por la fuente
El sistema SHALL conservar y mostrar el campo `language` del CSV, identificándolo como lenguaje informado por la fuente y sin calcular todavía una distribución por archivos.

#### Scenario: Lenguaje disponible
- **WHEN** una fila contiene `language = Go`
- **THEN** la tarjeta muestra `Go` como lenguaje del dataset

#### Scenario: Lenguaje ausente
- **WHEN** una fila no contiene lenguaje
- **THEN** la tarjeta muestra un estado de dato no disponible y no inventa un valor
