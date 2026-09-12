# Guía del participante

Esta guía explica cómo entrar al estudio y completar las tarjetas. El contrato está documentado como
`IMPLEMENTED-UNVERIFIED`, por lo que esta guía no afirma que exista evidencia aprobada de una ejecución HTTP o VPS.

## Username de login

Usa el username que el operador te haya asignado para el estudio. No elijas un estudio desde la pantalla de login.

- Estudio actual de 300 tarjetas: `javier`, `diego` o `pablo`.
- Estudio de validación de 30 tarjetas: `javier-30`, `diego-30` o `pablo-30`.

La clave visible del participante sigue siendo `javier`, `diego` o `pablo`. El username solo sirve para buscar la cuenta.
La cuenta persistida contiene el `study_id` autorizado y, después del login, la sesión conserva ese valor. Ese
`study_id` derivado de la cuenta y la sesión selecciona el estudio, nunca un selector, un sufijo interpretado o un valor
enviado por el navegador.

Si el username no funciona, informa al operador. No compartas tu contraseña ni intentes añadir el `study_id` a una URL,
query o formulario.

## Flujo de trabajo

1. Abre la página de login y escribe tu username asignado y contraseña.
2. Recorre las tarjetas en el orden mostrado.
3. Crea o reutiliza categorías planas propias cuando una tarjeta corresponda a un grupo.
4. Clasifica una tarjeta con exactamente una categoría y, si hace falta, añade una observación.
5. Descarta una tarjeta solo cuando corresponda y añade un motivo opcional.
6. Cierra sesión mediante el control de logout cuando termines.

Los tres participantes reciben la misma muestra dentro de cada estudio. Tu cola, categorías, clasificaciones, descartes,
observaciones y progreso son privados. Una decisión sobre una tarjeta no cambia la cola ni las categorías de otra persona.

## Privacidad y límites

No hay selector de participante ni selector de estudio. La aplicación no acepta un participante o estudio en la URL, query,
formulario o cabecera. No existe una UI administrativa para participantes.

La exportación no está disponible en el navegador. No existe `/export`; el paquete de resultados solo lo crea un operador
mediante una orden offline después de que todas las personas hayan terminado todas las tarjetas.

Las tarjetas proceden del CSV preparado. GitHub no se consulta durante la clasificación. Si se habilita enriquecimiento,
ocurre antes de la participación y solo durante la preparación operativa.

## Cuando termines

Una tarjeta queda en estado `CLASSIFIED` o `DISCARDED`. La cola queda vacía cuando todas las tarjetas de tu estudio tienen
una decisión terminal. El otro estudio y las decisiones de otros participantes siguen aislados.

Para el procedimiento de preparación, consulta [`MULTI-STUDY-VALIDATION.md`](MULTI-STUDY-VALIDATION.md). Para la
exportación operativa, consulta [`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md), que no es un procedimiento para participantes.
