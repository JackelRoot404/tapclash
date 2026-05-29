//! TapClash v2 — paid prize pools (season escrow).
//!
//! Economic model (mirrors the app's Season screen):
//!   * An authority (the leaderboard oracle / admin) opens a season with a fixed
//!     `entry_fee` and a `payout_bps` split for the top finishers.
//!   * Players `enter` once, paying `entry_fee` into a per-season vault PDA.
//!   * The oracle `submit_score`s each player's best off-chain round (the score's
//!     authenticity is established off-chain by the signed-score backend; the
//!     oracle attests it on-chain). This makes the standings auditable.
//!   * After the month ends the oracle `finalize_season`, passing the ranked
//!     winner Entry accounts in non-increasing score order. The program records
//!     the winners and freezes the pool.
//!   * Each winner `claim`s `final_pool * payout_bps[rank] / 10000` from the
//!     vault exactly once.
//!   * `withdraw_unallocated` lets the authority reclaim the provably
//!     un-payable remainder (unfilled ranks + rounding dust) — never funds
//!     earmarked for a winner.
//!
//! Trust model: scores are off-chain, so the oracle is trusted to report them
//! honestly (same trust the signed-score leaderboard already carries). The
//! escrow guarantees no one but the recorded winners can drain the pool, no
//! double-claims, and no over-payment beyond the deposited fees.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("CZaaYuo8oNfW7XV8hxwugPw43DVHQQZ8zEoW2A2t2VwV");

pub const SEASON_SEED: &[u8] = b"season";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ENTRY_SEED: &[u8] = b"entry";

pub const MAX_WINNERS: usize = 10;
pub const BPS_DENOMINATOR: u128 = 10_000;

#[program]
pub mod tapclash_pools {
    use super::*;

    /// Open a new season. `payout_bps` is the share (basis points) for finishers
    /// 1..=N; it must be non-empty-effective (sum > 0) and sum to at most 10000.
    pub fn init_season(
        ctx: Context<InitSeason>,
        season_id: u32,
        entry_fee: u64,
        payout_bps: [u16; MAX_WINNERS],
    ) -> Result<()> {
        let sum: u32 = payout_bps.iter().map(|&b| b as u32).sum();
        require!(sum > 0 && sum <= BPS_DENOMINATOR as u32, PoolError::InvalidPayoutSplit);

        // Splits must be front-loaded: once a rank is zero, every later rank must
        // be zero too. This guarantees the count of paying ranks is a clean
        // prefix length, so finalize can require the winner set to fill exactly
        // those ranks and no winner can be recorded at a zero-bps (unclaimable)
        // rank.
        let mut seen_zero = false;
        for &b in payout_bps.iter() {
            if b == 0 {
                seen_zero = true;
            } else if seen_zero {
                return err!(PoolError::InvalidPayoutSplit);
            }
        }

        let season = &mut ctx.accounts.season;
        season.authority = ctx.accounts.authority.key();
        season.season_id = season_id;
        season.entry_fee = entry_fee;
        season.pool_total = 0;
        season.final_pool = 0;
        season.entrants = 0;
        season.num_winners = 0;
        season.finalized = false;
        season.swept = false;
        season.payout_bps = payout_bps;
        season.winners = [Pubkey::default(); MAX_WINNERS];
        season.bump = ctx.bumps.season;
        season.vault_bump = ctx.bumps.vault;

        let vault = &mut ctx.accounts.vault;
        vault.season_id = season_id;
        vault.bump = ctx.bumps.vault;

        emit!(SeasonOpened { season_id, entry_fee, authority: season.authority });
        Ok(())
    }

    /// Pay the entry fee and register for the season. One entry per wallet
    /// (the Entry PDA `init` rejects a second call).
    pub fn enter(ctx: Context<Enter>, season_id: u32) -> Result<()> {
        require!(!ctx.accounts.season.finalized, PoolError::SeasonFinalized);

        let fee = ctx.accounts.season.entry_fee;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            fee,
        )?;

        let season = &mut ctx.accounts.season;
        season.pool_total = season.pool_total.checked_add(fee).ok_or(PoolError::MathOverflow)?;
        season.entrants = season.entrants.checked_add(1).ok_or(PoolError::MathOverflow)?;

        let entry = &mut ctx.accounts.entry;
        entry.player = ctx.accounts.player.key();
        entry.season_id = season_id;
        entry.best_score = 0;
        entry.paid = true;
        entry.claimed = false;
        entry.bump = ctx.bumps.entry;

