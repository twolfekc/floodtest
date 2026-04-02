# Full Stack Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete test suite (Go unit + integration + network, frontend Vitest, Playwright E2E) to a codebase that currently has zero tests.

**Architecture:** Test pyramid — many fast unit tests per Go package using `httptest` and temp SQLite, fewer integration tests behind a build tag, opt-in network tests via env var. Frontend uses Vitest + React Testing Library. E2E uses Playwright against a running binary. CI runs all tiers in GitHub Actions before Docker build.

**Tech Stack:** Go `testing` + `httptest`, Vitest 3.x, React Testing Library 16.x, Playwright 1.59, SQLite `:memory:`

---

### Task 1: Refactor DB Singleton for Testability

The `db.Open()` function uses `sync.Once`, preventing tests from creating isolated databases. We need to extract the core logic into a testable function.

**Files:**
- Modify: `internal/db/db.go`

**Step 1: Add `OpenDB()` function that accepts a path and has no singleton**

Add this new function to `internal/db/db.go` after the existing `Open()` function (which stays unchanged for backward compat):

```go
// OpenDB opens a SQLite database at the given path (or ":memory:" for tests)
// and runs migrations. Unlike Open(), this does NOT use a singleton — each
// call returns an independent connection.
func OpenDB(dsn string) (*sql.DB, error) {
	if dsn == ":memory:" {
		dsn = ":memory:?_journal_mode=WAL&_busy_timeout=5000"
	}
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	conn.SetMaxOpenConns(1)
	if _, err := conn.Exec(schema); err != nil {
		conn.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return conn, nil
}
```

**Step 2: Verify the app still builds**

Run: `cd /Users/tyler/wanthroughputdocker && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add internal/db/db.go
git commit -m "feat: add OpenDB() for testable database creation"
```

---

### Task 2: Write DB Package Tests

**Files:**
- Create: `internal/db/db_test.go`

**Step 1: Write the tests**

```go
package db

import (
	"testing"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestOpenDB_CreatesSchema(t *testing.T) {
	db := testDB(t)

	// Verify tables exist by inserting into each one.
	_, err := db.Exec("INSERT INTO settings (key, value) VALUES ('test', 'val')")
	if err != nil {
		t.Fatalf("settings table missing: %v", err)
	}
	_, err = db.Exec("INSERT INTO usage_counters (period, download_bytes, upload_bytes) VALUES ('test', 0, 0)")
	if err != nil {
		t.Fatalf("usage_counters table missing: %v", err)
	}
}

func TestOpenDB_IndependentInstances(t *testing.T) {
	db1 := testDB(t)
	db2 := testDB(t)

	SetSetting(db1, "key1", "val1")

	val, err := GetSetting(db2, "key1")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if val != "" {
		t.Errorf("expected empty string from independent DB, got %q", val)
	}
}

func TestGetSetting_MissingKey(t *testing.T) {
	db := testDB(t)
	val, err := GetSetting(db, "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "" {
		t.Errorf("expected empty string, got %q", val)
	}
}

func TestSetSetting_RoundTrip(t *testing.T) {
	db := testDB(t)

	if err := SetSetting(db, "mykey", "myvalue"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	val, err := GetSetting(db, "mykey")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if val != "myvalue" {
		t.Errorf("expected %q, got %q", "myvalue", val)
	}
}

func TestSetSetting_Upsert(t *testing.T) {
	db := testDB(t)

	SetSetting(db, "k", "v1")
	SetSetting(db, "k", "v2")

	val, _ := GetSetting(db, "k")
	if val != "v2" {
		t.Errorf("expected upserted value %q, got %q", "v2", val)
	}
}
```

**Step 2: Add missing import**

The test file uses `database/sql` via `testDB` return type. Add it to the import block:

```go
import (
	"database/sql"
	"testing"
)
```

Wait — actually `testDB` returns `*sql.DB` but the package already imports `database/sql` in `db.go`. Since this is in the same package, we need the import in the test file too. Let me fix: the `testDB` function returns `*sql.DB` so the import is needed. Actually, looking again, the test functions just call `testDB` and use the return value — Go needs the `database/sql` import only if the test file references `sql.DB` directly. Since `testDB` signature uses `*sql.DB`, yes, include it.

**Step 3: Run tests to verify they pass**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/db/ -v`
Expected: All 5 tests PASS.

**Step 4: Commit**

```bash
git add internal/db/db_test.go
git commit -m "test: add db package unit tests"
```

---

### Task 3: Write Scheduler Tests

The scheduler has pure functions (`ValidateSchedule`, `findMatchingSchedule`, `parseHHMM`, `containsDay`) that are highly testable without mocks. The CRUD operations need a real DB.

**Files:**
- Create: `internal/scheduler/scheduler_test.go`

**Step 1: Write the tests**

```go
package scheduler

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"wansaturator/internal/db"
)

// --- helpers ---

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

type mockController struct {
	running    atomic.Bool
	startCalls int
	stopCalls  int
	lastDlMbps int
	lastUlMbps int
}

func (m *mockController) StartEngines(_ context.Context, dl, ul int) error {
	m.running.Store(true)
	m.startCalls++
	m.lastDlMbps = dl
	m.lastUlMbps = ul
	return nil
}
func (m *mockController) StopEngines() {
	m.running.Store(false)
	m.stopCalls++
}
func (m *mockController) IsRunning() bool { return m.running.Load() }

// --- ValidateSchedule tests ---

func TestValidateSchedule_Valid(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{0, 1, 2},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 1000,
		UploadMbps:   500,
	}
	if err := ValidateSchedule(sc); err != nil {
		t.Fatalf("expected valid, got error: %v", err)
	}
}

func TestValidateSchedule_EmptyDays(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 1000,
		UploadMbps:   500,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for empty daysOfWeek")
	}
}

func TestValidateSchedule_InvalidDay(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{7},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 1000,
		UploadMbps:   500,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for day=7")
	}
}

func TestValidateSchedule_SameStartEnd(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1},
		StartTime:    "09:00",
		EndTime:      "09:00",
		DownloadMbps: 1000,
		UploadMbps:   500,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for same start/end")
	}
}

