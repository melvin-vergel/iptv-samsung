/**
 * epg.js — fetch + parse XMLTV EPG, match programmes to channels.
 */
const EPG = (() => {
    let cache = { url: null, xml: null, programmes: [], fetchedAt: 0 };
    const TTL_MS = 5 * 60 * 1000; // refresh EPG every 5 minutes

    function normalizeId(str) {
        return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // XMLTV date: "20241018180000 +0000" or "20241018180000"
    function parseXmltvDate(s) {
        if (!s) return null;
        const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
        if (!m) return null;
        const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
        if (m[7]) {
            const tz = m[7];
            const sign = tz[0];
            const hours = tz.slice(1, 3);
            const mins = tz.slice(3, 5);
            return new Date(iso + sign + hours + ':' + mins);
        }
        return new Date(iso + 'Z');
    }

    function parseXmltv(xmlText) {
        const programmes = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'application/xml');
            const parserError = doc.querySelector('parsererror');
            if (parserError) throw new Error('XML parse error');

            const nodes = doc.querySelectorAll('programme');
            nodes.forEach(p => {
                const start = parseXmltvDate(p.getAttribute('start'));
                const stop = parseXmltvDate(p.getAttribute('stop'));
                const channel = p.getAttribute('channel') || '';
                const titleEl = p.querySelector('title');
                const descEl = p.querySelector('desc');
                const subEl = p.querySelector('sub-title');
                programmes.push({
                    channel,
                    start,
                    stop,
                    title: titleEl ? titleEl.textContent.trim() : '',
                    desc: descEl ? descEl.textContent.trim() : '',
                    subtitle: subEl ? subEl.textContent.trim() : '',
                });
            });
        } catch (e) {
            console.error('EPG parse failed', e);
        }
        return programmes;
    }

    function fetchEpg(urls) {
        if (!urls || (Array.isArray(urls) && urls.length === 0)) {
            return Promise.reject(new Error('No EPG URL'));
        }
        const list = Array.isArray(urls) ? urls : [urls];
        const now = Date.now();
        if (cache.urls && cache.urls.length === list.length &&
            cache.urls.every((u, i) => u === list[i]) &&
            now - cache.fetchedAt < TTL_MS && cache.programmes.length) {
            return Promise.resolve(cache.programmes);
        }
        return Promise.all(list.map(u => fetchOne(u))).then(results => {
            const programmes = results.flat();
            cache = { urls: list, xml: null, programmes, fetchedAt: Date.now() };
            return programmes;
        });
    }

    function fetchOne(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 30000;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 400) {
                    resolve(parseXmltv(xhr.responseText));
                } else {
                    reject(new Error('HTTP ' + xhr.status));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.ontimeout = () => reject(new Error('Timeout'));
            xhr.send();
        });
    }

    function currentProgramme(channel, programmes) {
        if (!channel || !programmes || !programmes.length) return null;
        const now = new Date();
        const ids = [
            channel.tvgId,
            channel.name,
            channel.id,
        ].filter(Boolean);
        const norms = ids.map(normalizeId);

        return programmes.find(p => {
            if (!p.start || !p.stop) return false;
            const chNorm = normalizeId(p.channel);
            const match = norms.some(n => n === chNorm) ||
                          ids.some(id => id.toLowerCase() === p.channel.toLowerCase());
            return match && p.start <= now && p.stop > now;
        }) || null;
    }

    function nextProgramme(channel, programmes) {
        const cur = currentProgramme(channel, programmes);
        const from = cur ? cur.stop : new Date();
        if (!channel || !programmes || !programmes.length) return null;
        const ids = [channel.tvgId, channel.name, channel.id].filter(Boolean);
        const norms = ids.map(normalizeId);

        const next = programmes
            .filter(p => {
                if (!p.start) return false;
                const chNorm = normalizeId(p.channel);
                return norms.some(n => n === chNorm) ||
                       ids.some(id => id.toLowerCase() === p.channel.toLowerCase());
            })
            .filter(p => p.start >= from)
            .sort((a, b) => a.start - b.start)[0];
        return next || null;
    }

    return {
        fetch: fetchEpg,
        current: (channel) => currentProgramme(channel, cache.programmes),
        next: (channel) => nextProgramme(channel, cache.programmes),
        getProgrammes: () => cache.programmes,
        clear: () => { cache = { url: null, xml: null, programmes: [], fetchedAt: 0 }; },
    };
})();
