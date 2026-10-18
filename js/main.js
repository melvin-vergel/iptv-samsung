/**
 * main.js — app state machine, remote-control keys, UI rendering.
 *
 * Modes:
 *   BROWSE   sidebar visible, navigating providers/channels
 *   PLAY     fullscreen video, sidebar hidden
 *   SETTINGS manage playlist providers modal
 */

const KEYS = {
    UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39,
    ENTER: 13,
    BACK: [4, 10001, 10009, 4617],           // TV "return/back" variants
    EXIT: [412],                      // power/exit
    MENU: [457],
    NUM: (c) => c >= 48 && c <= 57,   // 0-9
    NUM_KP: (c) => c >= 96 && c <= 105,
    CHANNEL_UP: 4600, CHANNEL_DOWN: 4601, // some models report HBBTV codes
};

const App = {
    providers: [],
    activeId: null,
    sections: [],
    flatChannels: [],      // all channels of the active provider, group order preserved
    rows: [],              // renderable rows: {type:'header'|'channel', ...}
    col: 'providers',      // which sidebar column has focus
    pIdx: 0,
    cIdx: 0,
    sIdx: 0,               // settings cursor
    mode: 'PLAY',
    loading: false,
    numBuffer: '',
    numTimer: null,
    osdTimer: null,
};

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const els = {};
function cacheEls() {
    ['video', 'osd', 'osd-channel', 'osd-provider', 'sidebar', 'providers-list',
     'channels-list', 'channels-title', 'btn-settings', 'settings',
     'provider-manager', 'new-name', 'new-url', 'btn-add', 'toast', 'debug'].forEach(id => els[id] = $(id));
    const num = document.createElement('div');
    num.id = 'numbox';
    num.className = 'hidden';
    document.body.appendChild(num);
    els.numbox = num;
}

function toast(msg, ms = 3000) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function showOSD(channel, provider) {
    els['osd-channel'].textContent = channel.name;
    const cur = EPG.current(channel);
    const sub = cur ? (cur.title + (cur.subtitle ? ' — ' + cur.subtitle : '')) : '';
    els['osd-provider'].innerHTML = (provider ? provider.name : '') + (sub ? '<br>' + sub : '');
    els.osd.classList.remove('hidden');
    clearTimeout(App.osdTimer);
    App.osdTimer = setTimeout(() => els.osd.classList.add('hidden'), 3500);
}

/* ---------------- rendering ---------------- */
function renderProviders() {
    const ul = els['providers-list'];
    ul.innerHTML = '';
    App.providers.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'provider-item'
            + (p.id === App.activeId ? ' active' : '')
            + (App.col === 'providers' && App.mode === 'BROWSE' && i === App.pIdx ? ' cursor' : '');
        li.textContent = p.name;
        li.dataset.i = i;
        ul.appendChild(li);
    });
    els['btn-settings'].classList.toggle('cursor',
        App.col === 'providers' && App.mode === 'BROWSE' && App.pIdx >= App.providers.length);
}

function buildRows() {
    App.rows = [];
    App.sections.forEach(sec => {
        App.rows.push({ type: 'header', title: sec.title });
        sec.channels.forEach(ch => App.rows.push({ type: 'channel', ch, num: App.flatChannels.indexOf(ch) + 1 }));
    });
}

function renderChannels() {
    els['channels-title'].textContent =
        App.activeProvider() ? App.activeProvider().name : 'Channels';
    const ul = els['channels-list'];
    ul.innerHTML = '';
    App.rows.forEach((row, i) => {
        const li = document.createElement('li');
        if (row.type === 'header') {
            li.className = 'group-header';
            li.textContent = row.title;
        } else {
            li.className = 'channel-item'
                + (App.col === 'channels' && App.mode === 'BROWSE' && i === App.cIdx ? ' cursor' : '');
            li.dataset.i = i;

            const num = document.createElement('span');
            num.className = 'num';
            num.textContent = row.num;
            li.appendChild(num);

            const body = document.createElement('div');
            body.className = 'channel-body';

            const top = document.createElement('div');
            top.className = 'channel-top';

            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = row.ch.name;
            top.appendChild(name);

            if (row.ch.logo) {
                const img = document.createElement('img');
                img.className = 'logo';
                img.src = row.ch.logo;
                img.onerror = () => img.remove();
                top.appendChild(img);
            }

            body.appendChild(top);

            const epg = EPG.current(row.ch);
            if (epg && epg.title) {
                const epgEl = document.createElement('div');
                epgEl.className = 'epg-title';
                epgEl.textContent = epg.title;
                body.appendChild(epgEl);
            }

            li.appendChild(body);
        }
        ul.appendChild(li);
    });
    if (App.col === 'channels') keepCursorVisible(ul, App.cIdx);
}

