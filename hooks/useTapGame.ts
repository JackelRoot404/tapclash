import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ROUND_MS,
  TARGET_LIFETIME_MS,
  SPAWN_INTERVAL_START_MS,
  SPAWN_INTERVAL_END_MS,
  TARGET_RADIUS,
  TARGET_EDGE_PADDING,
  HIT_POINTS,
  PERFECT_BONUS,
  PERFECT_WINDOW_MS,
  MISS_PENALTY,
  COMBO_STEP_BONUS,
  COMBO_MAX_BONUS,
  ACCURACY_MIN_MULT,
  ACCURACY_RANGE,
} from '../constants/game';

export type Target = {
  id: number;
  x: number;
  y: number;
  bornAt: number;
};

export type GamePhase = 'idle' | 'countdown' | 'running' | 'finished';

type State = {
  phase: GamePhase;
  countdown: number;
  timeLeftMs: number;
  baseScore: number;
  hits: number;
  misses: number;
  combo: number;
  bestCombo: number;
  targets: Target[];
  nextId: number;
};

const initial: State = {
  phase: 'idle',
  countdown: 3,
  timeLeftMs: ROUND_MS,
  baseScore: 0,
  hits: 0,
  misses: 0,
  combo: 0,
  bestCombo: 0,
  targets: [],
  nextId: 1,
};

type Action =
  | { type: 'reset' }
  | { type: 'start_countdown' }
  | { type: 'tick_countdown' }
  | { type: 'tick_time'; deltaMs: number }
  | { type: 'spawn'; t: Target }
  | { type: 'expire'; id: number }
  | { type: 'hit'; id: number; now: number }
  | { type: 'whiff' }
  | { type: 'finish' };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'reset':
      return { ...initial };
    case 'start_countdown':
      return { ...initial, phase: 'countdown', countdown: 3 };
    case 'tick_countdown':
      if (s.countdown <= 1) return { ...s, phase: 'running', countdown: 0, timeLeftMs: ROUND_MS };
      return { ...s, countdown: s.countdown - 1 };
    case 'tick_time':
      return { ...s, timeLeftMs: Math.max(0, s.timeLeftMs - a.deltaMs) };
    case 'spawn':
      return { ...s, targets: [...s.targets, a.t], nextId: s.nextId + 1 };
    case 'expire':
      if (!s.targets.find((t) => t.id === a.id)) return s;
      return {
        ...s,
        targets: s.targets.filter((t) => t.id !== a.id),
        misses: s.misses + 1,
        combo: 0,
        baseScore: Math.max(0, s.baseScore - MISS_PENALTY),
      };
    case 'hit': {
      const target = s.targets.find((t) => t.id === a.id);
      if (!target) return s;
      const age = a.now - target.bornAt;
      const perfect = age <= PERFECT_WINDOW_MS;
      const nextCombo = s.combo + 1;
      const comboBonus = Math.min(COMBO_MAX_BONUS, nextCombo * COMBO_STEP_BONUS);
      const gained = HIT_POINTS + (perfect ? PERFECT_BONUS : 0) + comboBonus;
      return {
        ...s,
        targets: s.targets.filter((t) => t.id !== a.id),
        baseScore: s.baseScore + gained,
        hits: s.hits + 1,
        combo: nextCombo,
        bestCombo: Math.max(s.bestCombo, nextCombo),
      };
    }
    case 'whiff':
      return {
        ...s,
        combo: 0,
        baseScore: Math.max(0, s.baseScore - Math.floor(MISS_PENALTY / 2)),
      };
    case 'finish':
      // Targets still on screen at the buzzer were presented but not hit — count
      // them as misses so accuracy (and the signed final score) reflect the full
      // round. Otherwise stalling in the last ~1s would inflate the score.
      return {
        ...s,
        phase: 'finished',
        misses: s.misses + s.targets.length,
        combo: 0,
        targets: [],
        timeLeftMs: 0,
      };
  }
}

function currentSpawnIntervalMs(timeLeftMs: number): number {
  const progress = 1 - timeLeftMs / ROUND_MS;
  return SPAWN_INTERVAL_START_MS + (SPAWN_INTERVAL_END_MS - SPAWN_INTERVAL_START_MS) * progress;
}

export function finalScore(state: { baseScore: number; hits: number; misses: number }): number {
  const total = state.hits + state.misses;
  const accuracy = total > 0 ? state.hits / total : 0;
  const mult = ACCURACY_MIN_MULT + ACCURACY_RANGE * accuracy;
  return Math.round(state.baseScore * mult);
}

export function useTapGame(arenaW: number, arenaH: number) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Refs let the game-loop effect read fresh values without recreating the loop
  // every render. Without these the spawn gap + id would be frozen at first tick.
  const stateRef = useRef(state);
  stateRef.current = state;
  const arenaRef = useRef({ w: arenaW, h: arenaH });
  arenaRef.current = { w: arenaW, h: arenaH };

  useEffect(() => {
    if (state.phase !== 'countdown') return;
    const t = setTimeout(() => dispatch({ type: 'tick_countdown' }), 800);
    return () => clearTimeout(t);
  }, [state.phase, state.countdown]);

  // Single 50ms tick: advance time, spawn targets, expire stale ones.
  // Reads via refs so we don't restart on every state change.
  useEffect(() => {
    if (state.phase !== 'running') return;
    if (arenaW <= 0 || arenaH <= 0) return;

    const TICK_MS = 50;
    let lastSpawn = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const cur = stateRef.current;
      const arena = arenaRef.current;

      dispatch({ type: 'tick_time', deltaMs: TICK_MS });

      // Expire any targets that aged past their lifetime.
      for (const target of cur.targets) {
        if (now - target.bornAt >= TARGET_LIFETIME_MS) {
          dispatch({ type: 'expire', id: target.id });
        }
      }

      // Spawn cadence ramps as the round progresses.
      const spawnGap = currentSpawnIntervalMs(cur.timeLeftMs);
      if (now - lastSpawn >= spawnGap && arena.w > 0 && arena.h > 0) {
        lastSpawn = now;
        const xRange = Math.max(0, arena.w - 2 * (TARGET_EDGE_PADDING + TARGET_RADIUS));
        const yRange = Math.max(0, arena.h - 2 * (TARGET_EDGE_PADDING + TARGET_RADIUS));
        const x = TARGET_EDGE_PADDING + TARGET_RADIUS + Math.random() * xRange;
        const y = TARGET_EDGE_PADDING + TARGET_RADIUS + Math.random() * yRange;
        dispatch({ type: 'spawn', t: { id: cur.nextId, x, y, bornAt: now } });
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  // Intentionally only re-create when phase or arena dimensions change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, arenaW, arenaH]);

  useEffect(() => {
    if (state.phase === 'running' && state.timeLeftMs <= 0) {
      dispatch({ type: 'finish' });
    }
  }, [state.phase, state.timeLeftMs]);

  const start = useCallback(() => dispatch({ type: 'start_countdown' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const hit = useCallback((id: number) => dispatch({ type: 'hit', id, now: Date.now() }), []);
  const whiff = useCallback(() => dispatch({ type: 'whiff' }), []);

  return { state, start, reset, hit, whiff, finalScore: finalScore(state) };
}
