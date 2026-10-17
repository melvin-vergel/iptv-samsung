/**
 * playlist-server — aggregates IPTV playlists into one endpoint.
 *
 * Configure upstream playlists via env vars, expose ONE URL your Samsung
 * Tizen app (or any IPTV client) can read:
 *
 *   GET /playlist.m3u     merged M3U playlist
 *   GET /channels.json    {"channels":[{name,url,group,logo,provider}]}
 *   GET /                 provider status overview (JSON)
 *   GET /healthz          ok
 *
 * Env:
 *   PLAYLISTS     comma-separated sources: "Name|URL,Name|URL"  (Name optional)
 *                 or JSON: '[{"name":"...","url":"..."}]'
 *   CACHE_TTL     seconds between upstream refreshes (default 900)
 *   PORT          HTTP port (default 8080)
 *   USER_AGENT    upstream UA string (default "IPTV-Tizen/1.0")
 *
 * A source may return M3U/M3U8 text or a JSON channel list.
 * If a refresh fails, the last good channel list for that source is kept.
 */
'use strict';

const http = require('http');

const PORT = parseInt(process.env.PORT || '8080', 10);
const TTL = parseInt(process.env.CACHE_TTL || '900', 10) * 1000;
const USER_AGENT = process.env.USER_AGENT || 'IPTV-Tizen/1.0';

/* ---------------- config ---------------- */
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

const sources = parseSources(process.env.PLAYLISTS).map(s => ({
    ...s, channels: [], fetchedAt: 0, error: null,
}));

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
        src.fetchedAt = Date.now();
    }
}

async function ensureFresh() {
    const now = Date.now();
    const stale = sources.filter(s => now - s.fetchedAt > TTL);
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
            name: s.name,
            channels: s.channels.length,
            lastError: s.error,
            fetchedAt: s.fetchedAt ? new Date(s.fetchedAt).toISOString() : null,
        })),
    };
}

/* ---------------- HTTP server ---------------- */
const server = http.createServer(async (req, res) => {
    try {
        await ensureFresh();
    } catch (e) { /* per-source errors already logged */ }

    const path = (req.url || '/').split('?')[0];
    const send = (code, type, body) => {
        res.writeHead(code, { 'Content-Type': type, 'Cache-Control': `public, max-age=${Math.min(TTL / 1000, 60)}` });
        res.end(body);
    };

    if (path === '/playlist.m3u' || path === '/playlist') {
        send(200, 'application/x-mpegurl; charset=utf-8', renderM3U(allChannels()));
    } else if (path === '/channels.json') {
        send(200, 'application/json; charset=utf-8', JSON.stringify({ channels: allChannels() }));
    } else if (path === '/healthz') {
        send(200, 'text/plain', 'ok');
    } else if (path === '/') {
        send(200, 'application/json; charset=utf-8', JSON.stringify(statusJson(), null, 2));
    } else {
        send(404, 'text/plain', 'not found\n');
    }
});

if (!sources.length) {
    console.warn('WARNING: PLAYLISTS env is empty — endpoints will return 0 channels.');
}
console.log(`playlist-server on :${PORT} with ${sources.length} source(s), TTL ${TTL / 1000}s`);
server.listen(PORT);
