# TapClash

30-second tap-reaction game for the Solana Seeker phone. Sign in with your Seed Vault wallet, post your best score to the monthly leaderboard, climb the season ranks.

This is the v1 MVP — **score-only on-chain via wallet-signed submissions**. Paid entry pools + automated payouts arrive in v2 once the Anchor program is ready.

## Dev quick start

```bash
# 1) Install app deps
cd ~/solana-seeker-tapclash
npm install

# 2) (Optional) start the local leaderboard server
cd server && npm install && npm start
# Listens on http://localhost:8787; emulator reaches it via http://10.0.2.2:8787

# 3) Build + run on a connected Android device (Seeker)
cd ..
cp .env.example .env   # fill in EXPO_PUBLIC_HELIUS_API_KEY if you have one
npx expo run:android
```

If you skip step 2 the game still works offline — every round is saved to local stats, and the submit banner just shows "saved locally" instead of a server rank.

## Shipping to the Solana Mobile dApp Store

The native Android project, release keystore, signing config, listing
metadata, and step-by-step submission flow are all in place. See
**[DEPLOY.md](DEPLOY.md)** for the full publish runbook (publisher keypair,
funding, screenshots, `npx dapp-store` commands).

Short version once the keystore and publisher keypair exist:

```bash
( cd android && ./gradlew bundleRelease )                       # signed AAB
( cd publishing && npx dapp-store create release -k publisher-keypair.json )
( cd publishing && npx dapp-store publish submit -k publisher-keypair.json --requestor-is-authorized )
```

## Architecture

```
App.tsx
 └─ WalletProvider          MWA + Seed Vault, signMessage()
     └─ SeasonProvider      Calendar-month season id + countdown
         └─ TabNavigator    Play · Ranks · Season · Profile
```

| Folder | What lives there |
|---|---|
| `screens/` | One file per tab |
| `hooks/useTapGame.ts` | The game loop (spawner, combo, scoring) |
| `hooks/useSubmitScore.ts` | Build → sign → POST → fallback to local |
| `services/leaderboard.ts` | REST client + canonical signing payload |
| `services/stats.ts` | AsyncStorage-backed local stats |
| `utils/season.ts` | Season id from current month, payout split |
| `server/index.js` | Stub Node server that verifies Ed25519 sigs |

## Scoring

- Hit: `+100` (`+50` if tapped within 250ms of spawning)
- Combo bonus: `+10 × combo`, capped at `+200`
- Miss (target expires): `−30`, breaks combo
- Whiff (tap empty space): `−15`, breaks combo
- Final score = `baseScore × (0.5 + accuracy)`

Tune in [`constants/game.ts`](constants/game.ts).

## Signing flow

`useSubmitScore` builds a canonical message:

```
tapclash/v1
wallet=<base58>
season=202605
score=4287
hits=42
misses=5
dur=30000
nonce=<random hex>
```

It opens the Seed Vault via MWA `signMessages`, then POSTs `{message fields, signature}` to the server. The server reconstructs the exact same string, verifies the Ed25519 signature against the wallet pubkey, and stores best-per-wallet-per-season.

Each `(season, wallet, nonce)` is single-use, so a captured signed request cannot be replayed.

## Seasons

Season id is just `YYYYMM` computed from UTC. Clients agree on the current season without contacting the server. The `SeasonProvider` ticks down every second and rolls automatically at month boundaries.

## v2 roadmap (paid pools)

1. Anchor program with `Season`, `Entry`, `Vault` PDAs (instructions: `init_season`, `enter`, `submit_score`, `finalize_season`, `claim`).
2. Backend signer attests scores so the program trusts off-chain scoring without storing a leaderboard on-chain (cheap).
3. App: Entry button on Play tab gated by `enter` ix; Profile gains a "Claim winnings" button for past seasons.
4. Replace `LEADERBOARD_URL` stub with deployed Cloudflare Worker + KV.
