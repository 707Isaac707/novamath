import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 10000);

const apiNames = new Set([
  'assistant',
  'food-notify',
  'game-art',
  'iptv-epg',
  'iptv-playlist',
  'platform-api',
  'social-api',
  'social-auth',
  'sports-api',
  'watch-party',
  'youtube-search'
]);

const handlerCache = new Map();
function getHandler(name) {
  if (!apiNames.has(name)) return null;
  if (!handlerCache.has(name)) {
    const mod = require(`./functions/${name}.cjs`);
    if (typeof mod?.handler !== 'function') throw new Error(`Missing handler for ${name}`);
    handlerCache.set(name, mod.handler);
  }
  return handlerCache.get(name);
}

function send(res, status, headers, body) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers || {})) {
    if (value != null) res.setHeader(key, String(value));
  }
  res.end(body);
}

async function readBody(req, limit = 5 * 1024 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleApi(req, res, url) {
  const match = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/i);
  const name = match?.[1] || '';
  const handler = getHandler(name);
  if (!handler) {
    send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'API route not found.' }));
    return;
  }

  try {
    const body = await readBody(req);
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = req.headers.host || 'localhost';
    const event = {
      httpMethod: req.method || 'GET',
      headers: req.headers || {},
      body,
      rawUrl: `${proto}://${host}${req.url || ''}`,
      queryStringParameters: Object.fromEntries(url.searchParams.entries())
    };

    const out = await handler(event);
    const status = Number(out?.statusCode) || 200;
    const headers = out?.headers || {};
    const responseBody = out?.isBase64Encoded
      ? Buffer.from(out?.body || '', 'base64')
      : (out?.body ?? '');
    send(res, status, headers, responseBody);
  } catch (error) {
    console.error('Render API bridge error', error);
    const status = Number(error?.statusCode) || 500;
    send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify({ error: status === 413 ? 'Request body too large.' : 'Server function failed.' }));
  }
}

const allowedDirs = new Set(['apps', 'assets', 'docs', 'thumbs']);
const allowedRootExts = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.webmanifest']);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.data': 'application/octet-stream',
  '.unityweb': 'application/octet-stream',
  '.bin': 'application/octet-stream'
};

function staticCandidate(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (!parts.length) return path.join(root, 'index.html');

  if (parts.length === 1) {
    const ext = path.extname(parts[0]).toLowerCase();
    if (!allowedRootExts.has(ext)) return null;
  } else if (!allowedDirs.has(parts[0])) {
    return null;
  }

  const candidate = path.resolve(root, '.' + decoded);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

async function resolveStatic(pathname) {
  let candidate = staticCandidate(pathname);
  if (!candidate) return null;
  try {
    let stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
      stat = await fs.stat(candidate);
    }
    if (!stat.isFile()) return null;
    return { file: candidate, stat };
  } catch {
    if (!path.extname(pathname)) {
      try {
        const file = path.join(root, 'index.html');
        const stat = await fs.stat(file);
        return { file, stat };
      } catch {}
    }
    return null;
  }
}

async function serveStatic(req, res, url) {
  const found = await resolveStatic(url.pathname);
  if (!found) {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    return;
  }

  const ext = path.extname(found.file).toLowerCase();
  const basename = path.basename(found.file).toLowerCase();
  const noCache = basename === 'index.html' || basename === 'sw.js';
  res.statusCode = 200;
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', String(found.stat.size));
  res.setHeader('Cache-Control', noCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') return res.end();
  createReadStream(found.file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') {
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify({ ok: true, service: 'nova-math' }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error('Render server error', error);
    if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Server error');
    else res.end();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Nova Math listening on 0.0.0.0:${port}`);
});
