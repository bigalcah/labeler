# Tareas de implementación del pipeline Copilot 369

## 1. Aprobaciones y preservación de la línea base

- [x] 1.1 Cambio dedicado: obtener aprobación explícita del usuario para la excepción de pipeline y registrar su alcance
      exacto; el registro identifica las tres rutas permitidas y la autoridad que aprobó.
- [x] 1.2 Rama de trabajo: confirmar rama feature basada en `develop`, conservar todos los cambios previos del worktree
      y verificar que los siete workflows y Compose release parten de `b409233`.
- [x] 1.3 Manifiesto de política: guardar hashes SHA-256 iniciales de los siete workflows y Compose release; evidencia
      reproducible confirma exactamente siete nombres de workflows y baseline `b409233`.
- [x] 1.4 Plan operativo: conservar HOLD y separar evidencia local/CI de adopción, protección administrativa, backup,
      restore y autorización de operador; cada gate real sin evidencia queda pendiente.

## 2. Fixtures y contratos de rechazo

- [x] 2.1 Fixtures de manifiesto: crear casos válidos y negativos v2 con resultados esperados, incluidos campos
      ausentes, extra, duplicados, tipos inválidos, versión desconocida y v1 entrante rechazado.
- [x] 2.2 Fixtures de perfiles: cubrir perfiles equivocados, extra, duplicados, omitidos, intercambiados o reordenados,
      conteos/rutas no canónicos y cada hash incorrecto o ausente; todos deben rechazarse.
- [x] 2.3 Fixtures de identidad: cubrir commit/tag/digest incongruentes, `releaseId`, generación, fecha real UTC,
      workflow, rutas y compatibilidad inconsistentes; no se instala ni se muta PostgreSQL.
- [x] 2.4 Fixtures de bytes históricos: capturar bytes de manifiestos v1 antes de inspección; después deben coincidir
      exactamente y seguir siendo solo lectura.
- [x] 2.5 Fixtures de estado: cubrir journal ausente, malformado, pending, unknown, obsoleto, identidad incorrecta y
      transiciones incompletas; incluir adopción sin candidato con releaseId/generation null y vinculación posterior.
- [x] 2.6 Fixtures de interrupción: simular preparación/cutover interrumpidos, fallo de backup, runtime, smoke test y
      rollback, fallo del rollback mismo y crash entre punteros y journal; todo estado bloquea inicialmente hasta
      reconcile readonly, luego solo admite transiciones de 5.11/5.13, nunca reparación de unknown/malformado.
- [x] 2.7 Fixtures de concurrencia: probar lock, generación monotónica y operaciones concurrentes; la operación antigua
      o perdedora no cambia estado ni publica.
- [x] 2.8 Fixtures de rechazo: comprobar que preflight fallido permite staging/diagnóstico acotado, pero no instalación,
      generación, journal de compatibilidad ni comandos con escrituras de base de datos.
- [x] 2.9 Fixtures de backup: modelar orígenes realmente vacíos y con solo prefijo 001, recibo
      externo completo y restore aislado; afirmar orden antes de restart/up, migración, bootstrap y
      prepare, y rechazo de `STUDY_BACKUP_VERIFIED` aislado.
- [x] 2.10 Fixtures de recibos/transiciones: cubrir parser tipado/versionado, fases finitas,
      predecessor y autorización, recibo no referenciado, operación propia vs abandonada, cutover
      exacto y deploy continuado del mismo candidato.
- [x] 2.11 Fixtures de generación/publicación: cubrir reserva antes del floor, crash entre ambos,
      G menor, G igual autorizado solo para reserva exacta, replay/candidato/DB distinto, prefijos
      válidos de orden de punteros, combinaciones desconocidas, completion conflictivo y rollback
      que no baja floor.
- [x] 2.12 Fixtures de adopción: simular pushes excluidos, cada clase de operación v1
      drenada/cancelada, CI terminal, ningún deploy bajo lock, re-run bloqueado y espías que
      demuestran cero escrituras SQL/restarts durante inventario.

## 3. Manifiesto v2, imágenes y paquete

- [x] 3.1 `scripts/create-release-manifest.js`: escribir solo las claves raíz v2 exactas y validar tipos, formatos,
      relaciones de imagen/commit, generación y fecha; los fixtures de contrato pasan.
- [x] 3.2 Escritor v2: emitir `dataBundle` con exactamente 369 y luego 30 y compatibilidad separada
      `study-schema-3`/`copilot369-v1`; pruebas rechazan alias y datos adicionales.