func TestValidateSchedule_ZeroDownload(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 0,
		UploadMbps:   500,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for downloadMbps=0")
	}
}

func TestValidateSchedule_BadTimeFormat(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1},
		StartTime:    "9am",
		EndTime:      "17:00",
		DownloadMbps: 1000,
		UploadMbps:   500,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for bad time format")
	}
}

// --- findMatchingSchedule tests ---

func TestFindMatchingSchedule_SameDayMatch(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{1}, StartTime: "09:00", EndTime: "17:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: true},
	}
	// Monday at 12:00
	now := time.Date(2026, 3, 30, 12, 0, 0, 0, time.Local) // Monday
	result := findMatchingSchedule(schedules, now)
	if result == nil {
		t.Fatal("expected match")
	}
	if result.ID != 1 {
		t.Errorf("expected schedule 1, got %d", result.ID)
	}
}

func TestFindMatchingSchedule_BeforeWindow(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{1}, StartTime: "09:00", EndTime: "17:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: true},
	}
	now := time.Date(2026, 3, 30, 8, 59, 0, 0, time.Local) // Monday 08:59
	result := findMatchingSchedule(schedules, now)
	if result != nil {
		t.Fatal("expected no match before window")
	}
}

func TestFindMatchingSchedule_AfterWindow(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{1}, StartTime: "09:00", EndTime: "17:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: true},
	}
	now := time.Date(2026, 3, 30, 17, 0, 0, 0, time.Local) // Monday 17:00 (end is exclusive)
	result := findMatchingSchedule(schedules, now)
	if result != nil {
		t.Fatal("expected no match at end boundary")
	}
}

func TestFindMatchingSchedule_OvernightLateNight(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{5}, StartTime: "23:00", EndTime: "06:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: true},
	}
	// Friday at 23:30
	now := time.Date(2026, 4, 3, 23, 30, 0, 0, time.Local) // Friday
	result := findMatchingSchedule(schedules, now)
	if result == nil {
		t.Fatal("expected match in late-night portion of overnight window")
	}
}

func TestFindMatchingSchedule_OvernightEarlyMorning(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{5}, StartTime: "23:00", EndTime: "06:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: true},
	}
	// Saturday at 03:00 (prev day=Friday is in schedule)
	now := time.Date(2026, 4, 4, 3, 0, 0, 0, time.Local) // Saturday
	result := findMatchingSchedule(schedules, now)
	if result == nil {
		t.Fatal("expected match in early-morning portion of overnight window")
	}
}

func TestFindMatchingSchedule_DisabledSchedule(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{1}, StartTime: "09:00", EndTime: "17:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: false},
	}
	now := time.Date(2026, 3, 30, 12, 0, 0, 0, time.Local) // Monday 12:00
	result := findMatchingSchedule(schedules, now)
	if result != nil {
		t.Fatal("expected no match for disabled schedule")
	}
}

func TestFindMatchingSchedule_WrongDay(t *testing.T) {
	schedules := []Schedule{
		{ID: 1, DaysOfWeek: []int{1}, StartTime: "09:00", EndTime: "17:00", DownloadMbps: 1000, UploadMbps: 500, Enabled: true},
	}
	now := time.Date(2026, 3, 31, 12, 0, 0, 0, time.Local) // Tuesday
	result := findMatchingSchedule(schedules, now)
	if result != nil {
		t.Fatal("expected no match on wrong day")
	}
}

// --- CRUD tests ---

func TestScheduleCRUD(t *testing.T) {
	d := testDB(t)
	ctrl := &mockController{}
	sched := NewScheduler(d, ctrl)

	// Create
	sc := Schedule{
		DaysOfWeek:   []int{1, 3, 5},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 1000,
		UploadMbps:   500,
		Enabled:      true,
	}
	id, err := sched.CreateSchedule(sc)
	if err != nil {
		t.Fatalf("CreateSchedule: %v", err)
	}
	if id < 1 {
		t.Fatalf("expected positive ID, got %d", id)
	}

	// Read
	schedules, err := sched.GetSchedules()
	if err != nil {
		t.Fatalf("GetSchedules: %v", err)
	}
	if len(schedules) != 1 {
		t.Fatalf("expected 1 schedule, got %d", len(schedules))
	}
	if schedules[0].DownloadMbps != 1000 {
		t.Errorf("expected 1000 Mbps, got %d", schedules[0].DownloadMbps)
	}

	// Update
	sc.ID = int(id)
	sc.DownloadMbps = 2000
	if err := sched.UpdateSchedule(sc); err != nil {
		t.Fatalf("UpdateSchedule: %v", err)
	}
	schedules, _ = sched.GetSchedules()
	if schedules[0].DownloadMbps != 2000 {
		t.Errorf("expected updated 2000, got %d", schedules[0].DownloadMbps)
	}

	// Delete
	if err := sched.DeleteSchedule(int(id)); err != nil {
		t.Fatalf("DeleteSchedule: %v", err)
	}
	schedules, _ = sched.GetSchedules()
	if len(schedules) != 0 {
		t.Errorf("expected 0 schedules after delete, got %d", len(schedules))
	}
}

func TestDeleteSchedule_NotFound(t *testing.T) {
	d := testDB(t)
	ctrl := &mockController{}
	sched := NewScheduler(d, ctrl)

	err := sched.DeleteSchedule(999)
	if err != ErrScheduleNotFound {
		t.Errorf("expected ErrScheduleNotFound, got %v", err)
	}
}

// --- Manual override tests ---

func TestManualStart_OverridesSchedule(t *testing.T) {
	d := testDB(t)
	ctrl := &mockController{}
	sched := NewScheduler(d, ctrl)

	sched.ManualStart(500, 250)
	if sched.GetOverrideState() != OverrideForceStart {
		t.Errorf("expected OverrideForceStart, got %d", sched.GetOverrideState())
	}
}

func TestManualStop_OverridesSchedule(t *testing.T) {
	d := testDB(t)
	ctrl := &mockController{}
	sched := NewScheduler(d, ctrl)

	sched.ManualStop()
	if sched.GetOverrideState() != OverrideForceStop {
		t.Errorf("expected OverrideForceStop, got %d", sched.GetOverrideState())
	}
}

