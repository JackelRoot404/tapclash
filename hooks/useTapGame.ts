import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ROUND_MS,
  TARGET_EDGE_PADDING,
  PERFECT_WINDOW_MS,
  COMBO_STEP_BONUS,
  COMBO_MAX_BONUS,
  ACCURACY_MIN_MULT,
  ACCURACY_RANGE,
  MAX_SCORE,
  BOMB_TAP_PENALTY,
  MODES,
  TARGET_KINDS,
  pickKind,
  type GameMode,
  type TargetKind,
} from '../constants/game';

export type Target = {
  id: number;
  x: number;
  y: number;
  bornAt: number;
  kind: TargetKind;
  lifetimeMs: number;
};

export type GamePhase = 'idle' | 'countdown' | 'running' | 'finished';

// Why a finished round ended. 'time' = the 30s buzzer; 'miss'/'bomb' = a
// Sudden-Death stop. Drives the game-over copy + the Sudden-Death end feedback.
export type FinishReason = 'time' | 'miss' | 'bomb';

type State = {
  phase: GamePhase;
  mode: GameMode;
  reason: FinishReason | null;
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
  mode: 'classic',
  reason: null,
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
  | { type: 'start_countdown'; mode: GameMode }
  | { type: 'tick_countdown' }
  | { type: 'tick_time'; deltaMs: number }
  | { type: 'spawn'; t: Target }
  | { type: 'expire'; id: number }
  | { type: 'hit'; id: number; now: number }
  | { type: 'whiff' }
  | { type: 'finish' };

// End the round. Only the natural buzzer ('time') folds still-on-screen good
// targets into misses (anti-stall — you can't dodge accuracy by stalling out the
// last second). A Sudden-Death stop ('miss'/'bomb') ends on the triggering event
// alone: the remaining targets weren't "missed", the round just ended. Not
// folding them also keeps the *signed* final score deterministic — otherwise a
// tap landing in the same 50ms frame as the round-ending expire could be folded
// into misses or not depending on dispatch order.
function finishState(s: State, reason: FinishReason): State {
  const pendingMisses = reason === 'time' ? s.targets.filter((t) => !TARGET_KINDS[t.kind].isPenalty).length : 0;
  return {
    ...s,
    phase: 'finished',
    reason,
    misses: s.misses + pendingMisses,
    combo: 0,
    targets: [],
    timeLeftMs: 0,
  };
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'reset':
      return { ...initial };
    case 'start_countdown':
      return { ...initial, mode: a.mode, phase: 'countdown', countdown: 3 };
    case 'tick_countdown':
      if (s.countdown <= 1) return { ...s, phase: 'running', countdown: 0, timeLeftMs: ROUND_MS };
      return { ...s, countdown: s.countdown - 1 };
    case 'tick_time':
      return { ...s, timeLeftMs: Math.max(0, s.timeLeftMs - a.deltaMs) };
    case 'spawn':
      return { ...s, targets: [...s.targets, a.t], nextId: s.nextId + 1 };
    case 'expire': {
      if (s.phase !== 'running') return s;
      const target = s.targets.find((t) => t.id === a.id);
      if (!target) return s;
      const kind = TARGET_KINDS[target.kind];
      const without = s.targets.filter((t) => t.id !== a.id);
      // A bomb left to expire is correct play — no miss, no penalty.
      if (kind.isPenalty) return { ...s, targets: without };
      const mode = MODES[s.mode];
      const missed: State = {
        ...s,
        targets: without,
        misses: s.misses + 1,
        combo: 0,
        baseScore: Math.max(0, s.baseScore - mode.missPenalty),
      };
      return mode.suddenDeath ? finishState(missed, 'miss') : missed;
    }
    case 'hit': {
      if (s.phase !== 'running') return s;
      const target = s.targets.find((t) => t.id === a.id);
      if (!target) return s;
      const kind = TARGET_KINDS[target.kind];
      const mode = MODES[s.mode];
      const without = s.targets.filter((t) => t.id !== a.id);

      // Bomb: a mistake. Lose points, break combo, don't touch accuracy. Ends
      // the round in Sudden Death.
      if (kind.isPenalty) {
        const hit: State = {
          ...s,
          targets: without,
          baseScore: Math.max(0, s.baseScore - BOMB_TAP_PENALTY),
          combo: 0,
        };
        return mode.suddenDeath ? finishState(hit, 'bomb') : hit;
      }

      const age = a.now - target.bornAt;
      const perfect = age <= PERFECT_WINDOW_MS;
      const nextCombo = s.combo + 1;
      const comboBonus = Math.min(COMBO_MAX_BONUS, nextCombo * COMBO_STEP_BONUS);
      const gained = kind.points + (perfect ? mode.perfectBonus : 0) + comboBonus;
      return {
        ...s,
        targets: without,
        baseScore: s.baseScore + gained,
        hits: s.hits + 1,
        combo: nextCombo,
        bestCombo: Math.max(s.bestCombo, nextCombo),
      };
    }
    case 'whiff':
      // Tapping empty space: lose combo + a little score. Guard on phase so a tap
      // landing just as the round ends can't mutate the already-measured score.
      // Not lethal in Sudden Death (only a real miss or bomb tap ends it).
      if (s.phase !== 'running') return s;
      return {
        ...s,
        combo: 0,
        baseScore: Math.max(0, s.baseScore - Math.floor(MODES[s.mode].missPenalty / 2)),
      };
    case 'finish':
      return finishState(s, 'time');
  }
}

