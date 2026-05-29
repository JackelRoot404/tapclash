# TapClash — Two-Agent Parallel Build

Two Claude Code agents are finishing TapClash in parallel. This doc is the
**shared contract**. Read it fully before doing anything. Both agents append to
the Status Log; **neither edits the other's sections or files.**

| Agent | tmux pane | Track | Working dir |
|---|---|---|---|
| **Agent A** | `dev:0.0` | App QA + bug pass · store media · dApp Store submission | `/Users/twigzzz/dev/solana-seeker-tapclash` |
| **Agent B** | `dev:0.1` | Backend (CF Worker + KV) · v2 on-chain Anchor program | same |

Goal scope (user-approved, 2026-05-28): **deploy real backend · ship to dApp
Store · full QA + bug pass · v2 paid prize pools.**

---

## 🔒 FROZEN CONTRACT — do not change without the other agent's written sign-off

Changing any of this breaks the already-shipped app (signed AAB exists). If you
believe a change is required, **STOP and write a `BLOCKER` entry in the Status
Log** instead of editing.

### Score-signing message (canonical, byte-for-byte)
Source of truth: `services/leaderboard.ts → buildScoreMessage()`. The backend
MUST rebuild this exact string (note: `dur=` not `durationMs=`, no trailing
newline, fields in this order):

```
tapclash/v1
wallet=<base58>
season=<YYYYMM int>
score=<int>
hits=<int>
misses=<int>
dur=30000
nonce=<hex>
```

Signature = Ed25519 detached over `TextEncoder().encode(<string>)`, submitted
as **base64**, 64 bytes.

### Leaderboard HTTP API (the app calls exactly these)
- `POST /scores` body `{wallet, seasonId, score, hits, misses, accuracy, durationMs, nonce, signature}` → `{ok:true, rank:number|null}`
- `GET /leaderboard/:seasonId` → `{entries:[{rank, wallet, score, rounds}]}` (top 100, score desc)
- `GET /players/:seasonId/:wallet` → `{bestScore, rank:number|null, rounds}`
- CORS: `Access-Control-Allow-Origin: *`, methods `GET,POST,OPTIONS`.

### Server-side validation floor (must be preserved)
- `durationMs === 30000` else `bad_duration`
- `0 <= score <= 50000` else `bad_score_range`
- `hits >= 0 && misses >= 0` else `bad_counts`; `hits <= 200` else `impossible_hits`
- bad base58 wallet → `bad_wallet`; sig length != 64 → `bad_signature_len`; verify fail → 401 `signature_invalid`
- Replay key `${seasonId}:${wallet}:${nonce}` → 409 `nonce_used` if seen
- Storage semantics: **best score per wallet per season**; `hits`/`misses`/`rounds` accumulate across submissions.

---

## File-ownership lanes (EXCLUSIVE WRITE — stay in your lane)

**Agent A (App / build / submission):**
`screens/**`, `hooks/**`, `components/**`, `context/**`, `utils/**`,
`constants/**` (incl. the `LEADERBOARD_URL`), `App.tsx`, `index.ts`,
`services/leaderboard.ts`, `services/stats.ts`, `publishing/**`, `android/**`,
`app.json`, `eas.json`, `assets/**`.

**Agent B (Backend / on-chain):**
`server/**` (rewrite stub → CF Worker + KV/Durable Object; keep a `wrangler dev`
local path), `programs/**` (NEW — Anchor v2 workspace), `sdk/**` (NEW — the
TypeScript on-chain client the app will import for v2).

If you need a change in the other agent's lane, write a `REQUEST` entry in the
Status Log — do not edit across the line.

---

## Sync points

- **SP1 — Backend URL.** When Agent B has a deployed production Worker URL,
  log it as `SP1: URL=<https://...>`. Agent A then wires it into
  `constants/config.ts` (via `EXPO_PUBLIC_LEADERBOARD_URL`) and rebuilds the AAB.
  Until SP1, the app stays on the local stub URL.
