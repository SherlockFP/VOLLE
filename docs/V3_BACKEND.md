# V3 Backend and Online Architecture

## Current boundary

PeerJS and host-authoritative simulation remain useful for casual/private
testing. They are not final ranked authority.

## Production services

### Account/profile

- Durable identity.
- Session rotation.
- Account recovery.
- Ban and moderation state.

### Inventory/economy

- Append-only transaction records.
- Server-owned balances.
- Item catalog validation.
- Idempotent purchase and reward claims.
- Audit log.

### Matchmaking/lobby

- Queue ticket.
- Region and latency.
- Party integrity.
- Reconnect reservation.
- Queue population protection.

### Match service

- Fixed server tick.
- Input sequence.
- Server simulation/validation.
- Snapshot stream.
- Reconciliation.
- Signed result.

## Migration order

1. Make rewards server-owned.
2. Add durable profile storage.
3. Prototype authoritative 1v1.
4. Compare replay and server result.
5. Add ranked queue.
6. Extend to 3v3.

## Security

- Rate-limit session, purchase, reward, workshop and lobby endpoints.
- Return bounded `X-RateLimit-*` headers and `Retry-After` on `429` responses.
- Keep limiter state bounded and prune expired keys; do not retain request bodies.
- Never accept client reward amount.
- Validate match nonce and participant.
- Reject duplicate match claims.
- Sanitize names and custom-map metadata.
- Log suspicious transaction/reward frequency.
- Accept only allowlisted, bounded telemetry metrics from authenticated profiles.
- Hash profile identifiers in telemetry storage and never auto-ban from one sample.

## Implemented local foundation

- `server/request-limiter.js` provides a dependency-free bounded fixed-window limiter.
- `server.js` applies it before parsing mutation bodies for session, economy,
  creator-map and lobby surfaces.
- This is a local/single-process guard, not a replacement for a distributed
  edge limiter in production.

## Production exit gate

- Move rate limiting to the edge or shared store before multi-instance deploy.
- Add provider-backed payment intents and signed webhook receipt handling.
- Keep premium grants server-owned and append an immutable economy ledger entry.
- Feed flagged telemetry to review tooling; require replay/server evidence for action.
