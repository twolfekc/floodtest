package upload

import (
	"testing"
)

func TestUpdateSpeedScore(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	// First sample
	sl.UpdateSpeedScore("http://a.com", 1e9)
	health := sl.HealthStatus()
	if health[0].SpeedBps != 1e9 {
		t.Errorf("expected 1e9, got %f", health[0].SpeedBps)
	}

	// Rolling average of 3 samples
	sl.UpdateSpeedScore("http://a.com", 2e9)
	sl.UpdateSpeedScore("http://a.com", 3e9)
	health = sl.HealthStatus()
	expected := (1e9 + 2e9 + 3e9) / 3
	if health[0].SpeedBps != expected {
		t.Errorf("expected %f, got %f", expected, health[0].SpeedBps)
	}

	// Window caps at 5 samples
	sl.UpdateSpeedScore("http://a.com", 4e9)
	sl.UpdateSpeedScore("http://a.com", 5e9)
	sl.UpdateSpeedScore("http://a.com", 6e9) // should push out 1e9
	health = sl.HealthStatus()
	expected = (2e9 + 3e9 + 4e9 + 5e9 + 6e9) / 5
	if health[0].SpeedBps != expected {
		t.Errorf("expected %f, got %f", expected, health[0].SpeedBps)
	}

	// Unknown URL is a no-op
	sl.UpdateSpeedScore("http://unknown.com", 999)
}

func TestUploadServerAutoBlock(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	// 5 consecutive failures should auto-block
	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://a.com", "fail")
	}
	health := sl.HealthStatus()
	if health[0].Status != "blocked" {
		t.Errorf("expected blocked, got %s", health[0].Status)
	}
	if !health[0].Blocked {
		t.Error("expected Blocked=true")
	}
}

func TestUploadServerUnblock(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://a.com", "fail")
	}

	ok := sl.UnblockServer("http://a.com")
	if !ok {
		t.Error("expected UnblockServer to return true")
	}

	health := sl.HealthStatus()
	if health[0].Status != "healthy" {
		t.Errorf("expected healthy after unblock, got %s", health[0].Status)
	}
}

func TestUploadServerUnblockAll(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://a.com", "fail")
		sl.MarkUnhealthy("http://b.com", "fail")
	}

	count := sl.UnblockAll()
	if count != 2 {
		t.Errorf("expected 2 unblocked, got %d", count)
	}

	health := sl.HealthStatus()
	for _, h := range health {
		if h.Status != "healthy" {
			t.Errorf("expected healthy, got %s for %s", h.Status, h.URL)
		}
	}
}

func TestUploadServerLocation(t *testing.T) {
	sl := NewUploadServerList([]string{
		"https://s3.us-west-002.backblazeb2.com/bucket",
		"https://s3.eu-central-003.backblazeb2.com/bucket",
		"https://s3.us-east-005.backblazeb2.com/bucket",
		"https://custom-server.example.com/upload",
	})

	health := sl.HealthStatus()
	cases := []struct {
		idx      int
		expected string
	}{
		{0, "US West"},
		{1, "EU Central"},
		{2, "US East"},
		{3, ""},
	}
	for _, tc := range cases {
		if health[tc.idx].Location != tc.expected {
			t.Errorf("server %d: expected location %q, got %q", tc.idx, tc.expected, health[tc.idx].Location)
		}
	}
}