function renderSettings() {
    const ul = els['provider-manager'];
    ul.innerHTML = '';
    App.providers.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'pm-row' + (App.sIdx === i ? ' cursor' : '');
        const info = document.createElement('div');
        info.className = 'pm-info';
        const n = document.createElement('div');
        n.className = 'pm-name';
        n.textContent = p.name;
        const u = document.createElement('div');
        u.className = 'pm-url';
        u.textContent = p.url;
        info.appendChild(n); info.appendChild(u);
        const del = document.createElement('span');
        del.className = 'pm-del';
        del.textContent = '\u2716 remove';
        li.appendChild(info); li.appendChild(del);
        ul.appendChild(li);
    });
    // map sIdx beyond provider rows to the add controls
    const nRows = App.providers.length;
    els['new-name'].classList.toggle('cursor', App.sIdx === nRows);
    els['new-url'].classList.toggle('cursor', App.sIdx === nRows + 1);
    els['btn-add'].classList.toggle('cursor', App.sIdx === nRows + 2);
    if (App.sIdx <= nRows + 2) {
        const target = App.sIdx < nRows ? ul.children[App.sIdx]
            : App.sIdx === nRows ? els['new-name']
            : App.sIdx === nRows + 1 ? els['new-url']
            : els['btn-add'];
        target.scrollIntoView({ block: 'nearest' });
        if (target.tagName === 'INPUT') target.focus();
        else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    }
}

function keepCursorVisible(listEl, idx) {
    const el = listEl.querySelector('.cursor') || listEl.children[idx];
    if (el) el.scrollIntoView({ block: 'center' });
}

/* ---------------- data ---------------- */
App.activeProvider = () => App.providers.find(p => p.id === App.activeId) || null;

function setProviders(providers) {
    App.providers = providers;
    if (!App.providers.some(p => p.id === App.activeId)) {
        App.activeId = App.providers.length ? App.providers[0].id : null;
    }
}

function loadProvider(p) {
    if (!p || App.loading) return;
    App.loading = true;
    App.activeId = p.id;
    toast('Loading ' + p.name + '\u2026', 10000);
    renderProviders();
    fetchPlaylist(p.url)
        .then(text => {
            const channels = parsePlaylist(text);
            if (!channels.length) throw new Error('No channels found in playlist');
            App.sections = groupChannels(channels);
            App.flatChannels = channels;
            buildRows();
            App.cIdx = App.rows.findIndex(r => r.type === 'channel');
            App.mode = 'BROWSE';
            App.col = 'channels';
            els.sidebar.classList.remove('hidden');
            renderProviders();
            renderChannels();
            toast(channels.length + ' channels loaded');
            if (App.epgUrls && App.epgUrls.length) {
                EPG.fetch(App.epgUrls).then(() => {
                    renderChannels();
                }).catch(err => debug('EPG load failed: ' + err.message));
            }
        })
        .catch(err => {
            toast('Could not load playlist: ' + err.message, 4000);
            App.sections = [];
            App.rows = [];
            App.flatChannels = [];
            renderChannels();
        })
        .finally(() => { App.loading = false; });
}

/* ---------------- playback ---------------- */
function playChannelRow(i) {
    const row = App.rows[i];
    if (!row || row.type !== 'channel') return;
    const ch = row.ch;
    App.mode = 'PLAY';
    els.sidebar.classList.add('hidden');
    showOSD(ch, App.activeProvider());
    Player.play(ch.url);
}

