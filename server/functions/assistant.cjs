function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

const DEFAULT_MODEL = 'glm-5.3-flash:free';

function getKey() {
  // The backend provider is UnoRouter, but keep the existing variable name
  // so current deployments do not need to rename their key.
  const raw = process.env.OPENROUTER_API_KEY || process.env.UNOROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || '';
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

function getModel() {
  const raw = process.env.UNOROUTER_MODEL || DEFAULT_MODEL;
  return String(raw).trim() || DEFAULT_MODEL;
}

function friendlyUnoRouterError(status, data) {
  const raw = data?.error?.message || data?.message || `UnoRouter request failed (${status}).`;
  if (status === 401 || status === 403) return 'UnoRouter rejected the API key. Check OPENROUTER_API_KEY in Vercel, then redeploy.';
  if (status === 404 && /model|route|endpoint/i.test(raw)) return `${raw} The configured UnoRouter model may be unavailable. Try a¶»§q«^