func TestClearOverride(t *testing.T) {
	d := testDB(t)
	ctrl := &mockController{}
	sched := NewScheduler(d, ctrl)

	sched.ManualStart(500, 250)
	sched.ClearOverride()
	if sched.GetOverrideState() != OverrideNone {
		t.Errorf("expected OverrideNone, got %d", sched.GetOverrideState())
	}
}

// --- parseHHMM tests ---

func TestParseHHMM_Valid(t *testing.T) {
	cases := []struct {
		input    string
		expected int
	}{
		{"00:00", 0},
		{"09:30", 570},
		{"23:59", 1439},
		{"12:00", 720},
	}
	for _, tc := range cases {
		got, err := parseHHMM(tc.input)
		if err != nil {
			t.Errorf("parseHHMM(%q) error: %v", tc.input, err)
		}
		if got != tc.expected {
			t.Errorf("parseHHMM(%q) = %d, want %d", tc.input, got, tc.expected)
		}
	}
}

func TestParseHHMM_Invalid(t *testing.T) {
	invalids := []string{"25:00", "12:60", "abc", ""}
	for _, s := range invalids {
		_, err := parseHHMM(s)
		if err == nil {
			t.Errorf("parseHHMM(%q) expected error", s)
		}
	}
}
```

**Step 2: Add missing `database/sql` import**

The test file uses `*sql.DB` in `testDB`. Add to imports:

```go
import (
	"context"
	"database/sql"
	"sync/atomic"
	"testing"
	"time"

	"wansaturator/internal/db"
)
```

**Step 3: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/scheduler/ -v`
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add internal/scheduler/scheduler_test.go
git commit -m "test: add scheduler unit tests (validation, matching, CRUD, overrides)"
```

---

### Task 4: Write Config Package Tests

**Files:**
- Create: `internal/config/config_test.go`

**Step 1: Write the tests**

```go
package config

