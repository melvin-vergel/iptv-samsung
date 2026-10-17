/**
 * playlist.js — fetch + parse M3U / M3U8 channel playlists.
 */

/** Parse one #EXTINF line: attributes and display name. */
function parseExtInf(line) {
    const attr = (name) => {
        const m = line.match(new RegExp(name + '="([^"]*)"'));
        return m ? m[1] : '';
    };
    // Display name = text after the last comma outside quotes.
    const comma = line.lastIndexOf(',');
    let name = comma >= 0 ? line.slice(comma + 1).trim() : '';
    if (!name) name = attr('tvg-name');
    return {
        name,
        logo: attr('tvg-logo'),
        group: attr('group-title') || 'Uncategorized',
    };
}

/**
 * Parse an M3U text into a flat channel list.
 * Returns [{ name, url, group, logo }]
 */
function parsePlaylist(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    let meta = null;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF')) {
            meta = parseExtInf(line);
        } else if (line.startsWith('#EXTGRP')) {
            if (meta) meta.group = line.slice(7).trim() || meta.group;
        } else if (line.startsWith('#')) {
            continue; // other tags (#EXT-X-..., comments)
        } else if (/^https?:\/\//i.test(line)) {
            channels.push({
                name: (meta && meta.name) || decodeURIComponent(line.split('/').pop().split('?')[0]) || 'Channel',
                url: line,
                group: (meta && meta.group) || 'Uncategorized',
                logo: (meta && meta.logo) || '',
            });
            meta = null;
        }
    }
    return channels;
}

/** Group channels preserving first-seen group order. */
function groupChannels(channels) {
    const map = new Map();
    for (const ch of channels) {
        if (!map.has(ch.group)) map.set(ch.group, []);
        map.get(ch.group).push(ch);
    }
    return [...map.entries()].map(([title, items]) => ({ title, channels: items }));
}

/** Fetch playlist text (XHR works cross-origin on Tizen with the internet privilege). */
function fetchPlaylist(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 20000;
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 400) resolve(xhr.responseText);
            else reject(new Error('HTTP ' + xhr.status));
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.ontimeout = () => reject(new Error('Timeout'));
        xhr.send();
    });
}