function stepChannel(delta) {
    if (!App.flatChannels.length) return;
    const cur = App.flatChannels.findIndex(c => Player.url && c.url === Player.url);
    const next = Math.max(0, Math.min(App.flatChannels.length - 1, (cur < 0 ? 0 : cur) + delta));
    const ch = App.flatChannels[next];
    App.mode = 'PLAY';
    els.sidebar.classList.add('hidden');
    showOSD(ch, App.activeProvider());
    Player.play(ch.url);
}

/* number-pad channel select */
function onDigit(d) {
    App.numBuffer += d;
    els.numbox.textContent = App.numBuffer;
    els.numbox.classList.remove('hidden');
    clearTimeout(App.numTimer);
    App.numTimer = setTimeout(() => {
        const n = parseInt(App.numBuffer, 10);
        els.numbox.classList.add('hidden');
        App.numBuffer = '';
        const ch = App.flatChannels[n - 1];
        if (ch) {
            App.mode = 'PLAY';
            els.sidebar.classList.add('hidden');
            showOSD(ch, App.activeProvider());
            Player.play(ch.url);
        } else {
            toast('No channel ' + n);
        }
    }, 1200);
}

/* ---------------- settings actions ---------------- */
function openSettings() {
    App.mode = 'SETTINGS';
    App.sIdx = 0;
    els.settings.classList.remove('hidden');
    renderSettings();
}

function closeSettings() {
    els.settings.classList.add('hidden');
    if (App.activeProvider() && App.flatChannels.length) {
        App.mode = 'BROWSE';
        App.col = 'providers';
        els.sidebar.classList.remove('hidden');
        renderProviders();
        renderChannels();
    } else if (App.providers.length) {
        App.mode = 'BROWSE';
        App.col = 'providers';
        els.sidebar.classList.remove('hidden');
        loadProvider(App.providers[0]);
    } else {
        openSettings();
    }
}