- [x] 3.3 Escritor v2: fijar para los cuatro archivos los hashes aprobados en el diseño, sin recalcular valores
      distintos; la comparación contra archivos canónicos confirma cada hash.
- [x] 3.4 Imagen de servidor: incluir los dos CSV y sus sidecars en las cuatro rutas aprobadas; inspección de imagen
      confirma presencia y hashes independientes de cada archivo.
- [x] 3.5 Compose release y empaquetador: conservar exactamente `Caddyfile`, `docker-compose.yml` y
      `release-manifest.json`; prueba de inventario rechaza archivo extra o duplicado.
- [x] 3.6 `deployment/deploy-vps.sh`: validar estructura e identidad antes de artefactos y rechazar v1 como ingreso,
      claves desconocidas y perfiles no canónicos sin efectos activos.
- [x] 3.7 `deployment/deploy-vps.sh`: inspeccionar imagen con Docker `--network none --read-only`, verificar commit y
      los cuatro hashes antes de instalación, promoción, journal o PostgreSQL.
- [x] 3.8 Compose release: comprobar montajes externos regulares, identidad, permisos de solo lectura y correspondencia
      de perfiles; solo `labeling-study-prepare` recibe datos/configuración de estudio.
- [x] 3.9 Paquete y logs: verificar que no incluyen secreto, credencial, configuración privada ni cuarto archivo;
      pruebas de escaneo y listado de paquete documentan el resultado.

## 4. Inventario v1 y compatibilidad

- [x] 4.1 `deployment/deploy-vps.sh`: leer current, previous e inventario histórico v1 en modo de solo lectura y
      registrar identidad sin reescribir manifiestos.
- [x] 4.2 Pruebas del launcher: comparar bytes v1 antes/después y rechazar v1 reenviado como release tras adopción v2.
- [x] 4.3 Pruebas de recuperación: demostrar que schema-2/v1 sin `copilot369-v1` no inicia ni revierte la aplicación
      sobre datos Copilot, aunque declare soporte de esquema.

## 5. Preflight y estado durable

- [x] 5.1 `deployment/deploy-vps.sh`: validar imágenes/configuración antes de instalación; pull e inspección de digest
      usan el registro autorizado, pero el checksum de archivos se ejecuta sin red y todo rechazo conserva estado activo.
- [x] 5.2 Journal `state/database-compatibility.json`: definir parser cerrado para `pending`, `verified` y `unknown`,
       las 12 claves raíz exactas incluido `origin` como observación readonly del estado previo, origen/destino separados
       y adopción sin candidato con ambos IDs null, evidencia local y binding previo a mutaciones.
- [x] 5.3 Journal: escribir temporal, sincronizar archivo, renombrar y sincronizar directorio; prueba de filesystem
      confirma durabilidad o el launcher rechaza toda mutación.
- [x] 5.4 Launcher: bajo lock exclusivo, persistir `pending` antes de subir base, migrar, preparar o cortar; el fallo de
      persistencia impide ejecutar el comando mutante.
- [x] 5.5 Launcher: establecer `verified` solo tras lectura real que confirme por separado esquema, datos, identidad y
      evidencia temporal; lo no demostrable permanece `unknown`.
- [x] 5.6 Launcher: después de crash, bloquear inicialmente y reconciliar DB/punteros; malformado,
      parcial o no demostrable queda bloqueado/unknown. Solo origen intacto, destino exacto o prefijo
      publication_intent válido pueden seguir acciones explícitas de 5.11 y 5.13.
- [x] 5.7 Launcher: comprobar monotonicidad de generación y exclusión mutua en deploy, rollback, reconciliación y
      mantenimiento; replay y competidor pierden sin cambiar estado.
- [x] 5.8 Launcher: permitir rollback de imagen solo con journal verificado y aplicación compatible con ambos tokens;
      restore escribible exige backup verificado y destino separado aprobado.
- [x] 5.9 Pruebas de recuperación: ejecutar casos de interrupción, fallos tardíos y crash entre escrituras; no inferir
      éxito desde `current` ni tratar fallo del rollback como rollback exitoso.
- [x] 5.10 Recibos host-only: implementar esquemas estrictos e inmutables enlazados por
      `evidenceRef`, con publicación durable file+parent fsync; demostrar que recibos sueltos no
      autorizan y que DB observada decide compatibilidad.
