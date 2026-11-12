// Punto único de entrada a los motores. La API y el script de evaluación usan ESTA función,
// así lo que se evalúa es exactamente lo que se sirve.

import { analyzeTraditional } from './traditional.js';
import { analyzeGenerative } from './generative.js';

export async function analyze(message, mode, deps = {}) {
  if (mode === 'traditional') return analyzeTraditional(message);
  if (mode === 'generative') return analyzeGenerative(message, deps);
  throw new Error(`mode no soportado: ${mode}`);
}
