package main

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

// Channel is one playable entry.
type Channel struct {
	Name  string `json:"name"`
	URL   string `json:"url"`
	Group string `json:"group"`
	Logo  string `json:"logo"`
	TvgID string `json:"tvg_id,omitempty"`
}

// ChannelOut adds the provider for /channels.json consumers.
type ChannelOut struct {
	Channel
	Provider string `json:"provider"`
}

var (
	attrRe   = regexp.MustCompile(`([a-zA-Z0-9_-]+)="([^"]*)"`)
	urlLine  = regexp.MustCompile(`(?i)^https?://`)
	numName  = regexp.MustCompile(`/([^/?#]+)(\?|#|$)`)
)

// parseExtInf extracts attributes and display name from one #EXTINF line.
func parseExtInf(line string) (name, logo, group, tvgId string) {
	attrs := map[string]string{}
	for _, m := range attrRe.FindAllStringSubmatch(line, -1) {
		attrs[m[1]] = m[2]
	}
	if i := strings.LastIndex(line, ","); i >= 0 {
		name = strings.TrimSpace(line[i+1:])
	}
	if name == "" {
		name = attrs["tvg-name"]
	}
	return name, attrs["tvg-logo"], orDefault(attrs["group-title"], "Uncategorized"), attrs["tvg-id"]
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// parseM3U converts playlist text into channels.
func parseM3U(text string) []Channel {
	var out []Channel
	var meta *struct{ name, logo, group, tvgId string }

	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "#EXTINF"):
			n, l, g, id := parseExtInf(line)
			meta = &struct{ name, logo, group, tvgId string }{n, l, g, id}
		case strings.HasPrefix(line, "#EXTGRP"):
			if meta != nil {
				meta.group = orDefault(strings.TrimSpace(line[7:]), meta.group)
			}
		case strings.HasPrefix(line, "#"):
			// other tags/comments
		case urlLine.MatchString(line):
			name := ""
			if meta != nil {
				name = meta.name
			}
			if name == "" {
				name = baseName(line)
			}
			ch := Channel{Name: name, URL: line}
			if meta != nil {
				ch.Group = meta.group
				ch.Logo = meta.logo
				ch.TvgID = meta.tvgId
			} else {
				ch.Group = "Uncategorized"
			}
			out = append(out, ch)
			meta = nil
		}
	}
	return out
}

func baseName(u string) string {
	m := numName.FindStringSubmatch(u)
	if m == nil {
		return "Channel"
	}
	if dec, err := url.PathUnescape(m[1]); err == nil && dec != "" {
		return dec
	}
	if m[1] != "" {
		return m[1]
	}
	return "Channel"
}

// pickStr returns the first non-empty string field among keys.
func pickStr(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// parseJSONChannels accepts [{...}], {"channels":[...]}, {"data":[...]}.
func parseJSONChannels(text string) ([]Channel, error) {
	var data any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		return nil, err
	}
	var list []any
	switch v := data.(type) {
	case []any:
		list = v
	case map[string]any:
		for _, key := range []string{"channels", "data"} {
			if arr, ok := v[key].([]any); ok {
				list = arr
				break
			}
		}
	}
	if list == nil {
		return nil, &json.SyntaxError{}
	}
	var out []Channel
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		u := pickStr(m, "url", "streamUrl", "link")
		if u == "" {
			continue
		}
		out = append(out, Channel{
			Name:  orDefault(pickStr(m, "name", "title"), "Channel"),
			URL:   u,
			Group: orDefault(pickStr(m, "group", "group_title", "group-title", "category"), "Uncategorized"),
			Logo:  pickStr(m, "logo", "tvg_logo", "tvg-logo"),
			TvgID: pickStr(m, "tvg_id", "tvgId", "tvg-id", "id"),
		})
	}
	return out, nil
}

// parseBody sniffs M3U vs JSON.
func parseBody(text string) ([]Channel, error) {
	t := strings.TrimSpace(text)
	if strings.HasPrefix(t, "[") || strings.HasPrefix(t, "{") {
		return parseJSONChannels(t)
	}
	return parseM3U(t), nil
}

// renderM3U serializes channels back to M3U text.
func renderM3U(channels []ChannelOut) string {
	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	for _, c := range channels {
		b.WriteString(`#EXTINF:-1 tvg-name="`)
		b.WriteString(escapeAttr(c.Name))
		b.WriteString(`" group-title="`)
		b.WriteString(escapeAttr(c.Group))
		b.WriteString(`"`)
		if c.TvgID != "" {
			b.WriteString(` tvg-id="`)
			b.WriteString(escapeAttr(c.TvgID))
			b.WriteString(`"`)
		}
		if c.Logo != "" {
			b.WriteString(` tvg-logo="`)
			b.WriteString(escapeAttr(c.Logo))
			b.WriteString(`"`)
		}
		b.WriteString(",")
		b.WriteString(c.Name)
		b.WriteString("\n")
		b.WriteString(c.URL)
		b.WriteString("\n")
	}
	return b.String()
}

func escapeAttr(s string) string { return strings.ReplaceAll(s, `"`, "'") }
