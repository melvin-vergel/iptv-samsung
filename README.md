# Samsung Tizen IPTV App

A live-TV IPTV app for Samsung Tizen TVs (2017+). Load one or more **M3U/M3U8
playlists**, browse channels grouped by category, and play HLS streams using
Samsung's native **AVPlay** engine. Fully remote-control driven — no mouse or
touch needed.

## Features

- Multiple playlist providers (saved on the TV via localStorage)
- M3U parser with `group-title`, `tvg-logo`, `tvg-name` support
- Channel groups/sections with numbered channel list
- Number-pad channel select (type "125" → channel 125)
- Channel up/down with the remote arrows while watching
- Native HLS playback via `webapis.avplay` (no transcoding, smooth on TV)
- On-screen TV keyboard for entering playlist URLs (native `<input>` focus)

## Controls

| Key | Action |
|-----|--------|
| ← / → | Open/close sidebar, switch between provider & channel columns |
| ↑ / ↓ | Browse providers/channels; while watching: channel +/- |
| OK / Enter | Select provider / play channel |
| 0–9 | Jump to channel number (while watching) |
| Back | Close sidebar · press twice to exit the app |
| ⚙ Manage playlists | First item under providers, opens add/remove screen |

## Project layout

```
config.xml        Tizen widget manifest (TV profile, internet privilege)
index.html        App shell (video surface + UI layers)
css/style.css     TV-styled dark UI
js/storage.js     Provider persistence (localStorage)
js/playlist.js    M3U fetch + parse + grouping
js/player.js      AVPlay wrapper (prepare/play/stop, error handling)
js/main.js        State machine + remote-key routing + rendering
icon.png          App icon (replace with your own 112x112)
install.sh        One-command Docker installer (Option A below)
docker/           Installer image: Dockerfile, entrypoint.sh, run.sh
.env.default      Installer config template (cert + TV IP)
playlist-server/  Your own channel-list endpoint server (Docker, Node)
```

## Playlist endpoint server (`playlist-server/`)

A tiny zero-dependency Node container you can run on your local server (or
any Docker host on the LAN). You give it upstream playlist URLs via env
vars; it fetches, parses and **merges them into one stable endpoint** that
this TV app reads:

| Route | Returns |
|-------|---------|
| `/playlist.m3u` | merged M3U (standard format, works with any IPTV client) |
| `/channels.json` | `{"channels":[{name,url,group,logo,provider}]}` (this app understands it natively) |
| `/` | provider status (channel counts, last errors) |
| `/healthz` | healthcheck |

```bash
cd playlist-server
cp .env.example .env      # set PLAYLISTS="Name|https://...m3u,Name2|https://..."
docker compose up -d --build
```

Then point the TV app at `http://<server-ip>:8080/playlist.m3u`
(or add it as a builtin in `js/endpoints.js`). The app always gets fresh
channel lists from YOUR server — upstream changes need no TV redeploy, and
sources that block TV user-agents or require CORS are handled by the server
(`USER_AGENT` env lets you masquerade if needed). Failed upstreams keep
serving their last good cache (`CACHE_TTL` seconds between refreshes,
default 900).

## Building & installing on your TV

