// JSON con sangría para las rutas GET que se leen en el navegador (/, /health, /metrics).
//
// Igual que JSON.stringify(valor, null, 2), con una diferencia: un objeto o arreglo
// pequeño de valores simples se queda en una línea si cabe en MAX_LINE caracteres,
// por ejemplo { "method": "GET", "path": "/health" }. El nivel principal siempre se
// expande. El resultado sigue siendo JSON válido.

const MAX_LINE = 100;

const isSimple = (v) => v === null || typeof v !== 'object';
const entriesOf = (value) =>
  Array.isArray(value)
    ? value.map((v) => [null, v === undefined ? null : v])
    : Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== 'function');

function format(value, indent, prefixLength) {
  if (isSimple(value) || typeof value.toJSON === 'function') return JSON.stringify(value);
  const entries = entriesOf(value);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return open + close;

  const key = (k) => (k === null ? '' : `${JSON.stringify(k)}: `);
  if (indent && entries.every(([, v]) => isSimple(v))) {
    const inner = entries.map(([k, v]) => key(k) + JSON.stringify(v)).join(', ');
    const line = Array.isArray(value) ? `[${inner}]` : `{ ${inner} }`;
    if (indent.length + prefixLength + line.length <= MAX_LINE) return line;
  }

  const next = indent + '  ';
  const lines = entries.map(([k, v]) => next + key(k) + format(v, next, key(k).length));
  return `${open}\n${lines.join(',\n')}\n${indent}${close}`;
}

export function prettyJson(value) {
  return format(value, '', 0);
}
