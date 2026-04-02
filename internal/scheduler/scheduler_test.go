package scheduler

import (
	"context"
	"database/sql"
	"sync/atomic"
	"testing"
	"time"

	"wansaturator/internal/db"
)

// ---------- helpers ----------

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

func (m *mockController) IsRunning() bool {
	return m.running.Load()
}

// ---------- ValidateSchedule ----------

func TestValidateSchedule_Valid(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1, 2, 3, 4, 5},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 500,
		UploadMbps:   100,
		Enabled:      true,
	}
	if err := ValidateSchedule(sc); err != nil {
		t.Fatalf("expected valid schedule, got error: %v", err)
	}
}

func TestValidateSchedule_EmptyDays(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 500,
		UploadMbps:   100,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for empty days, got nil")
	}
}

func TestValidateSchedule_InvalidDay(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{7},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 500,
		UploadMbps:   100,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for day=7, got nil")
	}
}

func TestValidateSchedule_SameStartEnd(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1},
		StartTime:    "09:00",
		EndTime:      "09:00",
		DownloadMbps: 500,
		UploadMbps:   100,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for same start/end, got nil")
	}
}

func TestValidateSchedule_ZeroDownload(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1},
		StartTime:    "09:00",
		EndTime:      "17:00",
		DownloadMbps: 0,
		UploadMbps:   100,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for zero download, got nil")
	}
}

func TestValidateSchedule_BadTimeFormat(t *testing.T) {
	sc := Schedule{
		DaysOfWeek:   []int{1},
		StartTime:    "9am",
		EndTime:      "17:00",
		DownloadMbps: 500,
		UploadMbps:   100,
	}
	if err := ValidateSchedule(sc); err == nil {
		t.Fatal("expected error for bad time format, got nil")
	}
}

// ---------- findMatchingSchedule ----------

func TestFindMatchingSchedule_SameDayMatch(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{1, 2, 3, 4, 5}, // Mon-Fri
			StartTime:    "09:00",
			EndTime:      "17:00",
			DownloadMbps: 500,
			UploadMbps:   100,
			Enabled:      true,
		},
	}
	// Wednesday 12:00
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.Local) // 2026-04-01 is Wednesday (weekday=3)
	matched := findMatchingSchedule(schedules, now)
	if matched == nil {
		t.Fatal("expected a match, got nil")
	}
	if matched.ID != 1 {
		t.Fatalf("expected schedule ID 1, got %d", matched.ID)
	}
}

func TestFindMatchingSchedule_BeforeWindow(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{3}, // Wednesday
			StartTime:    "09:00",
			EndTime:      "17:00",
			DownloadMbps: 500,
			UploadMbps:   100,
			Enabled:      true,
		},
	}
	// Wednesday 08:59 -- before the window
	now := time.Date(2026, 4, 1, 8, 59, 0, 0, time.Local)
	matched := findMatchingSchedule(schedules, now)
	if matched != nil {
		t.Fatalf("expected no match before window, got schedule %d", matched.ID)
	}
}

func TestFindMatchingSchedule_AfterWindowEndExclusive(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{3}, // Wednesday
			StartTime:    "09:00",
			EndTime:      "17:00",
			DownloadMbps: 500,
			UploadMbps:   100,
			Enabled:      true,
		},
	}
	// Wednesday 17:00 -- end is exclusive
	now := time.Date(2026, 4, 1, 17, 0, 0, 0, time.Local)
	matched := findMatchingSchedule(schedules, now)
	if matched != nil {
		t.Fatalf("expected no match at end time (exclusive), got schedule %d", matched.ID)
	}
}

func TestFindMatchingSchedule_OvernightLateNight(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{5}, // Friday
			StartTime:    "23:00",
			EndTime:      "06:00",
			DownloadMbps: 1000,
			UploadMbps:   200,
			Enabled:      true,
		},
	}
	// Friday 23:30 -- late-night portion on the scheduled day
	now := time.Date(2026, 4, 3, 23, 30, 0, 0, time.Local) // 2026-04-03 is Friday (weekday=5)
	matched := findMatchingSchedule(schedules, now)
	if matched == nil {
		t.Fatal("expected match for Friday 23:30 in overnight window, got nil")
	}
}

func TestFindMatchingSchedule_OvernightEarlyMorning(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{5}, // Friday
			StartTime:    "23:00",
			EndTime:      "06:00",
			DownloadMbps: 1000,
			UploadMbps:   200,
			Enabled:      true,
		},
	}
	// Saturday 03:00 -- early-morning portion; previous day (Friday) is in schedule
	now := time.Date(2026, 4, 4, 3, 0, 0, 0, time.Local) // 2026-04-04 is Saturday (weekday=6)
	matched := findMatchingSchedule(schedules, now)
	if matched == nil {
		t.Fatal("expected match for Saturday 03:00 (overnight from Friday), got nil")
	}
}

func TestFindMatchingSchedule_Disabled(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{1, 2, 3, 4, 5},
			StartTime:    "09:00",
			EndTime:      "17:00",
			DownloadMbps: 500,
			UploadMbps:   100,
			Enabled:      false,
		},
	}
	// Wednesday 12:00 -- matches day and time but schedule is disabled
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.Local)
	matched := findMatchingSchedule(schedules, now)
	if matched != nil {
		t.Fatalf("expected no match for disabled schedule, got schedule %d", matched.ID)
	}
}

