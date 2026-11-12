// PARTE A — Motor tradicional (IA simbólica basada en reglas). NO usa modelos generativos.
//
// Pipeline (cada paso es una función pequeña y explicable):
//   1. normalize        -> minúsculas y sin acentos
//   2. stripInjection   -> elimina órdenes dirigidas al sistema ("ignora las instrucciones...")
//   3. scoreCategories  -> puntúa cada categoría con palabras clave ponderadas
//   4. pickCategory     -> elige la ganadora (SECURITY tiene precedencia por seguridad)
//   5. pickPriority     -> reglas de prioridad propias de cada categoría
//   6. buildResponse    -> respuesta predeterminada acorde a categoría/prioridad
//   7. needsReview      -> marca revisión humana (seguridad, inyección, baja confianza, crítico)

import { validateResult } from './contract.js';
import { normalize, stripInjection } from './security.js';

// [expresión regular, peso]. Se evalúa sobre texto normalizado (sin acentos).
const KEYWORDS = {
  SECURITY: [
    [/vulnerabilidad|vulnerability|inyeccion|sql injection|\bxss\b|\bcsrf\b/, 3],
    [/phishing|sospechos[oa]|suplantacion/, 3],
    [/acceso no autorizado|sin autorizacion|no autorizado|unauthorized|brecha|breach|filtracion|fuga de datos|data leak|ransomware|malware|hackeo|hackearon|hackers?|exfiltr|robo de (datos|informacion|credenciales)|credenciales (comprometidas|expuestas|filtradas)/, 4],
  ],
  ACCESS: [
    [/iniciar sesion|\blogin\b|log ?in\b|sign ?in\b|inicio de sesion/, 3],
    [/no (puedo|puede|pueden|podemos) (entrar|acceder|ingresar)/, 3],
    [/verificar mi identidad|codigo de verificacion|\b2fa\b|\bmfa\b|autenticacion/, 3],
    [/contrasena|password|cuenta bloqueada|acceso (denegado|bloqueado)|restablecer|recuperar (mi )?(cuenta|acceso)|permisos? denegados?/, 2],
  ],
  BUG: [
    [/no funciona|\bfall(a|an|o|ando|ar)\b|crash(es|ed)?|se (cae|cierra|congela)|caid[oa]|exception|\bbug\b/, 2],
    [/\berror(es)?\b|lent[oa]|congela|timeout|\b500\b|incorrect[oa]/, 1],
  ],
  FEATURE: [
    [/me gustaria|seria (genial|util|bueno)|nueva funcion(alidad)?|funcionalidad|sugerencia|sugiero|feature request|would be nice|add support|dark mode|modo oscuro/, 3],
    [/(necesitamos|quisieramos|quiero|queremos) poder|podrian (agregar|anadir|incluir)|agregar|anadir|implementar|integracion con/, 3],
  ],
};

const TIE_ORDER = ['SECURITY', 'ACCESS', 'BUG', 'FEATURE']; // desempate por severidad

export function scoreCategories(text) {
  const scores = {};
  for (const [category, rules] of Object.entries(KEYWORDS)) {
    scores[category] = rules.reduce((sum, [re, weight]) => sum + (re.test(text) ? weight : 0), 0);
  }
  return scores;
}

export function pickCategory(scores) {
  // Una señal fuerte de seguridad siempre gana: es mejor un falso positivo que ignorar un incidente.
  if (scores.SECURITY >= 3) return 'SECURITY';
  const ranked = [...TIE_ORDER].sort((a, b) => scores[b] - scores[a] || TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b));
  // Sin ninguna coincidencia: se asume BUG (lo más común) y se marcará para revisión por baja confianza.
  return scores[ranked[0]] > 0 ? ranked[0] : 'BUG';
}

