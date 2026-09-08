## Context

El repositorio contiene dos modelos que coexistieron durante la transicion: el clasificador legacy basado en `instance`, `label`, `instance_review`, `instance_discard`, conflictos y Socket.IO, y el MVP basado en `pr_cards`, `reviewer`, categorias privadas, clasificaciones y membresia de estudio. El MVP ya no necesita sincronizacion realtime porque cada participante consume y modifica sus propias categorias mediante HTTP y PostgreSQL.

El retiro no puede consistir solo en borrar rutas: los scripts SQL legacy crean vistas, funciones, procedimientos y foreign keys que también deben inventariarse. `reviewer` no es exclusivamente legacy porque las tablas MVP actuales lo referencian. Debe permanecer protegido mientras exista una dependencia estructural de membresías de estudio, categorías, clasificaciones o cuentas, no solo mientras funcione como identidad temporal.

## Goals / Non-Goals

**Goals:**

- Eliminar el realtime y los consumidores HTTP exclusivos del clasificador legacy.
- Retirar de forma controlada el esquema legacy que ya no tenga consumidores.
- Mantener operativo el bootstrap y el clasificador MVP durante y despues de la migracion.
- Preservar datos legacy utiles mediante un respaldo verificable antes de borrar objetos.
- Eliminar los mounts de fixtures legacy del despliegue MVP.

**Non-Goals:**

- No retirar `reviewer` mientras existan referencias estructurales desde membresías de estudio, categorías, clasificaciones o cuentas del MVP.
- No cambiar la privacidad, la taxonomia ni el modelo de categorias privadas del MVP.
- No añadir autenticacion, exportacion de estudio ni integracion GitHub.
- No borrar automaticamente filas de una base existente sin respaldo y confirmacion de migracion.

## Decisions

### 1. Inventario de consumidores antes de borrar

Se inspeccionaran rutas, vistas EJS, scripts SQL, exports y dependencias npm. Solo se retirara un objeto cuando no existan consumidores runtime o cuando la misma migracion retire todos sus consumidores. Las rutas `instances` que actualmente sirvan tarjetas PR se conservaran aunque su nombre sea legacy.

### 2. Eliminacion de Socket.IO

Se eliminara la inicializacion del servidor Socket.IO, sus eventos de labels globales, listeners de cliente y la dependencia npm. No se añadira un reemplazo realtime: categorias, clasificaciones y progreso del MVP usan solicitudes HTTP y persistencia PostgreSQL.

### 3. Frontera de datos

El bootstrap MVP sera el unico dueño de participantes, `pr_cards` y membresias de estudio. El despliegue dejara de montar `label.txt`, `reviewer.txt` e `instance.tsv`; los participantes se resolveran mediante la configuracion y las tablas de estudio.

### 4. Retiro SQL por fases

Primero se generará un respaldo externo compatible con `pg_dump`, junto con su manifiesto JSON y checksum conforme al contrato del runbook canónico. Después se retirarán consumidores runtime. Solo una migración posterior y explícita eliminará el tipo `conflict`, tablas, vistas, funciones y procedimientos que ya no tengan dependencias. Las foreign keys MVP hacia `reviewer` se conservarán mientras existan las referencias estructurales de membresías, categorías, clasificaciones o cuentas.

### 5. Compatibilidad y rollback

La migracion debe ejecutarse en una transaccion cuando el motor lo permita y utilizar una marca de version. Si falla el respaldo, el inventario de dependencias o la eliminacion, debe detenerse sin dejar el despliegue en un estado parcialmente retirado. La restauracion escribible se hara desde el respaldo y la version anterior de la aplicacion hacia una base de datos separada o un destino explicitamente aprobado; nunca debe sobrescribir por defecto el volumen de produccion.

## Risks / Trade-offs

- [El nombre `instances` puede ocultar rutas MVP activas] → Clasificar consumidores por consultas reales y conservar cualquier ruta que lea `pr_cards`.
- [El esquema legacy puede tener datos utiles] → Respaldar y verificar antes de borrar; no usar `DROP CASCADE` sin inventario.
- [Un volumen existente no ejecuta initdb otra vez] → Ejecutar una migracion versionada explicita para el retiro.
- [Un cliente viejo puede intentar usar endpoints eliminados] → Documentar el breaking change y responder con 404; no mantener compatibilidad falsa.
- [Socket.IO puede quedar en lockfiles o bundles] → Verificar dependencias npm, imports, scripts y assets despues del retiro.

## Migration Plan

1. Inventariar referencias runtime y clasificar objetos legacy frente a objetos MVP.
2. Crear y verificar respaldo/export de filas legacy utiles.
3. Desactivar los mounts de fixtures legacy del despliegue MVP.
4. Retirar Socket.IO, listeners y rutas/vistas exclusivamente legacy.
5. Ejecutar migracion SQL versionada que valide el respaldo y la ausencia de dependencias.
6. Eliminar objetos SQL legacy autorizados, conservando `reviewer` y todas las tablas MVP.
7. Levantar una base limpia y una base existente, verificando bootstrap, cola, categorias, clasificacion y progreso.
8. Verificar que el flujo MVP no contiene consultas a objetos retirados.

Rollback: detener el despliegue, restaurar la version anterior de la aplicacion y recuperar los objetos/datos desde el respaldo verificado en una base de datos separada o en un destino explicitamente aprobado para escritura. Nunca sobrescribir por defecto el volumen de produccion ni eliminar el volumen PostgreSQL como estrategia automatica de rollback.

## Decisiones resueltas

No hay preguntas abiertas. El respaldo es un archivo externo compatible con `pg_dump`, acompañado por un manifiesto JSON y checksum según el contrato del runbook canónico. La retención continua pertenece a las operaciones canónicas del MVP y no autoriza borrar el respaldo de retiro antes de que terminen las obligaciones de recuperación.
