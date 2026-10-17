/**
 * playlist-server — aggregates IPTV playlists into one endpoint.
 *
 * Configure upstream playlists via env vars AND/OR add/remove them at
 * runtime through the admin API (persisted to DATA_FILE). Exposes ONE URL
 * your Samsung Tizen app (or any IPTV client) can read:
 *
 *   GET /playlist.m3u           merged M3U  (?refresh=1 forces upstream pull)
 *   GET /channels.json          {"channels":[{name,url,group,logo,provider}]}
 *   GET /                       provider status overview (JSON)
 *   GET /healthz                ok
 *
 * Admin API (requires ADMIN_TOKEN env; send "Authorization: Bearer <token>"):
 *   GET    /admin/sources                     list all sources
 *   POST   /admin/sources  {"name":"X","url":"https://..."}   add + fetch now
 *   DELETE /admin/sources/<id>                remove a runtime-added source
 *
 * Env:
 *   PLAYLISTS     comma-separated sources: "Name|URL,Name|URL"  (Name optional)
 *                 or JSON: '[{"name":"...","url":"..."}]'
 *   CACHE_TTL     seconds between upstream refreshes (default 900)
 *   PORT          HTTP port (default 8080)
 *   USER_AGENT    upstream UA string (default "IPTV-Tizen/1.0")
 *   ADMIN_TOKEN   enables the admin API
 *   DATA_FILE     where runtime-added sources persist (default /data/sources.json)
 *
 * A source may return M3U/M3U8 text or a JSON channel list.
 * If a refresh fails, the last good channel list for that source is kept.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const TTL = parseInt(process.env.CACHE_TTL || '900', 10) * 1000;
const USER_AGENT = process.env.USER_AGENT || 'IPTV-Tizen/1.0';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_FILE = process.env.DATA_FILE || '/data/sources.json';

/* ---------------- sources (env = built-in base, file = runtime-added) ------- */
function parseSources(raw) {
    if (!raw || !raw.trim()) return [];
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed)
                .filter(s => s && s.url)
                .map((s, i) => ({ name: s.name || 'Source ' + (i + 1), url: s.url }));
        } catch (e) {
            console.error('PLAYLISTS JSON parse failed:', e.message);
            return [];
        }
    }
    return trimmed.split(',')
        .map(s => s.trim()).filter(Boolean)
        .map((s, i) => {
            const sep = s.indexOf('|');
            if (sep > 0) return { name: s.slice(0, sep).trim(), url: s.slice(sep + 1).trim() };
            const eq = s.lastIndexOf('=');
            if (eq > 0 && /^https?:/i.test(s.slice(eq + 1))) {
                return { name: s.slice(0, eq).trim(), url: s.slice(eq + 1).trim() };
            }
            return { name: 'Source ' + (i + 1), url: s };
        });
}

let idCounter = 0;
const genId = () => 's' + Date.now().toString(36) + (idCounter++);

function loadRuntimeSources() {
    try {
        const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return Array.isArray(arr)
            ? arr.filter(s => s && s.url).map(s => ({ id: s.id || genId(), name: s.name || 'Source', url: s.url }))
            : [];
    } catch (e) {
        return []; // no file yet
    }
}

function persistRuntimeSources() {
    const runtime = sources.filter(s => !s.builtin).map(({ id, name, url }) => ({ id, name, url }));
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(runtime, null, 2));
    } catch (e) {
        console.error('could not persist sources:', e.message);
    }
}

const sources = [
    ...parseSources(process.env.PLAYLISTS).map(s => ({ id: genId(), ...s, builtin: true })),
    ...loadRuntimeSources().map(s => ({ id: s.id, name: s.name, url: s.url, builtin: false })),
].map(s => ({ channels: [], fetchedAt: 0, error: null, ...s }));

/* ---------------- M3U / JSON parsing ---------------- */
function parseExtInf(line) {
    const attr = (name) => {
        const m = line.match(new RegExp(name + '="([^"]*)"'));
        return m ? m[1] : '';
    };
    const comma = line.lastIndexOf(',');
    return {
        name: (comma >= 0 ? line.slice(comma + 1).trim() : '') || attr('tvg-name'),
        logo: attr('tvg-logo'),
        group: attr('group-title') || 'Uncategorized',
    };
}

function parseM3U(text) {
    const out = [];
    let meta = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF')) meta = parseExtInf(line);
        else if (line.startsWith('#EXTGRP')) { if (meta) meta.group = line.slice(7).trim() || meta.group; }
        else if (line.startsWith('#')) continue;
        else if (/^https?:\/\//i.test(line)) {
            out.push({
                name: (meta && meta.name) || decodeURIComponent(line.split('/').pop().split('?')[0]) || 'Channel',
                url: line,
                group: (meta && meta.group) || 'Uncategorized',
                logo: (meta && meta.logo) || '',
            });
            meta = null;
        }
    }
    return out;
}

function parseJsonChannels(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.channels) ? data.channels : []);
    return list
        .filter(c => c && (c.url || c.streamUrl || c.link))
        .map(c => ({
            name: c.name || c.title || 'Channel',
            url: c.url || c.streamUrl || c.link,
            group: c.group || c.group_title || c.category || 'Uncategorized',
            logo: c.logo || c.tvg_logo || '',
        }));
}

function parseBody(text) {
    const t = (text || '').trim();
    if (t.startsWith('[') || t.startsWith('{')) return parseJsonChannels(t);
    return parseM3U(t);
}

