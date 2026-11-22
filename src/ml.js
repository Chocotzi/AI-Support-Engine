// EXTRA — Motor ML (aprendizaje automático clásico): TF-IDF + regresión logística.
//
// Python ENTRENA (ml/train.py, con scikit-learn) y guarda los parámetros en ml/model.json.
// Aquí solo se PREDICE, en JS puro, repitiendo las mismas cuentas que hace scikit-learn:
// el servidor sigue sin dependencias y `npm start` funciona sin Python.
//
// Pipeline (cada paso es una función pequeña):
//   1. preprocess     -> normalize + stripInjection (el mismo texto que vio el modelo al entrenar)
//   2. ngrams         -> palabras de 2+ caracteres, unigramas y bigramas (como TfidfVectorizer)
//   3. vectorize      -> TF-IDF con normalización L2
//   4. predictProba   -> softmax(coef · x + intercept): probabilidad de cada categoría
//   5. pickPriority / buildResponse (reglas de traditional.js) y needsReview

import { readFileSync } from 'node:fs';
import { CATEGORIES, validateResult } from './contract.js';
import { normalize, stripInjection } from './security.js';
import { pickPriority, buildResponse } from './traditional.js';

export const MIN_CONFIDENCE = 0.5; // por debajo de esta probabilidad se pide revisión humana
const MODEL_FILE = new URL('../ml/model.json', import.meta.url);

export class MLModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MLModelError';
  }
}

// Se lee una sola vez, la primera vez que se usa el motor (el servidor arranca aunque falte).
let model = null;
function loadModel() {
  if (model) return model;
  try {
    const m = JSON.parse(readFileSync(MODEL_FILE, 'utf8'));
    const n = m.vocabulary.length;
    const shapeOk =
      String([...m.classes].sort()) === String([...CATEGORIES].sort()) &&
      m.idf.length === n &&
      m.intercept.length === m.classes.length &&
      m.coef.length === m.classes.length &&
      m.coef.every((row) => row.length === n);
    if (!shapeOk) throw new Error('forma inválida');
    model = { ...m, index: new Map(m.vocabulary.map((term, i) => [term, i])) };
  } catch {
    throw new MLModelError('ml/model.json no existe o no tiene el formato esperado (ejecute npm run train)');
  }
  return model;
}

// Mismo preprocesamiento que el motor tradicional. ml/train.py también lo usa (vía
// ml/preprocess.js), así que el modelo entrena con exactamente el texto que verá aquí.
export function preprocess(message) {
  return stripInjection(normalize(message));
}

// Igual que TfidfVectorizer(ngram_range=(1, 2)): su token_pattern \b\w\w+\b descarta las
// palabras de 1 carácter, y cada par de palabras consecutivas forma un bigrama.
export function ngrams(text) {
  const words = text.match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  const bigrams = words.slice(1).map((word, i) => `${words[i]} ${word}`);
  return [...words, ...bigrams];
}

// TF-IDF como vector disperso (Map índice -> peso): (veces que aparece) × idf, dividido entre
// la norma L2. Los términos que no estaban en el vocabulario de entrenamiento se ignoran.
function vectorize(text, m) {
  const counts = new Map();
  for (const term of ngrams(text)) {
    const i = m.index.get(term);
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const x = new Map();
  let sumSquares = 0;
  for (const [i, count] of counts) {
    const w = count * m.idf[i];
    x.set(i, w);
    sumSquares += w * w;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm > 0) for (const [i, w] of x) x.set(i, w / norm); // sin palabras conocidas queda en ceros
  return x;
}

// Regresión logística multinomial: un puntaje lineal por categoría y softmax para volverlo probabilidad.
export function predictProba(cleanText) {
  const m = loadModel();
  const x = vectorize(cleanText, m);
  const scores = m.coef.map((row, k) => {
    let z = m.intercept[k];
    for (const [i, w] of x) z += row[i] * w;
    return z;
  });
  const max = Math.max(...scores); // se resta el máximo para que Math.exp no se desborde
  const exps = scores.map((z) => Math.exp(z - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return Object.fromEntries(m.classes.map((c, k) => [c, exps[k] / total]));
}

export function needsReview({ category, priority, injected, confidence }) {
  return category === 'SECURITY' || priority === 'CRITICAL' || injected || confidence < MIN_CONFIDENCE;
}

export function analyzeML(message) {
  const { clean, injected } = preprocess(message);
  const proba = predictProba(clean);
  const [category, confidence] = Object.entries(proba).reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  const priority = pickPriority(category, clean); // decisión A: misma regla de prioridad que el tradicional

  return validateResult(
    {
      category,
      priority,
      response: buildResponse(category, priority),
      requiresHumanReview: needsReview({ category, priority, injected, confidence }),
    },
    'ml',
  );
}

// Datos del modelo para el reporte de evaluación.
export function modelInfo() {
  const m = loadModel();
  return { trainedOn: m.trainedOn, features: m.vocabulary.length, sklearn: m.sklearn };
}
