# Online play: how players connect

VOLLE lobbies are host-authoritative peer-to-peer (PeerJS / WebRTC). The Node
server keeps the lobby registry, issues the lobby admission token and, when
WebRTC cannot connect, relays the game traffic itself.

```
friend's browser ──(1) WebRTC data channel (direct, or via TURN)──▶ host's browser
        │                                                              ▲
        └──(2) fallback: wss://<site>/api/relay ──▶ Node server ───────┘
```

## Join sequence

1. Client opens a PeerJS connection to the host's room code (8 s budget).
2. If that fails (ICE failure, symmetric / carrier-grade NAT, blocked UDP, host
   not on the PeerJS broker) the client connects to `/api/relay` instead. The
   host keeps one relay socket open per registered lobby.
3. Over either transport the host runs the same resume-token identity
   challenge, then sends the lobby admission proof (and the welcome).
4. The client posts the proof to `POST /api/lobbies/:code/join`. The server
   only admits clients that present the host's proof.
5. The client waits up to 20 s for the proof and re-asks the host every 2.5 s
   (`lobbyAdmissionRequest`), so one lost or late packet does not fail a join.

Progress is shown as toasts: "Connecting to the host…", "Direct connection
blocked — connecting through the game server…", "Connected — joining the
lobby…". Failures show one clear reason (EN/TR): already in the lobby from
another tab, wrong password, lobby full, lobby closed, lobby re-created, ranked
needs an account, network blocking the connection, or lobby service down.

## Who can play online

* **Signed-in players:** everything, including ranked.
* **Guests:** they host and join casual lobbies (Join by Code, the lobby
  browser, casual Quick Play) through an anonymous guest lobby session
  (`POST /api/lobbies/guest-session`, an HMAC-signed token valid for 12 h). The
  guest session is accepted only by the lobby endpoints and the relay. Guests
  never get a profile, economy, rewards or ranked access. They count toward
  lobby capacity but are never reward-eligible match members.
* An **expired account session** falls back to a guest lobby session
  automatically, and a toast asks the player to sign in again to earn rewards.

## Render setup (owner)

Nothing is required: STUN defaults and the WebSocket relay work out of the
box on Render, which supports WebSocket upgrades on the web service port.

Recommended:

1. **LOBBY_GUEST_SECRET**: `render.yaml` generates it. If the service was set
   up by hand, add a random value of 32 or more characters under
   *Environment*. Guest sessions then survive restarts.

Optional, for better latency than the server relay (the host's traffic goes
through a TURN server near the players instead of through Render):

2. **Cloudflare Realtime TURN** (free tier):
   Cloudflare dashboard → *Realtime* → *TURN Server* → *Create*. Copy the
   **Turn Token ID** and the **API Token**, then set on Render:
   * `CLOUDFLARE_TURN_KEY_ID` = the Turn Token ID
   * `CLOUDFLARE_TURN_API_TOKEN` = the API token
3. **or Metered.ca** (free tier): create an app, then set
   * `METERED_TURN_APP` = your app subdomain (`volle` for `volle.metered.live`)
   * `METERED_TURN_API_KEY` = the app's API key
4. **or your own coturn**: `TURN_URLS` (comma-separated `turn:` / `turns:` URLs)
   plus either `TURN_SECRET` (coturn REST shared secret) or
   `TURN_USERNAME` + `TURN_CREDENTIAL`.

Provider API tokens stay on the server. Clients only receive short-lived
TURN credentials from `GET /api/ice-servers` (alias `/api/rtc-config`). These
credentials are cached for half their TTL (`TURN_TTL_SECONDS`, default
3600). If the provider is down, the server falls back to STUN, and the relay
covers the rest.

Other switches:

| Variable | Default | Effect |
| --- | --- | --- |
| `STUN_URLS` | Google ×2, Cloudflare, Twilio | Replace the STUN list |
| `LOBBY_RELAY` | on | `0` disables `/api/relay` |
| `LOBBY_GUEST_SESSIONS` | on | `0` disables guest online play |
| `PEER_HOST` / `PEER_PORT` / `PEER_PATH` / `PEER_SECURE` | PeerJS cloud | Self-hosted PeerJS broker |

After a deploy, players do not need a hard refresh. JS / HTML / CSS are served
`no-store`, and the service worker is network-first.

## Relay limits and security

* The host must be the lobby's registered owner and must present the lobby
  admission token. A client needs a lobby identity (account or guest). The
  host then admits or kicks the client exactly as over WebRTC.
* The server never parses game packets. It assigns relay ids
  (`relay-<hex>`), sanitizes the connect metadata (resume tokens never pass
  through it), and forwards messages.
* Limits: 1 MiB per message; per-socket token buckets (client 240 msg/s and
  1 MiB/s, host 3000 msg/s and 8 MiB/s); 12 relay sockets per IP; 40 clients
  per room; 1000 rooms. A room closes when its lobby is closed or expires.
* Relay clients do not join the WebRTC mesh. The host forwards movement
  between relay clients and everyone else. Relay clients are not host-migration
  candidates.

## Testing locally

* `node --test tests/lobby-join-reliability.test.mjs tests/lobby-relay-guest.test.mjs tests/rtc-turn-providers.test.mjs`
  cover lost and late proofs, fallback timing, the relay end to end (identity,
  proof and `/join`), guest rules and TURN providers.
* A real cross-country / carrier-grade NAT test cannot be simulated on one
  machine. To exercise the relay path in a browser, force the WebRTC attempt
  to fail on the joining tab:
  `__volle.network._connectHostP2P = () => Promise.reject(Object.assign(new Error('x'), { code: 'p2p_failed' }))`
  (open the page with `?debug`).
