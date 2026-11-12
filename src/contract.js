// CONTRATO COMPARTIDO (lo definen A y B juntos en la Fase 0).
//
// Ambos motores devuelven EXACTAMENTE esta forma:
//   { category, priority, response, requiresHumanReview, mode }
//
// Toda salida (sobre todo la del modelo generativo) pasa por validateResult()
// antes de salir de la API. Las claves extra se descartan y `mode` se fuerza
// al del motor que realmente se ejecutó.

export const CATEGORIES = ['ACCESS', 'BUG', 'FEATURE', 'SECURITY'];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const MODES = ['traditional', 'generative'];
export const MAX_RESPONSE_LEN = 1200;

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractError';
  }
}

export function validateResult(obj, mode) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ContractError('La salida no es un objeto JSON');
  }
  const missing = ['category', 'priority', 'response', 'requiresHumanReview'].filter(
    (k) => !(k in obj),
  );
  if (missing.length) throw new ContractError(`Faltan campos: ${missing.join(', ')}`);

  const category = typeof obj.category === 'string' ? obj.category.trim().toUpperCase() : null;
  const priority = typeof obj.priority === 'string' ? obj.priority.trim().toUpperCase() : null;

  if (!CATEGORIES.includes(category)) throw new ContractError(`category inválida: ${JSON.stringify(obj.category)}`);
  if (!PRIORITIES.includes(priority)) throw new ContractError(`priority inválida: ${JSON.stringify(obj.priority)}`);
  if (typeof obj.response !== 'string' || !obj.response.trim()) {
    throw new ContractError('response debe ser un texto no vacío');
  }
  if (obj.response.length > MAX_RESPONSE_LEN) throw new ContractError('response excede la longitud máxima');
  if (typeof obj.requiresHumanReview !== 'boolean') {
    throw new ContractError('requiresHumanReview debe ser booleano');
  }
  if (!MODES.includes(mode)) throw new ContractError(`mode inválido: ${mode}`);

  return {
    category,
    priority,
    response: obj.response.trim(),
    requiresHumanReview: obj.requiresHumanReview,
    mode,
  };
}
