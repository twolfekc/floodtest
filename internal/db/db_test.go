package db

import (
	"database/sql"
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

	// Verify settings table exists by inserting a row.
	if _, err := db.Exec("INSERT INTO settings (key, value) VALUES ('k', 'v')"); err != nil {
		t.Fatalf("insert into settings: %v", err)
	}

	// Verify usage_counters table exists by inserting a row.
	if _, err := db.Exec("INSERT INTO usage_counters (period, download_bytes, upload_bytes) VALUES ('2026-04', 0, 0)"); err != nil {
		t.Fatalf("insert into usage_counters: %v", err)
	}

	// Verify schedules table exists by inserting a row.
	if _, err := db.Exec("INSERT INTO schedules (days_of_week, start_time, end_time, download_mbps, upload_mbps, enabled) VALUES ('[1,2,3]', '09:00', '17:00', 500, 100, 1)"); err != nil {
		t.Fatalf("insert into schedules: %v", err)
	}

	// Verify throughput_history table exists by inserting a row.
	if _, err := db.Exec("INSERT INTO throughput_history (timestamp, download_bytes, upload_bytes) VALUES (datetime('now'), 1000, 500)"); err != nil {
		t.Fatalf("insert into throughput_history: %v", err)
	}

	// Verify throttle_events table exists by inserting a row.
	if _, err := db.Exec("INSERT INTO throttle_events (timestamp, direction, target_bps, actual_bps) VALUES (datetime('now'), 'download', 1000000, 500000)"); err != nil {
		t.Fatalf("insert into throttle_events: %v", err)
	}

	// Verify update_history table exists by inserting a row.
	if _, err := db.Exec("INSERT INTO update_history (previous_digest, new_digest, status) VALUES ('sha256:old', 'sha256:new', 'success')"); err != nil {
		t.Fatalf("insert into update_history: %v", err)
	}
}

func TestOpenDB_IndependentInstances(t *testing.T) {
	db1 := testDB(t)
	db2 := testDB(t)

	// Write to db1.
	if err := SetSetting(db1, "only_in_one", "hello"); err != nil {
		t.Fatalf("SetSetting on db1: %v", err)
	}

	// db2 should not see the row.
	val, err := GetSetting(db2, "only_in_one")
	if err != nil {
		t.Fatalf("GetSetting on db2: %v", err)
	}
	if val != "" {
		t.Fatalf("expected empty string from db2, got %q", val)
	}
}

func TestGetSetting_MissingKey(t *testing.T) {
	db := testDB(t)

	val, err := GetSetting(db, "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "" {
		t.Fatalf("expected empty string, got %q", val)
	}
}

func TestSetSetting_RoundTrip(t *testing.T) {
	db := testDB(t)

	if err := SetSetting(db, "fruit", "apple"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	got, err := GetSetting(db, "fruit")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if got != "apple" {
		t.Fatalf("expected %q, got %q", "apple", got)
	}
}

func TestSetSetting_Upsert(t *testing.T) {
	db := testDB(t)

	if err := SetSetting(db, "color", "red"); err != nil {
		t.Fatalf("SetSetting first: %v", err)
	}
	if err := SetSetting(db, "color", "blue"); err != nil {
		t.Fatalf("SetSetting second: %v", err)
	}

	got, err := GetSetting(db, "color")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if got != "blue" {
		t.Fatalf("expected %q after upsert, got %q", "blue", got)
	}
}