func TestFindMatchingSchedule_WrongDay(t *testing.T) {
	schedules := []Schedule{
		{
			ID:           1,
			DaysOfWeek:   []int{1}, // Monday only
			StartTime:    "09:00",
			EndTime:      "17:00",
			DownloadMbps: 500,
			UploadMbps:   100,
			Enabled:      true,
		},
	}
	// Wednesday 12:00 -- right time but wrong day
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.Local) // Wednesday
	matched := findMatchingSchedule(schedules, now)
	if matched != nil {
		t.Fatalf("expected no match for wrong day, got schedule %d", matched.ID)
	}
}

// ---------- CRUD ----------

func TestCRUD_CreateReadUpdateDelete(t *testing.T) {
	d := testDB(t)
	mc := &mockController{}
	sched := NewScheduler(d, mc)

	// Create
	sc := Schedule{
		DaysOfWeek:   []int{1, 3, 5},
		StartTime:    "08:00",
		EndTime:      "20:00",
		DownloadMbps: 500,
		UploadMbps:   100,
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
	got := schedules[0]
	if got.ID != int(id) {
		t.Errorf("ID: got %d, want %d", got.ID, id)
	}
	if got.StartTime != "08:00" {
		t.Errorf("StartTime: got %q, want %q", got.StartTime, "08:00")
	}
	if got.DownloadMbps != 500 {
		t.Errorf("DownloadMbps: got %d, want 500", got.DownloadMbps)
	}
	if !got.Enabled {
		t.Error("Enabled: got false, want true")
	}

	// Update
	got.DownloadMbps = 1000
	got.EndTime = "22:00"
	if err := sched.UpdateSchedule(got); err != nil {
		t.Fatalf("UpdateSchedule: %v", err)
	}
	schedules, err = sched.GetSchedules()
	if err != nil {
		t.Fatalf("GetSchedules after update: %v", err)
	}
	if schedules[0].DownloadMbps != 1000 {
		t.Errorf("DownloadMbps after update: got %d, want 1000", schedules[0].DownloadMbps)
	}
	if schedules[0].EndTime != "22:00" {
		t.Errorf("EndTime after update: got %q, want %q", schedules[0].EndTime, "22:00")
	}

	// Delete
	if err := sched.DeleteSchedule(int(id)); err != nil {
		t.Fatalf("DeleteSchedule: %v", err)
	}
	schedules, err = sched.GetSchedules()
	if err != nil {
		t.Fatalf("GetSchedules after delete: %v", err)
	}
	if len(schedules) != 0 {
		t.Fatalf("expected 0 schedules after delete, got %d", len(schedules))
	}
}

func TestCRUD_DeleteNonexistent(t *testing.T) {
	d := testDB(t)
	mc := &mockController{}
	sched := NewScheduler(d, mc)

	err := sched.DeleteSchedule(9999)
	if err != ErrScheduleNotFound {
		t.Fatalf("expected ErrScheduleNotFound, got %v", err)
	}
}

// ---------- Override ----------

func TestOverride_ManualStart(t *testing.T) {
	d := testDB(t)
	mc := &mockController{}
	sched := NewScheduler(d, mc)

	sched.ManualStart(500, 100)
	if sched.GetOverrideState() != OverrideForceStart {
		t.Fatalf("expected OverrideForceStart (%d), got %d", OverrideForceStart, sched.GetOverrideState())
	}
}

func TestOverride_ManualStop(t *testing.T) {
	d := testDB(t)
	mc := &mockController{}
	sched := NewScheduler(d, mc)

	sched.ManualStop()
	if sched.GetOverrideState() != OverrideForceStop {
		t.Fatalf("expected OverrideForceStop (%d), got %d", OverrideForceStop, sched.GetOverrideState())
	}
}

func TestOverride_ClearOverride(t *testing.T) {
	d := testDB(t)
	mc := &mockController{}
	sched := NewScheduler(d, mc)

	sched.ManualStart(500, 100)
	sched.ClearOverride()
	if sched.GetOverrideState() != OverrideNone {
		t.Fatalf("expected OverrideNone (%d), got %d", OverrideNone, sched.GetOverrideState())
	}
}

// ---------- parseHHMM ----------

func TestParseHHMM_Valid(t *testing.T) {
	cases := []struct {
		input string
		want  int
	}{
		{"00:00", 0},
		{"09:30", 570},
		{"23:59", 1439},
		{"12:00", 720},
		{"01:01", 61},
	}
	for _, tc := range cases {
		got, err := parseHHMM(tc.input)
		if err != nil {
			t.Errorf("parseHHMM(%q): unexpected error: %v", tc.input, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseHHMM(%q) = %d, want %d", tc.input, got, tc.want)
		}
	}
}

func TestParseHHMM_Invalid(t *testing.T) {
	cases := []string{
		"25:00",
		"abc",
		"",
		"12:60",
		"-1:00",
		"24:00",
	}
	for _, input := range cases {
		_, err := parseHHMM(input)
		if err == nil {
			t.Errorf("parseHHMM(%q): expected error, got nil", input)
		}
	}
}