        emit!(Entered { season_id, player: entry.player, fee });
        Ok(())
    }

    /// Oracle-attested best score for a player (monotonic — keeps the max).
    /// Only the season authority may call this.
    pub fn submit_score(ctx: Context<SubmitScore>, _season_id: u32, score: u64) -> Result<()> {
        require!(!ctx.accounts.season.finalized, PoolError::SeasonFinalized);
        let entry = &mut ctx.accounts.entry;
        require!(entry.paid, PoolError::NotEntered);
        if score > entry.best_score {
            entry.best_score = score;
        }
        Ok(())
    }

    /// Freeze the pool and record the winners. The ranked winner Entry accounts
    /// are passed via `remaining_accounts` in non-increasing `best_score` order,
    /// rank 1 first. Validates each is a genuine, paid Entry PDA for this season,
    /// that the order is correct, and that there are no duplicates.
    ///
    /// Anti-rug invariant: the winner set must fill EVERY paying rank, i.e.
    /// `winners.len() == min(entrants, paying_ranks)`. This stops the authority
    /// from finalizing with too few (or zero) winners so that
    /// `withdraw_unallocated` could later sweep the players' fees. The authority
    /// is still trusted to pick the correct top players (scores are off-chain),
    /// but it cannot withhold the pool from the field.
    pub fn finalize_season<'info>(
        ctx: Context<'_, '_, 'info, 'info, FinalizeSeason<'info>>,
        season_id: u32,
    ) -> Result<()> {
        require!(!ctx.accounts.season.finalized, PoolError::AlreadyFinalized);

        let accs = ctx.remaining_accounts;
        require!(accs.len() <= MAX_WINNERS, PoolError::TooManyWinners);

        // Must distribute to all paying ranks the field can fill.
        let paying_ranks = ctx.accounts.season.payout_bps.iter().take_while(|&&b| b > 0).count();
        let required = core::cmp::min(ctx.accounts.season.entrants as usize, paying_ranks);
        require!(accs.len() == required, PoolError::IncompleteWinnerSet);

        let mut winners = [Pubkey::default(); MAX_WINNERS];
        let mut prev_score = u64::MAX;

        for (i, acc) in accs.iter().enumerate() {
            // Deserializes + checks owner == this program + discriminator.
            let entry: Account<Entry> = Account::try_from(acc)?;
            require!(entry.season_id == season_id, PoolError::SeasonMismatch);
            require!(entry.paid, PoolError::NotEntered);

            let (expected, _) = Pubkey::find_program_address(
                &[ENTRY_SEED, &season_id.to_le_bytes(), entry.player.as_ref()],
                &crate::ID,
            );
            require_keys_eq!(expected, acc.key(), PoolError::InvalidWinnerAccount);

            require!(entry.best_score <= prev_score, PoolError::WinnersNotSorted);
            prev_score = entry.best_score;

            // Reject duplicates among the winners passed so far.
            for w in winners.iter().take(i) {
                require!(*w != entry.player, PoolError::DuplicateWinner);
            }
            winners[i] = entry.player;
        }

        let season = &mut ctx.accounts.season;
        season.num_winners = accs.len() as u8;
        season.winners = winners;
        season.final_pool = season.pool_total;
        season.finalized = true;

        emit!(SeasonFinalized {
            season_id,
            num_winners: season.num_winners,
            final_pool: season.final_pool,
        });
        Ok(())
    }

    /// A recorded winner withdraws their share. Pays exactly once per Entry.
    pub fn claim(ctx: Context<Claim>, _season_id: u32) -> Result<()> {
        let season = &ctx.accounts.season;
        require!(season.finalized, PoolError::NotFinalized);

        let player = ctx.accounts.player.key();
        let rank = (0..season.num_winners as usize)
            .find(|&i| season.winners[i] == player)
            .ok_or(PoolError::NotAWinner)?;

        let amount = payout_for(season.final_pool, season.payout_bps[rank]);
        require!(amount > 0, PoolError::NothingToClaim);

        let vault_ai = ctx.accounts.vault.to_account_info();
        let player_ai = ctx.accounts.player.to_account_info();

        // Keep the vault rent-exempt — never draw below its own minimum balance.
        let vault_min = Rent::get()?.minimum_balance(vault_ai.data_len());
        let need = amount.checked_add(vault_min).ok_or(PoolError::MathOverflow)?;
        require!(vault_ai.lamports() >= need, PoolError::InsufficientVault);

        // Effects before the lamport move (no reentrancy on Solana, but tidy).
        ctx.accounts.entry.claimed = true;
        **vault_ai.try_borrow_mut_lamports()? -= amount;
        **player_ai.try_borrow_mut_lamports()? += amount;

        emit!(Claimed { season_id: ctx.accounts.entry.season_id, player, amount });
        Ok(())
    }

    /// Authority reclaims the un-payable remainder of a finalized pool: the
    /// share of ranks with no winner plus rounding dust. This can NEVER touch a
    /// winner's earmarked funds, because it only moves
    /// `final_pool - Σ payout_for(final_pool, bps[i])` over filled ranks.
    pub fn withdraw_unallocated(ctx: Context<WithdrawUnallocated>, _season_id: u32) -> Result<()> {
        let season = &ctx.accounts.season;
        require!(season.finalized, PoolError::NotFinalized);
        require!(!season.swept, PoolError::AlreadySwept);

        let mut allocated: u64 = 0;
        for i in 0..season.num_winners as usize {
            allocated = allocated
                .checked_add(payout_for(season.final_pool, season.payout_bps[i]))
                .ok_or(PoolError::MathOverflow)?;
        }
        let remainder = season.final_pool.saturating_sub(allocated);

        if remainder > 0 {
            let vault_ai = ctx.accounts.vault.to_account_info();
            let authority_ai = ctx.accounts.authority.to_account_info();
            let vault_min = Rent::get()?.minimum_balance(vault_ai.data_len());
            let need = remainder.checked_add(vault_min).ok_or(PoolError::MathOverflow)?;
            require!(vault_ai.lamports() >= need, PoolError::InsufficientVault);
            **vault_ai.try_borrow_mut_lamports()? -= remainder;
            **authority_ai.try_borrow_mut_lamports()? += remainder;
        }

        ctx.accounts.season.swept = true;
        Ok(())
    }
}