- [x] 5.11 State machine: implementar solo handoffs declarados bajo lock y propiedad confiable;
      own-pending puede avanzar un paso, abandoned requiere reconcile readonly y autorización
      explícita, sin confiar en PID, timestamp o token de cliente.
- [x] 5.12 Generación: persistir reserva VALIDATED enlazada a DB, candidato, imágenes y tres hashes
      antes de elevar floor; bloquear reserva abandonada desconocida y consumir solo después de
      publicación coherente.
- [x] 5.13 Publicación: escribir `previous`, `current`, `active-schema-version`, `deployment` en
      orden fijo y completion al final; reconcile no repara ni declara éxito sin finalización
      explícita y runtime/smoke frescos.
- [x] 5.14 Helper local: implementar modos privilegiados de adopción, reconciliación, mantenimiento,
      continuación y finalización, todos bajo el lock común; demostrar que reconcile no escribe DB,
      reinicia servicios ni corrige punteros, y que SSH solo conserva deploy/rollback.
- [x] 5.15 Launcher: validar recibo externo de backup completo custom y restore aislado contra
      identidad, volumen y origen observado, independientemente del esquema de aplicación; rechazar
      marcador solo y exigirlo antes de restart/up o mutación.

## 6. Clasificación previa a migración y preparación

- [x] 6.1 Helper de readiness de solo lectura: distinguir base vacía, pareja exacta 369+30, primaria histórica 300 y
      estado parcial/desconocido; fixtures prueban cada clasificación.
- [x] 6.2 `scripts/prepare-study-deployment.sh`: ejecutar clasificación antes de cualquier migración, bootstrap,
      aprovisionamiento, importación, refresh o enriquecimiento; prueba espía confirma orden.
- [x] 6.3 Entry point: verificar pareja 369+30 existente en solo lectura y omitir todas las escrituras incluso si hay
      decisiones guardadas; snapshots y timestamps persisten sin cambio.
- [x] 6.4 Entry point: preparar solo una base realmente vacía y elegible, primero 369 y después 30; prueba de orden y
      estado final confirma ambos perfiles antes de runtime.
- [x] 6.5 Entry point: rechazar pareja parcial, drift, esquema desconocido, objeto legacy inesperado e interrupción
      previa antes de mutaciones; no completar ni reparar automáticamente.
- [x] 6.6 Entry point: rechazar 300 e indicar el mantenimiento manual existente, sin invocar cutover ni cambiar su lógica;
      pruebas confirman que la operación ordinaria no transforma esa primaria.

## 7. CI sintético, seguridad y exportación

- [x] 7.1 `shared-validation.yml`: preparar seis cuentas sintéticas en dos manifiestos independientes, tres por perfil;
      credenciales efímeras no aparecen en logs ni artefactos.
- [x] 7.2 Fixtures CI: sembrar cuentas, tarjetas, decisiones y sesiones con `study_id` explícito autenticado; cada
      participante recibe membresía canónica completa y ordenada.
- [x] 7.3 Pruebas de identidad: rechazar selección de estudio del cliente y sufijo `-30`; la autenticación determina el
      estudio y los cruces no escriben en el otro.
- [x] 7.4 Pruebas de sesión y privacidad: crear tres sesiones aisladas por estudio, con cookies y CSRF separados;
      respuestas privadas al mismo PR no revelan ni alteran respuestas ajenas.
- [x] 7.5 E2E de ambos estudios: autenticar los seis logins y probar categoría privada, notas, edición, clasificación,
      descarte, navegación, progreso, exportación y logout con base descartable.
- [x] 7.6 Compose/Caddy CI: verificar HTTPS `/login` 200, `/actuator` y subrutas 404 externamente, y health del servidor
      por separado en la red interna.
- [x] 7.7 E2E de seguridad: verificar cookies Secure, HttpOnly y SameSite, CSRF y Origin same-origin; solicitudes
      inválidas no escriben y sesión cerrada no entrega datos privados.
- [x] 7.8 E2E de exportación: con una decisión pendiente rechazar descarga; con dos o tres participantes completos
      comprobar filas y columnas exactas, privacidad y aislamiento del estudio.
- [x] 7.9 Pruebas de preservación: comparar antes/después el estado protegido de 30, incluidos IDs, membresía, orden,
      tarjetas, cuentas, credenciales, snapshots, decisiones y timestamps; toda diferencia falla el gate.
- [x] 7.10 Release sucesivo sintético: repetir con decisiones guardadas y verificar idempotencia y estado 30 idéntico,
      incluidos IDs protegidos, credenciales, snapshots, decisiones y timestamps.
