// playlist-server — aggregates IPTV playlists into one endpoint.
//
// Configure upstream playlists via env vars AND/OR add/remove them at
// runtime through the admin API (persisted to DATA_FILE). Exposes ONE URL
// your Samsung Tizen app (or any IPTV client) can read:
//
//	GET /playlist.m3u    merged M3U  (?refresh=1 forces upstream pull)
//	GET /channels.json   {"channels":[{name,url,group,logo,provider}]}
//	GET /epg.xml         XMLTV passthrough (requires EPG_URL env)
//	GET /                provider status overview (JSON)
//	GET /healthz         ok
//
// Admin API (requires ADMIN_TOKEN env; send "Authorization: Bearer <token>"):
//
//	GET    /admin/sources                                  list all sources
//	POST   /admin/sources  {"name":"X","url":"https://..."} add + fetch now
//	DELETE /admin/sources/<id>                             remove a runtime source
//
// Env:
//
//	PLAYLISTS    comma-separated "Name|URL,Name|URL" (Name optional) or
//	             JSON '[{"name":"...","url":"..."}]'
//	CACHE_TTL    seconds between upstream refreshes (default 900)
//	PORT         HTTP port (default 8080)
//	USER_AGENT   upstream UA string (default "IPTV-Tizen/1.0")
//	ADMIN_TOKEN  enables the admin API
//	DATA_FILE    where runtime-added sources persist (default /data/sources.json)
//	EPG_URL      upstream XMLTV guide URL served at /epg.xml
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

// ---------------- config ----------------

type Config struct {
	Port      string
	TTL       time.Duration
	UserAgent string
	AdminToken string
	DataFile  string
	EPGURL    string
	Playlists string
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func loadConfig() Config {
	return Config{
		Port:       envOr("PORT", "8080"),
		TTL:        secondsEnv("CACHE_TTL", 900),
		UserAgent:  envOr("USER_AGENT", "IPTV-Tizen/1.0"),
		AdminToken: os.Getenv("ADMIN_TOKEN"),
		DataFile:   envOr("DATA_FILE", "/data/sources.json"),
		EPGURL:     os.Getenv("EPG_URL"),
		Playlists:  os.Getenv("PLAYLISTS"),
	}
}

func secondsEnv(key string, def int) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return time.Duration(def) * time.Second
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n <= 0 {
		log.Printf("invalid %s=%q, using %d", key, v, def)
		n = def
	}
	return time.Duration(n) * time.Second
}

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe http://127.0.0.1:$PORT/healthz and exit")
	flag.Parse()

	cfg := loadConfig()

	if *healthcheck {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		client := &http.Client{Timeout: 5 * time.Second}
		res, err := client.Get("http://127.0.0.1:" + port + "/healthz")
		if err != nil || res.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	srv := NewServer(cfg)
	log.Printf("playlist-server on :%s with %d source(s) (%d from env, %d runtime), TTL %ds, admin API %s, epg %s",
		cfg.Port, len(srv.store.All()), srv.store.BuiltinCount(), srv.store.RuntimeCount(), int(cfg.TTL.Seconds()),
		map[bool]string{true: "ENABLED", false: "disabled"}[cfg.AdminToken != ""],
		map[bool]string{true: "/epg.xml", false: "disabled"}[cfg.EPGURL != ""])
	if len(srv.store.All()) == 0 {
		log.Printf("WARNING: no playlists configured (PLAYLISTS env / admin API / DATA_FILE).")
	}

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(httpSrv.ListenAndServe())
}
