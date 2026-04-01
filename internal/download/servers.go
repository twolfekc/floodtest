package download

import (
	"sync"
	"time"
)

const unhealthyCooldown = 5 * time.Minute

// DefaultServers is the built-in list of public speed-test file URLs.
// All URLs verified working. Intentionally large (20+) and geographically
// diverse so the tool can sustain bandwidth even if individual servers
// block us or go offline.
var DefaultServers = []string{
	// --- Hetzner (Germany, Finland, US, Singapore) — 10GB files ---
	"http://speed.hetzner.de/10GB.bin",
	"http://fsn1-speed.hetzner.com/10GB.bin",
	"http://nbg1-speed.hetzner.com/10GB.bin",
	"http://hel1-speed.hetzner.com/10GB.bin",
	"http://ash-speed.hetzner.com/10GB.bin",
	"http://sin-speed.hetzner.com/10GB.bin",
	// --- European Providers — large files ---
	"http://speedtest.belwue.net/10G",              // BelWUe (Germany)
	"http://speedtest.tele2.net/10GB.zip",           // Tele2 (Sweden)
	"http://proof.ovh.net/files/10Gb.dat",           // OVH (France)
	"http://ping.online.net/10000Mo.dat",            // Scaleway/Online.net (France)
	"http://scaleway.testdebit.info/10G.iso",        // Scaleway (France)
	"http://speedtest.serverius.net/files/10000mb.bin", // Serverius (Netherlands)
	// --- Vultr Looking Glass (global, 1GB files) ---
	"http://lax-ca-us-ping.vultr.com/vultr.com.1000MB.bin",  // Los Angeles
	"http://nj-us-ping.vultr.com/vultr.com.1000MB.bin",      // New Jersey
	"http://ams-nl-ping.vultr.com/vultr.com.1000MB.bin",     // Amsterdam
	"http://fra-de-ping.vultr.com/vultr.com.1000MB.bin",     // Frankfurt
	"http://par-fr-ping.vultr.com/vultr.com.1000MB.bin",     // Paris
	"http://sgp-ping.vultr.com/vultr.com.1000MB.bin",        // Singapore
	"http://hnd-jp-ping.vultr.com/vultr.com.1000MB.bin",     // Tokyo
	"http://syd-au-ping.vultr.com/vultr.com.1000MB.bin",     // Sydney
	// --- CDN / Misc ---
	"http://cachefly.cachefly.net/200mb.test",                // CacheFly CDN
	"http://ipv4.download.thinkbroadband.com/1GB.zip",        // ThinkBroadband (UK)
}

// ServerHealth contains the current health status of a download server,
// exported for API consumption.
type ServerHealth struct {
	URL                string    `json:"url"`
	Healthy            bool      `json:"healthy"`
	ConsecutiveFailures int      `json:"consecutiveFailures"`
	TotalFailures      int       `json:"totalFailures"`
	TotalDownloads     int       `json:"totalDownloads"`
	LastError          string    `json:"lastError,omitempty"`
	LastErrorTime      time.Time `json:"lastErrorTime,omitempty"`
	UnhealthyUntil     time.Time `json:"unhealthyUntil,omitempty"`
	BytesDownloaded    int64     `json:"bytesDownloaded"`
}

// Server represents a single download endpoint with health tracking.
type Server struct {
	URL                 string
	healthy             bool
	unhealthyUntil      time.Time
	consecutiveFailures int
	totalFailures       int
	totalDownloads      int
	lastError           string
	lastErrorTime       time.Time
	bytesDownloaded     int64
}

// ServerList manages a thread-safe, round-robin list of download servers
// with per-server health tracking and automatic cooldown recovery.
type ServerList struct {
	mu      sync.RWMutex
	servers []Server
	index   int
}

// NewServerList creates a ServerList from the given URLs.
// All servers start in the healthy state.
func NewServerList(urls []string) *ServerList {
	servers := make([]Server, len(urls))
	for i, u := range urls {
		servers[i] = Server{URL: u, healthy: true}
	}
	return &ServerList{servers: servers}
}