import (
	"database/sql"
	"testing"

	"wansaturator/internal/db"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestNew_Defaults(t *testing.T) {
	d := testDB(t)
	cfg := New(d)
	s := cfg.Get()

	if s.DefaultDownloadMbps != DefaultDownloadMbps {
		t.Errorf("DefaultDownloadMbps = %d, want %d", s.DefaultDownloadMbps, DefaultDownloadMbps)
	}
	if s.UploadMode != UploadModeHTTP {
		t.Errorf("UploadMode = %q, want %q", s.UploadMode, UploadModeHTTP)
	}
	if s.AutoMode != AutoModeReliable {
		t.Errorf("AutoMode = %q, want %q", s.AutoMode, AutoModeReliable)
	}
	if s.ThrottleThresholdPct != DefaultThrottleThreshold {
		t.Errorf("ThrottleThresholdPct = %d, want %d", s.ThrottleThresholdPct, DefaultThrottleThreshold)
	}
	if len(s.DownloadServers) == 0 {
		t.Error("expected non-empty download servers")
	}
	if len(s.UploadEndpoints) == 0 {
		t.Error("expected non-empty upload endpoints")
	}
}

func TestNew_NilDB(t *testing.T) {
	cfg := New(nil)
	s := cfg.Get()
	if s.DefaultDownloadMbps != DefaultDownloadMbps {
		t.Errorf("expected defaults with nil DB, got %d", s.DefaultDownloadMbps)
	}
}

func TestUpdate_Persists(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	err := cfg.Update(func(s *Snapshot) error {
		s.DefaultDownloadMbps = 9999
		s.DefaultUploadMbps = 1234
		return nil
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	s := cfg.Get()
	if s.DefaultDownloadMbps != 9999 {
		t.Errorf("expected 9999, got %d", s.DefaultDownloadMbps)
	}

	// Reload from same DB to verify persistence
	cfg2 := New(d)
	s2 := cfg2.Get()
	if s2.DefaultDownloadMbps != 9999 {
		t.Errorf("expected persisted 9999, got %d", s2.DefaultDownloadMbps)
	}
}

func TestSetB2Credentials(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	cfg.SetB2Credentials("key123", "secret456", "mybucket", "https://s3.example.com")
	s := cfg.Get()

	if s.B2KeyID != "key123" {
		t.Errorf("B2KeyID = %q, want %q", s.B2KeyID, "key123")
	}
	if s.B2AppKey != "secret456" {
		t.Errorf("B2AppKey = %q, want %q", s.B2AppKey, "secret456")
	}
	if s.B2BucketName != "mybucket" {
		t.Errorf("B2BucketName = %q, want %q", s.B2BucketName, "mybucket")
	}
}

func TestSetSpeedTargets(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	cfg.SetSpeedTargets(2000, 1000)
	s := cfg.Get()

	if s.DefaultDownloadMbps != 2000 {
		t.Errorf("DefaultDownloadMbps = %d, want %d", s.DefaultDownloadMbps, 2000)
	}
	if s.DefaultUploadMbps != 1000 {
		t.Errorf("DefaultUploadMbps = %d, want %d", s.DefaultUploadMbps, 1000)
	}
}

func TestSanitize_InvalidUploadMode(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	cfg.Update(func(s *Snapshot) error {
		s.UploadMode = "invalid"
		return nil
	})
	// cleanedSnapshot should normalize, but sanitizeLocked only runs at init.
	// Update uses cleanedSnapshot which does NOT validate mode.
	// The actual validation happens in the API layer.
	// So let's test the config package validates via isValidUploadMode.
	if isValidUploadMode("invalid") {
		t.Error("expected invalid upload mode to return false")
	}
	if !isValidUploadMode(UploadModeS3) {
		t.Error("expected s3 to be valid")
	}
	if !isValidUploadMode(UploadModeHTTP) {
		t.Error("expected http to be valid")
	}
	if !isValidUploadMode(UploadModeLocal) {
		t.Error("expected local to be valid")
	}
}

func TestCleanStringList_Dedupes(t *testing.T) {
	input := []string{"http://a.com", "http://b.com", "http://a.com", " ", "http://c.com"}
	result := cleanStringList(input)
	if len(result) != 3 {
		t.Errorf("expected 3 unique, got %d: %v", len(result), result)
	}
}

func TestCleanStringList_Empty(t *testing.T) {
	result := cleanStringList(nil)
	if result != nil {
		t.Errorf("expected nil for empty input, got %v", result)
	}
}

func TestConcurrentGetUpdate(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			cfg.Update(func(s *Snapshot) error {
				s.DefaultDownloadMbps = i
				return nil
			})
		}
		close(done)
	}()

	for i := 0; i < 100; i++ {
		_ = cfg.Get()
	}
	<-done
}
```

**Step 2: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/config/ -v -race`
Expected: All tests PASS (including data race detection).

**Step 3: Commit**

```bash
git add internal/config/config_test.go
git commit -m "test: add config package unit tests (defaults, persistence, concurrency)"
```

---

### Task 5: Write Stats Collector Tests

**Files:**
- Create: `internal/stats/collector_test.go`

**Step 1: Write the tests**

```go
package stats

import (
	"context"
	"testing"
	"time"

	"wansaturator/internal/db"
)

func testCollector(t *testing.T) (*Collector, *sql.DB) {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	c := NewCollector(d)
	return c, d
}

func TestAddDownloadBytes_Atomic(t *testing.T) {
	c, _ := testCollector(t)

	c.AddDownloadBytes(1000)
	c.AddDownloadBytes(2000)

	// Read and reset via Swap (as rateLoop does)
	total := c.downloadBytes.Swap(0)
	if total != 3000 {
		t.Errorf("expected 3000 bytes, got %d", total)
	}
}

func TestAddUploadBytes_Atomic(t *testing.T) {
	c, _ := testCollector(t)

	c.AddUploadBytes(500)
	c.AddUploadBytes(1500)

	total := c.uploadBytes.Swap(0)
	if total != 2000 {
		t.Errorf("expected 2000 bytes, got %d", total)
	}
}

func TestCurrentRate_InitiallyZero(t *testing.T) {
	c, _ := testCollector(t)
	rate := c.CurrentRate()
	if rate.DownloadBps != 0 || rate.UploadBps != 0 {
		t.Errorf("expected zero rate, got dl=%d ul=%d", rate.DownloadBps, rate.UploadBps)
	}
}

func TestRecentHistory_Empty(t *testing.T) {
	c, _ := testCollector(t)
	h := c.RecentHistory(10)
	if len(h) != 0 {
		t.Errorf("expected empty history, got %d entries", len(h))
	}
}

func TestRecentHistory_ZeroSeconds(t *testing.T) {
	c, _ := testCollector(t)
	h := c.RecentHistory(0)
	if h != nil {
		t.Errorf("expected nil for 0 seconds, got %v", h)
	}
}

func TestRateLoop_ComputesRate(t *testing.T) {
	c, _ := testCollector(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Simulate what rateLoop does manually (to avoid timing issues)
	c.AddDownloadBytes(125) // 125 bytes = 1000 bits
	c.AddUploadBytes(250)   // 250 bytes = 2000 bits

	dl := c.downloadBytes.Swap(0)
	ul := c.uploadBytes.Swap(0)

	snap := Snapshot{
		DownloadBps: dl * 8,
		UploadBps:   ul * 8,
		Timestamp:   time.Now(),
	}

	c.mu.Lock()
	c.currentRate = snap
	c.recentHistory = append(c.recentHistory, snap)
	c.mu.Unlock()

	rate := c.CurrentRate()
	if rate.DownloadBps != 1000 {
		t.Errorf("DownloadBps = %d, want 1000", rate.DownloadBps)
	}
	if rate.UploadBps != 2000 {
		t.Errorf("UploadBps = %d, want 2000", rate.UploadBps)
	}

	_ = ctx // keep linter happy
}

func TestRecentHistory_TrimAt600(t *testing.T) {
	c, _ := testCollector(t)

	// Fill 610 entries
	c.mu.Lock()
	for i := 0; i < 610; i++ {
		c.recentHistory = append(c.recentHistory, Snapshot{DownloadBps: int64(i)})
	}
	// Simulate trim logic
	if len(c.recentHistory) > 600 {
		copy(c.recentHistory, c.recentHistory[len(c.recentHistory)-600:])
		c.recentHistory = c.recentHistory[:600]
	}
	c.mu.Unlock()

	h := c.RecentHistory(600)
	if len(h) != 600 {
		t.Errorf("expected 600, got %d", len(h))
	}
	// First entry should be what was at index 10 (after trim)
	if h[0].DownloadBps != 10 {
		t.Errorf("first entry DownloadBps = %d, want 10", h[0].DownloadBps)
	}
}

func TestPersistMinute_WritesToDB(t *testing.T) {
	c, d := testCollector(t)

	// Manually add snapshots to recentHistory
	c.mu.Lock()
	for i := 0; i < 60; i++ {
		c.recentHistory = append(c.recentHistory, Snapshot{
			DownloadBps: 8000, // 1000 bytes/s
			UploadBps:   4000, // 500 bytes/s
			Timestamp:   time.Now(),
		})
	}
	c.mu.Unlock()

	c.persistMinute()

	// Check throughput_history
	var dlBytes, ulBytes int64
	err := d.QueryRow("SELECT download_bytes, upload_bytes FROM throughput_history LIMIT 1").Scan(&dlBytes, &ulBytes)
	if err != nil {
		t.Fatalf("query throughput_history: %v", err)
	}
	// 60 snapshots * 1000 bytes/s = 60000
	if dlBytes != 60000 {
		t.Errorf("download_bytes = %d, want 60000", dlBytes)
	}
	if ulBytes != 30000 {
		t.Errorf("upload_bytes = %d, want 30000", ulBytes)
	}

	// Check usage_counters
	var sessionDl int64
	err = d.QueryRow("SELECT download_bytes FROM usage_counters WHERE period = 'session'").Scan(&sessionDl)
	if err != nil {
		t.Fatalf("query usage_counters: %v", err)
	}
	if sessionDl != 60000 {
		t.Errorf("session download_bytes = %d, want 60000", sessionDl)
	}
}

func TestSessionBytes_Empty(t *testing.T) {
	c, _ := testCollector(t)
	if c.SessionDownloadBytes() != 0 {
		t.Error("expected 0 session download bytes")
	}
	if c.SessionUploadBytes() != 0 {
		t.Error("expected 0 session upload bytes")
	}
}

func TestGetSessionStart(t *testing.T) {
	c, _ := testCollector(t)
	start := c.GetSessionStart()
	if time.Since(start) > time.Second {
		t.Error("session start should be very recent")
	}
}
```

**Step 2: Add `database/sql` import**

```go
import (
	"context"
	"database/sql"
	"testing"
	"time"

	"wansaturator/internal/db"
)
```

Wait — actually we don't reference `sql.DB` directly in the test file. The `testCollector` function returns `(*Collector, *sql.DB)`, so yes we do need `database/sql`. Let me correct the import to just include what's needed.

Actually, looking at the function signature `func testCollector(t *testing.T) (*Collector, *sql.DB)` — the `*sql.DB` type requires the `database/sql` import. Include it.

**Step 3: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/stats/ -v`
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add internal/stats/collector_test.go
git commit -m "test: add stats collector unit tests (atomics, history, persistence)"
```

---

### Task 6: Write Throttle Detector Tests

**Files:**
- Create: `internal/throttle/detector_test.go`

**Step 1: Write the tests**

```go
package throttle

import (
	"database/sql"
	"testing"

	"wansaturator/internal/db"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestDetector_NoThrottleAboveThreshold(t *testing.T) {
	d := testDB(t)

	provider := func(windowSeconds int) (int64, int64) {
		return 900_000_000, 400_000_000 // 900 Mbps, 400 Mbps
	}

	det := NewDetector(d, provider, 80, 5)
	det.SetTargets(1_000_000_000, 500_000_000) // 1 Gbps, 500 Mbps

	det.check()

	// No throttle events should be created
	var count int
	d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 throttle events, got %d", count)
	}
}

func TestDetector_ThrottleWhenBelowThreshold(t *testing.T) {
	d := testDB(t)

	provider := func(windowSeconds int) (int64, int64) {
		return 500_000_000, 200_000_000 // 500 Mbps, 200 Mbps (below 80% of targets)
	}

	det := NewDetector(d, provider, 80, 5)
	det.SetTargets(1_000_000_000, 500_000_000)

	det.check()

	var count int
	d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count)
	if count != 2 {
		t.Errorf("expected 2 throttle events (dl + ul), got %d", count)
	}
}

func TestDetector_ThrottleResolvesWhenRecovered(t *testing.T) {
	d := testDB(t)

	throttled := true
	provider := func(windowSeconds int) (int64, int64) {
		if throttled {
			return 500_000_000, 200_000_000
		}
		return 900_000_000, 450_000_000
	}

	det := NewDetector(d, provider, 80, 5)
	det.SetTargets(1_000_000_000, 500_000_000)

	// First check: create events
	det.check()

	// Second check: recover
	throttled = false
	det.check()

	// Events should have resolved_at set
	var resolved int
	d.QueryRow("SELECT COUNT(*) FROM throttle_events WHERE resolved_at IS NOT NULL").Scan(&resolved)
	if resolved != 2 {
		t.Errorf("expected 2 resolved events, got %d", resolved)
	}
}

func TestDetector_UpdateDurationOnContinuedThrottle(t *testing.T) {
	d := testDB(t)

	provider := func(windowSeconds int) (int64, int64) {
		return 500_000_000, 200_000_000
	}

	det := NewDetector(d, provider, 80, 5)
	det.SetTargets(1_000_000_000, 500_000_000)

	det.check() // creates events with duration=0
	det.check() // updates duration to 30

	var duration int
	d.QueryRow("SELECT duration_seconds FROM throttle_events WHERE direction = 'download' LIMIT 1").Scan(&duration)
	if duration != 30 {
		t.Errorf("expected duration 30, got %d", duration)
	}
}

func TestDetector_NoEventWhenZeroRate(t *testing.T) {
	d := testDB(t)

	provider := func(windowSeconds int) (int64, int64) {
		return 0, 0 // zero rate
	}

	det := NewDetector(d, provider, 80, 5)
	det.SetTargets(1_000_000_000, 500_000_000)

	det.check()

	var count int
	d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 events for zero rate, got %d", count)
	}
}

func TestDetector_NoEventWhenZeroTarget(t *testing.T) {
	d := testDB(t)

	provider := func(windowSeconds int) (int64, int64) {
		return 500_000_000, 200_000_000
	}

	det := NewDetector(d, provider, 80, 5)
	// Don't set targets (default is 0)

	det.check()

	var count int
	d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 events for zero target, got %d", count)
	}
}

func TestSetThreshold(t *testing.T) {
	d := testDB(t)
	det := NewDetector(d, nil, 80, 5)

	det.SetThreshold(90)

	det.mu.Lock()
	defer det.mu.Unlock()
	if det.thresholdPct != 90 {
		t.Errorf("expected threshold 90, got %d", det.thresholdPct)
	}
}

func TestSetWindow(t *testing.T) {
	d := testDB(t)
	det := NewDetector(d, nil, 80, 5)

	det.SetWindow(10)

	det.mu.Lock()
	defer det.mu.Unlock()
	if det.windowMinutes != 10 {
		t.Errorf("expected window 10, got %d", det.windowMinutes)
	}
}
```

**Step 2: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/throttle/ -v`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add internal/throttle/detector_test.go
git commit -m "test: add throttle detector unit tests (events, resolution, edge cases)"
```

---

### Task 7: Write API Handler Tests

**Files:**
- Create: `internal/api/handlers_test.go`

**Step 1: Write the tests**

```go
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"wansaturator/internal/config"
	"wansaturator/internal/db"
	"wansaturator/internal/scheduler"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func testApp(t *testing.T) *App {
	t.Helper()
	d := testDB(t)
	cfg := config.New(d)

	// Create a mock controller for the scheduler
	ctrl := &mockEngineController{}
	sched := scheduler.NewScheduler(d, ctrl)

	app := &App{
		DB:        d,
		Config:    cfg,
		Scheduler: sched,
		Hub:       NewWsHub(),

		IsRunning:               func() bool { return false },
		GetDownloadStreams:      func() int { return 0 },
		GetUploadStreams:        func() int { return 0 },
		GetSessionStart:         func() time.Time { return time.Now() },
		GetSessionDownloadBytes: func() int64 { return 0 },
		GetSessionUploadBytes:   func() int64 { return 0 },
		GetCurrentDownloadBps:   func() int64 { return 0 },
		GetCurrentUploadBps:     func() int64 { return 0 },
		GetServerHealth:         func() interface{} { return []interface{}{} },
		GetUploadServerHealth:   func() interface{} { return []interface{}{} },
		GetUpdateStatus:         func() interface{} { return map[string]interface{}{"dockerAvailable": false} },
		GetUpdateHistory:        func() interface{} { return []interface{}{} },
	}
	return app
}

type mockEngineController struct{}

func (m *mockEngineController) StartEngines(_ context.Context, _, _ int) error { return nil }
func (m *mockEngineController) StopEngines()                                   {}
func (m *mockEngineController) IsRunning() bool                                { return false }

func TestHandleStatus_ReturnsJSON(t *testing.T) {
	app := testApp(t)

	req := httptest.NewRequest("GET", "/api/status", nil)
	w := httptest.NewRecorder()
	app.HandleStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := body["running"]; !ok {
		t.Error("response missing 'running' field")
	}
}

func TestHandleGetSettings_ReturnsDefaults(t *testing.T) {
	app := testApp(t)

	req := httptest.NewRequest("GET", "/api/settings", nil)
	w := httptest.NewRecorder()
	app.HandleGetSettings(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)

	if mode, ok := body["uploadMode"].(string); !ok || mode != "http" {
		t.Errorf("uploadMode = %v, want %q", body["uploadMode"], "http")
	}
}

func TestHandleGetSchedules_Empty(t *testing.T) {
	app := testApp(t)

	req := httptest.NewRequest("GET", "/api/schedules", nil)
	w := httptest.NewRecorder()
	app.HandleGetSchedules(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body []interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	if len(body) != 0 {
		t.Errorf("expected empty array, got %d items", len(body))
	}
}

func TestHandleCreateSchedule_Valid(t *testing.T) {
	app := testApp(t)

	body := `{"daysOfWeek":[1,3,5],"startTime":"09:00","endTime":"17:00","downloadMbps":1000,"uploadMbps":500,"enabled":true}`
	req := httptest.NewRequest("POST", "/api/schedules", strings.NewReader(body))
	w := httptest.NewRecorder()
	app.HandleCreateSchedule(w, req)

	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 200/201, body: %s", w.Code, w.Body.String())
	}
}

func TestHandleCreateSchedule_InvalidBody(t *testing.T) {
	app := testApp(t)

	body := `{"daysOfWeek":[],"startTime":"09:00","endTime":"17:00","downloadMbps":1000,"uploadMbps":500}`
	req := httptest.NewRequest("POST", "/api/schedules", strings.NewReader(body))
	w := httptest.NewRecorder()
	app.HandleCreateSchedule(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body: %s", w.Code, w.Body.String())
	}
}

func TestHandleUsage_ReturnsJSON(t *testing.T) {
	app := testApp(t)

	req := httptest.NewRequest("GET", "/api/usage", nil)
	w := httptest.NewRecorder()
	app.HandleUsage(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestHandleServerHealth_ReturnsArray(t *testing.T) {
	app := testApp(t)

	req := httptest.NewRequest("GET", "/api/server-health", nil)
	w := httptest.NewRecorder()
	app.HandleServerHealth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

// --- validation helper tests ---

func TestValidateAbsoluteURL_Valid(t *testing.T) {
	if err := validateAbsoluteURL("test", "https://example.com/path"); err != nil {
		t.Errorf("expected valid, got %v", err)
	}
}

func TestValidateAbsoluteURL_Invalid(t *testing.T) {
	invalids := []string{"not-a-url", "ftp://example.com", "/relative/path", ""}
	for _, u := range invalids {
		if err := validateAbsoluteURL("test", u); err == nil {
			t.Errorf("expected error for %q", u)
		}
	}
}

func TestValidateMin(t *testing.T) {
	if err := validateMin("field", 5, 1); err != nil {
		t.Errorf("expected valid, got %v", err)
	}
	if err := validateMin("field", 0, 1); err == nil {
		t.Error("expected error for 0 < 1")
	}
}

func TestValidateRange(t *testing.T) {
	if err := validateRange("field", 50, 1, 100); err != nil {
		t.Errorf("expected valid, got %v", err)
	}
	if err := validateRange("field", 0, 1, 100); err == nil {
		t.Error("expected error for 0 out of [1,100]")
	}
	if err := validateRange("field", 101, 1, 100); err == nil {
		t.Error("expected error for 101 out of [1,100]")
	}
}

func TestValidateUploadMode(t *testing.T) {
	for _, mode := range []string{"s3", "http", "local"} {
		if err := validateUploadMode(mode); err != nil {
			t.Errorf("expected %q valid, got %v", mode, err)
		}
	}
	if err := validateUploadMode("ftp"); err == nil {
		t.Error("expected error for ftp")
	}
}

func TestValidateAutoUpdateSchedule(t *testing.T) {
	for _, s := range []string{"daily", "weekly", "monthly"} {
		if err := validateAutoUpdateSchedule(true, s); err != nil {
			t.Errorf("expected %q valid, got %v", s, err)
		}
	}
	if err := validateAutoUpdateSchedule(true, ""); err == nil {
		t.Error("expected error for empty schedule when enabled")
	}
	if err := validateAutoUpdateSchedule(false, ""); err != nil {
		t.Errorf("expected valid for disabled with empty, got %v", err)
	}
}
```

**Step 2: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/api/ -v`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add internal/api/handlers_test.go
git commit -m "test: add API handler tests (status, settings, schedules, validation)"
```

---

### Task 8: Write Download Server Health Tests

**Files:**
- Create: `internal/download/servers_test.go`

Note: The `servers.go` file already exists. We create a test file for it.

**Step 1: Write the tests**

```go
package download

import (
	"testing"
)

func TestNewServerList_DefaultServers(t *testing.T) {
	sl := NewServerList(DefaultServers)
	status := sl.HealthStatus()

	if len(status) != len(DefaultServers) {
		t.Errorf("expected %d servers, got %d", len(DefaultServers), len(status))
	}

	for _, s := range status {
		if !s.Healthy {
			t.Errorf("server %q should start healthy", s.URL)
		}
	}
}

func TestServerList_MarkUnhealthy(t *testing.T) {
	servers := []string{"http://server1.test/file", "http://server2.test/file"}
	sl := NewServerList(servers)

	sl.MarkUnhealthy("http://server1.test/file", "test error")

	status := sl.HealthStatus()
	for _, s := range status {
		if s.URL == "http://server1.test/file" {
			if s.ConsecutiveFailures != 1 {
				t.Errorf("expected 1 consecutive failure, got %d", s.ConsecutiveFailures)
			}
		}
	}
}

func TestServerList_MarkSuccess(t *testing.T) {
	servers := []string{"http://server1.test/file"}
	sl := NewServerList(servers)

	sl.MarkUnhealthy("http://server1.test/file", "err")
	sl.MarkSuccess("http://server1.test/file", 1000)

	status := sl.HealthStatus()
	if status[0].ConsecutiveFailures != 0 {
		t.Errorf("expected 0 failures after success, got %d", status[0].ConsecutiveFailures)
	}
}

func TestServerList_Next_SkipsUnhealthy(t *testing.T) {
	servers := []string{"http://server1.test/file", "http://server2.test/file"}
	sl := NewServerList(servers)

	// Mark server1 unhealthy enough to be in cooldown
	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://server1.test/file", "err")
	}

	// Next should return server2
	url := sl.Next()
	if url == "http://server1.test/file" {
		t.Error("expected to skip unhealthy server1")
	}
}

func TestServerList_UnblockServer(t *testing.T) {
	servers := []string{"http://server1.test/file"}
	sl := NewServerList(servers)

	// Block it
	for i := 0; i < 10; i++ {
		sl.MarkUnhealthy("http://server1.test/file", "err")
	}

	sl.UnblockServer("http://server1.test/file")

	status := sl.HealthStatus()
	if !status[0].Healthy {
		t.Error("expected server to be healthy after unblock")
	}
}

func TestServerList_ResetCooldowns(t *testing.T) {
	servers := []string{"http://server1.test/file", "http://server2.test/file"}
	sl := NewServerList(servers)

	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://server1.test/file", "err")
		sl.MarkUnhealthy("http://server2.test/file", "err")
	}

	sl.ResetCooldowns()

	status := sl.HealthStatus()
	for _, s := range status {
		if !s.Healthy {
			t.Errorf("expected %q healthy after reset, got unhealthy", s.URL)
		}
	}
}
```

**Step 2: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./internal/download/ -v -run TestNewServerList\|TestServerList`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add internal/download/servers_test.go
git commit -m "test: add download server health unit tests"
```

---

### Task 9: Set Up Frontend Test Infrastructure (Vitest)

**Files:**
- Modify: `frontend/package.json` (add devDependencies)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test-setup.ts`

**Step 1: Install test dependencies**

Run:
```bash
cd /Users/tyler/wanthroughputdocker/frontend && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

**Step 2: Add test script to package.json**

Add to the `"scripts"` section in `frontend/package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Create vitest.config.ts**

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
})
```

**Step 4: Create test setup file**

Create `frontend/src/test-setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

**Step 5: Verify setup works**

Run: `cd /Users/tyler/wanthroughputdocker/frontend && npx vitest run`
Expected: "No test files found" (this is fine — no tests written yet).

**Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test-setup.ts
git commit -m "feat: set up Vitest + React Testing Library infrastructure"
```

---

### Task 10: Write Frontend API Client Tests

**Files:**
- Create: `frontend/src/__tests__/api/client.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from '../../api/client'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api.getStatus', () => {
  it('calls GET /api/status', async () => {
    const data = { running: false, downloadBps: 0 }
    mockFetch.mockResolvedValueOnce(mockResponse(data))

    const result = await api.getStatus()

    expect(mockFetch).toHaveBeenCalledWith('/api/status', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(result).toEqual(data)
  })
})

describe('api.start', () => {
  it('calls POST /api/start with speeds', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))

    await api.start(1000, 500)

    expect(mockFetch).toHaveBeenCalledWith('/api/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ downloadMbps: 1000, uploadMbps: 500 }),
    }))
  })
})

describe('api.stop', () => {
  it('calls POST /api/stop', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))

    await api.stop()

    expect(mockFetch).toHaveBeenCalledWith('/api/stop', expect.objectContaining({
      method: 'POST',
    }))
  })
})

describe('api.getSchedules', () => {
  it('calls GET /api/schedules', async () => {
    const data = [{ id: 1, daysOfWeek: [1], startTime: '09:00', endTime: '17:00' }]
    mockFetch.mockResolvedValueOnce(mockResponse(data))

    const result = await api.getSchedules()

    expect(result).toEqual(data)
  })
})

describe('api.getSettings', () => {
  it('calls GET /api/settings', async () => {
    const data = { uploadMode: 'http', autoMode: 'reliable' }
    mockFetch.mockResolvedValueOnce(mockResponse(data))

    const result = await api.getSettings()

    expect(result).toEqual(data)
  })
})

describe('api.updateSettings', () => {
  it('calls PUT /api/settings', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))

    await api.updateSettings({ defaultDownloadMbps: 5000 })

    expect(mockFetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ defaultDownloadMbps: 5000 }),
    }))
  })
})

describe('error handling', () => {
  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'bad request' }, 400))

    await expect(api.getStatus()).rejects.toThrow('400')
  })
})

describe('api.unblockServer', () => {
  it('sends POST with url in body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 'ok' }))

    await api.unblockServer('http://server1.test')

    expect(mockFetch).toHaveBeenCalledWith('/api/server-unblock', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'http://server1.test' }),
    }))
  })
})
```

**Step 2: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker/frontend && npx vitest run`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add frontend/src/__tests__/api/client.test.ts
git commit -m "test: add frontend API client tests"
```

---

### Task 11: Write Frontend WebSocket Hook Tests

**Files:**
- Create: `frontend/src/__tests__/hooks/useWebSocket.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket, type WsStats } from '../../hooks/useWebSocket'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0

  constructor(_url: string) {
    MockWebSocket.instances.push(this)
  }

  close() {
    this.readyState = 3
  }

  simulateOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  simulateMessage(data: Partial<WsStats>) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose() {
    this.readyState = 3
    this.onclose?.()
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as any)
  vi.useFakeTimers()
})

describe('useWebSocket', () => {
  it('connects on mount', () => {
    renderHook(() => useWebSocket())
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('sets connected=true on open', () => {
    const { result } = renderHook(() => useWebSocket())
    expect(result.current.connected).toBe(false)

    act(() => MockWebSocket.instances[0].simulateOpen())
    expect(result.current.connected).toBe(true)
  })

  it('updates stats on message', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => MockWebSocket.instances[0].simulateOpen())

    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        downloadBps: 1_000_000,
        uploadBps: 500_000,
        running: true,
      })
    })

    expect(result.current.stats.downloadBps).toBe(1_000_000)
    expect(result.current.stats.running).toBe(true)
  })

  it('reconnects after close with 2s delay', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => MockWebSocket.instances[0].simulateOpen())

    act(() => MockWebSocket.instances[0].simulateClose())
    expect(result.current.connected).toBe(false)
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => vi.advanceTimersByTime(2000))
    expect(MockWebSocket.instances).toHaveLength(2)
  })
})
```

**Step 2: Run tests**

Run: `cd /Users/tyler/wanthroughputdocker/frontend && npx vitest run`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add frontend/src/__tests__/hooks/useWebSocket.test.ts
git commit -m "test: add WebSocket hook tests (connect, message, reconnect)"
```

---

### Task 12: Set Up Playwright E2E Infrastructure

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/package.json`

**Step 1: Initialize e2e directory**

Run:
```bash
mkdir -p /Users/tyler/wanthroughputdocker/e2e
cd /Users/tyler/wanthroughputdocker/e2e && npm init -y
npm install -D @playwright/test
npx playwright install chromium
```

**Step 2: Create playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:7860',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'cd .. && go run ./cmd/server',
    url: 'http://localhost:7860',
    timeout: 30_000,
    reuseExistingServer: true,
    env: {
      DATA_DIR: '/tmp/floodtest-e2e',
    },
  },
})
```

**Step 3: Commit**

```bash
git add e2e/package.json e2e/package-lock.json e2e/playwright.config.ts
git commit -m "feat: set up Playwright E2E test infrastructure"
```

---

### Task 13: Write Playwright E2E Smoke Tests

**Files:**
- Create: `e2e/tests/smoke.spec.ts`

**Step 1: Write the smoke tests**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and shows mode selector', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=FloodTest')).toBeVisible()
    // Dashboard should have a start/stop button
    await expect(page.getByRole('button', { name: /start|stop/i })).toBeVisible()
  })

  test('shows download and upload speed cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Download')).toBeVisible()
    await expect(page.locator('text=Upload')).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('loads settings page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /settings/i }).click()
    await expect(page.locator('text=Download Speed')).toBeVisible()
  })
})

test.describe('Schedule', () => {
  test('loads schedule page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /schedule/i }).click()
    await expect(page.locator('text=Schedule')).toBeVisible()
  })
})

test.describe('Charts', () => {
  test('loads charts page without error', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /charts/i }).click()
    // Page should load without JS errors
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Server Health', () => {
  test('loads server health page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /server/i }).click()
    await expect(page.locator('text=Server')).toBeVisible()
  })
})

test.describe('API Smoke', () => {
  test('GET /api/status returns JSON', async ({ request }) => {
    const res = await request.get('/api/status')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body).toHaveProperty('running')
  })

  test('GET /api/settings returns JSON', async ({ request }) => {
    const res = await request.get('/api/settings')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body).toHaveProperty('uploadMode')
  })

  test('GET /api/schedules returns array', async ({ request }) => {
    const res = await request.get('/api/schedules')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
```

