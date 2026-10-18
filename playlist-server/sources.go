package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Source is one upstream playlist (env-configured or runtime-added).
type Source struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	URL      string     `json:"url"`
	Builtin  bool       `json:"builtin"`
	Channels []Channel  `json:"-"`
	FetchedAt time.Time `json:"-"`
	LastErr  string     `json:"-"`
}

// SourceStore owns the source list, its cache and persistence.
type SourceStore struct {
	mu      sync.Mutex
	cfg     Config
	sources []*Source
	idSeq   int
	epg     struct {
		body []byte
		at   time.Time
	}
}

func NewSourceStore(cfg Config) *SourceStore {
	s := &SourceStore{cfg: cfg}
	for i, src := range parseEnvSources(cfg.Playlists) {
		src.ID = s.genID()
		src.Builtin = true
		log.Printf("env source %d: %s -> %s", i+1, src.Name, src.URL)
		s.sources = append(s.sources, src)
	}
	for _, src := range loadRuntimeSources(cfg.DataFile) {
		// skip runtime dupes of env urls
		dup := false
		for _, e := range s.sources {
			if e.URL == src.URL {
				dup = true
			}
		}
		if !dup {
			src.Builtin = false
			s.sources = append(s.sources, src)
		}
	}
	return s
}

func (s *SourceStore) genID() string {
	s.idSeq++
	return fmt.Sprintf("s%x%d", time.Now().UnixMilli(), s.idSeq)
}

// ---------------- env parsing ----------------

var httpPrefix = regexp.MustCompile(`(?i)^https?://`)

type envSource struct{ name, url string }

func parseEnvSources(raw string) []*Source {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var items []envSource
	if strings.HasPrefix(raw, "[") {
		var arr []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		}
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			log.Printf("PLAYLISTS JSON parse failed: %v", err)
			return nil
		}
		for i, a := range arr {
			if a.URL == "" {
				continue
			}
			name := a.Name
			if name == "" {
				name = fmt.Sprintf("Source %d", i+1)
			}
			items = append(items, envSource{name, a.URL})
		}
	} else {
		for i, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			name, u := autoName(i+1), part
			if sep := strings.Index(part, "|"); sep > 0 {
				name, u = strings.TrimSpace(part[:sep]), strings.TrimSpace(part[sep+1:])
			} else if eq := strings.LastIndex(part, "="); eq > 0 && httpPrefix.MatchString(part[eq+1:]) {
				name, u = strings.TrimSpace(part[:eq]), strings.TrimSpace(part[eq+1:])
			}
			items = append(items, envSource{name, u})
		}
	}
	out := make([]*Source, 0, len(items))
	for _, it := range items {
		out = append(out, &Source{Name: it.name, URL: it.url})
	}
	return out
}

func autoName(i int) string { return fmt.Sprintf("Source %d", i) }

// ---------------- persistence ----------------

func loadRuntimeSources(file string) []*Source {
	data, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var arr []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if json.Unmarshal(data, &arr) != nil {
		return nil
	}
	var out []*Source
	for _, a := range arr {
		if a.URL == "" {
			continue
		}
		id := a.ID
		if id == "" {
			id = fmt.Sprintf("sr%d", time.Now().UnixNano())
		}
		out = append(out, &Source{ID: id, Name: orDefault(a.Name, "Source"), URL: a.URL})
	}
	return out
}

func (s *SourceStore) persistRuntime() {
	type persisted struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	var keep []persisted
	for _, src := range s.sources {
		if !src.Builtin {
			keep = append(keep, persisted{src.ID, src.Name, src.URL})
		}
	}
	data, _ := json.MarshalIndent(keep, "", "  ")
	if err := os.MkdirAll(filepath.Dir(s.cfg.DataFile), 0o755); err != nil {
		log.Printf("could not create data dir: %v", err)
		return
	}
	if err := os.WriteFile(s.cfg.DataFile, data, 0o644); err != nil {
		log.Printf("could not persist sources: %v", err)
	}
}

// ---------------- fetch + cache ----------------

