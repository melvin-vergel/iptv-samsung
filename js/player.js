/**
 * player.js — thin wrapper over Samsung's native AVPlay API.
 * AVPlay handles HLS natively on Tizen TV; a <video> element is used
 * only as the display surface.
 */
const Player = (() => {
    const AV = (typeof webapis !== 'undefined' && webapis.avplay) ? webapis.avplay : null;
    let videoEl = null;
    let currentUrl = null;
    let callbacks = { onReady: null, onError: null, onCompleted: null };
    let switchToken = 0;

    function nativeStates() {
        // STATE_* constants come from the AVPlay object itself.
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
                    AV.close();
                }
            } catch (e) { /* state machine may already be idle */ }
            // give the native layer a beat to release the pipeline
            setTimeout(resolve, 250);
        });
    }

    function prepare(url) {
        const token = ++switchToken;
        return teardown().then(() => {
            // Abort if the user picked another channel in the meantime.
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

    return {
        /** Must be called once with the <video> element before playing. */
        init(el, { onReady, onError, onCompleted } = {}) {
            videoEl = el;
            callbacks = { onReady, onError, onCompleted };
            if (!AV) {
                console.warn('AVPlay API unavailable (not running on a TV?)');
                return;
            }
            AV.setDisplayElement(videoEl);
            AV.setOnPlayerErrorListener((error) => {
                console.error('AVPlay error', error);
                if (callbacks.onError) callbacks.onError('Player error (' + error + ')');
            });
            AV.setOnCompletedListener(() => {
                if (callbacks.onCompleted) callbacks.onCompleted();
            });
        },

        get available() { return !!AV; },
        get url() { return currentUrl; },

        /** Load and play a stream URL. */
        play(url) {
            if (!AV) {
                if (callbacks.onError) callbacks.onError('Playback needs a TV (AVPlay unavailable)');
                return Promise.reject(new Error('AVPlay unavailable'));
            }
            if (url === currentUrl) return Promise.resolve(); // already tuned
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
