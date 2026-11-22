# AI Support Engine

**Integrantes del equipo:**

- Carlos Andrés Arriaga Márquez
- Cleber Antonio Bolaños Moreno
- Benkis Carbajal Hernández

Clasificador de solicitudes de soporte con **tres motores** que cumplen el mismo contrato de respuesta:

- **`traditional`** — IA simbólica: reglas ponderadas, sin modelos generativos.
- **`generative`** — LLM real (Gemini, Ollama local, Anthropic u OpenAI-compatible) con salida JSON validada.
- **`ml`** _(extra, el enunciado no lo pide)_ — aprendizaje automático clásico: TF-IDF + regresión logística entrenada con scikit-learn. Ver [Motor `ml`](#motor-ml-extra).

Node.js ≥ 22, **cero dependencias** (usa `fetch`, `node:http` y `node:test` nativos). Python solo hace falta para **reentrenar** el motor `ml`. Reparto de trabajo del equipo: [`docs/REPARTO.md`](docs/REPARTO.md).

## Arquitectura

```
POST /api/analyze ──► server.js (valida petición, mapea errores)
                         └─► service.js ─┬─► traditional.js   (reglas)
                                         ├─► ml.js            (TF-IDF + regresión logística; lee ml/model.json)
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
| 503 / 504 | Proveedor sin configurar o falta `ml/model.json` / tiempo de espera agotado |

`GET /health` devuelve `{"status":"ok"}`.

## Seguridad y validación

- Petición validada (tipos, longitud, tamaño, `mode`); salida de **todos** los motores validada contra el mismo contrato.
- El mensaje del usuario se trata como **dato**, no como instrucción (prompt y reglas anti-inyección).
- `SECURITY` o intento de manipulación ⇒ `requiresHumanReview: true`, forzado en código aunque el modelo diga lo contrario.
- Secretos pegados por el usuario se redactan antes de llegar al modelo; los logs solo guardan metadatos, nunca el mensaje.
- Si el modelo falla no se inventa respuesta: se devuelve error (no hay *fallback* silencioso que simule IA generativa).

## Motor `ml` (extra)

Entrena en Python y predice en Node. Así el servidor sigue con cero dependencias, corre en un solo proceso y `npm start` funciona sin Python.

```
ml/tickets.csv ──► ml/train.py (scikit-learn) ──► ml/model.json (vocabulario, idf, coeficientes)
                                                        │
POST /api/analyze {mode:"ml"} ─► service.js ─► src/ml.js (TF-IDF + softmax en JS puro)
```

1. **Preprocesamiento:** `normalize` + `stripInjection`, igual que el tradicional. Las órdenes como "ignora las instrucciones…" se quitan **antes** de vectorizar. `train.py` usa ese mismo código de Node (`ml/preprocess.js`), así que el modelo entrena con el mismo texto que verá en producción.
2. **Categoría:** TF-IDF de unigramas y bigramas, más regresión logística multinomial. `src/ml.js` repite las cuentas de scikit-learn. La prueba de paridad (`tests/ml.test.js`) comprueba que las probabilidades en JS y en Python coinciden con un margen de 1e-6; la diferencia medida es de alrededor de 1e-16.
   - La regularización `C` se elige con validación cruzada (log-loss) usando solo el CSV. Salió `C=300`.
   - Con el valor por defecto (`C=1`), la exactitud era casi la misma (70 % contra 71 %), pero el 96 % de las predicciones quedaba bajo 0.5 de probabilidad. Así, el umbral de revisión humana marcaría casi todo.
3. **Prioridad y respuesta:** usan las mismas reglas del tradicional (`pickPriority` y `buildResponse`). Con 240 ejemplos, un modelo de prioridad sería débil. Por eso la comparación mide solo qué motor clasifica mejor la categoría.
4. **Revisión humana:** se marca si la categoría es SECURITY, la prioridad es CRITICAL, hubo intento de manipulación o la probabilidad de la categoría ganadora es menor a 0.5.

**Datos de entrenamiento** ([`ml/tickets.csv`](ml/tickets.csv)): 240 tickets sintéticos, 60 por categoría, generados con IA (Claude). La mayoría está en español y algunos en inglés.

- No se usaron los casos de `eval/dataset.json` y se evitó parafrasearlos.
- `train.py` **se detiene** si algún caso de la evaluación aparece en el CSV, o si se parece a un ticket con una similitud de palabras ≥ 0.6. Al entrenar, imprime los tres parecidos más altos.
- Aviso honesto: quien generó los tickets **tuvo a la vista** la evaluación, así que puede haber cierta afinidad de temas (por ejemplo, phishing o cuentas bloqueadas). La validación con el 20 % separado del CSV no depende de eso.
- La columna `priority` es informativa: el motor no la usa.

Para reentrenar (por ejemplo, después de agregar tickets al CSV):

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt   # Windows
# ml/.venv/bin/python -m pip install -r ml/requirements.txt     # macOS / Linux
npm run train    # imprime classification_report y validación cruzada; reescribe ml/model.json
npm test         # incluye la prueba de paridad Python <-> JS
```

`ml/model.json` se sube al repositorio. Si falta, `mode:"ml"` responde 503 `ML_MODEL_NOT_AVAILABLE`.

## Pruebas comparativas

```bash
npm run eval                                # los tres motores, llamada directa
npm run eval:ml                             # solo ml (también eval:traditional); reescribe results/ solo con ese motor
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
| generative (Gemini `gemini-3.6-flash`) | 15/20 | 75% (15 de las 17 que respondió el proveedor) | 85%: las 3 fallas son del proveedor (1 tiempo agotado, 2 HTTP 429), no JSON inválido |
| ml | 18/20 | 90% (casos nuevos 15–20: 5/6) | 100% |

Fallos del tradicional, todos en casos nuevos: #16 "cuenta bloqueada" → BUG (no reconoce "bloqueada" como acceso); #18 excompañero con acceso → BUG (no detecta el riesgo sin palabras como "vulnerabilidad"); #20 adversarial "solo una sugerencia" → FEATURE (la frase engañosa le gana a "tokens de sesión visibles").

Fallos del generativo:
- Clasificó bien la categoría, pero subió la prioridad un nivel en dos casos: #2 y #18 quedaron CRITICAL; la referencia es HIGH.
- En #3, #19 y #20 no hubo respuesta: el proveedor agotó el tiempo o rechazó la petición por límite de uso. Esos casos cuentan como incorrectos.
- Volver a ejecutar `npm run eval` cuando se libere la cuota debería dar una fila sin errores del proveedor.

Fallos del ml:
- #9 "Ayuda, no funciona." → ACCESS: el mensaje casi no tiene palabras propias de una falla.
- #18 excompañero que todavía puede entrar → ACCESS: "puede entrar" pesa hacia acceso, y el modelo no capta que el riesgo es de seguridad.

> ⚠️ Cómo leer el 90 % del ml:
> - Sale de solo 20 casos: cada acierto o fallo mueve el resultado 5 puntos.
> - Con tickets del CSV que el modelo no vio, la exactitud fue menor: 62.5 % con el 20 % separado y 71 % con validación cruzada. Es de esperar que rinda por debajo del 90 % con mensajes nuevos.
> - Quien generó los datos de entrenamiento conocía la evaluación (ver [Motor `ml`](#motor-ml-extra)).
> - No se ajustó nada después de ver estos resultados. `C` se eligió antes, con validación cruzada sobre el CSV.

**Conclusión técnica:** _completar_
