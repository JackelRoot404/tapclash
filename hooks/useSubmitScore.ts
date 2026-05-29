import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '../context/WalletContext';
import { buildScoreMessage, submitScore } from '../services/leaderboard';
import { randomNonce } from '../utils/nonce';
import { recordRound } from '../services/stats';
import { queuePendingScore, flushPendingScores } from '../services/pendingScores';

export type SubmitInput = {
  seasonId: number;
  // v2 leaderboard category (game-mode slug). Bound into the signature + bucket.
  category?: string;
  score: number;
  hits: number;
  misses: number;
  durationMs: number;
};

export type SubmitResult =
  | { status: 'idle' }
  | { status: 'signing' }
  | { status: 'submitting' }
  | { status: 'submitted'; rank?: number }
  | { status: 'offline_saved' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export function useSubmitScore() {
  const { publicKey, signMessage } = useWallet();
  const [state, setState] = useState<SubmitResult>({ status: 'idle' });

  // Flush any scores that were signed but couldn't reach the backend last time,
  // as soon as we have a wallet (covers app launch and reconnect).
  useEffect(() => {
    if (!publicKey) return;
    flushPendingScores().catch(() => {});
  }, [publicKey]);

  const submit = useCallback(
    async (input: SubmitInput, opts?: { recordLocal?: boolean }) => {
      // Save locally first so a single round can't be lost to network problems.
      // recordLocal defaults true; a re-submit of the SAME round (e.g. after the
      // player connects a wallet on the finished screen) passes false so all-time
      // stats aren't double-counted.
      if (opts?.recordLocal ?? true) await recordRound(input);

      if (!publicKey) {
        setState({ status: 'error', message: 'Connect your wallet to submit your score.' });
        return;
      }

      setState({ status: 'signing' });
      const nonce = randomNonce();
      const wallet = publicKey.toBase58();
      const accuracy = input.hits + input.misses > 0
        ? input.hits / (input.hits + input.misses)
        : 0;

      const message = buildScoreMessage({
        wallet,
        seasonId: input.seasonId,
        category: input.category,
        score: input.score,
        hits: input.hits,
        misses: input.misses,
        durationMs: input.durationMs,
        nonce,
      });

      const signResult = await signMessage(message);
      if (!signResult.ok) {
        // Distinguish a deliberate decline from a failure so the UI can offer a
        // sensible next step (retry vs reconnect).
        setState(signResult.reason === 'cancelled' ? { status: 'cancelled' } : { status: 'offline_saved' });
        return;
      }

      const payload = {
        wallet,
        seasonId: input.seasonId,
        category: input.category,
        score: input.score,
        hits: input.hits,
        misses: input.misses,
        accuracy,
        durationMs: input.durationMs,
        nonce,
        signature: Buffer.from(signResult.signature).toString('base64'),
      };

      setState({ status: 'submitting' });
      const result = await submitScore(payload);

      if (result.ok) {
        setState({ status: 'submitted', rank: result.rank });
      } else if (result.retryable) {
        // Signed and valid, just couldn't reach the backend — keep it for retry.
        await queuePendingScore(payload);
        setState({ status: 'offline_saved' });
      } else {
        setState({
          status: 'error',
          message:
            result.error === 'nonce_used'
              ? 'This score was already submitted.'
              : 'The leaderboard rejected this score.',
        });
      }
    },
    [publicKey, signMessage]
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, submit, reset };
}