// Next returns the URL of the next healthy server using round-robin rotation.
//
// If the candidate server is marked unhealthy but its cooldown has expired,
// it is automatically promoted back to healthy and returned.
//
// If every server is unhealthy, Next returns the one whose cooldown expires
// soonest so the caller can retry instead of blocking.
func (sl *ServerList) Next() string {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	if len(sl.servers) == 0 {
		return ""
	}

	now := time.Now()
	start := sl.index

	// Walk the full ring looking for a healthy (or recovered) server.
	for i := 0; i < len(sl.servers); i++ {
		idx := (start + i) % len(sl.servers)
		s := &sl.servers[idx]

		if s.healthy {
			sl.index = (idx + 1) % len(sl.servers)
			return s.URL
		}

		// Cooldown expired -- promote back to healthy.
		if now.After(s.unhealthyUntil) {
			s.healthy = true
			s.unhealthyUntil = time.Time{}
			s.consecutiveFailures = 0
			sl.index = (idx + 1) % len(sl.servers)
			return s.URL
		}
	}

	// All servers are unhealthy. Pick the one that recovers soonest.
	var best *Server
	for i := range sl.servers {
		s := &sl.servers[i]
		if best == nil || s.unhealthyUntil.Before(best.unhealthyUntil) {
			best = s
		}
	}
	// Advance the index anyway so the next call rotates.
	sl.index = (sl.index + 1) % len(sl.servers)
	return best.URL
}

// MarkUnhealthy marks the server identified by url as unhealthy.
// Cooldown increases with consecutive failures: 5min, 10min, 20min, capped at 30min.
func (sl *ServerList) MarkUnhealthy(url string, errMsg string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			s := &sl.servers[i]
			s.healthy = false
			s.consecutiveFailures++
			s.totalFailures++
			s.lastError = errMsg
			s.lastErrorTime = time.Now()

			// Exponential backoff: 5min * 2^(failures-1), capped at 30min
			cooldown := unhealthyCooldown
			for j := 1; j < s.consecutiveFailures && cooldown < 30*time.Minute; j++ {
				cooldown *= 2
			}
			if cooldown > 30*time.Minute {
				cooldown = 30 * time.Minute
			}
			s.unhealthyUntil = time.Now().Add(cooldown)
			return
		}
	}
}

// MarkSuccess records a successful download completion from a server.
// Bytes are already counted incrementally via AddBytes, so only increment the counter.
func (sl *ServerList) MarkSuccess(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].totalDownloads++
			return
		}
	}
}

// AddBytes incrementally updates the bytes downloaded counter for a server.
// Called during streaming to provide real-time progress in the health UI.
func (sl *ServerList) AddBytes(url string, n int64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].URL == url {
			sl.servers[i].bytesDownloaded += n
			return
		}
	}
}

// HealthStatus returns the current health of all servers for API/UI consumption.
func (sl *ServerList) HealthStatus() []ServerHealth {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	result := make([]ServerHealth, len(sl.servers))
	for i, s := range sl.servers {
		healthy := s.healthy
		if !healthy && now.After(s.unhealthyUntil) {
			healthy = true // cooldown expired
		}
		result[i] = ServerHealth{
			URL:                 s.URL,
			Healthy:             healthy,
			ConsecutiveFailures: s.consecutiveFailures,
			TotalFailures:       s.totalFailures,
			TotalDownloads:      s.totalDownloads,
			LastError:           s.lastError,
			LastErrorTime:       s.lastErrorTime,
			UnhealthyUntil:      s.unhealthyUntil,
			BytesDownloaded:     s.bytesDownloaded,
		}
	}
	return result
}

// UpdateServers replaces the entire server list with the given URLs.
// All new servers start healthy and the round-robin index is reset.
func (sl *ServerList) UpdateServers(urls []string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	servers := make([]Server, len(urls))
	for i, u := range urls {
		servers[i] = Server{URL: u, healthy: true}
	}
	sl.servers = servers
	sl.index = 0
}

// HealthyCount returns the number of currently healthy servers.
func (sl *ServerList) HealthyCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	count := 0
	for _, s := range sl.servers {
		if s.healthy || now.After(s.unhealthyUntil) {
			count++
		}
	}
	return count
}

// TotalCount returns the total number of configured servers.
func (sl *ServerList) TotalCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()
	return len(sl.servers)
}
