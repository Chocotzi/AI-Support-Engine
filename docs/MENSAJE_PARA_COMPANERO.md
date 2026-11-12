# Mensaje para mi compañero/a — Persona B (Motor generativo + API + Seguridad)

Hola. Ya dejé armado el proyecto completo (Node.js, sin dependencias). Nos dividimos por archivos para no pisarnos:
yo hago la **Parte A** (motor tradicional + evaluación) y tú la **Parte B** (motor generativo + API + seguridad).
El reparto completo está en `docs/REPARTO.md`.

## 1. Preparación (10 min)

```bash
git pull
git checkout -b feat/generative
node --version          # necesitas Node 22 o superior
cp .env.example .env    # NO subas .env a git
npm test                # debe dar 27 pruebas en verde
```

Elige un proveedor de IA y configúralo en `.env`:

| Opción | Pasos |
|---|---|
| **Ollama (local, gratis, recomendada)** | Instala https://ollama.com, luego `ollama pull llama3.2`. Deja `LLM_PROVIDER=ollama` |
| Anthropic | `LLM_PROVIDER=anthropic` y `ANTHROPIC_API_KEY=...` |
| OpenAI o compatible | `LLM_PROVIDER=openai` y `OPENAI_API_KEY=...` |

## 2. Tus archivos (solo toca estos)

- `src/generative.js`: prompt, reintento, guardrails
- `src/providers.js`: conexión con Ollama / Anthropic / OpenAI
- `src/server.js`: endpoint `POST /api/analyze` y validación de la petición
- `tests/generative.test.js` y `tests/api.test.js`

`src/contract.js`, `src/security.js` y `src/service.js` son compartidos: si necesitas cambiarlos, avísame antes.

## 3. Tu lista de tareas

1. **Probar el modelo real.** `npm start` y luego:
   ```bash
   curl -X POST http://127.0.0.1:3000/api/analyze -H "content-type: application/json" \
     -d "{\"message\":\"No puedo iniciar sesión\",\"mode\":\"generative\"}"
   ```
   En Windows PowerShell usa `curl.exe` o `Invoke-RestMethod`.
2. **Afinar el prompt** (`SYSTEM_PROMPT` en `generative.js`) hasta que el modelo clasifique bien las 14 solicitudes de `eval/dataset.json`, **sin copiar los casos dentro del prompt**. Con un modelo pequeño probablemente tendrás que ajustarlo.
3. **Probar los fallos y guardar la evidencia:** apaga Ollama (debe dar 502), pon una llave inválida, usa un modelo inexistente, manda mensajes vacíos o muy largos (400). Ninguna respuesta debe mostrar llaves ni detalles internos.
4. **Probar los 2 casos adversariales** con el modelo real y revisar que `requiresHumanReview` salga `true`.
5. **Revisar el repo:** `git log -p | findstr /i "sk- api_key"` no debe encontrar llaves. `.env` está en `.gitignore`.
6. **Ejecutar la evaluación juntos:** `npm run eval` (o `node eval/run-eval.js --api http://127.0.0.1:3000` para tener evidencia vía endpoint). Guardamos `results/results.md`.

## 4. Lo que debes poder explicar (el profesor lo pide)

- Por qué el mensaje del usuario va dentro de `<solicitud>` y se trata como dato, no como instrucción.
- Por qué se valida la salida del modelo con `validateResult` y por qué solo se reintenta una vez.
- Qué hacen los guardrails en código y por qué no basta con confiar en el modelo.
- Por qué no hay *fallback* al motor tradicional cuando el modelo falla (sería simular una respuesta generativa).
- Qué código HTTP devuelve cada error: 400, 413, 415, 502, 503, 504.

## 5. Flujo de git

Commits pequeños en tu rama `feat/generative`, abre un PR y yo lo reviso; yo te paso el mío (`feat/traditional`). Así los dos entendemos todo el código.

## 6. Checklist final (los dos)

- [ ] `npm test` en verde
- [ ] `npm run eval` con ambos motores y `results/` en el repo
- [ ] Captura del endpoint funcionando en ambos modos
- [ ] Conclusión de máximo 150 palabras en el README, con los números reales
- [ ] Sin `.env` ni llaves en git
