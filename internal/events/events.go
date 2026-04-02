package events

import (
	"sync"
	"time"
)

// Event represents a single engine decision or state change.
type Event struct {
	Time    time.Time `json:"time"`
	Kind    string    `json:"kind"`    // "stream", "server", "adjust", "test"
	Message string    `json:"message"`
}

// Buffer is a thread-safe ring buffer of engine events.
type Buffer struct {
	mu     sync.Mutex
	events []Event
	cap    int
}

// NewBuffer creates an event buffer with the given capacity.
func NewBuffer(capacity int) *Buffer {
	return &Buffer{
		events: make([]Event, 0, capacity),
		cap:    capacity,
	}
}

// Add appends an event to the buffer. If at capacity, the oldest event is dropped.
func (b *Buffer) Add(kind, message string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	e := Event{
		Time:    time.Now(),
		Kind:    kind,
		Message: message,
	}

	if len(b.events) >= b.cap {
		copy(b.events, b.events[1:])
		b.events[len(b.events)-1] = e
	} else {
		b.events = append(b.events, e)
	}
}

// Drain returns all buffered events and clears the buffer.
// Events are returned in chronological order (oldest first).
func (b *Buffer) Drain() []Event {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.events) == 0 {
		return nil
	}

	out := make([]Event, len(b.events))
	copy(out, b.events)
	b.events = b.events[:0]
	return out
}
