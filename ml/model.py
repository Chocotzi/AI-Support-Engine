"""PARTE C — Motor de Machine Learning (aprendizaje supervisado con scikit-learn).

Pipeline: TF-IDF (unigramas + bigramas) -> Regresión logística. Solo decide la CATEGORÍA;
la prioridad, la respuesta y la revisión humana las completa src/ml.js reutilizando
las reglas del motor tradicional.

Datos:
  ml/tickets.csv   -> dataset base (message,category), escrito a mano, SIN casos de eval/dataset.json
  ml/feedback.csv  -> correcciones confirmadas por una persona (POST /api/feedback). No va a git.

Uso:
  python ml/model.py        # evalúa (train/test 80/20 + validación cruzada) e imprime el reporte
"""

from pathlib import Path

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline

BASE = Path(__file__).resolve().parent
DATA = BASE / "tickets.csv"
FEEDBACK = BASE / "feedback.csv"
CATEGORIES = {"ACCESS", "BUG", "FEATURE", "SECURITY"}


def load_data():
    """Dataset base + correcciones humanas, solo con categorías válidas."""
    data = pd.read_csv(DATA, encoding="utf-8")
    if FEEDBACK.exists():
        data = pd.concat([data, pd.read_csv(FEEDBACK, encoding="utf-8")], ignore_index=True)
    data = data.dropna(subset=["message", "category"])
    return data[data["category"].isin(CATEGORIES)].reset_index(drop=True)


def build_model():
    return Pipeline([
        # strip_accents: "sesión" y "sesion" cuentan como la misma palabra
        ("vectorizer", TfidfVectorizer(ngram_range=(1, 2), strip_accents="unicode")),
        ("classifier", LogisticRegression(max_iter=1000)),
    ])


def train():
    """Entrena con TODOS los datos disponibles. Devuelve (modelo, número de ejemplos)."""
    data = load_data()
    model = build_model().fit(data["message"], data["category"])
    return model, len(data)


def learn(message, category):
    """Aprendizaje continuo: guarda la corrección en feedback.csv y reentrena."""
    if category not in CATEGORIES:
        raise ValueError("categoría inválida")
    row = pd.DataFrame([{"message": message, "category": category}])
    row.to_csv(FEEDBACK, mode="a", header=not FEEDBACK.exists(), index=False, encoding="utf-8")
    return train()


def evaluate():
    """El script original: separación 80/20 estratificada + classification_report."""
    data = load_data()

    X_train, X_test, y_train, y_test = train_test_split(
        data["message"],
        data["category"],
        test_size=0.2,
        stratify=data["category"],
        random_state=42,
    )

    model = build_model()
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    print(f"Ejemplos: {len(data)} ({len(X_train)} entrenamiento / {len(X_test)} prueba)\n")
    print(classification_report(y_test, predictions))

    # Con pocos datos una sola partición es ruidosa: la validación cruzada da una cifra más estable.
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(build_model(), data["message"], data["category"], cv=folds)
    print(f"Validación cruzada (5 particiones): {scores.mean():.1%} ± {scores.std():.1%}\n")

    final, _ = train()
    print(final.predict([
        "Alguien entró a mi cuenta sin autorización"
    ]))


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8")  # acentos legibles en la consola de Windows
    evaluate()