/// `pool * bps / 10000`, computed in u128 to avoid overflow, floored.
fn payout_for(pool: u64, bps: u16) -> u64 {
    ((pool as u128 * bps as u128) / BPS_DENOMINATOR) as u64
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Season {
    pub authority: Pubkey,
    pub season_id: u32,
    pub entry_fee: u64,
    pub pool_total: u64,
    pub final_pool: u64,
    pub entrants: u32,
    pub num_winners: u8,
    pub finalized: bool,
    pub swept: bool,
    pub payout_bps: [u16; MAX_WINNERS],
    pub winners: [Pubkey; MAX_WINNERS],
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub season_id: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub player: Pubkey,
    pub season_id: u32,
    pub best_score: u64,
    pub paid: bool,
    pub claimed: bool,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct InitSeason<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump
    )]
    pub season: Account<'info, Season>,
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, &season_id.to_le_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct Enter<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &season_id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = player,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, &season_id.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub entry: Account<'info, Entry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct SubmitScore<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump,
        has_one = authority @ PoolError::Unauthorized
    )]
    pub season: Account<'info, Season>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &season_id.to_le_bytes(), entry.player.as_ref()],
        bump = entry.bump,
        constraint = entry.season_id == season_id @ PoolError::SeasonMismatch
    )]
    pub entry: Account<'info, Entry>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct FinalizeSeason<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump,
        has_one = authority @ PoolError::Unauthorized
    )]
    pub season: Account<'info, Season>,
    // Winner Entry accounts are supplied as `remaining_accounts`.
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct Claim<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &season_id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &season_id.to_le_bytes(), player.key().as_ref()],
        bump = entry.bump,
        has_one = player @ PoolError::NotAWinner,
        constraint = !entry.claimed @ PoolError::AlreadyClaimed
    )]
    pub entry: Account<'info, Entry>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct WithdrawUnallocated<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump,
        has_one = authority @ PoolError::Unauthorized
    )]
    pub season: Account<'info, Season>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &season_id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct SeasonOpened {
    pub season_id: u32,
    pub entry_fee: u64,
    pub authority: Pubkey,
}

#[event]
pub struct Entered {
    pub season_id: u32,
    pub player: Pubkey,
    pub fee: u64,
}

#[event]
pub struct SeasonFinalized {
    pub season_id: u32,
    pub num_winners: u8,
    pub final_pool: u64,
}

#[event]
pub struct Claimed {
    pub season_id: u32,
    pub player: Pubkey,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum PoolError {
    #[msg("payout split must be > 0 and sum to at most 10000 bps")]
    InvalidPayoutSplit,
    #[msg("season is already finalized")]
    SeasonFinalized,
    #[msg("season is already finalized")]
    AlreadyFinalized,
    #[msg("season is not finalized yet")]
    NotFinalized,
    #[msg("player has not entered this season")]
    NotEntered,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("entry does not belong to this season")]
    SeasonMismatch,
    #[msg("too many winners (max 10)")]
    TooManyWinners,
    #[msg("winners must be passed in non-increasing score order")]
    WinnersNotSorted,
    #[msg("duplicate winner account")]
    DuplicateWinner,
    #[msg("invalid winner account")]
    InvalidWinnerAccount,
    #[msg("already claimed")]
    AlreadyClaimed,
    #[msg("caller is not a winner of this season")]
    NotAWinner,
    #[msg("nothing to claim for this rank")]
    NothingToClaim,
    #[msg("vault has insufficient balance")]
    InsufficientVault,
    #[msg("unallocated funds already swept")]
    AlreadySwept,
    #[msg("only the season authority may perform this action")]
    Unauthorized,
    #[msg("winner set must fill every paying rank: min(entrants, payout ranks)")]
    IncompleteWinnerSet,
}
