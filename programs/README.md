# tapclash_pools — v2 paid-pool season escrow

Anchor program (Anchor 0.32.1) backing TapClash's v2 paid prize pools. **SP2 /
second-release** work — the MVP ships score-only without it.

- **Program id:** `CZaaYuo8oNfW7XV8hxwugPw43DVHQQZ8zEoW2A2t2VwV`
- **Devnet:** deployed (upgradeable; upgrade authority = the deploying wallet).
- **TS client:** `../sdk` (`@tapclash/pools-sdk`).

This Anchor workspace IS the `programs/` dir (Agent B's lane), so the crate lives
at `./tapclash_pools` and `Anchor.toml [workspace] members` points there instead
of the default `./programs/<name>`.

## Model

| account  | seeds                                       | role                                   |
|----------|---------------------------------------------|----------------------------------------|
| `Season` | `["season", u32_le(season_id)]`             | config, pool totals, winners, flags    |
| `Vault`  | `["vault",  u32_le(season_id)]`             | program-owned escrow holding the SOL   |
| `Entry`  | `["entry",  u32_le(season_id), player]`     | per-player: paid, best_score, claimed  |

Instructions: `init_season`, `enter`, `submit_score`, `finalize_season`,
`claim`, `withdraw_unallocated`. Scores are off-chain; the season **authority**
(the leaderboard oracle) attests them on-chain via `submit_score` and freezes the
ranked winners at `finalize_season`. Payout per winner =
`final_pool * payout_bps[rank] / 10000` (checked u128 math, floored). The escrow
guarantees: only recorded winners can draw the pool, exactly once each; total
payouts never exceed deposits; the vault never drops below rent-exemption;
`withdraw_unallocated` reclaims only the provably un-payable remainder.

### Anti-rug invariants (hardened after the security audit)

- **Payout splits are front-loaded** — once a rank is 0 bps, every later rank
  must be 0. So the paying-rank count is a clean prefix and no winner is ever
  recorded at an unclaimable (0-bps) rank.
- **Finalize must fill every paying rank** —
  `winners.len() == min(entrants, paying_ranks)`. The authority cannot finalize
  with too few (or zero) winners and then sweep the field's fees via
  `withdraw_unallocated`; that sweep can only ever reclaim the share of ranks no
  entrant exists to fill, plus rounding dust.

### Trust model & known limitations

Scores are computed and signature-verified off-chain (by the leaderboard
backend), so the authority is **trusted to report the correct top players** — the
program can validate ordering, paid-entry, and full distribution, but not that
the named winners are the true high scorers (that would require on-chain scoring).
Deferred hardening (tracked, not yet implemented): an `ends_at` time gate so the
authority cannot `finalize` before the season actually ends. Until then, finalize
timing is at the authority's discretion.

## Build / test / deploy

```bash
# Build (.so + IDL). Needs ~/.cargo/env + solana bins on PATH.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
source ~/.cargo/env
anchor build                       # → target/deploy/tapclash_pools.so, target/idl/...

# Tests live in ../sdk (LiteSVM, fast, no validator) and exercise the built .so:
cd ../sdk && npm test

# Deploy to DEVNET (allowed, routine):
solana program deploy --url devnet \
  --keypair ~/.config/solana/devnet-wallet.json \
  --program-id target/deploy/tapclash_pools-keypair.json \
  target/deploy/tapclash_pools.so

# After rebuilding, refresh the SDK's IDL copy:
cd ../sdk && npm run sync-idl
```

> Mainnet deploy is a GUARDRAIL — do not run it autonomously. The program is
> devnet-only until the user funds + triggers a mainnet deploy.
