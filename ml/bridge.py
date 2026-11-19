"""Puente Node <-> Python para el motor de ML.

src/ml.js abre este proceso UNA vez y se comunica por stdin/stdout con una línea JSON por mensaje:
  -> {"id": 1, "op": "predict", "message": "..."}
  <- {"id": 1, "category": "ACCESS", "confidence": 0.82}
  -> {"id": 2, "op": "learn", "message": "...", "category": "SECURITY"}
  <- {"id": 2, "ok": true, "trainedOn": 201}
  -> {"id": 3, "op": "ping"}
  <- {"id": 3, "ok": true, "trainedOn": 201}

stdout SOLO lleva respuestas JSON. Los errores devuelven el tipo de error, nunca el contenido
del mensaje (puede traer datos personales).
"""

import json
import sys

import model as ml


def handle(req, state):
    op = req.get("op")
    if op == "predict":
        proba = state["model"].predict_proba([str(req["message"])])[0]
        i = int(proba.argmax())
        return {"category": str(state["model"].classes_[i]), "confidence": round(float(proba[i]), 4)}
    if op == "learn":
        state["model"], state["n"] = ml.learn(str(req["message"]), str(req["category"]))
        return {"ok": True, "trainedOn": state["n"]}
    if op == "ping":
        return {"ok": True, "trainedOn": state["n"]}
    raise ValueError("operación desconocida")


def main():
    # En Windows la consola usa cp1252 por defecto: se fuerza UTF-8 para los acentos.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

    model, n = ml.train()
    state = {"model": model, "n": n}

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            out = handle(req, state)
        except Exception as err:  # noqa: BLE001 — se responde el error en vez de tumbar el proceso
            out = {"error": type(err).__name__}
        print(json.dumps({"id": req_id, **out}), flush=True)


if __name__ == "__main__":
    main()
