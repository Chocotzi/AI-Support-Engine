// GUÍA DE USO — lo que responde GET / (la raíz del servicio).
//
// Todo sale en vivo del propio servidor: la versión desplegada, el estado de cada motor
// y un ejemplo REAL calculado con el motor tradicional (nada escrito a mano).

import { MODES } from './contract.js';
import { appInfo } from './metrics.js';
import { getConfig, isConfigured } from './providers.js';
import { analyzeTraditional } from './traditional.js';

const EXAMPLE_REQUEST = { message: 'No puedo iniciar sesión', mode: 'traditional' };

const ENDPOINTS = [
  { method: 'POST', path: '/api/analyze', description: 'Clasifica una solicitud' },
  { method: 'GET', path: '/health', description: 'Estado y versión desplegada' },
  { method: 'GET', path: '/metrics', description: 'Peticiones, errores y latencia' },
];

function engineStatus(mode, env) {
  if (mode !== 'generative') return 'disponible';
  const config = getConfig(env);
  return isConfigured(config) ? `disponible (${config.provider}/${config.model})` : 'sin proveedor configurado (responde 503)';
}

export async function serviceIndex(env = process.env) {
  const { version, environment } = appInfo(env);
  return {
    service: 'AI Support Engine',
    description: 'Clasifica solicitudes de soporte en ACCESS, BUG, FEATURE o SECURITY',
    version: /^[0-9a-f]{8,}$/i.test(version) ? version.slice(0, 7) : version,
    environment,
    engines: Object.fromEntries(MODES.map((mode) => [mode, engineStatus(mode, env)])),
    endpoints: ENDPOINTS,
    example: {
      request: EXAMPLE_REQUEST,
      response: await analyzeTraditional(EXAMPLE_REQUEST.message),
    },
  };
}
