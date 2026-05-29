// Persistent queue for fully-signed score submissions whose POST failed for a
// transient reason (offline / backend down). A signed score is valuable — the
// user already approved it in their wallet — so we keep it and retry on the
// next launch / wallet connect instead of silently dropping it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SubmitPayload, submitScore } from './leaderboard';

const PENDING_KEY = 'tapclash_pending_scores';
const MAX_PENDING = 50; // bound storage; oldest dropped beyond this.

export async function getPendingScores(): Promise<SubmitPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function queuePendingScore(payload: SubmitPayload): Promise<void> {
  const pending = await getPendingScores();
  pending.push(payload);
  // Drop oldest if we exceed the cap.
  const trimmed = pending.slice(-MAX_PENDING);
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(trimmed));
}

// Try to submit every queued score. Keeps only the ones that fail for a
// retryable reason; drops permanently-rejected ones (bad/duplicate) so the
// queue can't grow forever. Returns the number successfully flushed.
export async function flushPendingScores(): Promise<number> {
  const pending = await getPendingScores();
  if (pending.length === 0) return 0;

  const stillPending: SubmitPayload[] = [];
  let flushed = 0;
  for (const payload of pending) {
    const res = await submitScore(payload);
    if (res.ok) {
      flushed += 1;
    } else if (res.retryable) {
      stillPending.push(payload);
    }
    // non-retryable failure → drop it (already counted, or permanently invalid).
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(stillPending));
  return flushed;
}
