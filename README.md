# AI Support Engine

**Integrantes del equipo:**

- Carlos Andrés Arriaga Márquez
- Cleber Antonio Bolaños Moreno
- Benkis Carbajal Hernández

Clasificador de solicitudes de soporte con **tres motores** que cumplen el mismo contrato de respuesta:

- **`traditional`** — IA simbólica: reglas ponderadas, sin modelos generativos.
- **`generative`** — LLM real (Gemini, Ollama local, Anthropic u OpenAI-compatible) con salida JSON validada.
- **`ml`** — Machine Learning supervisado (pandas + scikit-learn: TF-IDF + regresión logística) que **aprende de las correcciones** confirmadas por una persona.

Node.js ≥ 22, **cero dependencias de npm** (usa `fetch`, `node:http` y `node:test` nativos). El motor `ml` además necesita Python con pandas y scikit-learn. Reparto de trabajo del equipo: [`docs/REPARTO.md`](docs/REPARTO.md).

## Arquitectura

```
POST /api/analyze ──► server.js (valida petición, mapea errores)
                         └─► service.js ──► traditional.js   (reglas)
                                       ├─► generative.js ──► providers.js ──► LLM
                                       └─► ml.js ──► ml/bridge.py ──► ml/model.py (scikit-learn)
                                                 │
                       contract.js ◄─────────────┘  (valida TODA salida)
                       security.js  (redacción de secretos, detección de inyección)

POST /api/feedback ──► server.js (token) ──► ml.js ──► ml/feedback.csv + reentrenamiento
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

### Motor de Machine Learning (`ml`)

```bash
python -m pip install -r ml/requirements.txt   # pandas + scikit-learn
npm run ml:train                               # reporte: train/test 80/20 + validación cruzada
```

- **Datos:** [`ml/tickets.csv`](ml/tickets.csv), con 200 ejemplos (50 por categoría) redactados aparte. **Ninguno** es un caso de `eval/dataset.json`, para que la comparación sea justa.
- **Modelo:** `TfidfVectorizer(ngram_range=(1, 2), strip_accents="unicode")` + `LogisticRegression`. Solo decide la **categoría**. La prioridad y la respuesta salen de las reglas del motor tradicional (`pickPriority`, `buildResponse`).
- **Integración con Node:** `src/ml.js` abre **un** proceso Python (`ml/bridge.py`) y se comunican con una línea JSON por mensaje. El modelo se entrena al arrancar (milisegundos), así que la primera petición tarda unos segundos.
- **Revisión humana** si la confianza es menor a 0.5, si la categoría es `SECURITY`, si la prioridad es `CRITICAL`, si hubo intento de inyección, o si las reglas detectan una señal fuerte de seguridad que el modelo no vio.
- Si Python no está disponible, la API responde **503** (no se usa otro motor a escondidas). Variables opcionales: `ML_PYTHON`, `ML_TIMEOUT_MS`.

#### Aprendizaje continuo (`POST /api/feedback`)

Una persona confirma o corrige la categoría y el modelo se reentrena con ese ejemplo:

```bash
curl -X POST http://127.0.0.1:3000/api/feedback \
  -H 'content-type: application/json' -H "authorization: Bearer $FEEDBACK_TOKEN" \
  -d '{"message":"Un exempleado todavía entra al panel","category":"SECURITY"}'
# {"ok":true,"trainedOn":201}
```

- Requiere `FEEDBACK_TOKEN` en `.env`. Sin él, el endpoint responde **503**. Con un token incorrecto responde **401**.
- **Por qué el token:** si cualquiera pudiera enseñarle al modelo, un atacante podría mandar muchos "vulnerabilidad = FEATURE" hasta que el modelo lo aprenda (*envenenamiento de datos*).
- Las correcciones se guardan en `ml/feedback.csv` (ignorado por git), normalizadas y con secretos redactados. `tickets.csv` nunca se modifica.

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
| 400 | `message` ausente/vacío/>2000 caracteres, `mode` inválido (`traditional`, `generative`, `ml`), JSON malformado |
| 401 | `/api/feedback` sin token o con token incorrecto |
| 413 / 415 | Cuerpo >10 KB / `Content-Type` distinto de JSON |
| 502 | El proveedor falló o el modelo no devolvió el formato esperado |
| 503 / 504 | Proveedor o motor ML no disponible (o feedback deshabilitado) / tiempo de espera agotado |

`GET /health` devuelve `{"status":"ok"}`.

## Seguridad y validación

- Petición validada (tipos, longitud, tamaño, `mode`); salida de **ambos** motores validada contra el mismo contrato.
- El mensaje del usuario se trata como **dato**, no como instrucción (prompt y reglas anti-inyección).
- `SECURITY` o intento de manipulación ⇒ `requiresHumanReview: true`, forzado en código aunque el modelo diga lo contrario.
- Secretos pegados por el usuario se redactan antes de llegar al modelo; los logs solo guardan metadatos, nunca el mensaje.
- Si el modelo falla no se inventa respuesta: se devuelve error (no hay *fallback* silencioso que simule IA generativa).

## Pruebas comparativas

```bash
npm run eval                                # los tres motores, llamada directa
npm run eval:ml                             # traditional vs ml -> results/results-ml.md
node eval/run-eval.js --api http://127.0.0.1:3000   # igual, pero pasando por el endpoint
```

- Dataset y **clasificación de referencia**: [`eval/dataset.json`](eval/dataset.json) (20 casos: normales, ambiguos y 3 adversariales). Los casos 15–20 se agregaron con su referencia fijada **antes** de ejecutar y sin ajustar las reglas después.
- Un caso es correcto si **categoría y prioridad** coinciden con la referencia.
- Salidas: `results/results.md` (tabla) y `results/results.json`.
- Si el proveedor generativo no está configurado, el script **omite** ese motor y lo avisa; nunca rellena resultados.

> ⚠️ Las reglas del tradicional se escribieron viendo los casos 1–14 (los acierta todos). Los casos 15–20 son nuevos para el motor y muestran su rendimiento real fuera de lo que ya conocía.

## Resultados y conclusión

Detalle por caso: [`results/results.md`](results/results.md). Evidencia del endpoint: [`results/evidencia-endpoint.md`](results/evidencia-endpoint.md).

| Motor | Correctos | Precisión (cat+prio) | Formato válido |
|---|---|---|---|
| traditional | 17/20 | 85% (casos nuevos 15–20: 3/6) | 100% |
| generative | _pendiente: falta configurar el proveedor y ejecutar `npm run eval`_ | | |
| ml | 18/20 | 90% | 100% |

Motor `ml` (detalle en [`results/results-ml.md`](results/results-ml.md)): en su propio dataset obtiene 75% en la partición 80/20 y 76,5% ± 4,6% en validación cruzada. Acierta #16 y #20, donde falla el tradicional. Falla en #9 "Ayuda, no funciona" (→ ACCESS: el mensaje casi no tiene palabras útiles) y en #18 excompañero con acceso (→ ACCESS: asocia "puede entrar al panel" con un problema de acceso, no con un riesgo). Es justo el tipo de error que corrige el feedback. Con solo 200 ejemplos la cifra es orientativa.

Fallos del tradicional, todos en casos nuevos: #16 "cuenta bloqueada" → BUG (no reconoce "bloqueada" como acceso); #18 excompañero con acceso → BUG (no detecta el riesgo sin palabras como "vulnerabilidad"); #20 adversarial "solo una sugerencia" → FEATURE (la frase engañosa le gana a "tokens de sesión visibles").

**Conclusión técnica:** _completar_
