# MBS Offline/Online Reliability

Phase 8 provides:
- explicit online/offline/reconnecting states
- exponential retry backoff with a maximum delay
- deterministic duplicate-operation protection
- compatibility with the Phase 7 offline mutation queue

Recommended runtime flow:
1. Detect connectivity.
2. Keep local reads available while offline.
3. Queue mutations while offline.
4. On reconnection, replay FIFO operations.
5. Use operation IDs to avoid duplicate replay.
6. Apply revision checks before accepting remote updates.