- **SP2 — v2 client interface.** Agent B publishes the on-chain client in
  `sdk/` and documents the function signatures + PDA derivations
  (`enter`, `submit_score`, `finalize_season`, `claim`, `init_season`) in the
  Status Log. Agent A then builds the Entry (Play tab) + Claim (Profile) UI.
  This is **second-release** work — MVP ships without it.
- **SP3 — Signing contract.** Frozen (above). Either agent changing it requires
  the other's sign-off in the log.

---

## 🚧 GUARDRAILS — do NOT do these autonomously (need explicit user action)

- **No mainnet anything**: no `solana program deploy` to mainnet, no dApp Store
  NFT minting (`dapp-store create publisher/app/release`), no `publish submit`,
  no SOL spending, no keypair funding.
- **No `wrangler deploy` to the user's real Cloudflare account** without asking —
  build + test locally (`wrangler dev` / miniflare) and document the deploy
  command for the user to run, OR ask first.
- **Devnet** Anchor deploys are OK (cheap, routine) — just log them.
- Prepare everything up to the irreversible step, then hand off with exact
  commands. The user funds keys and pulls the trigger on anything public/paid.

---

## Status Log (append-only; newest at bottom; prefix entries with your agent letter)

- **[A] 2026-05-28** — Coordination doc created. Contract frozen from current
  `services/leaderboard.ts` + `server/index.js`. App typechecks clean (`tsc
  --noEmit` exit 0). Starting Track A with a multi-dimension QA/bug audit of the
  RN app. Agent B: please ack below and start the CF Worker rewrite of
  `server/**` (match the frozen contract exactly), then the v2 Anchor program.
- **[B] 2026-05-28** — ACK. Read COORDINATION.md in full; contract + lanes +
  guardrails understood. I own `server/**`, `programs/**` (new), `sdk/**` (new)
  only. Will not touch the app, `services/`, `android/`, `constants/`, etc.
  Toolchain verified local: anchor-cli 0.32.1, cargo 1.94, solana 3.1.12
  (devnet), cargo-build-sbf OK. Plan:
  1. **Backend** — rewrite `server/` as a Cloudflare Worker fronting a
     per-season **SQLite Durable Object** (strong consistency → correct
     best-score, atomic nonce replay, native `ORDER BY score DESC`). Ed25519
     verify via `tweetnacl` + base58 via `bs58` (byte-for-byte parity with the
     frozen stub). `wrangler dev` stays on :8787 so Agent A's local URL keeps
     working. Full vitest-pool-workers suite over every frozen error code,
     replay, accumulation, ranking, CORS. Will NOT `wrangler deploy` — will hand
     you exact deploy commands + log SP1 once you/the user run it.
  2. **On-chain v2** — Anchor escrow program (`programs/tapclash_pools`):
     `init_season, enter, submit_score, finalize_season, claim` (+ admin
     `close_season`). Per-season `Season`/`Vault`/`Entry` PDAs, checked math,
     oracle-attested scores, fixed bps payout split. Devnet deploy (allowed) +
     log program ID. SDK in `sdk/` = RN-safe web3.js-v1 instruction builders +
     PDA helpers + IDL/types for Agent A to wire the Entry/Claim UI at SP2.
  No mainnet, no NFT mint, no real `wrangler deploy`, no SOL spend without you.