Two options. **Option A (recommended)** mirrors the
[jellyfin-tizen-installer](https://github.com/ldotlopez/jellyfin-tizen-installer)
approach: one Docker command, no Tizen Studio GUI on your Mac, no Samsung
developer account needed. Option B is the classic Tizen Studio route.

### Option A — one-command Docker installer (`./install.sh`)

Prerequisites: Docker Desktop (or Colima) running + your TV on the same network.

1. **Enable Developer Mode on the TV**
   On the TV: *Settings* → *General* → *Developer Mode* (or open the **Apps**
   page and press `12345` on the remote). Set **IP Address** to **your Mac's
   IP** (`ipconfig getifaddr en0`), toggle **On**, and let the TV restart.

2. **Configure**
   ```bash
   cp .env.default .env
   # edit .env: set CERT_PASSWORD and TIZEN_TV_IP (the TV's IP)
   ```

3. **Install**
   ```bash
   ./install.sh
   ```
   The first run downloads the Tizen Studio CLI (~1.8 GB) into `./build/`
   and creates a signing certificate in `./cert/` — both are cached/reused,
   so later runs take ~1 minute and can update the app *without uninstalling*.
   When it finishes, the app is installed and launched on the TV.

How it works (`docker/run.sh`): downloads the Tizen Studio web CLI →
generates/reuses a self-signed author cert → `tizen build-web` +
`tizen package` → `sdb connect <TV_IP>` → `tizen install` → launches the app.

> ⚠️ Keep `./cert/` — reinstalling with a different certificate requires
> uninstalling the old app first. And keep `.env` private (cert password);
> it's gitignored.

**Troubleshooting** (same as the Jellyfin installer):
- *Could not connect to TV* → TV on, developer mode on, correct IPs, same LAN; `ping <TV_IP>`.
- *Interrupted Tizen Studio download* → `rm build/tizen-studio.bin` and rerun.
- *Install fails (certificate mismatch)* → use the original `./cert/*.p12` or uninstall the app from the TV first.

### Option B — Tizen Studio (GUI)

You need **Tizen Studio** (free, requires a Samsung developer account):

1. **Install Tizen Studio**
   Download "Tizen Studio (with Package Manager)" from
   <https://developer.samsung.com/smarttv/develop/getting-started/setting-up-development-environment.html>
   and run the installer. In Package Manager make sure **TV Extension SDK** is
   installed.

2. **Create a Tizen certificate**
   Tizen Studio → *Tools* → *Tizen Certificate Manager* → create a **Samsung**
   certificate (sign in with your Samsung account when prompted). Keep the
   password handy.

3. **Enable Developer Mode on the TV**
   On the TV: *Apps* → search **Developer Mode** app (or Settings → General →
   Developer Mode). Set **IP Address** to your Mac's local IP (run
   `ipconfig getifaddr en0`), toggle **On**, restart the TV when asked.

4. **Import the project**
   Tizen Studio → *File → New → Tizen Web Project* → choose the **TV** style →
   import from existing content → select this folder. When asked, pick the
   certificate you created.

5. **Run on TV**
   Click the drop-down next to the Run button → *Run on Remote Device* → your
   TV should be discovered on the network (make sure TV and Mac share the same
   Wi-Fi/LAN). Select it, enter the TV's **key** shown in the Developer Mode
   app, and deploy. The app launches on the TV.

### Alternative: command line

```bash
# tizen CLI ships with Tizen Studio at ~/tizen-studio/tools/cli
export PATH="$HOME/tizen-studio/tools/cli:$HOME/tizen-studio/ide/tools:$PATH"

cd samsung-iptv
tizen build web
tizen package -t web -s <your-profile-name> -- .build/results
tizen install -n IPTV.wgt -t <TV-device-name>   # see: tizen device -l
tizen run -t <TV-device-name> -a IPTVa1b2c3.IPTV
```

> Replace the `tizen:application id`/`package` in `config.xml` if it collides
> with another sideloaded app of yours.

## Testing without a TV

- UI + playlist logic: open `index.html` in Chrome (DevTools device toolbar →
  1920×1080). Playback won't work — `webapis.avplay` only exists on TVs; the
  app shows a toast instead.
- Samsung also offers an **Emulator** via Tizen Studio's Device Manager
  (TV profile) that *does* include AVPlay support.

## Notes & ideas for later

- Playlist URLs must be reachable from the TV's network.
- Some providers block non-TV user agents; if a playlist fails to load, try
  it in Safari/Chrome on the same network to confirm the URL is live.
- Next features worth adding: **EPG** (`tvg-id` + XMLTV), last-channel
  resume, favorites, search, and audio/subtitle track selection via
  `AVPlay.selectTrack`.
