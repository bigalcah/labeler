# Desarrollo

Ejecuta los comandos desde la raíz: `index.js` usa `./views`, `dotenv` busca `.env` desde el cwd y los scripts usan
rutas relativas. `npm ci` instala desde el lockfile.

## Scripts existentes

`dev`, `start`, `lint`, `lint:js`, `lint:css`, `lint:md`, `minify`, `minify:css`, `backup:legacy`, `bootstrap:study`,
`enrich:study`, `import:csv`, `migrate:study`, `retire:legacy:apply`, `retire:legacy:clean-check`,
`retire:legacy:check`, `test:foundation`, `test:migrations`, `test:study-http`, `test:study-concurrency` y
`test:rollback-readonly` existen estáticamente en `package.json`.

No existen `npm test`, `npm run build` ni una compilación EJS separada. EJS renderiza en runtime. `lint:md` solo cubre
Markdown raíz; `lint` incluye CSS con configuración conocida como no fiable; `test:study-concurrency` ejecuta el mismo
archivo que `test:study-http`; `minify` reescribe CSS y no es validación de solo lectura.

## Desarrollo local

```bash
npm ci
npm run dev
npm run lint:js
npm run lint:md
```

El servidor usa `3000` por defecto. Docker publica `7755:3000`; sus precondiciones están en
[`docs/OPERATIONS.md`](OPERATIONS.md).

Los cambios documentation-only no modifican runtime, dependencias, SQL, Compose, bases o volúmenes. Actualiza
`docs/JAVASCRIPT-API.md` cuando cambien exports, handlers, clases, factories, entrypoints o coordinadores JavaScript.