/* ---------------- upstream fetch + cache ---------------- */
async function fetchSource(src) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
        const res = await fetch(src.url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': USER_AGENT },
            redirect: 'follow',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const channels = parseBody(text);
        if (!channels.length) throw new Error('0 channels parsed');
        src.channels = channels;
        src.error = null;
        console.log(`[${src.name}] ${channels.length} channels`);
    } catch (e) {
        src.error = e.message;
        console.error(`[${src.name}] refresh failed: ${e.message} (serving last good list: ${src.channels.length})`);
    } finally {
        clearTimeout(timer);
        src.fetchedAt = Date.now();
    }
}

async function ensureFresh(forceAll) {
    const now = Date.now();
    const stale = sources.filter(s => forceAll || now - s.fetchedAt > TTL);
    await Promise.allSettled(stale.map(fetchSource));
}

/* ---------------- output rendering ---------------- */
function allChannels() {
    const prefixGroup = sources.length > 1;
    return sources.flatMap(s => s.channels.map(c => ({
        ...c,
        group: prefixGroup && s.name ? `${s.name} / ${c.group}` : c.group,
        provider: s.name,
    })));
}

function renderM3U(channels) {
    const esc = (v) => String(v).replace(/"/g, "'");
    const lines = ['#EXTM3U'];
    for (const c of channels) {
        lines.push(`#EXTINF:-1 tvg-name="${esc(c.name)}" group-title="${esc(c.group)}"${c.logo ? ` tvg-logo="${esc(c.logo)}"` : ''},${c.name}`);
        lines.push(c.url);
    }
    return lines.join('\n') + '\n';
}

function statusJson() {
    return {
        updatedAt: new Date().toISOString(),
        ttlSeconds: TTL / 1000,
        endpoints: { playlist: '/playlist.m3u', channels: '/channels.json' },
        providers: sources.map(s => ({
            id: s.id,
            name: s.name,
            url: s.url,
            builtin: s.builtin,
            channels: s.channels.length,
            lastError: s.error,
            fetchedAt: s.fetchedAt ? new Date(s.fetchedAt).toISOString() : null,
        })),
    };
}

/* ---------------- admin helpers ---------------- */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => {
            data += c;
            if (data.length > 64 * 1024) { reject(new Error('body too large')); req.destroy(); }
        });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('invalid JSON')); } });
        req.on('error', reject);
    });
}

async function handleAdmin(req, res, urlPath) {
    const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
    };
    if (!ADMIN_TOKEN) return send(403, { error: 'admin API disabled: set ADMIN_TOKEN env' });
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + ADMIN_TOKEN) return send(401, { error: 'unauthorized' });

    if (req.method === 'GET' && urlPath === '/admin/sources') {
        return send(200, { sources: sources.map(({ id, name, url, builtin, channels }) => ({ id, name, url, builtin, channels: channels.length })) });
    }
    if (req.method === 'POST' && urlPath === '/admin/sources') {
        let body;
        try { body = await readBody(req); } catch (e) { return send(400, { error: e.message }); }
        const { name, url } = body || {};
        if (!url || !/^https?:\/\//i.test(url)) return send(400, { error: 'url must be a valid http(s) URL' });
        if (sources.some(s => s.url === url)) return send(409, { error: 'url already configured', id: sources.find(s => s.url === url).id });
        const src = { id: genId(), name: name || new URL(url).hostname, url, builtin: false, channels: [], fetchedAt: 0, error: null };
        sources.push(src);
        persistRuntimeSources();
        await fetchSource(src);
        return send(201, { added: src.id, name: src.name, channels: src.channels.length, lastError: src.error });
    }
    if (req.method === 'DELETE' && urlPath.startsWith('/admin/sources/')) {
        const id = urlPath.split('/')[3];
        const i = sources.findIndex(s => s.id === id);
        if (i < 0) return send(404, { error: 'not found' });
        if (sources[i].builtin) return send(403, { error: 'cannot delete env-configured source (edit PLAYLISTS instead)' });
        const [removed] = sources.splice(i, 1);
        persistRuntimeSources();
        return send(200, { removed: removed.id, name: removed.name });
    }
    return send(404, { error: 'not found' });
}

/* ---------------- HTTP server ---------------- */
const server = http.createServer(async (req, res) => {
    const fullUrl = req.url || '/';
    const urlPath = fullUrl.split('?')[0];
    const query = fullUrl.includes('refresh=1');

    if (urlPath.startsWith('/admin')) {
        try { await ensureFresh(query); } catch (e) {}
        return handleAdmin(req, res, urlPath);
    }

    try {
        await ensureFresh(query);
    } catch (e) { /* per-source errors already logged */ }

    const send = (code, type, body) => {
        res.writeHead(code, { 'Content-Type': type, 'Cache-Control': `public, max-age=${Math.min(TTL / 1000, 60)}` });
        res.end(body);
    };

    if (urlPath === '/playlist.m3u' || urlPath === '/playlist') {
        send(200, 'application/x-mpegurl; charset=utf-8', renderM3U(allChannels()));
    } else if (urlPath === '/channels.json') {
        send(200, 'application/json; charset=utf-8', JSON.stringify({ channels: allChannels() }));
    } else if (urlPath === '/healthz') {
        send(200, 'text/plain', 'ok');
    } else if (urlPath === '/') {
        send(200, 'application/json; charset=utf-8', JSON.stringify(statusJson(), null, 2));
    } else {
        send(404, 'text/plain', 'not found\n');
    }
});

if (!sources.length) {
    console.warn('WARNING: no playlists configured (PLAYLISTS env / admin API / DATA_FILE).');
}
console.log(`playlist-server on :${PORT} with ${sources.length} source(s) ` +
    `(${sources.filter(s => s.builtin).length} from env, ${sources.filter(s => !s.builtin).length} runtime), ` +
    `TTL ${TTL / 1000}s, admin API ${ADMIN_TOKEN ? 'ENABLED' : 'disabled'}`);
server.listen(PORT);
