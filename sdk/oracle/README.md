# TapClash v2 oracle

The off-chain operator tool that bridges the signed-score leaderboard to the
on-chain pool program. Scores are computed + signature-verified off-chain, so a
trusted **authority** must attest the final standings on-chain. This CLI is that
authority. It signs with the season authority keypair (the wallet that called
`init_season`).

Run with `tsx` (installed as a dev dep) from the `sdk/` dir:

```bash
# Open a paid season (admin). Default split = DEFAULT_PAYOUT_BPS.
npx tsx oracle/oracle.ts init-season --season 202606 --fee 0.05

# Inspect a season (config, pool, entrants, winners, payouts).
npx tsx oracle/oracle.ts status --season 202606

# At season end: rank paid entrants by their off-chain score, attest the top-N
# on-chain (submit_score), then finalize. --dry-run prints the plan only.
npx tsx oracle/oracle.ts finalize --season 202606 --dry-run
npx tsx oracle/oracle.ts finalize --season 202606
```

Flags (all optional unless noted):

| flag | default | notes |
|------|---------|-------|
| `--season <id>` | — (required) | YYYYMM season id |
| `--fee <SOL>` | — (init only) | entry fee in SOL |
| `--bps a,b,...` | `DEFAULT_PAYOUT_BPS` | payout split, front-loaded, sum ≤ 10000 |
| `--url <c>` | `devnet` | `devnet`/`mainnet`/`localnet`/custom RPC |
| `--keypair <p>` | `~/.config/solana/devnet-wallet.json` | authority signer |
| `--leaderboard <u>` | deployed Worker | score source for `finalize` |
| `--yes-mainnet` | off | **required** to touch mainnet (spends real SOL) |

## How `finalize` works

1. Read the on-chain `Season` (must not be finalized) and all paid `Entry` PDAs
   for the season (`getProgramAccounts`, `dataSize` 55).
2. Fetch the off-chain `GET /leaderboard/:season` (score-desc) and keep only
   wallets that actually paid. Paid entrants with no off-chain score rank last at
   score 0, so the winner set can still fill every paying rank the field supports.
3. Take the top `min(entrants, paying_ranks)` as winners (matches the program's
   `IncompleteWinnerSet` invariant).
4. `submit_score` each winner's best on-chain (chunked, monotonic), then
   `finalize_season` with the ranked winners. Winners then `claim` via the app.

Network calls retry with backoff (public devnet RPC is flaky).

## Validation

`oracle/e2e-devnet.ts` runs the whole v2 path against devnet + the live Worker
(init → fund → enter → signed score → oracle finalize → claim, asserting exact
payouts). It's a manual integration script (spends devnet SOL), not a unit test:

```bash
npx tsx oracle/e2e-devnet.ts
```

## Trust / guardrails

- The authority is trusted to report the true top players (off-chain scoring) —
  the program enforces ordering, paid-entry, and full distribution, but not the
  selection. See `programs/README.md` → "Trust model".
- Mainnet is guardrailed: `--yes-mainnet` is required and it spends real SOL.
  For mainnet the authority should be a dedicated key, not a personal wallet.