function currentSpawnIntervalMs(mode: GameMode, timeLeftMs: number): number {
  const m = MODES[mode];
  const progress = 1 - timeLeftMs / ROUND_MS;
  return m.spawnStartMs + (m.spawnEndMs - m.spawnStartMs) * progress;
}

export function finalScore(state: { baseScore: number; hits: number; misses: number }): number {
  const total = state.hits + state.misses;
  const accuracy = total > 0 ? state.hits / total : 0;
  const mult = ACCURACY_MIN_MULT + ACCURACY_RANGE * accuracy;
  // Clamp to the frozen-contract ceiling so no mode/target mix can exceed it.
  return Math.min(MAX_SCORE, Math.max(0, Math.round(state.baseScore * mult)));
}

export function useTapGame(arenaW: number, arenaH: number, mode: GameMode) {
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
      const activeMode = cur.mode;

      dispatch({ type: 'tick_time', deltaMs: TICK_MS });

      // Expire any targets that aged past their own lifetime.
      for (const target of cur.targets) {
        if (now - target.bornAt >= target.lifetimeMs) {
          dispatch({ type: 'expire', id: target.id });
        }
      }

      // Spawn cadence ramps as the round progresses.
      const spawnGap = currentSpawnIntervalMs(activeMode, cur.timeLeftMs);
      if (now - lastSpawn >= spawnGap && arena.w > 0 && arena.h > 0) {
        lastSpawn = now;
        const kind = pickKind(MODES[activeMode], Math.random());
        const radius = TARGET_KINDS[kind].radius;
        const lifetimeMs = Math.round(MODES[activeMode].baseLifetimeMs * TARGET_KINDS[kind].lifetimeMult);
        const xRange = Math.max(0, arena.w - 2 * (TARGET_EDGE_PADDING + radius));
        const yRange = Math.max(0, arena.h - 2 * (TARGET_EDGE_PADDING + radius));
        const x = TARGET_EDGE_PADDING + radius + Math.random() * xRange;
        const y = TARGET_EDGE_PADDING + radius + Math.random() * yRange;
        dispatch({ type: 'spawn', t: { id: cur.nextId, x, y, bornAt: now, kind, lifetimeMs } });
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

  const start = useCallback(() => dispatch({ type: 'start_countdown', mode }), [mode]);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const hit = useCallback((id: number) => dispatch({ type: 'hit', id, now: Date.now() }), []);
  const whiff = useCallback(() => dispatch({ type: 'whiff' }), []);

  return { state, start, reset, hit, whiff, finalScore: finalScore(state) };
}
