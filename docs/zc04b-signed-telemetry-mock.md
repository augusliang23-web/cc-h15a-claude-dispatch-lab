# ZC-04B — Signed Telemetry Contract (OFFLINE MOCK ONLY)

This is a toy `OfflineSignedTelemetryStore` with real Ed25519 signature verification over **test fixture** keys, a strict envelope, canonical fixed-key serialization, SHA-256 chained event digests, one fixed task+attempt, monotone event sequence/time, producer-specific allowed types, and rejection of altered signatures, duplicated events and session swaps.

It makes **zero network calls** and no GitHub, Mac, model, file or credential writes. `MOCK_ACCEPTED` means only that a synthetically signed fixture was accepted in one in-memory JS instance. Every result has `simulated:true` and `real_agent_activity_verified:false`.

CI test: `node --test bridge/test/telemetry-signed-mock.test.mjs`.

**Critical non-goals:** no GitHub App/least-privilege installation, no secret distribution, no event persistence, no process registration, no actual model invocation, no real heartbeat, no scheduler, no server time attestation or cross-machine concurrency guarantee. This is NOT a production event writer or authoritative live status. See Issue #27 for the human-controlled permission gates.
