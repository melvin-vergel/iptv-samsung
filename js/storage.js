/**
 * storage.js — persistence for playlist providers (localStorage).
 */
const Storage = (() => {
    const KEY = 'iptv.providers.v1';
    const SEEDED = 'iptv.seeded.v1';

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list.filter(p => p && p.name && p.url) : [];
        } catch (e) {
            console.error('provider load failed', e);
            return [];
        }
    }

    function save(providers) {
        localStorage.setItem(KEY, JSON.stringify(providers));
    }

    function add(name, url) {
        const providers = load();
        providers.push({ id: 'p' + Date.now().toString(36), name, url });
        save(providers);
        return providers;
    }

    function remove(id) {
        const providers = load().filter(p => p.id !== id);
        save(providers);
        return providers;
    }

    /**
     * One-time seeding of endpoint providers baked into the app
     * (see js/endpoints.js). Runs only on first launch, so users can
     * still remove them afterwards.
     */
    function seedBuiltins(builtins) {
        if (localStorage.getItem(SEEDED) || !builtins || !builtins.length) return load();
        const providers = load();
        for (const b of builtins) {
            if (!providers.some(p => p.id === b.id)) {
                providers.push({ id: b.id, name: b.name, url: b.url });
            }
        }
        save(providers);
        localStorage.setItem(SEEDED, '1');
        return providers;
    }

    return { load, add, remove, seedBuiltins };
})();
