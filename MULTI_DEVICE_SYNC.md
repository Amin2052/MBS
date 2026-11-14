# MBS Multi-device Sync

Phase 7 adds deterministic synchronization primitives:
- per-record revision/version checking
- optimistic-concurrency conflict detection
- FIFO offline mutation queue
- last-write ordering helper for equal-version timestamps

The central online API remains the source of truth. Existing local SQLite behavior
is preserved; the queue can replay local mutations when connectivity returns.
