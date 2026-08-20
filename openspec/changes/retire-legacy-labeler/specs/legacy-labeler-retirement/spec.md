## Purpose

Retirar de forma segura el clasificador legacy basado en instancias, labels globales, reviews, discards, conflictos y realtime, preservando el estudio MVP basado en tarjetas PR y categorias privadas.

## ADDED Requirements

### Requirement: Realtime legacy retirado

El sistema MUST dejar de depender de Socket.IO y de los eventos de labels globales para que el clasificador MVP funcione.

#### Scenario: Clasificacion privada sin realtime
- **WHEN** un participante crea o renombra una categoria privada
- **THEN** el cambio se persiste mediante el flujo HTTP y queda disponible para ese participante sin emitir eventos a otros participantes

#### Scenario: Dependencia retirada
- **WHEN** se construye y ejecuta el servidor despues del retiro legacy
- **THEN** no se carga Socket.IO ni se registran listeners o emisores de `label_added`, `label_removed` o `label_renamed`

### Requirement: Interfaces HTTP legacy retiradas

El sistema MUST retirar las rutas y vistas dedicadas exclusivamente a labels globales, merge/rename legacy y resolucion de conflictos legacy.

#### Scenario: Ruta legacy eliminada
- **WHEN** un cliente solicita una ruta exclusiva del clasificador legacy
- **THEN** la aplicacion no registra esa ruta y responde con el comportamiento HTTP de ruta inexistente

#### Scenario: Flujo MVP preservado
- **WHEN** un participante abre la cola, una tarjeta PR, categorias o progreso del estudio
- **THEN** las rutas MVP siguen disponibles y no dependen de labels globales, `instance_review_label` ni conflictos destructivos

### Requirement: Datos legacy preservados antes del retiro

El sistema MUST respaldar o exportar los datos legacy utiles antes de eliminar tablas, funciones, procedimientos, vistas o tipos persistentes.

#### Scenario: Respaldo no disponible
- **WHEN** la migracion de retiro no puede generar o verificar el respaldo requerido
- **THEN** la migracion falla antes de eliminar objetos o filas

#### Scenario: Retiro confirmado
- **WHEN** existe un respaldo verificable y no quedan consumidores runtime de los objetos legacy
- **THEN** la migracion puede eliminar los objetos legacy autorizados sin modificar las tablas del estudio MVP

### Requirement: Esquema MVP fuera del retiro

El sistema MUST conservar `reviewer`, `pr_cards`, `study`, `study_participant`, `study_card`, `participant_category` y `pr_classification`, junto con sus claves, indices y restricciones necesarias.

#### Scenario: Bootstrap posterior al retiro
- **WHEN** se ejecuta el bootstrap del estudio despues de retirar legacy
- **THEN** puede reutilizar o crear participantes, cargar 300 `pr_cards` y crear categorias y clasificaciones sin consultar tablas legacy retiradas

#### Scenario: Clasificacion posterior al retiro
- **WHEN** un participante clasifica una tarjeta PR
- **THEN** se conserva una clasificacion privada por participante y no se crea ningun registro en tablas de labels, reviews, discards o conflictos legacy

### Requirement: Fixtures legacy fuera del arranque

El sistema MUST dejar de montar y cargar `label.txt`, `reviewer.txt` e `instance.tsv` como datos de inicializacion del despliegue MVP.

#### Scenario: Volumen limpio
- **WHEN** se inicia Docker con un volumen PostgreSQL nuevo
- **THEN** el despliegue no carga filas legacy de labels o instancias y el bootstrap del estudio prepara los participantes y las tarjetas canonicas

#### Scenario: Volumen existente
- **WHEN** se inicia Docker con un volumen existente
- **THEN** no se eliminan automaticamente datos legacy ni clasificaciones MVP; el retiro requiere una migracion explicita y respaldada
