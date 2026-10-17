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
```

## Building & installing on your TV

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
