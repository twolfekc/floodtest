package events

import (
	"testing"
	"time"
)

func TestBufferAddAndDrain(t *testing.T) {
	buf := NewBuffer(5)

	buf.Add("stream", "added 2 download streams")
	buf.Add("server", "hz-de3 entered cooldown")
	buf.Add("adjust", "auto-adjust: 87%")

	events := buf.Drain()
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	if events[0].Kind != "stream" {
		t.Errorf("expected kind 'stream', got %q", events[0].Kind)
	}
	if events[0].Message != "added 2 download streams" {
		t.Errorf("unexpected message: %q", events[0].Message)
	}

	// Drain again should be empty
	events = buf.Drain()
	if len(events) != 0 {
		t.Fatalf("expected 0 events after drain, got %d", len(events))
	}
}

func TestBufferOverflow(t *testing.T) {
	buf := NewBuffer(3)

	buf.Add("a", "first")
	buf.Add("b", "second")
	buf.Add("c", "third")
	buf.Add("d", "fourth") // pushes out "first"

	events := buf.Drain()
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	if events[0].Message != "second" {
		t.Errorf("expected oldest to be 'second', got %q", events[0].Message)
	}
	if events[2].Message != "fourth" {
		t.Errorf("expected newest to be 'fourth', got %q", events[2].Message)
	}
}

func TestBufferTimestamp(t *testing.T) {
	buf := NewBuffer(10)
	before := time.Now()
	buf.Add("test", "hello")
	after := time.Now()

	events := buf.Drain()
	if events[0].Time.Before(before) || events[0].Time.After(after) {
		t.Errorf("timestamp %v not between %v and %v", events[0].Time, before, after)
	}
}

func TestBufferConcurrent(t *testing.T) {
	buf := NewBuffer(50)
	done := make(chan struct{})

	// Writer goroutine
	go func() {
		for i := 0; i < 100; i++ {
			buf.Add("test", "msg")
		}
		close(done)
	}()

	// Reader goroutine
	for i := 0; i < 10; i++ {
		_ = buf.Drain()
	}
	<-done
}
