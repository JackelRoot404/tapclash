import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tapclash_local_stats_v1';

export type LocalStats = {
  bestScore: number;
  totalRounds: number;
  totalHits: number;
  totalMisses: number;
  lastSeasonId: number | null;
};

const empty = (): LocalStats => ({
  bestScore: 0,
  totalRounds: 0,
  totalHits: 0,
  totalMisses: 0,
  lastSeasonId: null,
});

export async function getLocalStats(): Promise<LocalStats> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

export async function recordRound(input: {
  seasonId: number;
  score: number;
  hits: number;
  misses: number;
}): Promise<LocalStats> {
  const cur = await getLocalStats();
  // Reset bestScore when entering a new season — bestScore is per-season.
  const sameSeason = cur.lastSeasonId === input.seasonId;
  const next: LocalStats = {
    bestScore: sameSeason ? Math.max(cur.bestScore, input.score) : input.score,
    totalRounds: cur.totalRounds + 1,
    totalHits: cur.totalHits + input.hits,
    totalMisses: cur.totalMisses + input.misses,
    lastSeasonId: input.seasonId,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
