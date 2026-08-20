## Purpose

Importar de forma reproducible la muestra histórica local de 300 Pull Requests, proteger tarjetas existentes contra cambios de fuente y dejar un contrato preparado para una fuente GitHub posterior sin activarla.

## ADDED Requirements

### Requirement: Validación completa antes de escribir

El sistema MUST leer y validar todo el CSV antes de iniciar cualquier escritura. Debe validar encabezado, comillas, campos multilinea, JSON incrustado, campos requeridos, unicidad de `source_card_id` y exactamente 300 IDs para este MVP.

#### Scenario: CSV válido
- **WHEN** el CSV contiene 300 registros lógicos válidos y IDs únicos
- **THEN** la validación termina antes de la transacción de persistencia y el bootstrap puede continuar

#### Scenario: Conteo incorrecto
- **WHEN** el CSV contiene menos o más de 300 IDs únicos
- **THEN** el bootstrap falla antes de escribir tarjetas o membresías y la web no queda lista

### Requirement: Importación robusta del CSV

El sistema SHALL importar registros lógicos desde un CSV con encabezado, campos entrecomillados, comas internas, saltos de línea y JSON incrustado, sin confundir líneas físicas con registros.

#### Scenario: Fila inválida
- **WHEN** una fila tiene JSON inválido o carece de `card_id` y URL suficientes
- **THEN** el sistema registra el error de esa fila y no crea una tarjeta parcial silenciosamente

### Requirement: Reimportación protegida por checksum

El sistema MUST reutilizar una tarjeta existente solo cuando `source_card_id` y el contenido canónico coinciden. Un cambio de contenido o checksum para un ID existente MUST fallar sin actualizar, borrar ni sobrescribir la tarjeta o sus clasificaciones.

#### Scenario: Reimportación idéntica
- **WHEN** se ejecuta de nuevo el bootstrap con el mismo CSV
- **THEN** conserva una sola tarjeta por `source_card_id`, conserva sus clasificaciones y deja la membresía sin duplicados

#### Scenario: Conflicto canónico
- **WHEN** cambia el contenido de una fila con un `source_card_id` ya persistido
- **THEN** falla con un conflicto explícito y no ejecuta `UPDATE`, borrado ni reemplazo de datos clasificados

### Requirement: Bootstrap transaccional

El sistema MUST ejecutar la preparación de tarjetas y membresía en una única transacción, con rollback completo ante cualquier error y sin eliminación automática de datos previos.

#### Scenario: Error durante persistencia
- **WHEN** falla la creación de una tarjeta, reviewer o `study_card`
- **THEN** se revierte toda la transacción, se conserva el estado previo y el servicio permanece no listo

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

### Requirement: Propiedad del bootstrap

El sistema MUST reservar al bootstrap la importación CSV y la creación de `pr_cards` y `study_card`; las migraciones solo crean estructura y categorías o clasificaciones no se siembran.

#### Scenario: Arranque limpio
- **WHEN** PostgreSQL está saludable y el volumen no contiene datos del estudio
- **THEN** el bootstrap importa el CSV y crea la membresía canónica antes de anunciar readiness
