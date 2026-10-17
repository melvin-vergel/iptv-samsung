/**
 * endpoints.js — app configuration.
 *
 * Put your IPTV playlist/API endpoints here. These providers are seeded on
 * first launch (and re-added if you remove them) so the app loads channels
 * straight from the endpoint without typing anything on the TV keyboard.
 *
 * Supported endpoint responses:
 *   - M3U / M3U8 playlist text  (any URL ending in .m3u/.m3u8 or returning #EXTM3U)
 *   - JSON list:  [{ "name": "...", "url": "...", "group": "...", "logo": "..." }, ...]
 *   - JSON wrapped: { "channels": [ ...same shape... ] }
 */
const ENDPOINTS = {
    // Built-in endpoints baked into the app (id must be stable, used for dedupe).
    builtins: [
        // { id: 'builtin-main', name: 'My Provider', url: 'https://example.com/playlist.m3u' },
        // { id: 'builtin-api',  name: 'From My API', url: 'https://api.example.com/channels.json' },
    ],
};