function addProviderFromForm() {
    const name = els['new-name'].value.trim();
    const url = els['new-url'].value.trim();
    if (!url) { toast('Enter a playlist URL'); return; }
    if (!/^https?:\/\//i.test(url)) { toast('URL must start with http(s)://'); return; }
    setProviders(Storage.add(name || url.split('/')[2] || 'Provider', url));
    els['new-name'].value = '';
    els['new-url'].value = '';
    App.sIdx = 0;
    renderSettings();
    toast('Playlist added');
}

function removeProviderAt(i) {
    const p = App.providers[i];
    if (!p) return;
    setProviders(Storage.remove(p.id));
    App.sIdx = Math.min(App.sIdx, App.providers.length);
    renderSettings();
    toast(p.name + ' removed');
}

/* ---------------- key routing ---------------- */
const isBack = (c) => KEYS.BACK.includes(c);

function handleKey(code) {
    // global: exit app on back when nothing is open and in PLAY mode
    if (isBack(code)) {
        if (App.mode === 'SETTINGS') { closeSettings(); return true; }
        if (App.mode === 'BROWSE') {
            if (App.col === 'providers') { /* fallthrough: exit */ }
            App.mode = 'PLAY';
            els.sidebar.classList.add('hidden');
            renderProviders();
            return true;
        }
        // PLAY + back -> double-back exits handled by caller
        return false;
    }

    if (App.mode === 'SETTINGS') {
        const max = App.providers.length + 2;
        if (code === KEYS.UP) { App.sIdx = Math.max(0, App.sIdx - 1); renderSettings(); }
        else if (code === KEYS.DOWN) { App.sIdx = Math.min(max, App.sIdx + 1); renderSettings(); }
        else if (code === KEYS.ENTER) {
            if (App.sIdx < App.providers.length) removeProviderAt(App.sIdx);
            else if (App.sIdx === max) addProviderFromForm();
        }
        return true;
    }

    if (App.mode === 'BROWSE') {
        if (code === KEYS.LEFT) { App.col = 'providers'; renderProviders(); renderChannels(); return true; }
        if (code === KEYS.RIGHT) {
            App.col = 'channels';
            if (!App.flatChannels.length && App.activeProvider()) loadProvider(App.activeProvider());
            renderProviders(); renderChannels(); return true;
        }
        if (code === KEYS.UP) {
            if (App.col === 'providers') App.pIdx = Math.max(0, App.pIdx - 1);
            else App.cIdx = moveChannel(-1);
            renderProviders(); renderChannels(); return true;
        }
        if (code === KEYS.DOWN) {
            if (App.col === 'providers') App.pIdx = Math.min(App.providers.length, App.pIdx + 1);
            else App.cIdx = moveChannel(1);
            renderProviders(); renderChannels(); return true;
        }
        if (code === KEYS.ENTER) {
            if (App.col === 'providers') {
                if (App.pIdx < App.providers.length) {
                    App.col = 'channels';
                    loadProvider(App.providers[App.pIdx]);
                } else openSettings();
            } else {
                playChannelRow(App.cIdx);
            }
            return true;
        }
        return true; // swallow the rest while browsing
    }

    // PLAY mode
    if (code === KEYS.LEFT || code === KEYS.MENU) {
        App.mode = 'BROWSE';
        App.col = 'channels';
        els.sidebar.classList.remove('hidden');
        if (!App.flatChannels.length && App.activeProvider()) loadProvider(App.activeProvider());
        renderProviders(); renderChannels();
        return true;
    }
    if (code === KEYS.UP || code === KEYS.CHANNEL_UP) { stepChannel(1); return true; }
    if (code === KEYS.DOWN || code === KEYS.CHANNEL_DOWN) { stepChannel(-1); return true; }
    if (code === KEYS.RIGHT) { // show info
        const cur = App.flatChannels.find(c => c.url === Player.url);
        if (cur) showOSD(cur, App.activeProvider());
        return true;
    }
    if (code === KEYS.ENTER) {
        const cur = App.flatChannels.find(c => c.url === Player.url);
        if (cur) showOSD(cur, App.activeProvider());
        return true;
    }
    return true;
}

function moveChannel(delta) {
    if (!App.rows.length) return 0;
    let i = App.cIdx;
    for (let guard = 0; guard < App.rows.length; guard++) {
        i += delta;
        if (i < 0) i = 0;
        if (i >= App.rows.length) i = App.rows.length - 1;
        if (App.rows[i].type === 'channel') return i;
    }
    return App.cIdx;
}

/* ---------------- boot ---------------- */
function registerTvKeys() {
    if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return [];
    // Samsung/Tizen uses these key names, NOT the DOM "Arrow*" names.
    const keys = [
        'Up', 'Down', 'Left', 'Right',
        'Enter', 'Return',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'ChannelUp', 'ChannelDown'
    ];
    const failed = [];
    keys.forEach(k => {
        try { tizen.tvinputdevice.registerKey(k); }
        catch (e) { failed.push(k); }
    });
    return failed;
}

function debug(msg) {
    if (!els.debug) return;
    els.debug.classList.remove('hidden');
    const line = document.createElement('div');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    els.debug.appendChild(line);
}

function discoverEndpoints(baseUrl) {
    return new Promise((resolve, reject) => {
        if (!baseUrl) { reject(new Error('No SERVER_URL configured')); return; }
        const xhr = new XMLHttpRequest();
        xhr.open('GET', baseUrl.replace(/\/$/, '') + '/', true);
        xhr.timeout = 15000;
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 400) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const ep = data.endpoints || {};
                    const playlist = ep.playlist ? baseUrl.replace(/\/$/, '') + ep.playlist : null;
                    const globalEpg = ep.epg ? baseUrl.replace(/\/$/, '') + ep.epg : null;
                    const providers = data.providers || [];
                    const epgUrls = [];
                    if (globalEpg) epgUrls.push(globalEpg);
                    providers.forEach(p => {
                        if (p.epg) epgUrls.push(baseUrl.replace(/\/$/, '') + p.epg);
                    });
                    if (!playlist) { reject(new Error('Server did not return playlist endpoint')); return; }
                    resolve({ playlistUrl: playlist, epgUrls: epgUrls });
                } catch (e) {
                    reject(new Error('Bad discovery JSON: ' + e.message));
                }
            } else {
                reject(new Error('Discovery HTTP ' + xhr.status));
            }
        };
        xhr.onerror = () => reject(new Error('Discovery network error'));
        xhr.ontimeout = () => reject(new Error('Discovery timeout'));
        xhr.send();
    });
}