- [x] 7.11 Runtime CI: asignar directorio, contenedores, red, volumen y puertos loopback únicos; concurrencia de
      navegador determinista, secuencial y acotada evita colisiones.
- [x] 7.12 Cleanup CI: emitir recibo por recursos asignados y comprobar ausencia; limpieza parcial o no confirmada falla
      o queda cancelada no confirmada con diagnósticos redactados, nunca `removed=true` ficticio.

## 8. Suites reproducibles y gates OpenSpec

- [x] 8.1 `shared-validation.yml`: ejecutar selección unitaria completa `npm run test:unit` junto con selección completa
      de release y suites específicas de integración y E2E.
- [x] 8.2 Harness de pruebas: enumerar explícitamente todos los `*.integration.js` previstos y ejecutar cada suite;
      evidencia de inventario y resultados confirma que ninguna quedó fuera.
- [x] 8.3 Gates CI: prohibir exclusiones, skips silenciosos, selección reducida y retries como éxito; fallo, omisión,
      cancelación o prerrequisito ausente bloquea build, publicación y deploy.
- [x] 8.4 Runner limpio: instalar y verificar exactamente OpenSpec CLI 1.9.0 y ejecutar
      `openspec validate --all --strict --no-interactive --json` sobre specs activas y principales.
- [ ] 8.5 Workflow de calidad: ejecutar validación en runner Linux limpio y PR autorizada, sin secretos VPS; registrar
      ejecución y estados reales de lint, unidad, integración, E2E, preservación y contratos, sin avance tras un fallo.

## 9. Excepción de congelación y release

- [x] 9.1 Excepción aprobada: entre rutas congeladas permitir solo `shared-validation.yml`, `release.yml` y Compose
      release; la comparación con `b409233` demuestra otros cinco workflows y siete nombres intactos.
- [x] 9.2 Freeze: actualizar en este cambio fingerprints SHA-256 anteriores/nuevos y pruebas de contrato con hashes
      calculados sobre archivos finales; validar allowlist exacta y preservación de CODEOWNERS.
- [x] 9.3 Workflows afectados: preservar SHA pins y cadena master-only `quality` → `build` → `publish` → `deploy`;
      pruebas de contrato rechazan publicación/despliegue en otras ramas.
- [x] 9.4 Workflow release: mantener deploy tras publicación inmutable del mismo commit y digest, con secretos VPS
      limitados al job protegido; contrato detecta secretos en jobs previos.
- [x] 9.5 Integración: ejecutar literalmente
      `git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml`; salida
      no vacía bloquea merge salvo aprobación explícita de excepción para el conjunto exacto y hashes auditados.
- [x] 9.6 Política `AGENTS.md` y documento HOLD: reconciliar únicamente la excepción acotada aprobada; conservar el comando
      literal, allowlist/hash exactos y gates operativos, sin enmascarar rutas ni declarar producción lista antes de tiempo.
- [ ] 9.7 Validación administrativa: verificar por evidencia real protección de rama, revisión owner, éxito de
      freeze-test y pausa del environment `production`; si falta disponibilidad o enforcement, conservar HOLD.

## 10. Fallos, ensayo y adopción operativa

- [x] 10.1 Evidencia de ensayo local/CI: archivar comandos, fixtures, versiones, resultados y hashes redactados;
      identificarla como sintética, no como backup, restore, adopción o despliegue real.
- [x] 10.2 Ensayo de fallos: ejecutar en bases descartables backup fallido, runtime/smoke fallidos, rollback fallido,
      interrupciones y reconciliación; ningún resultado simula evidencia de producción.
- [ ] 10.3 Antes de instalar el consumidor: operador demuestra exclusión temporal de pushes y
      re-runs v1, drenaje/cancelación de queued, running, aprobación pendiente, retryables y en vuelo,
      CI terminal y ningún deploy bajo lock; si falla evidencia, no adopta.
- [ ] 10.4 Antes del primer push a master: operador instala y verifica en host el launcher aprobado,
      inventaría releases v1 sin escritura y registra hash/versión y prueba inocua; HOLD persiste y
      ventana v1 permanece cerrada hasta candidato v2 validado.
- [ ] 10.5 Antes del primer push a master: operador inspecciona DB saludable por acceso existente estrictamente
      readonly, registra identidad/esquema/datos y elegibilidad preliminar de cutover/ventana; ninguna consulta muta
      datos.
