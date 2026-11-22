# Backlog

## [HECHO] Tercer motor: `ml` (TF-IDF + regresión logística)

**Registrado:** 2026-11-18 · **Estado:** implementado el 2026-11-19 en la rama `feat/ml` (sin commit todavía) · **Pendiente del equipo:** agregar tickets propios al CSV y escribir la conclusión técnica

Agregar un tercer modo, `mode: "ml"`, que clasifique con aprendizaje automático clásico (scikit-learn) y cumpla el mismo contrato que `traditional` y `generative`. Es extra: el enunciado solo exige los otros dos modos, y estos siguen funcionando igual.

### Código base propuesto

```python
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report

data = pd.read_csv("tickets.csv")

X_train, X_test, y_train, y_test = train_test_split(
    data["message"], data["category"],
    test_size=0.2, stratify=data["category"], random_state=42,
)

model = Pipeline([
    ("vectorizer", TfidfVectorizer(ngram_range=(1, 2))),
    ("classifier", LogisticRegression(max_iter=1000)),
])
model.fit(X_train, y_train)
print(classification_report(y_test, model.predict(X_test)))
print(model.predict(["Alguien entró a mi cuenta sin autorización"]))
```

### Lo que hay que resolver antes de integrarlo

1. **El proyecto es Node.js sin dependencias** y el código es Python. Hay Python 3.11.9, pero **scikit-learn no está instalado**.
2. **`tickets.csv` no existe.** Hay que crear datos de entrenamiento que **no salgan de `eval/dataset.json`**. Si el modelo entrena con los casos de la evaluación, los memoriza y el porcentaje no sirve.
3. **Solo predice la categoría.** El contrato pide además `priority`, `response` y `requiresHumanReview`.
4. **Sin filtro, las frases manipuladoras lo engañan.** Hay que pasar el texto por `stripInjection` antes de vectorizar.

### Arquitectura: entrenar en Python, predecir en Node

```
ml/train.py  (código base + exportación)  ──►  ml/model.json  (vocabulario, idf, coeficientes)
                                                     │
POST /api/analyze {mode:"ml"} ─► service.js ─► src/ml.js  (TF-IDF + softmax en JS puro)
```

- **Python solo se usa para entrenar.** El script imprime el `classification_report` y guarda los parámetros del modelo en un JSON, que se sube al repo.
- **Node hace la predicción** (unas 60 líneas). El servidor sigue con cero dependencias y un solo proceso, y `npm start` funciona sin Python.
- **Alternativas descartadas:**
  - Que Node lance Python en cada petición: tarda alrededor de 1 s por cargar sklearn y obliga a tener Python en el servidor.
  - Un microservicio aparte en Flask o FastAPI: son dos servidores para algo pequeño.

### Decisiones pendientes (la primera opción de cada una es la recomendada)

- [x] **A. Prioridad** → se usan las reglas de `pickPriority`
  - **Recomendado: las reglas de `pickPriority`** de `traditional.js`. Con unos 240 ejemplos, un modelo de prioridad sería débil, y así la comparación mide solo qué clasifica mejor la categoría.
  - Alternativa: un segundo `LogisticRegression` entrenado con la columna `priority`.
- [x] **B. Datos de entrenamiento** → 240 tickets sintéticos generados con IA; faltan los ejemplos escritos por el equipo
  - **Recomendado: tickets sintéticos generados con IA**, declarados en el README, sin parafrasear los casos de evaluación, con una revisión de coincidencias y algunos ejemplos escritos por el equipo.
  - Alternativa: que el equipo escriba todo el CSV.

### Tareas

- [x] **0.** Crear la rama `feat/ml` desde `main`.
- [x] **1. Datos** (`ml/tickets.csv`): unos 240 tickets en español, 60 por categoría, con columnas `message,category,priority`.
- [x] **2. Entrenamiento** (`ml/train.py`, `ml/requirements.txt` con `pandas` y `scikit-learn`):
  - Instalar en un entorno virtual `ml/.venv` (agregarlo a `.gitignore`).
  - Preprocesar igual que `normalize()` de `src/security.js`: NFD, quitar U+0300–U+036F y pasar a minúsculas.
  - Exportar `ml/model.json` con `classes`, `vocabulary`, `idf`, `coef` e `intercept`, más unas frases de muestra con las probabilidades que da Python, para la prueba de paridad.
  - Fallar si algún mensaje de `eval/dataset.json` aparece en el CSV.
- [x] **3. Motor en Node** (`src/ml.js`):
  - Separar las palabras como sklearn (palabras de 2 o más caracteres, `[\p{L}\p{N}_]{2,}`), con unigramas y bigramas.
  - Calcular TF-IDF con normalización L2 y aplicar softmax para obtener la categoría y su probabilidad.
- [x] **4. Completar el contrato:**
  - `priority` según la decisión A.
  - `response` con `buildResponse`.
  - `requiresHumanReview` si la categoría es SECURITY, la prioridad es CRITICAL, hay manipulación o la probabilidad es menor a 0.5.
  - Pasar la salida por `validateResult(…, 'ml')`.
- [x] **5. Integración:**
  - `MODES` incluye `'ml'` en `src/contract.js` (el servidor ya valida contra esa lista).
  - Agregar la ruta en `src/service.js`.
  - Motores por defecto de `eval/run-eval.js`: `traditional`, `generative` y `ml`.
  - Scripts `train` y `eval:ml` en `package.json`.
- [x] **6. Pruebas** (`tests/ml.test.js`, `tests/api.test.js`):
  - Las probabilidades de JS coinciden con las de Python (margen de 1e-6).
  - Cumple el contrato.
  - SECURITY pide revisión humana.
  - El caso adversarial queda bien clasificado.
  - `POST` con `mode:"ml"` responde 200.
- [x] **7. Ejecutar y documentar:**
  - Correr `pip install`, `npm run train`, `npm test` y `npm run eval`.
  - README: arquitectura, cómo reentrenar, origen de los datos y tabla con números reales.

### Criterios de terminado

- `npm test` pasa, incluida la prueba de paridad Python↔JS.
- `npm start` funciona sin tener Python instalado.
- `results/results.md` incluye la fila de `ml`, medida con los 20 casos de `eval/dataset.json`, que no se usan para entrenar.

### Avisos

- `npm run eval` sobrescribe `results/results.md` y `results.json`. Si Gemini no está configurado, la tabla quedará con `traditional` y `ml`.
- Cada integrante debe poder explicar el motor. Hay que mantener `src/ml.js` corto y comentado, igual que `traditional.js`.

### Resultado (2026-11-19)

- `npm test`: 45/45, incluida la paridad Python↔JS (diferencia máxima ≈ 1e-16).
- `npm run eval`, sobre los 20 casos de `eval/dataset.json`:
  - traditional: 17/20 (85 %).
  - ml: 18/20 (90 %).
  - generative (Gemini): 15/20 (75 %), con 3 errores del proveedor (1 tiempo agotado y 2 HTTP 429).
- Validación interna del ml con tickets del CSV que no vio: 62.5 % con el 20 % separado y 71 % con validación cruzada.
- Cambio frente al código base: `C` se elige por validación cruzada (log-loss) y salió `C=300`. Con `C=1`, el 96 % de las predicciones quedaba bajo el umbral de 0.5 de revisión humana.
- Cambio frente al plan: Python no reimplementa `normalize`. Llama a `ml/preprocess.js`, que usa el mismo código de Node, así que `stripInjection` también se aplica al entrenar.