const GROUP_IMPACT = /\b(todos|todas|toda|todo el|equipo|area|departamento|empresa|oficina|usuarios|clientes)\b|\b\d{2,}\s+(personas|usuarios|empleados)|administrador|\badmin\b|no podemos|urgente|sin poder trabajar/;
const TOTAL_OUTAGE = /nadie puede|todos los usuarios|toda la empresa|all users|ningun usuario/;
const PRODUCTION_CONTEXT = /produccion|production|pagos|payment|facturacion|checkout/;
const OUTAGE_SIGNAL = /caid[oa]|\bdown\b|no pueden|no funciona|no responde|fuera de servicio/;
const DATA_LOSS = /perdida de datos|data loss|corrupcion de datos|se borraron|borrado de datos/;
const COSMETIC = /ortografia|typo|tipografia|color|alineacion|alineado|texto cortado|icono|estetic|visual/;
const BUG_WIDE_IMPACT = /todos los usuarios|varios usuarios|muchos usuarios|no se puede (trabajar|facturar|usar)|bloquea|datos (incorrectos|erroneos)|afecta a (todos|clientes)|urgente/;
const SECURITY_CRITICAL = /ransomware|brecha|breach|exfiltr|fuga de datos|filtracion de datos|acceso no autorizado|sin autorizacion|no autorizado|unauthorized access|robo de (datos|informacion|credenciales)/;
const FEATURE_IMPORTANT = /importante|auditoria|requisito|contrato|regulacion|cumplimiento|necesitamos|urgente|clientes? (piden|solicitan)/;

export function pickPriority(category, text) {
  switch (category) {
    case 'SECURITY':
      // Nunca por debajo de HIGH: un incidente o vulnerabilidad no es "baja" aunque el texto lo pida.
      return SECURITY_CRITICAL.test(text) ? 'CRITICAL' : 'HIGH';
    case 'ACCESS':
      if (TOTAL_OUTAGE.test(text)) return 'CRITICAL';
      return GROUP_IMPACT.test(text) ? 'HIGH' : 'MEDIUM';
    case 'BUG':
      if (DATA_LOSS.test(text) || (PRODUCTION_CONTEXT.test(text) && OUTAGE_SIGNAL.test(text))) return 'CRITICAL';
      if (BUG_WIDE_IMPACT.test(text)) return 'HIGH';
      if (COSMETIC.test(text)) return 'LOW';
      return 'MEDIUM';
    case 'FEATURE':
      return FEATURE_IMPORTANT.test(text) ? 'MEDIUM' : 'LOW';
    default:
      return 'MEDIUM';
  }
}

const RESPONSES = {
  ACCESS:
    'Lamentamos el inconveniente con su acceso. Verifique que sus credenciales sean correctas y utilice la opción de recuperación de contraseña si es necesario. Si el problema continúa, nuestro equipo de soporte revisará su cuenta.',
  BUG:
    'Gracias por reportar el problema. Hemos registrado la falla y la enviamos al equipo técnico para su análisis. Si puede, comparta los pasos para reproducirla y cualquier mensaje de error que haya visto.',
  FEATURE:
    'Gracias por su sugerencia. Hemos registrado su solicitud de nueva funcionalidad y será evaluada por el equipo de producto junto con otras peticiones.',
  SECURITY:
    'Gracias por avisarnos. Su reporte se trata como un posible incidente de seguridad y fue escalado a nuestro equipo especializado, que lo revisará con urgencia. Por favor no comparta contraseñas ni datos sensibles por este medio.',
};

export function buildResponse(category, priority) {
  const urgent =
    priority === 'CRITICAL' || priority === 'HIGH'
      ? ' Dada la urgencia, su caso se atenderá con prioridad.'
      : '';
  return RESPONSES[category] + urgent;
}

export function analyzeTraditional(message) {
  const { clean, injected } = stripInjection(normalize(message));

  const scores = scoreCategories(clean);
  const category = pickCategory(scores);
  const priority = pickPriority(category, clean);

  const sorted = Object.values(scores).sort((a, b) => b - a);
  const lowConfidence = sorted[0] < 3 || sorted[0] - sorted[1] < 2;

  const requiresHumanReview =
    category === 'SECURITY' || injected || lowConfidence || priority === 'CRITICAL';

  return validateResult(
    { category, priority, response: buildResponse(category, priority), requiresHumanReview },
    'traditional',
  );
}