async function boot() {
    try {
        cacheEls();

        // Global error reporter: shows any uncaught error on the TV screen.
        window.onerror = (msg, url, line, col, err) => {
            debug('JS ERROR: ' + msg + ' @' + line + ':' + col + ' ' + (err && err.stack ? err.stack : ''));
            return false;
        };
        window.addEventListener('unhandledrejection', (e) => {
            debug('UNHANDLED PROMISE: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
        });

        const keyFails = registerTvKeys();
        debug('TV keys registered; failed: ' + (keyFails.length ? keyFails.join(', ') : 'none'));

        // Grab focus so remote keys reach our handler.
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        if (els.video) els.video.setAttribute('tabindex', '-1');

        let discovered = null;
        try {
            discovered = await discoverEndpoints(ENDPOINTS.serverUrl);
            App.playlistUrl = discovered.playlistUrl;
            App.epgUrls = discovered.epgUrls || [];
            debug('Discovered playlist=' + discovered.playlistUrl + ' epgs=' + (App.epgUrls.join(', ') || 'none'));
        } catch (e) {
            debug('Endpoint discovery failed: ' + e.message);
            // fallback: try any hardcoded builtins we may still have
        }

        const builtins = App.playlistUrl
            ? [{ id: 'discovered', name: 'Home Server', url: App.playlistUrl }]
            : (ENDPOINTS.builtins || []);
        setProviders(Storage.seedBuiltins(builtins));
        debug('Providers: ' + App.providers.map(p => p.name).join(', '));

        Player.init(els.video, {
            onReady: () => {},
            onError: (msg) => { toast('\u26a0 ' + msg, 4000); debug('PLAYER: ' + msg); },
            onCompleted: () => toast('Stream ended'),
        });

        let backCount = 0;
        document.addEventListener('keydown', (e) => {
            const code = e.keyCode;
            debug('KEYDOWN code=' + code + ' key=' + (e.key || '?'));

            // let text inputs handle their own keys (TV keyboard)
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                if (isBack(code)) { document.activeElement.blur(); e.preventDefault(); }
                return;
            }

            // digits work in PLAY mode
            if (App.mode === 'PLAY' && (KEYS.NUM(code) || KEYS.NUM_KP(code))) {
                onDigit(String(code >= 96 ? code - 96 : code - 48));
                e.preventDefault();
                return;
            }

            if (isBack(code)) {
                const handled = handleKey(code);
                if (!handled) {
                    backCount++;
                    toast(backCount === 1 ? 'Press Back again to exit' : 'Exiting\u2026', 2000);
                    if (backCount >= 2) {
                        Player.stop();
                        if (typeof tizen !== 'undefined') tizen.application.getCurrentApplication().exit();
                        return;
                    }
                }
                backCount = 0;
            } else {
                backCount = 0;
                handleKey(code);
            }
            e.preventDefault();
        }, true);

        // initial screen
        if (!App.providers.length) {
            openSettings();
        } else {
            App.mode = 'BROWSE';
            App.col = 'providers';
            els.sidebar.classList.remove('hidden');
            renderProviders();
            loadProvider(App.providers[App.pIdx] || App.providers[0]);
        }
        debug('Boot complete. mode=' + App.mode);
    } catch (err) {
        debug('BOOT FAILED: ' + (err && err.message ? err.message : err) + '\n' + (err && err.stack ? err.stack : ''));
        throw err;
    }
}

document.addEventListener('DOMContentLoaded', boot);
