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

const DEFAULT_MODEL = 'space-bunny-alpha:free';
const DEFAULT_FALLBACK_MODELS = ['mimo-v2.6-flash:free','axon-1.8-flash:free','axon-1.8-lightning:free'];

function getKey() {
  // The backend provider is UnoRouter, but keep the existing variable name
  // so current deployments do not need to rename their key.
  const raw = process.env.UNOROUTER_API_KEY || '';
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

function getModel() {
  const raw = process.env.UNOROUTER_MODEL || DEFAULT_MODEL;
  return String(raw).trim() || DEFAULT_MODEL;
}
function getFallbackModels(primary) {
  const raw = String(process.env.UNOROUTER_FALLBACK_MODELS || '').trim();
  const extra = raw ? raw.split(',').map(x=>x.trim()).filter(Boolean) : DEFAULT_FALLBACK_MODELS;
  return [...new Set([primary,...extra])].slice(0,4);
}


function friendlyUnoRouterError(status, data) {
  const raw = data?.error?.message || data?.message || `UnoRouter request failed (${status}).`;
  if (status === 401 || status === 403) return 'UnoRouter rejected the API key. Check UNOROUTER_API_KEY in Vercel, then redeploy.';
  if (status === 404 && /model|route|endpoint/i.test(raw)) return `${raw} The configured UnoRouter model may be unavailable. Try another free model.`;
  if (status === 429) return 'The selected free UnoRouter model is rate-limited right now. Try again in a little bit.';
  return raw;
}

async function callUnoRouter(key, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch('https://api.unorouter.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    return { r, data };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return reply(204, {});

  const key = getKey();
  const model = getModel();

  if (event.httpMethod === 'GET') {
    return reply(200, {
      ok: true,
      configured: Boolean(key),
      provider: 'UnoRouter',
      model
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'Use POST.' });
  if (!key) return reply(501, { error: 'AI is not configured. Add UNOROUTER_API_KEY in Vercel and redeploy the site.' });

  try {
    const body = JSON.parse(event.body || '{}');
    const messages = cleanMessages(body.messages);
    if (!messages.length) return reply(400, { error: 'Missing message.' });

    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const games = Array.isArray(context.matchingGames) ? context.matchingGames.slice(0, 24) : [];
    const system = `You are Nova Math AI, a general-purpose assistant built into the user's Nova Math website. Answer any normal question you can help with, not just questions about Nova Math. You can explain school topics, help with writing, coding, troubleshooting, brainstorming, recommendations, general knowledge, and everyday questions. Use the Nova Math context below only when it is relevant to the user's request, and do not force every answer to be about the site. Current section: ${String(context.currentTab || 'unknown').slice(0, 30)}. The site has about ${Number(context.gameCount) || 0} built-in games. Site features include: ${(Array.isArray(context.features) ? context.features : []).slice(0, 20).join(', ')}. Potentially relevant built-in games for this user's question: ${games.map(g => `${g.title}${g.genre ? ` (${g.genre})` : ''}`).join(', ') || 'none supplied'}. When recommending a built-in game, only claim it exists if it appears in the supplied game list. If you do not know something, say so instead of making it up. Be concise by default and go into detail when the user asks. Do not claim you can click buttons or control the site yourself.`;

    const payload = {
      model,
      stream: false,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.7
    };

    let result=null,usedModel=model,lastFailure=null;
    const candidates=getFallbackModels(model);
    for (let i=0;i<candidates.length;i++) {
      const candidate=candidates[i];
      try {
        const attempt=await callUnoRouter(key,{...payload,model:candidate});
        if (attempt.r.ok) { result=attempt; usedModel=candidate; break; }
        lastFailure=attempt;
        const retryable=[404,408,409,429,500,502,503,504].includes(attempt.r.status);
        if (!retryable) break;
      } catch (e) {
        if (e?.name !== 'AbortError') console.error('UnoRouter network error', e);
        lastFailure={error:e};
      }
    }
    if(!result){
      if(lastFailure?.error?.name==='AbortError')return reply(504,{error:'The AI request timed out. Try again.'});
      if(lastFailure?.r){const {r,data}=lastFailure;console.error('UnoRouter',r.status,data);return reply(r.status,{error:friendlyUnoRouterError(r.status,data),code:data?.error?.code||null});}
      return reply(502,{error:'Could not reach UnoRouter from the server function.'});
    }

    const { r, data } = result;
    const content = data?.choices?.[0]?.message?.content;
    const message = Array.isArray(content)
      ? content.map(x => x?.text || x?.content || '').join('').trim()
      : String(content || '').trim();

    if (!message) return reply(502, { error: 'The AI returned an empty response. Try again.' });
    return reply(200, { message, provider: 'UnoRouter', model: data?.model || usedModel, fallbackUsed: usedModel!==model });
  } catch (e) {
    console.error('assistant', e);
    return reply(500, { error: 'AI assistant failed. Try again.' });
  }
};
