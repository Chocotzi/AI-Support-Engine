// PARTE C — Motor de Machine Learning (aprendizaje supervisado: TF-IDF + regresión logística).
//
// El modelo vive en Python (ml/model.py, pandas + scikit-learn) y SOLO decide la categoría.
// Node lo usa a través de un proceso persistente (ml/bridge.py) que habla JSON por stdin/stdout.
//
// Pipeline:
//   1. prepare        -> redacta secretos, normaliza y quita órdenes de inyección (igual que los otros motores)
//   2. predict        -> Python devuelve { category, confidence }
//   3. pickPriority   -> reglas de prioridad del motor tradicional (el modelo no aprende prioridad)
//   4. buildResponse  -> respuesta predeterminada del motor tradicional
//   5. review         -> revisión humana si: baja confianza, SECURITY, CRITICAL, inyección,
//                        o las reglas ven una señal fuerte de seguridad que el modelo no vio
//
// Aprendizaje continuo: learnML() guarda una corrección CONFIRMADA por una persona y reentrena.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, validateResult } from './contract.js';
import { normalize, redactSecrets, stripInjection } from './security.js';
import { scoreCategories, pickPriority, buildResponse } from './traditional.js';

const BRIDGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ml', 'bridge.py');

// Por debajo de esta probabilidad la predicción se marca para revisión humana.
export const MIN_CONFIDENCE = 0.5;

export class MLError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MLError';
    this.code = code; // ML_UNAVAILABLE | ML_TIMEOUT | ML_FAILED | ML_INVALID_INPUT
  }
}

// Cliente del proceso Python. Se arranca en la primera llamada y se reutiliza.
export function createPythonClient({
  python = process.env.ML_PYTHON || 'python',
  timeoutMs = Number(process.env.ML_TIMEOUT_MS) || 20000,
} = {}) {
  let current = null;

  function start() {
    const child = spawn(python, [BRIDGE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const state = { child, pending: new Map(), nextId: 0 };

    const failAll = (code, msg) => {
      for (const p of state.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new MLError(code, msg));
      }
      state.pending.clear();
      if (current === state) current = null; // la próxima llamada vuelve a arrancar Python
    };
    child.on('error', () => failAll('ML_UNAVAILABLE', 'No se pudo iniciar el motor de ML (¿Python instalado?)'));
    child.on('exit', () => failAll('ML_UNAVAILABLE', 'El proceso del motor de ML terminó'));
    child.stdin.on('error', () => {}); // EPIPE si Python murió: lo reporta 'exit'
    child.stderr.resume(); // se descarta: no se registran trazas que puedan traer contenido

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = state.pending.get(msg.id);
      if (!p) return;
      state.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new MLError('ML_FAILED', 'El motor de ML no pudo procesar la solicitud'));
      else p.resolve(msg);
    });

    // El proceso hijo no impide que Node termine; mientras haya una petición pendiente,
    // su temporizador mantiene vivo el proceso.
    child.unref();
    for (const s of [child.stdin, child.stdout, child.stderr]) s.unref?.();
    return state;
  }

  function call(payload) {
    if (!current) current = start();
    const state = current;
    const id = state.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new MLError('ML_TIMEOUT', 'El motor de ML no respondió a tiempo'));
        state.child.kill(); // un proceso colgado no debe bloquear las siguientes peticiones
      }, timeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      state.child.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
    });
  }

  return {
    predict: (message) => call({ op: 'predict', message }),
    learn: (message, category) => call({ op: 'learn', message, category }),
    ping: () => call({ op: 'ping' }),
    close() {
      if (current) current.child.stdin.end();
      current = null;
    },
  };
}

let defaultClient = null;
const getClient = (deps) => deps.mlClient ?? (defaultClient ??= createPythonClient());

export function closeML() {
  defaultClient?.close();
  defaultClient = null;
}

export async function pingML(deps = {}) {
  return getClient(deps).ping();
}

function prepare(message) {
  return stripInjection(normalize(redactSecrets(message)));
}

export async function analyzeML(message, deps = {}) {
  const { clean, injected } = prepare(message);
  const { category, confidence } = await getClient(deps).predict(clean);
  if (!CATEGORIES.includes(category) || typeof confidence !== 'number') {
    throw new MLError('ML_FAILED', 'El motor de ML devolvió una predicción inválida');
  }

  const priority = pickPriority(category, clean);
  // Guardrail: si las reglas ven una señal fuerte de seguridad y el modelo no, lo revisa una persona.
  const missedSecurity = category !== 'SECURITY' && scoreCategories(clean).SECURITY >= 3;
  const requiresHumanReview =
    category === 'SECURITY' ||
    priority === 'CRITICAL' ||
    injected ||
    confidence < MIN_CONFIDENCE ||
    missedSecurity;

  return validateResult(
    { category, priority, response: buildResponse(category, priority), requiresHumanReview },
    'ml',
  );
}

// Solo debe llamarse con una categoría CONFIRMADA por una persona (ver POST /api/feedback).
export async function learnML(message, category, deps = {}) {
  if (!CATEGORIES.includes(category)) throw new MLError('ML_INVALID_INPUT', 'category inválida');
  const { clean } = prepare(message);
  if (!clean) throw new MLError('ML_INVALID_INPUT', 'El mensaje no tiene contenido para aprender');
  const out = await getClient(deps).learn(clean, category);
  return { trainedOn: out.trainedOn };
}