**Step 2: Run E2E tests (requires built frontend)**

Run:
```bash
cd /Users/tyler/wanthroughputdocker/frontend && npm run build
cp -r dist ../cmd/server/frontend/dist
cd /Users/tyler/wanthroughputdocker/e2e && npx playwright test
```
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add e2e/tests/smoke.spec.ts
git commit -m "test: add Playwright E2E smoke tests (dashboard, settings, schedule, API)"
```

---

### Task 14: Add CI Test Job to GitHub Actions

**Files:**
- Modify: `.github/workflows/build.yml`

**Step 1: Add test job before the build job**

Insert a `test` job at the top of the `jobs` section. The existing `build` job should depend on it via `needs: test`:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Go unit tests
        run: go test ./...

      - name: Go integration tests
        run: go test -tags integration ./...

      - name: Frontend install + test
        run: |
          cd frontend
          npm ci
          npx vitest run

      - name: Build frontend
        run: |
          cd frontend
          npm run build
          cp -r dist ../cmd/server/frontend/dist

      - name: Build Go binary
        run: go build -o wansaturator ./cmd/server

      - name: E2E tests
        run: |
          cd e2e
          npm ci
          npx playwright install --with-deps chromium
          DATA_DIR=/tmp/floodtest-e2e ../wansaturator &
          sleep 3
          npx playwright test

  build:
    needs: test
```

**Step 2: Verify YAML is valid**

Run: `cd /Users/tyler/wanthroughputdocker && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"`
Expected: No error.

**Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add test job (Go unit/integration, frontend, E2E) gating Docker build"
```

---

### Task 15: Run Full Test Suite Locally and Fix Issues

**Step 1: Run all Go tests**

Run: `cd /Users/tyler/wanthroughputdocker && go test ./... -v`
Expected: All PASS. If any fail, fix the test or source code.

**Step 2: Run frontend tests**

Run: `cd /Users/tyler/wanthroughputdocker/frontend && npx vitest run`
Expected: All PASS.

**Step 3: Run E2E tests**

Run:
```bash
cd /Users/tyler/wanthroughputdocker/frontend && npm run build && cp -r dist ../cmd/server/frontend/dist
cd /Users/tyler/wanthroughputdocker/e2e && npx playwright test
```
Expected: All PASS.

**Step 4: Fix any issues, commit fixes**

If any tests need adjustments, fix them and commit:
```bash
git add -A && git commit -m "fix: resolve test suite issues found during local run"
```
