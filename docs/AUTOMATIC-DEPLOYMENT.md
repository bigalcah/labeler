# Despliegue automático desde master

El modo delegado recupera `push master → calidad → publicación → aprobación production → deploy SSH`.
No ejecuta ni exige backup o restore aislado. No fabrica recibos: `backupRef` es `null` y la autorización registra
`automation: {policySha256, backupRequired: false}`. El modo manual previo sigue disponible.
Esta política fue solicitada por el operador; conservar un volumen no sustituye un respaldo.

## Activación inicial

Instalar el consumidor corregido requiere root una sola vez. CI no recibe sudo general ni nuevos verbos SSH.
El deployment root existente debe pertenecer a root, sin escritura para clientes. Conservar releases, manifiestos,
punteros y volumen; cerrar el ingreso legacy antes de activar la política. La instalación debe incluir
`deployment/host/automatic.py`; la imagen candidata debe incluir el generador de solicitud y verificadores nuevos.

Junto al archivo `LABELER_ENV_FILE`, instalar `automatic-deployment.json`, root-owned y modo `0400`.
La ruta actual es `/opt/labeler/config/automatic-deployment.json`:

```json
{
  "version": 1,
  "repository": "bigalcah/labeler",
  "databaseName": "labeling",
  "consumerSha256": "<sha256 real del consumidor instalado y sus observer assets>",
  "backupRequired": false,
  "allowHistoricalCutover": true,
  "legacyIngressDisabled": true
}
```

El ejemplo no es ejecutable. Obtener el fingerprint real con el entorno host configurado y
`python3 -B /opt/labeler/consumer/deployment/release-host-control.py --version`.
Cambiar el consumidor o sus observer assets exige revisar y volver a fijar el hash. Una política inválida bloquea
antes de detener servicios; si no existe, continúa disponible el contrato manual anterior.
No incluir política, credenciales o configuración privada en el paquete de release.

## Operación

Deploy valida paquete, repositorio, commit/digests, fuentes, configuración y DB antes de detener servicios.
Mantiene `labeling-data` y `labeling-network`; nunca elimina el volumen ni restaura sobre él.
Bajo el lock común detiene escritores conocidos y verifica también escritores en PostgreSQL.
Sin journal, inventaría solo releases v1 conocidas y adopta la identidad observada. No inventa un inventario de
ejecuciones GitHub drenadas: la instalación de la política acredita el cierre del ingreso legacy.

Para la primaria histórica elegible captura configuración cruda y las 300 membresías en una transacción readonly,
valida fuentes y checksums y usa el cutover existente, que revalida bajo locks. Ejecuta normalización únicamente
si corresponde al catálogo, después 016 y continuación del mismo candidato. Conserva study ID, cuentas e historial;
cero decisiones primarias sigue siendo requisito. Las filas del estudio de 30 permanecen intactas.
La pareja 369+30 existente se prepara readonly, sin reimportar o reaprovisionar. El origen vacío conocido usa el
preparador existente. Solo tras verificar esquema y pareja exactos inicia app/Caddy y comprueba salud y `/login`.

Fallos de política, identidad, fuente, concurrencia o preservación bloquean. Pending/unknown requieren
reconciliación explícita; no se reparan automáticamente ni permiten fallback a una imagen v1 incompatible.
Las acciones locales root `reconcile`, `continue` y `finalize-publication` reutilizan la política instalada;
la recuperación explícita tampoco exige respaldo cuando esa política válida lo declara innecesario.
No se presenta una prueba aislada como despliegue real.
Los workflows congelados, Compose release, fingerprints y CODEOWNERS permanecen intactos. La aprobación
production sigue vigente; cada release posterior usa deploy SSH, sin script manual por candidato.
