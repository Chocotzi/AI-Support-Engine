// PARTE B — Conexión con el proveedor de IA generativa (local o API).
// Soporta: ollama (local, sin costo), anthropic, openai (y cualquier API compatible con OpenAI).
//
// Configuración SOLO por variables de entorno (ver .env.example). Las llaves nunca se
// escriben en el código, nunca se registran y nunca se incluyen en mensajes de error.

export class ProviderError extends Error {
  // code: PROVIDER_NOT_CONFIGURED | PROVIDER_TIMEOUT | PROVIDER_NETWORK | PROVIDER_HTTP | PROVIDER_BAD_BODY
  constructor(code, message, status) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export function getConfig(env = process.env) {
  const provider = (env.LLM_PROVIDER || 'ollama').toLowerCase();
  const defaults = {
    ollama: 'llama3.2',
    anthropic: 'claude-haiku-5-5',
    openai: 'gpt-4o-mini',
  };
  return {
    provider,
    model: env.LLM_MODEL || defaults[provider],
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || 30000,
    ollamaHost: (env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

export function isConfigured(config = getConfig()) {
  if (config.provider === 'ollama') return true; // se comprobará al llamar
  if (config.provider === 'anthropic') return Boolean(config.anthropicKey);
  if (config.provider === 'openai') return Boolean(config.openaiKey);
  return false;
}

async function post(url, headers, body, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ProviderError('PROVIDER_TIMEOUT', 'El proveedor de IA tardó demasiado en responder');
    }
    throw new ProviderError('PROVIDER_NETWORK', 'No se pudo conectar con el proveedor de IA');
  }
  if (!res.ok) {
    // No se reenvía el cuerpo del error (podría contener datos de la cuenta); solo el status.
    throw new ProviderError('PROVIDER_HTTP', `El proveedor de IA respondió con error HTTP ${res.status}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new ProviderError('PROVIDER_BAD_BODY', 'El proveedor de IA devolvió una respuesta ilegible');
  }
}

// Devuelve el TEXTO crudo generado por el modelo.
export async function callModel({ system, user }, config = getConfig()) {
  if (!isConfigured(config)) {
    throw new ProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `Proveedor "${config.provider}" no configurado (revise las variables de entorno)`,
    );
  }

  switch (config.provider) {
    case 'ollama': {
      const data = await post(
        `${config.ollamaHost}/api/chat`,
        {},
        {
          model: config.model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        config.timeoutMs,
      );
      return data?.message?.content ?? '';
    }
    case 'anthropic': {
      const data = await post(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
        {
          model: config.model,
          max_tokens: 600,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: user }],
        },
        config.timeoutMs,
      );
      return (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    case 'openai': {
      const data = await post(
        `${config.openaiBaseUrl}/chat/completions`,
        { authorization: `Bearer ${config.openaiKey}` },
        {
          model: config.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        config.timeoutMs,
      );
      return data?.choices?.[0]?.message?.content ?? '';
    }
    default:
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', `Proveedor desconocido: ${config.provider}`);
  }
}
