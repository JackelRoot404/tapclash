# @tapclash/pools-sdk — v2 paid-pools client

RN-safe TypeScript client for the `tapclash_pools` Anchor program. Pure
`@solana/web3.js` v1 instruction builders + PDA helpers + account decoders — **no
Anchor runtime / Provider / Wallet dependency**, so it composes with Mobile
Wallet Adapter signing in the app. (This is **second-release / SP2** work — the
MVP ships without paid pools.)

- **Program (devnet):** `CZaaYuo8oNfW7XV8hxwugPw43DVHQQZ8zEoW2A2t2VwV`
- **IDL:** `idl/tapclash_pools.json` (kept in sync with `programs/`; run
  `npm run sync-idl` after a program rebuild)
- Import from `../sdk/src` (Metro transpiles the TS), or build to JS if preferred.

## Economic model

Authority (the leaderboard oracle/admin) opens a season with an `entry_fee` and a
`payout_bps` split. Players pay the fee to a per-season vault. The oracle attests
each player's best score on-chain, then finalizes the ranked winners. Winners
claim `final_pool * payout_bps[rank] / 10000`. The split defaults to
`utils/season.ts → PAYOUT_SPLIT_BPS` (`[4000,2000,1200,800,500,400,300,300,300,200]`,
sums to 10000 = 100%).

## PDA derivations (all helpers exported)

| PDA      | seeds                                                   | helper                         |
|----------|---------------------------------------------------------|--------------------------------|
| `season` | `["season", u32_le(seasonId)]`                          | `seasonPda(seasonId)`          |
| `vault`  | `["vault",  u32_le(seasonId)]`                          | `vaultPda(seasonId)`           |
| `entry`  | `["entry",  u32_le(seasonId), player.toBuffer()]`       | `entryPda(seasonId, player)`   |

`seasonId` is the app's `YYYYMM` integer (fits `u32`). Each returns
`[PublicKey, bump]`; `*Address(...)` variants return just the `PublicKey`.

## Instruction builders → `TransactionInstruction`

Each accepts an optional trailing `programId` (defaults to the deployed id).

```ts
initSeasonIx({ authority, seasonId, entryFee, payoutBps })   // admin: open season + vault
enterIx({ player, seasonId })                                // player pays entryFee, registers (once)
submitScoreIx({ authority, seasonId, player, score })        // oracle attests best score (monotonic)
finalizeSeasonIx({ authority, seasonId, winners })           // admin: winners = player pubkeys, rank order (desc score)
claimIx({ player, seasonId })                                // winner withdraws their bps share (once)
withdrawUnallocatedIx({ authority, seasonId })               // admin: reclaim un-payable remainder (once)
```

`entryFee` and `score` accept `bigint | number` (lamports / raw score).
`payoutBps` is up to 10 entries summing to ≤ 10000 (padded to a fixed `[u16;10]`).
For `finalizeSeasonIx`, pass winner **player** pubkeys in rank order — the SDK
derives and appends their Entry PDAs as the program's remaining accounts.

### App usage (Play "Enter" button, Profile "Claim" button)

```ts
import { Transaction } from '@solana/web3.js';
import { enterIx } from '../sdk/src';

const ix = enterIx({ player: publicKey, seasonId: season.id });
const tx = new Transaction().add(ix);
tx.feePayer = publicKey;
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
// sign + send via MWA: wallet.signAndSendTransactions({ transactions: [tx] })
```

`enter`, `claim` are **player-signed**; `initSeason`, `submitScore`,
`finalizeSeason`, `withdrawUnallocated` are **authority-signed** (the off-chain
oracle/admin, not the app user).

## Reading on-chain state

```ts
import { decodeSeason, decodeEntry, decodeVault, payoutFor } from '../sdk/src';

const season = decodeSeason(accountInfo.data);   // { finalized, finalPool, winners, payoutBps, ... }
const entry  = decodeEntry(accountInfo.data);     // { bestScore, paid, claimed, ... }
// Pending claim for a winner at rank r:
const owed = payoutFor(season.finalPool, season.payoutBps[r]); // bigint lamports
```

`decode*` validate the 8-byte account discriminator and throw on mismatch.
u64 fields (`entryFee`, `poolTotal`, `finalPool`, `bestScore`) are `bigint`.

## Tests

```bash
npm test    # 8 LiteSVM integration tests: full lifecycle (exact pool
            # distribution) + every security guard, run against the compiled .so
```
