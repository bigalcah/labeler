## Context

La composición base usada por `release.yml` prepara un solo CSV y no declara el descriptor multiestudio. El overlay
`docker-compose.clean.yml` contiene los mounts correctos, pero no forma parte del paquete allowlisted de producción.
Además, renderizar la composición completa en GitHub fijaría rutas absolutas del runner en el artefacto.

## Goals / Non-Goals

**Goals:**

- Producir una composición de release autónoma con el wiring clean de ambos perfiles.
- Mantener los paths externos como variables interpoladas para resolverlos en la VPS.
- Mantener el archivo empaquetado con exactamente tres entradas y el launcher sin build.
- Mantener intactos los overlays locales `clean` y `existing`.

**Non-Goals:**

- No migrar ni borrar el volumen PostgreSQL existente.
- No incluir credenciales, manifests o configuraciones de la VPS en GitHub.
- No convertir el overlay `existing` en una ruta automática de release.

## Decisions

Se añadirá `deployment/docker-compose.release.yml` como fuente versionada y autocontenida para producción. Será
equivalente a la composición base con los mounts clean agregados solo al preparador. El workflow copiará esa fuente al
paquete con el nombre `docker-compose.yml`; así el paquete conserva su contrato y no contiene rutas materializadas del
runner.

El preparador recibirá el descriptor en `/run/config/study-profiles.json`, las configuraciones en
`/run/config/studies/` y ambos manifests en `/run/secrets/studies/`. El servidor y Caddy conservarán únicamente sus
secretos de runtime. El launcher exigirá la presencia de esos targets y `STUDY_PROFILES_INPUT` durante su preflight.

La alternativa de empaquetar el resultado de `docker compose config` se descarta porque resolvería los paths absolutos
del entorno de construcción. La alternativa de añadir los mounts a la composición base se descarta porque rompería la
ruta local mutuamente excluyente `existing`.

## Risks / Trade-offs

- [La VPS no tiene alguno de los cinco archivos externos] → El preflight falla antes del backup y conserva el runtime.
- [La fuente de release diverge de los overlays locales] → Los tests comparan mounts, nombres, volumen, red y gates.
- [Un paquete antiguo omite el wiring] → El launcher rechaza targets o variables ausentes antes de preparar.

## Migration Plan

1. Crear y validar los archivos externos de los dos perfiles en la VPS.
2. Publicar la composición de release corregida y ejecutar el workflow en `master`.
3. Comprobar evidencia, ambos estados `READY`, health checks y `/login` antes de considerar la adopción completa.
4. Si falla antes de publicar `current`, conservar la release activa; si falla después, aplicar el rollback de imagen
   compatible documentado sin revertir migraciones ni borrar el volumen.