func (s *SourceStore) Fetch(src *Source) {
	client := &http.Client{Timeout: 20 * time.Second}
	req, err := http.NewRequest("GET", src.URL, nil)
	if err == nil {
		req.Header.Set("User-Agent", s.cfg.UserAgent)
		var res *http.Response
		res, err = client.Do(req)
		if err == nil {
			defer res.Body.Close()
			if res.StatusCode < 200 || res.StatusCode >= 400 {
				err = fmt.Errorf("HTTP %d", res.StatusCode)
			} else {
				var body []byte
				body, err = io.ReadAll(io.LimitReader(res.Body, 64<<20))
				var ch []Channel
				if err == nil {
					ch, err = parseBody(string(body))
					if err == nil && len(ch) == 0 {
						err = fmt.Errorf("0 channels parsed")
					}
				}
				if err == nil {
					s.mu.Lock()
					src.Channels = ch
					src.LastErr = ""
					s.mu.Unlock()
					log.Printf("[%s] %d channels", src.Name, len(ch))
				}
			}
		}
	}
	s.mu.Lock()
	src.FetchedAt = time.Now()
	if err != nil {
		src.LastErr = err.Error()
		log.Printf("[%s] refresh failed: %v (serving last good list: %d)", src.Name, err, len(src.Channels))
	}
	s.mu.Unlock()
}

// EnsureFresh refreshes stale sources (or all when force).
func (s *SourceStore) EnsureFresh(force bool) {
	s.mu.Lock()
	var stale []*Source
	for _, src := range s.sources {
		if force || time.Since(src.FetchedAt) > s.cfg.TTL {
			stale = append(stale, src)
		}
	}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, src := range stale {
		wg.Add(1)
		go func(x *Source) { defer wg.Done(); s.Fetch(x) }(src)
	}
	wg.Wait()
}

// ---------------- views ----------------

func (s *SourceStore) All() []*Source {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Source, len(s.sources))
	copy(out, s.sources)
	return out
}

func (s *SourceStore) BuiltinCount() int {
	n := 0
	for _, src := range s.All() {
		if src.Builtin {
			n++
		}
	}
	return n
}

func (s *SourceStore) RuntimeCount() int { return len(s.All()) - s.BuiltinCount() }

// Channels returns merged channels; provider names prefix groups when >1 source.
func (s *SourceStore) Channels() []ChannelOut {
	all := s.All()
	prefix := len(all) > 1
	var out []ChannelOut
	for _, src := range all {
		for _, c := range src.Channels {
			g := c.Group
			if prefix && src.Name != "" {
				g = src.Name + " / " + c.Group
			}
			out = append(out, ChannelOut{Channel: Channel{Name: c.Name, URL: c.URL, Group: g, Logo: c.Logo, TvgID: c.TvgID}, Provider: src.Name})
		}
	}
	return out
}

// AddSource registers a runtime source, persists and fetches it now.
func (s *SourceStore) AddSource(name, u string) (*Source, error) {
	if !httpPrefix.MatchString(u) {
		return nil, fmt.Errorf("url must be a valid http(s) URL")
	}
	if name == "" {
		if pu, err := url.Parse(u); err == nil {
			name = pu.Hostname()
		}
	}
	s.mu.Lock()
	for _, ex := range s.sources {
		if ex.URL == u {
			s.mu.Unlock()
			return nil, fmt.Errorf("duplicate:%s", ex.ID)
		}
	}
	src := &Source{ID: s.genID(), Name: name, URL: u}
	s.sources = append(s.sources, src)
	s.persistRuntime()
	s.mu.Unlock()
	s.Fetch(src)
	return src, nil
}

// RemoveSource deletes a runtime (non-builtin) source by id.
func (s *SourceStore) RemoveSource(id string) (*Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, src := range s.sources {
		if src.ID == id {
			if src.Builtin {
				return nil, fmt.Errorf("builtin")
			}
			s.sources = append(s.sources[:i], s.sources[i+1:]...)
			s.persistRuntime()
			return src, nil
		}
	}
	return nil, fmt.Errorf("notfound")
}

// ---------------- EPG passthrough ----------------

func (s *SourceStore) GetEPG() ([]byte, bool) {
	if s.cfg.EPGURL == "" {
		return nil, false
	}
	s.mu.Lock()
	stale := time.Since(s.epg.at) > s.cfg.TTL
	body := s.epg.body
	s.mu.Unlock()
	if stale {
		client := &http.Client{Timeout: 30 * time.Second}
		req, _ := http.NewRequest("GET", s.cfg.EPGURL, nil)
		req.Header.Set("User-Agent", s.cfg.UserAgent)
		res, err := client.Do(req)
		if err == nil {
			defer res.Body.Close()
			if res.StatusCode >= 200 && res.StatusCode < 400 {
				body, err = io.ReadAll(io.LimitReader(res.Body, 128<<20))
				if err == nil {
					s.mu.Lock()
					s.epg.body, s.epg.at = body, time.Now()
					s.mu.Unlock()
				} else {
					body = s.epg.body
				}
			} else {
				log.Printf("EPG fetch failed: HTTP %d", res.StatusCode)
			}
		} else {
			log.Printf("EPG fetch failed: %v", err)
		}
	}
	return body, true
}