- [ ] 10.6 Antes del primer push a master: operador verifica backup externo y restore de manera separada y elegible;
      evidencia real identifica destino y resultado, nunca se fabrica desde CI.
- [ ] 10.7 Candidato: tras validación confiable de master y build/publicación del mismo commit, confirmar que deploy
      queda retenido hasta aprobación humana realmente aplicada en `production` para ese candidato exacto.
- [ ] 10.8 Primaria histórica 300: operador verifica digest, detiene escritores, refresca backup y toma lock;
      sin checkpoint previo, maintenance valida y persiste la reserva candidata, eleva durablemente
      `state/highest-generation` y solo después registra pending y ejecuta 014/cutover. Con `normalization_verified`,
      reutiliza exactamente la reserva no consumida y el floor, sin nueva reserva ni incremento, y exige autorización
      fresca y backup/restore del baseline normalizado antes del cutover aún no ejecutado. Verificar destino antes de
      aprobar deploy; este continúa esa reserva exacta
      no consumida sin nueva reserva ni repetición de migraciones/cutover. Probar orden y lectura del contexto por prepare.
- [ ] 10.9 Pareja 369+30 existente: operador acredita estado exacto readonly y aprueba solo el
       candidato compatible; el launcher no migra ni reescribe decisiones o estado protegido.
- [ ] 10.10 Base nueva elegible: operador acredita salud, vaciedad, backup y autorización de inicialización; launcher
      persiste pending, crea 369 y 30, verifica destino y solo después inicia aplicación/Caddy.
- [ ] 10.11 Cierre: registrar por separado autoridad y evidencia de adopción host, protección real, backup/restore,
      cutover aplicable y despliegue real; cualquier ausencia conserva HOLD y no declara garantía de riesgo cero.
- [x] 10.12 Backup de inicialización: ensayar con fixtures descartables orígenes vacío y prefijo
       conocido usando recibo externo y restore aislado; verificar identidad, volumen, hash,
       prerrequisitos, destino y contenido sin ejecutar backup real.
- [ ] 10.13 Drenaje de adopción: demostrar inventario readonly con IDs/tiempos/fingerprints, cero
       SQL/restart/prepare, app previa operativa si no hay corte y cierre de ventana solo al primer
       v2 validado.
- [x] 10.14 Primer v2 fallido: demostrar que una primera release incompatible con baseline v1 no
        revierte automáticamente, no repite cutover/migración/bootstrap en continuación y puede
        quedar no disponible hasta recuperación aprobada.

## 11. Normalización protegida posterior al retiro

Estas tareas corresponden al delta de normalización. Las 37 casillas históricas iniciales se
conservan sin ampliar retroactivamente su alcance. Cada casilla del delta se cierra únicamente con
la implementación y evidencia nuevas, no por los resultados anteriores a la ampliación.

- [x] 11.1 Fixture de catálogo: fijar readonly la diferencia exacta entre catálogo retirado y canónico 014, incluida FK,
      índices, dependencias/RI y huella de fuentes; probar que el ledger acredita 002 en su posición para esa fuente
      especial y que la fuente canónica nueva puede omitirla; confirmar que 015 no entra a `managedMigrations`.
- [x] 11.2 Pin independiente: registrar y validar `schema/migrations/015_normalize_retired_study_schema.sql` en el
      contrato interno de normalización sin inventar ni alterar hashes de migraciones 001–014, manifiesto, paquete o
      compatibilidad de aplicación.
- [x] 11.3 Linaje cerrado: probar en todos los consumidores, incluidos `assertLedgerState`, `runStudyMigrations`,
      readiness y verificador dedicado de cutover, el prefijo completo y ordenado 001–014, 002 solo en posición permitida
      y 015 externa únicamente después de 014; rechazar IDs desconocidos, huecos, duplicados y desorden. Probar que la 015
      válida no se trata como desconocida ni se ejecuta automáticamente; sin 015, conservar los casos previos de ledger
      vacío y prefijos válidos incompletos del migrador, sin declararlos aplicación lista.
- [x] 11.4 Readiness readonly: mantener 014 canónica con bundle Copilot 369+30 y decisiones, aceptable sin fila 015 y sin escritura; aceptar
      readonly esa misma pareja en catálogo canónico con fila 015 válida y clasificar el catálogo retirado solo como elegible a normalización.
- [x] 11.5 Datos elegibles: comprobar por separado base vacía, 300+30 exacta y 369+30 exacta, incluidos decisiones
      válidas; rechazar datos parciales/desconocidos, huérfanos y drift sin remediación automática.
