// PARTE B — API HTTP: POST /api/analyze (y GET /health).
// Solo módulos nativos de Node: sin Express ni dependencias que auditar.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { MODES } from './contract.js';
import { analyze } from './service.js';
import { ProviderError } from './providers.js';
import { GenerativeFormatError } from './generative.js';

export const MAX_BODY_BYTES = 10 * 1024;
export const MAX_MESSAGE_LEN = 2000;
// Tras un 413 se descarta el resto del cuerpo para que el cliente reciba la respuesta;
// si aun así sigue enviando más de esto, se corta la conexión (no se drenan cuerpos gigantes).
const HARD_LIMIT_BYTES = 64 * MAX_BODY_BYTES;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    // Tras un cuerpo demasiado grande no se reutiliza la conexión.
    ...(status === 413 ? { connection: 'close' } : {}),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (tooLarge) {
        if (size > HARD_LIMIT_BYTES) req.destroy();
        return; // se descarta: no se acumula en memoria
      }
      if (size > MAX_BODY_BYTES) {
        // No se destruye la conexión aquí: si se hiciera, el cliente nunca recibiría el 413.
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', `El cuerpo excede ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new HttpError(400, 'BAD_REQUEST', 'No se pudo leer la solicitud')));
  });
}

// Validación de la petición (requerimiento 4).
export function validateRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'El cuerpo debe ser un objeto JSON');
  }
  if (typeof body.message !== 'string') {
    throw new HttpError(400, 'INVALID_MESSAGE', '"message" es obligatorio y debe ser texto');
  }
  const message = body.message.trim();
  if (!message) throw new HttpError(400, 'INVALID_MESSAGE', '"message" no puede estar vacío');
  if (message.length > MAX_MESSAGE_LEN) {
    throw new HttpError(400, 'INVALID_MESSAGE', `"message" excede ${MAX_MESSAGE_LEN} caracteres`);
  }
  if (!MODES.includes(body.mode)) {
    throw new HttpError(400, 'INVALID_MODE', `"mode" debe ser uno de: ${MODES.join(', ')}`);
  }
  return { message, mode: body.mode };
}

// Traduce errores internos a respuestas seguras (sin stack traces, sin detalles del proveedor).
function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof ProviderError) {
    if (err.code === 'PROVIDER_NOT_CONFIGURED') return new HttpError(503, err.code, 'El motor generativo no está configurado');
    if (err.code === 'PROVIDER_TIMEOUT') return new HttpError(504, err.code, 'El proveedor de IA no respondió a tiempo');
    if (err.code === 'PROVIDER_BLOCKED') return new HttpError(502, err.code, 'El proveedor de IA rechazó procesar la solicitud');
    return new HttpError(502, err.code, 'El proveedor de IA no está disponible');
  }
  if (err instanceof GenerativeFormatError) {
    return new HttpError(502, 'INVALID_MODEL_OUTPUT', 'El modelo no devolvió una respuesta con el formato esperado');
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'Error interno del servidor');
}

export function createServer({ analyzeFn = analyze, log = console.log } = {}) {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    let info = {};
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/health' && req.method === 'GET') {
        return send(res, 200, { status: 'ok' });
      }
      if (url.pathname !== '/api/analyze') throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada');
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
      }
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type debe ser application/json');
      }

      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, 'INVALID_JSON', 'El cuerpo no es JSON válido');
      }

      const { message, mode } = validateRequest(parsed);
      info = { mode };
      const result = await analyzeFn(message, mode);
      info = { mode, category: result.category, priority: result.priority };
      send(res, 200, result);
    } catch (err) {
      const httpErr = toHttpError(err);
      info = { ...info, error: httpErr.code };
      send(res, httpErr.status, { error: { code: httpErr.code, message: httpErr.message } });
    } finally {
      // Se registra metadata, NUNCA el contenido del mensaje (puede traer datos personales).
      log(JSON.stringify({ t: new Date().toISOString(), ms: Date.now() - started, ...info }));
    }
  });
}

// Arranca solo si se ejecuta directamente (npm start), no al importarlo en pruebas.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`AI Support Engine escuchando en http://${host}:${port}`));
}