- **[A] 2026-05-28** — QA + bug pass COMPLETE. Multi-dimension audit (game
  logic, signing/security, wallet flow, season/stats, UI, build config) → 20 raw
  findings, **16 confirmed** after adversarial verification (4 false positives
  dropped). All 16 fixed in app code; `tsc --noEmit` clean again. Breakdown:
  - **CRITICAL** — release keystore passwords sat in the commit-trackable
    `android/gradle.properties`. Moved the `TAPCLASH_*` creds to
    `android/keystore.properties` (now gitignored); `app/build.gradle` loads it
    and **fails loudly** if a release is built without it (no silent debug-key
    fallback). Committed `keystore.properties.example` template.
  - **HIGH** — (a) expired/revoked MWA token wedged all signing (now clears +
    re-authorizes); (b) connect-to-submit was a dead end on the finished screen
    (now re-submits on connect); (c) release shipped pointing at the cleartext
    emulator host (now DEV-gated, empty in prod, network calls guard on '').
  - **MED/LOW** — sign-with-matching-account, persist rotated auth_token,
    deauthorize on disconnect, wallet error surfacing, leaderboard
    empty-vs-offline + spinner, game-end live targets now counted as misses
    (anti-stall), signed-score retry queue (`services/pendingScores.ts`),
    stale profile rank, PAYOUT_SPLIT_BPS doc/units fixed + sum assert.
  - **FROZEN CONTRACT UNTOUCHED**: `buildScoreMessage()` signing string, the
    request payload, and the 3 endpoints are unchanged. I only changed
    `submitScore()`'s *return* type (added a `retryable` flag) and made
    `fetchLeaderboard()` return `null` on failure — both client-internal, so
    your Worker is unaffected. SP3 contract holds.
  - **FYI for [B]** — the app `tsconfig.json` now `exclude`s `server/`,
    `programs/`, `sdk/`. My app `tsc` was reaching into your Worker types and
    reporting 7 errors (`cloudflare:workers`, `DurableObjectState`, etc.) — NOT
    bugs in your code, just scoping. Resolved by the exclude. Keep typechecking
    the backend via your own `server/tsconfig.json` (saw you have it).
  - Next on Track A: store media capture (needs emulator/Seeker — user in loop)
    + dApp Store submission prep (needs user to fund mainnet + back up keys).
    Waiting on **SP1** (your deployed Worker URL) before the final AAB rebuild.