- [x] 11.6 Alcance de mantenimiento: exigir wrapper local `maintenance` con alcance `normalize`, el campo `action` de la solicitud externa root y
      `authorization.action` exactamente `maintenance-normalize`; comprobar que autorización de cutover no permite 015
       ni la autorización de normalización autoriza cutover. Exigir root, DB saludable/enlazada, writers detenidos, locks,
      backup/restore, candidato, reserva/floor y pending durables; sin claves raíz ni verbos SSH nuevos, ni prepare.
- [x] 11.7 Preflight SQL: revalidar bajo locks catálogo, pin 015, linaje, huérfanos, equivalencia de índices canónicos y
      definiciones/dependencias exactas de los tres índices; cada discrepancia falla antes de la primera escritura.
- [x] 11.8 Migración `schema/migrations/015_normalize_retired_study_schema.sql`: implementar DDL transaccional que valida
      FK no diferible `participant_category_participant_id_fkey`
      y elimina únicamente los tres índices declarados; prohibir CASCADE, borrado, reasignación y backfill.
- [x] 11.9 Verificación/ledger: antes de commit verificar que el catálogo RESULTANTE coincide con el contrato físico
      canónico 014; preservar filas PREEXISTENTES, IDs, cuentas, credenciales, snapshots, decisiones, timestamps y filas
      PREVIAS del ledger; insertar únicamente la nueva fila 015 atómicamente.
- [x] 11.10 Idempotencia: desde 014 canónica permitir solo DDL no-op más append 015; sobre 015 exacta terminar readonly sin
      nuevo DDL ni fila; bloquear todo estado intermedio desconocido.
- [x] 11.11 Contrato de fingerprints: preservar fingerprints de aplicación y filas previas; aceptar solo la fila 015
      prevista en fingerprint global y probar explícitamente que el fingerprint total de DB no se declara idéntico.
- [x] 11.12 Estado y fases: mantener 12 claves raíz exactas en journal/recibo, origin inmutable y agregar fase finita
      `normalization_verified` desde reserved/pending con detención y validación cerrada por target/observación.
- [x] 11.13 Handoff/reconcile: readonly demuestra preestado intacto, pero exige autorización externa explícita separada
       antes de mutar; registra normalized+ledger exactos y bloquea unknown para parcial; forma física sin fila 015 no
       prueba commit.
- [x] 11.14 Continuación autorizada: probar entrypoints reales de inicialización ordinaria desde origen normalizado vacío
       y mantenimiento local `maintenance` desde origen histórico normalizado, mediante `Runtime.maintenance()`,
       `scripts/migrate-study-schema.js` y `scripts/cutover-copilot-369.js`, sin confundirlo con el retiro legacy `existing`;
       ambos recorridos alcanzan `runStudyMigrations`. Con prefijo hasta
       014 completo, no reaplicar migraciones ni ejecutar 015/escribir ledger o datos ya verificados. Exigir autorización
       nueva y backup/restore post-015 enlazados al baseline normalizado; rechazar backup pre-015 antes de SQL. Probar que
       vacío, 300+30 y Copilot 369+30 se detienen en `normalization_verified` sin bootstrap/cutover/runtime/reinicio/
       publicación/cambio de punteros/consumo de reserva, incluso si Copilot ya tiene esquema, datos y tokens finales;
       autorización ausente, expirada, de otro candidato o normalization-only no admite continuación. Copilot prosigue
       readonly sin migrador; 300 con decisiones puede normalizarse pero cutover sigue exigiendo cero historial. Tras crash
       commit-sin-recibo, solo catálogo canónico más ledger 015 exacto permite checkpoint readonly, sin repetir SQL y con
       parada hasta continuación fresca; catálogo físico sin ledger no prueba commit. No repetir 015 ni consumir reserva
       antes de publicación coherente.
- [x] 11.15 Concurrencia/crashes: inyectar carreras de lock/generación y fallos antes, durante y después del commit, más
      fallo de persistencia de recibo; confirmar que solo transacción y evidencia previstas avanzan.
- [x] 11.16 Harness completo: integrar fixtures en selección e inventario completo, cleanup verificable y gates existentes;
      ampliar explícitamente inventario si aparecen archivos, sin skips, retries verdes ni selección reducida.
- [x] 11.17 Preservación y HOLD: mantener inalterados los datos protegidos 30 y las invariantes de aplicación; conservar
      HOLD y gates de operador/admin pendientes, sin afirmar implementación, harness verde ni autorización productiva.
