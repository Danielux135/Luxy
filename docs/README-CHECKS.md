# Coherencia de documentación

`AGENTS.md` y `CLAUDE.md` deben citar comandos que existan en `package.json` y
no pueden contradecir las decisiones de seguridad.

Al cambiar arquitectura, comandos, proveedores, permisos, trabajos, memoria o
despliegue:

1. actualizar `AGENTS.md` y `CLAUDE.md`;
2. actualizar `PROJECT-STATE.md` y el ítem correspondiente de `MASTER-PLAN.md`;
3. registrar el cambio en `CHANGELOG-WORK.md`;
4. registrar las pruebas en `TEST-RESULTS.md`;
5. revisar los enlaces de README;
6. ejecutar `npm test`, que incluye comprobaciones documentales existentes.

Los documentos de continuidad no deben contener secretos, respuestas privadas
completas ni resultados de pruebas que no se hayan ejecutado.
