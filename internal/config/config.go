package config

import (
	"database/sql"
	"encoding/json"
	"os"
	"strconv"
	"sync"

	"wansaturator/internal/db"
)

type Config struct {
	mu sync.RWMutex `json:"-"`
	DB *sql.DB      `json:"-"`

	B2KeyID      string `json:"b2KeyId"`
	B2AppKey     string `json:"b2AppKey"`
	B2BucketName string `json:"b2BucketName"`
	B2Endpoint   string `json:"b2Endpoint"`

	WebPort            int `json:"webPort"`
	DefaultDownloadMbps int `json:"defaultDownloadMbps"`
	DefaultUploadMbps   int `json:"defaultUploadMbps"`

	DownloadConcurrency int `json:"downloadConcurrency"`
	UploadConcurrency   int `json:"uploadConcurrency"`
	UploadChunkSizeMB   int `json:"uploadChunkSizeMb"`

	ThrottleThresholdPct int `json:"throttleThresholdPct"`
	ThrottleWindowMin    int `json:"throttleWindowMin"`

	DownloadServers []string `json:"downloadServers"`
}

// DefaultDownloadServers matches download.DefaultServers — keep in sync.
var DefaultDownloadServers = []string{
	"http://speed.hetzner.de/10GB.bin",
	"http://fsn1-speed.hetzner.com/10GB.bin",
	"http://nbg1-speed.hetzner.com/10GB.bin",
	"http://hel1-speed.hetzner.com/10GB.bin",
	"http://ash-speed.hetzner.com/10GB.bin",
	"http://sin-speed.hetzner.com/10GB.bin",
	"http://speedtest.belwue.net/10G",
	"http://speedtest.tele2.net/10GB.zip",
	"http://proof.ovh.net/files/10Gb.dat",
	"http://ping.online.net/10000Mo.dat",
	"http://scaleway.testdebit.info/10G.iso",
	"http://speedtest.serverius.net/files/10000mb.bin",
	"http://lax-ca-us-ping.vultr.com/vultr.com.1000MB.bin",
	"http://nj-us-ping.vultr.com/vultr.com.1000MB.bin",
	"http://ams-nl-ping.vultr.com/vultr.com.1000MB.bin",
	"http://fra-de-ping.vultr.com/vultr.com.1000MB.bin",
	"http://par-fr-ping.vultr.com/vultr.com.1000MB.bin",
	"http://sgp-ping.vultr.com/vultr.com.1000MB.bin",
	"http://hnd-jp-ping.vultr.com/vultr.com.1000MB.bin",
	"http://syd-au-ping.vultr.com/vultr.com.1000MB.bin",
	"http://cachefly.cachefly.net/200mb.test",
	"http://ipv4.download.thinkbroadband.com/1GB.zip",
}

func New(database *sql.DB) *Config {
	c := &Config{
		DB:                   database,
		WebPort:              envInt("WEB_PORT", 7860),
		DefaultDownloadMbps:  envInt("DEFAULT_DOWNLOAD_SPEED", 5000),
		DefaultUploadMbps:    envInt("DEFAULT_UPLOAD_SPEED", 5000),
		DownloadConcurrency:  8,
		UploadConcurrency:    4,
		UploadChunkSizeMB:    10,
		ThrottleThresholdPct: 60,
		ThrottleWindowMin:    5,
		DownloadServers:      DefaultDownloadServers,
		B2KeyID:              os.Getenv("B2_KEY_ID"),
		B2AppKey:             os.Getenv("B2_APP_KEY"),
		B2BucketName:         os.Getenv("B2_BUCKET_NAME"),
		B2Endpoint:           os.Getenv("B2_ENDPOINT"),
	}
	if c.B2Endpoint == "" {
		c.B2Endpoint = "https://s3.us-west-002.backblazeb2.com"
	}
	c.loadFromDB()
	return c
}

func (c *Config) loadFromDB() {
	if c.DB == nil {
		return
	}
	if v, _ := db.GetSetting(c.DB, "b2_key_id"); v != "" {
		c.B2KeyID = v
	}
	if v, _ := db.GetSetting(c.DB, "b2_app_key"); v != "" {
		c.B2AppKey = v
	}
	if v, _ := db.GetSetting(c.DB, "b2_bucket_name"); v != "" {
		c.B2BucketName = v
	}
	if v, _ := db.GetSetting(c.DB, "b2_endpoint"); v != "" {
		c.B2Endpoint = v
	}
	if v, _ := db.GetSetting(c.DB, "default_download_mbps"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.DefaultDownloadMbps = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "default_upload_mbps"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.DefaultUploadMbps = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "download_concurrency"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.DownloadConcurrency = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "upload_concurrency"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.UploadConcurrency = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "upload_chunk_size_mb"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.UploadChunkSizeMB = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "throttle_threshold_pct"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.ThrottleThresholdPct = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "throttle_window_min"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.ThrottleWindowMin = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "download_servers"); v != "" {
		var servers []string
		if json.Unmarshal([]byte(v), &servers) == nil && len(servers) > 0 {
			c.DownloadServers = servers
		}
	}
}

func (c *Config) Save() error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	pairs := map[string]string{
		"b2_key_id":              c.B2KeyID,
		"b2_app_key":            c.B2AppKey,
		"b2_bucket_name":        c.B2BucketName,
		"b2_endpoint":           c.B2Endpoint,
		"default_download_mbps": strconv.Itoa(c.DefaultDownloadMbps),
		"default_upload_mbps":   strconv.Itoa(c.DefaultUploadMbps),
		"download_concurrency":  strconv.Itoa(c.DownloadConcurrency),
		"upload_concurrency":    strconv.Itoa(c.UploadConcurrency),
		"upload_chunk_size_mb":  strconv.Itoa(c.UploadChunkSizeMB),
		"throttle_threshold_pct": strconv.Itoa(c.ThrottleThresholdPct),
		"throttle_window_min":   strconv.Itoa(c.ThrottleWindowMin),
	}
	serversJSON, _ := json.Marshal(c.DownloadServers)
	pairs["download_servers"] = string(serversJSON)

	for k, v := range pairs {
		if err := db.SetSetting(c.DB, k, v); err != nil {
			return err
		}
	}
	return nil
}

func (c *Config) SetB2Credentials(keyID, appKey, bucket, endpoint string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.B2KeyID = keyID
	c.B2AppKey = appKey
	c.B2BucketName = bucket
	if endpoint != "" {
		c.B2Endpoint = endpoint
	}
}

func (c *Config) SetSpeedTargets(dlMbps, ulMbps int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.DefaultDownloadMbps = dlMbps
	c.DefaultUploadMbps = ulMbps
}

func (c *Config) Get() Config {
	c.mu.RLock()
	defer c.mu.RUnlock()
	copy := *c
	return copy
}

func (c *Config) IsSetupRequired() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.B2KeyID == "" || c.B2AppKey == "" || c.B2BucketName == ""
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
