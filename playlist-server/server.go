package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Server wires routes over a SourceStore.
type Server struct {
	cfg   Config
	store *SourceStore
}

func NewServer(cfg Config) *Server {
	return &Server{cfg: cfg, store: NewSourceStore(cfg)}
}

type providerStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Builtin   bool   `json:"builtin"`
	Channels  int    `json:"channels"`
	LastError string `json:"lastError"`
	FetchedAt string `json:"fetchedAt"`
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	full := r.URL.Path
	query := r.URL.Query().Get("refresh") == "1"

	if strings.HasPrefix(full, "/admin") {
		s.handleAdmin(w, r)
		return
	}

	s.store.EnsureFresh(query)

	send := func(code int, ctype, body string) {
		maxAge := int(s.cfg.TTL.Seconds())
		if maxAge > 60 {
			maxAge = 60
		}
		w.Header().Set("Content-Type", ctype)
		w.Header().Set("Cache-Control", "public, max-age="+itoa(maxAge))
		w.WriteHeader(code)
		io.WriteString(w, body)
	}

	switch {
	case full == "/playlist.m3u" || full == "/playlist":
		send(http.StatusOK, "application/x-mpegurl; charset=utf-8", renderM3U(s.store.Channels()))
	case full == "/channels.json":
		channels := s.store.Channels()
		if channels == nil {
			channels = []ChannelOut{}
		}
		b, _ := json.Marshal(map[string]any{"channels": channels})
		send(http.StatusOK, "application/json; charset=utf-8", string(b))
	case full == "/epg.xml" || full == "/epg":
		body, ok := s.store.GetEPG()
		if !ok {
			send(http.StatusServiceUnavailable, "text/plain", "EPG disabled: set EPG_URL\n")
			return
		}
		if body == nil {
			send(http.StatusBadGateway, "text/plain", "EPG upstream unavailable\n")
			return
		}
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.WriteHeader(http.StatusOK)
		w.Write(body)
	case full == "/healthz":
		send(http.StatusOK, "text/plain", "ok")
	case full == "/":
		status := map[string]any{
			"updatedAt":  nowISO(),
			"ttlSeconds": int(s.cfg.TTL.Seconds()),
			"endpoints":  s.endpoints(),
			"providers":  s.providerStatuses(),
		}
		b, _ := json.MarshalIndent(status, "", "  ")
		send(http.StatusOK, "application/json; charset=utf-8", string(b))
	default:
		send(http.StatusNotFound, "text/plain", "not found\n")
	}
}

func (s *Server) endpoints() map[string]any {
	ep := map[string]any{"playlist": "/playlist.m3u", "channels": "/channels.json"}
	if s.cfg.EPGURL != "" {
		ep["epg"] = "/epg.xml"
	} else {
		ep["epg"] = nil
	}
	return ep
}

func (s *Server) providerStatuses() []providerStatus {
	var out []providerStatus
	for _, src := range s.store.All() {
		st := providerStatus{
			ID: src.ID, Name: src.Name, URL: src.URL,
			Builtin: src.Builtin, Channels: len(src.Channels),
		}
		if src.LastErr != "" {
			st.LastError = src.LastErr
		}
		if !src.FetchedAt.IsZero() {
			st.FetchedAt = src.FetchedAt.UTC().Format(timeRFC3339)
		}
		out = append(out, st)
	}
	if out == nil {
		out = []providerStatus{}
	}
	return out
}

// ---------------- admin API ----------------

func (s *Server) handleAdmin(w http.ResponseWriter, r *http.Request) {
	jsonOut := func(code int, v any) {
		b, _ := json.Marshal(v)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		w.Write(b)
	}
	errOut := func(code int, msg string) { jsonOut(code, map[string]string{"error": msg}) }

	if s.cfg.AdminToken == "" {
		errOut(http.StatusForbidden, "admin API disabled: set ADMIN_TOKEN env")
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+s.cfg.AdminToken {
		errOut(http.StatusUnauthorized, "unauthorized")
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	parts := strings.Split(path, "/") // ["", "admin", "sources", "<id>"]

	switch {
	case r.Method == "GET" && path == "/admin/sources":
		var list []map[string]any
		for _, src := range s.store.All() {
			list = append(list, map[string]any{
				"id": src.ID, "name": src.Name, "url": src.URL,
				"builtin": src.Builtin, "channels": len(src.Channels),
			})
		}
		jsonOut(http.StatusOK, map[string]any{"sources": list})

	case r.Method == "POST" && path == "/admin/sources":
		var body struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		}
		data, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
		if json.Unmarshal(data, &body) != nil {
			errOut(http.StatusBadRequest, "invalid JSON")
			return
		}
		src, err := s.store.AddSource(body.Name, strings.TrimSpace(body.URL))
		if err != nil {
			if strings.HasPrefix(err.Error(), "duplicate:") {
				jsonOut(http.StatusConflict, map[string]string{
					"error": "url already configured",
					"id":    strings.TrimPrefix(err.Error(), "duplicate:"),
				})
				return
			}
			errOut(http.StatusBadRequest, err.Error())
			return
		}
		jsonOut(http.StatusCreated, map[string]any{
			"added": src.ID, "name": src.Name,
			"channels": len(src.Channels), "lastError": emptyToNil(src.LastErr),
		})

	case r.Method == "DELETE" && len(parts) == 4 && parts[2] == "sources":
		src, err := s.store.RemoveSource(parts[3])
		switch {
		case err != nil && err.Error() == "notfound":
			errOut(http.StatusNotFound, "not found")
		case err != nil && err.Error() == "builtin":
			errOut(http.StatusForbidden, "cannot delete env-configured source (edit PLAYLISTS instead)")
		case err != nil:
			errOut(http.StatusInternalServerError, err.Error())
		default:
			jsonOut(http.StatusOK, map[string]string{"removed": src.ID, "name": src.Name})
		}

	default:
		errOut(http.StatusNotFound, "not found")
	}
}

func emptyToNil(v any) any {
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	return v
}
