/**
 * player.js — thin wrapper over Samsung's native AVPlay API.
 * Supports both the older API (setDisplayRect/open/prepareAsync) used by
 * 2017-2020 Tizen TVs and the newer API (setDisplayElement/prepare) used
 * by 2021+ models.
 */
const Player = (() => {
    const AV = (typeof webapis !== 'undefined' && webapis.avplay) ? webapis.avplay : null;
    let videoEl = null;
    let currentUrl = null;
    let callbacks = { onReady: null, onError: null, onCompleted: null };
    let switchToken = 0;

    // The TV in this issue exposes webapis.avplay but lacks setDisplayElement,
    // so we fall back to the old setDisplayRect/open/prepareAsync path.
    const isOldApi = AV && typeof AV.setDisplayRect === 'function';

    function nativeStates() {
        return AV;
    }

    function isBusyState() {
        if (!AV) return false;
        try {
            const s = AV.getPlayerState();
            return s === AV.STATE_PREPARED || s === AV.STATE_PLAYING ||
                   s === AV.STATE_PAUSED || s === AV.STATE_VIDEO_ONLY ||
                   s === AV.STATE_AUDIO_ONLY || s === AV.STATE_READY;
        } catch (e) { return false; }
    }

    function teardown() {
        if (!AV) return Promise.resolve();
        return new Promise((resolve) => {
            try {
                if (isBusyState()) {
                    AV.stop();
                }
                AV.close();
            } catch (e) { /* state machine may already be idle */ }
            setTimeout(resolve, 250);
        });
    }

    function prepareNew(url) {
        const token = ++switchToken;
        return teardown().then(() => {
            if (token !== switchToken) return;
            return new Promise((resolve, reject) => {
                try {
                    AV.prepare(
                        { url, additionalData: [], codec: 'AUDIO|VIDEO' },
                        () => {
                            if (token !== switchToken) return;
                            try {
                                AV.play();
                                AV.setMuted(false);
                            } catch (e) {
                                reject(e);
                                return;
                            }
                            currentUrl = url;
                            resolve();
                        },
                        (err) => {
                            console.error('AVPlay prepare failed', err);
                            reject(new Error('Playback failed (' + err + ')'));
                        }
                    );
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    function prepareOld(url) {
        const token = ++switchToken;
        return teardown().then(() => {
            if (token !== switchToken) return;
            return new Promise((resolve, reject) => {
                try {
                    AV.open(url);
                    // Full-screen rectangle in the TV app coordinate space.
                    AV.setDisplayRect(0, 0, 1920, 1080);
                    AV.prepareAsync(
                        () => {
                            if (token !== switchToken) return;
                            try {
                                AV.play();
                                AV.setMuted(false);
                            } catch (e) {
                                reject(e);
                                return;
                            }
                            currentUrl = url;
                            resolve();
                        },
                        (err) => {
                            console.error('AVPlay prepareAsync failed', err);
                            reject(new Error('Playback failed (' + err + ')'));
                        }
                    );
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    return {
        init(el, { onReady, onError, onCompleted } = {}) {
            videoEl = el;
            callbacks = { onReady, onError, onCompleted };
            if (!AV) {
                console.warn('AVPlay API unavailable (not running on a TV?)');
                return;
            }
            if (isOldApi) {
                AV.setDisplayRect(0, 0, 1920, 1080);
                if (typeof AV.setListener === 'function') {
                    AV.setListener({
                        onerror: (error) => {
                            console.error('AVPlay error', error);
                            if (callbacks.onError) callbacks.onError('Player error (' + error + ')');
                        },
                        onstreamcompleted: () => {
                            if (callbacks.onCompleted) callbacks.onCompleted();
                        }
                    });
                }
            } else {
                AV.setDisplayElement(videoEl);
                AV.setOnPlayerErrorListener((error) => {
                    console.error('AVPlay error', error);
                    if (callbacks.onError) callbacks.onError('Player error (' + error + ')');
                });
                AV.setOnCompletedListener(() => {
                    if (callbacks.onCompleted) callbacks.onCompleted();
                });
            }
        },

        get available() { return !!AV; },
        get url() { return currentUrl; },

        play(url) {
            if (!AV) {
                if (callbacks.onError) callbacks.onError('Playback needs a TV (AVPlay unavailable)');
                return Promise.reject(new Error('AVPlay unavailable'));
            }
            if (url === currentUrl) return Promise.resolve();
            const prepare = isOldApi ? prepareOld : prepareNew;
            return prepare(url).then(() => {
                if (callbacks.onReady) callbacks.onReady(url);
            }).catch((err) => {
                if (callbacks.onError) callbacks.onError(err.message || String(err));
                throw err;
            });
        },

        stop() {
            currentUrl = null;
            switchToken++;
            return teardown();
        },

        setMuted(m) {
            if (AV) { try { AV.setMuted(m); } catch (e) {} }
        },
    };
})();
