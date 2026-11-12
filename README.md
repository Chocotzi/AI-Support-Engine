# AI Support Engine

Clasificador de solicitudes de soporte con **dos motores** que cumplen el mismo contrato de respuesta:

- **`traditional`** — IA simbólica: reglas ponderadas, sin modelos generativos.
- **`generative`** — LLM real (Gemini, Ollama local, Anthropic u OpenAI-compatible) con salida JSON validada.

Node.js ≥ 22, **cero dependencias** (usa `fetch`, `node:http` y `node:test` nativos). Reparto de trabajo del equipo: [`docs/REPARTO.md`](docs/REPARTO.md).

## Arquitectura

```
POST /api/analyze ──► server.js (valida petición, mapea errores)
                         └─► service.js ──► traditional.js   (reglas)
                                       └─► generative.js ──► providers.js ──► LLM
                                                 │
                       contract.js ◄─────────────┘  (valida TODA salida)
                       security.js  (redacción de secretos, detección de inyección)
```

## Puesta en marcha

```bash
cp .env.example .env     # configure el proveedor (ver abajo)
npm test                 # pruebas unitarias y de API
npm start                # http://127.0.0.1:3000
```

### Proveedor generativo (elija uno)

| Opción | Pasos |
|---|---|
| **Gemini (usado por el equipo)** | `LLM_PROVIDER=gemini` + `GEMINI_API_KEY=...` (opcional `LLM_MODEL`, por defecto `gemini-3.8-flash`). API REST nativa con `responseSchema`; la llave va en cabecera, nunca en la URL |
| Ollama (local, gratis) | Instale [Ollama](https://ollama.com), `ollama pull llama3.2`, deje `LLM_PROVIDER=ollama` |
| Anthropic | `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY=...` |
| OpenAI / compatible | `LLM_PROVIDER=openai` + `OPENAI_API_KEY=...` (+ `OPENAI_BASE_URL`) |

Las llaves solo viven en `.env` (ignorado por git). Nunca se registran ni aparecen en errores.

## API

```bash
curl -X POST http://127.0.0.1:3000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"message":"No puedo iniciar sesión","mode":"generative"}'
```

En Windows PowerShell 5.1 envíe el cuerpo como bytes UTF-8; si no, los acentos llegan corruptos ("sesi?n") y la clasificación cambia:

```powershell
$json = '{"message":"No puedo iniciar sesión","mode":"generative"}'
Invoke-RestMethod -Method Post http://127.0.0.1:3000/api/analyze -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
```

```json
{ "category": "ACCESS", "priority": "MEDIUM", "response": "...", "requiresHumanReview": false, "mode": "generative" }
```

| Código | Cuándo |
|---|---|
| 400 | `message` ausente/vacío/>2000 caracteres, `mode` inválido, JSON malformado |
| 413 / 415 | Cuerpo >10 KB / `Content-Type` distinto de JSON |
| 502 | El proveedor falló o el modelo no devolvió el formato esperado |
| 503 / 504 | Proveedor sin configurar / tiempo de espera agotado |

`GET /health` devuelve `{"status":"ok"}`.

## Seguridad y validación

- Petición validada (tipos, longitud, tamaño, `mode`); salida de **ambos** motores validada contra el mismo contrato.
- El mensaje del usuario se trata como **dato**, no como instrucción (prompt y reglas anti-inyección).
- `SECURITY` o intento de manipulación ⇒ `requiresHumanReview: true`, forzado en código aunque el modelo diga lo contrario.
- Secretos pegados por el usuario se redactan antes de llegar al modelo; los logs solo guardan metadatos, nunca el mensaje.
- Si el modelo falla no se inventa respuesta: se devuelve error (no hay *fallback* silencioso que simule IA generativa).

## Pruebas comparativas

```bash
npm run eval                                # ambos motores, llamada directa
node eval/run-eval.js --api http://127.0.0.1:3000   # igual, pero pasando por el endpoint
```

- Dataset y **clasificación de referencia**: [`eval/dataset.json`](eval/dataset.json) (14 casos: normales, ambiguos y 2 adversariales).
- Un caso es correcto si **categoría y prioridad** coinciden con la referencia.
- Salidas: `results/results.md` (tabla) y `results/results.json`.
- Si el proveedor generativo no está configurado, el script **omite** ese motor y lo avisa; nunca rellena resultados.

> ⚠️ El tradicional sale 14/14 en este dataset porque las reglas se escribieron viendo esos casos. Para una comparación honesta, agreguen casos nuevos al dataset antes de ejecutar (`tests/traditional.test.js` ya prueba mensajes que no están en él).

## Resultados y conclusión

> **Pendiente del equipo:** ejecutar `npm run eval` con el modelo real, pegar aquí la tabla de `results/results.md` y escribir la conclusión (≤150 palabras) con los números obtenidos.

| Motor | Correctos | Precisión | Formato válido |
|---|---|---|---|
| traditional | _completar_ | _completar_ | _completar_ |
| generative | _completar_ | _completar_ | _completar_ |

**Conclusión técnica:** _completar_