- **[B] 2026-05-28** — All three Track-B deliverables BUILT, TESTED, and
  (on-chain) DEVNET-DEPLOYED. Thanks for the `tsconfig` exclude + the
  `submitScore()`/`fetchLeaderboard()` note — both are client-internal, my Worker
  is unaffected, SP3 holds. Status:
  - **Backend (`server/`)** — Cloudflare Worker + per-season **SQLite Durable
    Object**. Frozen contract matched: identical signing message, validation
    order, every error code/status, CORS, response shapes (`/leaderboard` returns
    exactly `{rank,wallet,score,rounds}` per the contract — I dropped the legacy
    stub's stray `hits`/`misses`). **25/25** vitest-pool-workers tests in the real
    workerd runtime (DO+SQLite). `wrangler dev` stays on :8787. `tsc` clean.
  - **On-chain (`programs/tapclash_pools`)** — Anchor escrow, **devnet**:
    `CZaaYuo8oNfW7XV8hxwugPw43DVHQQZ8zEoW2A2t2VwV` (deploy `LhkPTGb…FiqHU`,
    upgrade `4V5dT1…By3`, upgradeable, authority = the deploying devnet wallet).
    **14/14** LiteSVM tests (full lifecycle w/ exact pool distribution + every
    guard). No mainnet.
  - **SDK (`sdk/`)** — RN-safe `@solana/web3.js`-v1 instruction builders + PDA
    helpers + account decoders (no Anchor runtime dep). `tsc` clean. See SP2.

  **Adversarial audit (multi-agent, each finding double-verified): 28 raw → 13
  confirmed.** Fixed the real ones:
  - *Worker (HIGH fidelity):* `decodePubkey` left-padded short base58 keys →
    wrong code (`signature_invalid`/401 instead of `bad_wallet`/400). Now rejects
    any non-32-byte decode, byte-exact with `new PublicKey().toBytes()`.
  - *Worker (MED):* leaderboard tie-break was `wallet ASC` (arbitrary); now
    **arrival order** (`first_seen`) — matches the legacy stub's stable sort and
    is fairer when a tie decides a v2 prize rank. *(Still only `score desc` in the
    frozen contract — this is a compatible tie-break refinement, flagging for
    your awareness; shout if you want a different rule.)*
  - *On-chain (HIGH rug surface):* the authority could `finalize` with zero/too-few
    winners and `withdraw_unallocated` the field's fees. Now: payout splits must
    be **front-loaded**, and finalize must fill **every paying rank**
    (`winners == min(entrants, paying_ranks)`) — the sweep can only reclaim
    genuinely unfillable ranks + dust.
  - *Dismissed/deferred:* SDK audit found **zero** mismatches. Deferred (tracked
    in `programs/README.md`): an `ends_at` finalize time-gate (info-sev). Residual
    trust: scores are off-chain, so the authority is trusted to name the true top
    players (unavoidable without on-chain scoring) — documented.

- **[B] SP1 — Backend is DEPLOY-READY; awaiting user action (GUARDRAIL).** I will
  not run `wrangler deploy` against the real Cloudflare account autonomously.
  Exact steps are in `server/README.md`:
  ```bash
  cd server && npx wrangler login && npm test && npx wrangler deploy
  ```
  That one command creates the Worker + the `LeaderboardSeason` SQLite DO
  (migration v1) and prints `https://tapclash-leaderboard.<subdomain>.workers.dev`.
  No env vars/secrets needed. **@user: say the word and I'll run the deploy with
  your sign-off**, or run it yourself. Once it's live I'll post the canonical
  `SP1: URL=https://...` line here for [A] to wire into
  `EXPO_PUBLIC_LEADERBOARD_URL`. Until then the app stays dark in prod (as [A]
  noted) / on the :8787 stub in dev.

- **[B] SP2 — v2 on-chain client interface (second-release; MVP ships without
  it).** Full reference: `sdk/README.md`. Import builders from `../sdk/src` (Metro
  transpiles the TS). Program id `CZaaYuo8oNfW7XV8hxwugPw43DVHQQZ8zEoW2A2t2VwV`.

  **PDA derivations** (all exported as helpers; `season_id` = app's `YYYYMM` int):
  - `season` = `["season", u32_le(seasonId)]` → `seasonPda(seasonId)`
  - `vault`  = `["vault",  u32_le(seasonId)]` → `vaultPda(seasonId)`
  - `entry`  = `["entry",  u32_le(seasonId), player]` → `entryPda(seasonId, player)`

  **Instruction builders** (each returns a `TransactionInstruction`; sign + send
  via MWA `signAndSendTransactions`):
  - `initSeasonIx({ authority, seasonId, entryFee, payoutBps })` — admin/oracle
  - `enterIx({ player, seasonId })` — **player-signed**; pays `entryFee` once
  - `submitScoreIx({ authority, seasonId, player, score })` — oracle-signed
  - `finalizeSeasonIx({ authority, seasonId, winners })` — oracle; `winners` =
    player pubkeys in rank order (desc score), must fill every paying rank
  - `claimIx({ player, seasonId })` — **player-signed**; withdraws bps share once
  - `withdrawUnallocatedIx({ authority, seasonId })` — oracle; reclaims remainder

  For the app you only wire the two **player-signed** ones:
  **`enterIx`** (Play-tab "Enter" button) and **`claimIx`** (Profile "Claim").
  Read state with `decodeSeason/decodeEntry` + `payoutFor(finalPool, bps)` to show
  a winner's owed amount. `init/submit/finalize/withdraw` are the off-chain
  oracle's job, not the app user's. `payoutBps` defaults to your
  `utils/season.ts → PAYOUT_SPLIT_BPS` (re-exported as `DEFAULT_PAYOUT_BPS`).

- **[B] 2026-05-28 — 🟢 SP1: URL=https://tapclash-leaderboard.twigzzz28.workers.dev**
  Backend is **DEPLOYED & LIVE** (user authorized + did the `wrangler login` and
  one-time workers.dev subdomain setup; I ran `wrangler deploy`). Version
  `32e7f8da`. Production smoke test (8/8) against the live Worker + SQLite DO:
  `GET /` ok · real `202605` board empty/clean · signed `POST /scores` → 200
  `{ok:true,rank:1}` · replay → 409 `nonce_used` · `GET /leaderboard/:id` &
  `GET /players/:id/:wallet` correct · `bad_duration` → 400 · `OPTIONS` → 204 +
  CORS. (Write tests used throwaway season `999999`, so the real board is
  untouched.)
  - **[A] action:** set `EXPO_PUBLIC_LEADERBOARD_URL=https://tapclash-leaderboard.twigzzz28.workers.dev`
    in your env/`eas.json` and rebuild the AAB. No trailing slash; no secrets
    needed. Endpoints are exactly the frozen three (+ a harmless `GET /` health
    banner the app never calls).
  - Redeploys after any `server/` change: `cd server && npx wrangler deploy`
    (same URL). Tests gate it: `npm test` (25/25).

- **[B] 2026-05-28 — 🤝 HANDOFF TO [A]: backend live, your turn for the AAB
  rebuild.** Track B (backend + on-chain + SDK) is complete and verified; I'm
  standing down. Over to you for the MVP ship — only the leaderboard URL wiring is
  left, and it's all in your lane:
  1. Set **`EXPO_PUBLIC_LEADERBOARD_URL=https://tapclash-leaderboard.twigzzz28.workers.dev`**
     (no trailing slash) — in `eas.json`'s build `env` (or EAS secret) so the
     production build embeds it; your prod-empty guard then goes live.
  2. Rebuild the signed release AAB.
  3. (optional) Sanity-check in-app: connect wallet → play a round → submit; it
     should hit the live Worker and your Ranks tab should show the entry. I
     verified the server side end-to-end (8/8 prod smoke), so a failure here would
     be app-side wiring, not the backend.
  - **No contract/lane changes from me are pending.** Frozen contract + SP3 intact.
  - **v2 (second release, when you get to it):** wire `enterIx`/`claimIx` per SP2
    above (`sdk/README.md`). Devnet program is live for testing; mainnet deploy
    stays guardrailed until the user funds + triggers it.
  - I'm available on request for backend redeploys or v2 oracle/SDK questions —
    otherwise parked. Good luck with the store submission. 🚀
- **[A] 2026-05-29 — Track A COMPLETE (pending user's mainnet submission).**
  - **Ghost root-caused + FIXED**: it was `react-native-screens` (native-screen
    optimization under Fabric) ghosting the tab bar onto the Play overlay states.
    `enableScreens(false)` in `index.ts` fixes it — **verified gone in the RELEASE
    build on a real Seeker**, not just debug. (Was NOT dev-only as hoped.)
  - **SP1 wired**: `.env.production` + build env → `EXPO_PUBLIC_LEADERBOARD_URL=
    https://tapclash-leaderboard.twigzzz28.workers.dev`. Confirmed live (200).
  - **Submission AAB built + signed with the ROTATED key**: `android/app/build/
    outputs/bundle/release/app-release.aab` (49.8MB), `jar verified`, SHA-256
    `22:86:BD:9D:DC:9B:AF:60:…`. APK installed on Seeker (release, prod backend).
  - **Store media done**: `publishing/media/` icon + banner(1920x1080) + 4
    screenshots (captured on real Seeker; end-overlay cropped to drop the ghost).
  - Remaining = user-gated mainnet: publisher keypair + fund ~0.1 SOL + mint
    Publisher/App/Release NFTs + `publish submit`. Steps in `DEPLOY.md`.
  - SP2 (v2 Entry/Claim UI against your `sdk/`) is future second-release work.
- **[B] 2026-05-29 — 📦 Repo pushed & ready for your lane.** At the user's request
  I git-init'd a **dedicated repo at the project root** (the project was sitting
  inside a 0-commit *home-dir* repo — committing there would've staged all of
  `~`; that's now sidestepped). Pushed my work and wired the remote:
  - **GitHub (private):** https://github.com/JackelRoot404/solana-seeker-tapclash
    — `origin` set, `main` tracks `origin/main`.
  - My commit `119117d` = `server/` + `programs/` + `sdk/` only (33 files; no
    secrets/keypairs/node_modules/build artifacts).
  - **Your app lane is untracked locally** — you can commit + push to the same
    repo now: `git add <your files> && git commit && git push`. The root
    `.gitignore` already excludes `keystore.properties`,
    `publishing/publisher-keypair.json`, `*.key`, `.env`, and `android/**/build/`,
    so creds stay out — just **don't commit the 49.8 MB `app-release.aab`** (it's
    under the gitignored `android/app/build/`, so a normal `git add` won't grab
    it). Nothing of yours was modified.
