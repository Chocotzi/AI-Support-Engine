# Reparto del trabajo (2 personas)

El proyecto se divide por **archivos**, no por tareas sueltas, para que casi no haya conflictos de git.
Lo único compartido es el **contrato** (`src/contract.js`) y las utilidades de seguridad (`src/security.js`), que ya vienen escritos: léanlos juntos en los primeros 15 minutos.

| | **Persona A — Motor tradicional + Evaluación** | **Persona B — Motor generativo + API + Seguridad** |
|---|---|---|
| Criterios que cubre | Motor tradicional (25 %) · Pruebas comparativas (15 %) | IA generativa (30 %) · Validaciones y seguridad (20 %) |
| Archivos propios | `src/traditional.js`, `eval/dataset.json`, `eval/run-eval.js`, `tests/traditional.test.js` | `src/generative.js`, `src/providers.js`, `src/server.js`, `tests/generative.test.js`, `tests/api.test.js` |
| Archivos compartidos | `src/contract.js`, `src/security.js`, `src/service.js` (se cambian solo de común acuerdo) | |
| Entregables | Tabla de resultados, conclusión (≤150 palabras) | Evidencia del endpoint funcionando con ambos modos |
| Ambos | README y repositorio (10 %) | |

## Línea de tiempo sugerida (≈ 2.5 h)

| Min | Persona A | Persona B |
|---|---|---|
| 0–15 | **Juntos:** leer `contract.js`, `security.js`, el enunciado; crear repo y ramas `feat/traditional` y `feat/generative` | |
| 15–60 | Revisar/ajustar reglas y palabras clave de `traditional.js`; ampliar `dataset.json` (más casos, definir la referencia **antes** de ejecutar) | Instalar Ollama (`ollama pull llama3.2`) o configurar una API key; probar `callModel` a mano |
| 60–100 | Pruebas unitarias del tradicional; medir con mensajes nuevos (no solo el dataset) | Afinar el prompt de `generative.js`; probar reintentos y errores (apagar Ollama, llave inválida) |
| 100–130 | **Juntos:** merge, `npm test`, levantar la API, ejecutar `npm run eval` con ambos motores (idealmente `--api` para tener evidencia vía endpoint) | |
| 130–150 | Tabla + conclusión técnica; capturas/log de la evidencia | README final, revisar que no haya secretos en el repo |

## Qué debe poder explicar cada quien (el enunciado lo exige)

**Persona A**
- Por qué reglas ponderadas y no solo "if contiene palabra": pesos, normalización de acentos, desempate por severidad.
- Por qué `SECURITY` tiene precedencia y nunca baja de `HIGH`.
- Cómo `stripInjection` elimina la *orden* pero conserva el *contenido* ("esta vulnerabilidad").
- Cómo se define "correcto" (categoría **y** prioridad) y por qué la referencia se fija antes de ejecutar.
- Limitaciones: depende de palabras clave, no entiende sinónimos ni ironía, el idioma es limitado.

**Persona B**
- Cómo el prompt separa instrucciones (`system`) de datos (`<solicitud>`) y por qué eso mitiga la inyección.
- Por qué se valida la salida con `validateResult` (un LLM puede devolver JSON inválido o categorías inventadas) y por qué solo se reintenta una vez.
- Qué hacen los *guardrails* en código (revisión humana forzada) y por qué no se confía solo en el modelo.
- Cómo se evita exponer secretos: variables de entorno, `redactSecrets` antes de enviar al modelo, logs sin contenido del mensaje, errores sin detalles del proveedor.
- Qué código HTTP devuelve cada fallo (400/413/415/502/503/504) y por qué no hay *fallback* silencioso al tradicional (sería simular una respuesta generativa).

## Flujo de git

```bash
git checkout -b feat/traditional   # Persona A
git checkout -b feat/generative    # Persona B
# commits pequeños; PR cruzado: cada quien revisa el código del otro (así ambos entienden todo)
```

## Checklist de entrega

- [ ] `npm test` en verde
- [ ] `npm run eval` ejecutado con **ambos** motores; `results/results.md` y `results/results.json` en el repo
- [ ] Captura o log del endpoint `POST /api/analyze` en ambos modos
- [ ] Conclusión técnica ≤ 150 palabras escrita **con los números reales** (sección final del README)
- [ ] Sin `.env` ni llaves en el historial de git
- [ ] Cada integrante puede explicar su parte (y repasar la del otro)
