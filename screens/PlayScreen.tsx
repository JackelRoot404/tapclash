import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { COLORS } from '../constants/config';
import { useTapGame, finalScore } from '../hooks/useTapGame';
import { TargetView } from '../components/Target';
import { Hud } from '../components/Hud';
import { Button } from '../components/Button';
import { useSeason } from '../context/SeasonContext';
import { useWallet } from '../context/WalletContext';
import { useSubmitScore, SubmitResult } from '../hooks/useSubmitScore';
import { ROUND_MS } from '../constants/game';

export default function PlayScreen() {
  const [arena, setArena] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const game = useTapGame(arena.w, arena.h);
  const { season } = useSeason();
  const { connected, connect, connecting, error: walletError } = useWallet();
  const submit = useSubmitScore();
  const [submittedFor, setSubmittedFor] = useState<number | null>(null);

  const onArenaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArena({ w: width, h: height });
  };

  const submitRound = () =>
    submit.submit({
      seasonId: season.id,
      score: finalScore(game.state),
      hits: game.state.hits,
      misses: game.state.misses,
      durationMs: ROUND_MS,
    });

  // Auto-submit best-effort once the round ends (records locally even if no wallet).
  useEffect(() => {
    if (game.state.phase !== 'finished') return;
    if (submittedFor === season.id && submit.state.status !== 'idle') return;
    setSubmittedFor(season.id);
    submitRound();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.state.phase]);

  // If the user connects (or reconnects) on the finished screen after the first
  // attempt couldn't submit, send the score now — otherwise the connect button
  // is a dead end and the score never reaches the leaderboard.
  useEffect(() => {
    if (game.state.phase !== 'finished' || !connected) return;
    if (submit.state.status !== 'error' && submit.state.status !== 'cancelled') return;
    submitRound();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const onHit = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    game.hit(id);
  };

  const onArenaPress = () => {
    if (game.state.phase === 'running') game.whiff();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>TapClash</Text>
          <Text style={styles.subtitle}>{season.label} season</Text>
        </View>
      </View>

      <View style={styles.hudWrap}>
        <Hud timeLeftMs={game.state.timeLeftMs} score={game.state.baseScore} combo={game.state.combo} />
      </View>

      <Pressable onPress={onArenaPress} style={styles.arenaWrap} onLayout={onArenaLayout}>
        {/* Targets are absolutely positioned within the arena */}
        {game.state.phase === 'running' &&
          game.state.targets.map((t) => (
            <TargetView key={t.id} x={t.x} y={t.y} onHit={() => onHit(t.id)} />
          ))}

        {game.state.phase === 'idle' && (
          <Overlay>
            <Text style={styles.bigText}>Ready?</Text>
            <Text style={styles.body}>Tap the green dots before they vanish. 30 seconds. Big combos = big scores.</Text>
            <Button label="Start round" onPress={game.start} style={{ marginTop: 24, minWidth: 220 }} />
          </Overlay>
        )}

        {game.state.phase === 'countdown' && (
          <Overlay>
            <Text style={styles.countdown}>{game.state.countdown}</Text>
          </Overlay>
        )}

        {game.state.phase === 'finished' && (
          <Overlay>
            <Text style={styles.label}>FINAL SCORE</Text>
            <Text style={styles.finalScore}>{game.finalScore}</Text>
            <Text style={styles.body}>
              {game.state.hits} hits · {game.state.misses} misses · best combo {game.state.bestCombo}x
            </Text>

            <SubmitBanner state={submit.state} />

            {!connected && submit.state.status !== 'submitted' && (
              <Button
                label={connecting ? 'Opening Seed Vault…' : 'Connect wallet to submit'}
                onPress={connect}
                loading={connecting}
                style={{ marginTop: 12, minWidth: 240 }}
              />
            )}

            {connected && (submit.state.status === 'cancelled' || submit.state.status === 'offline_saved') && (
              <Button
                label="Retry submit"
                onPress={submitRound}
                style={{ marginTop: 12, minWidth: 240 }}
              />
            )}

            {walletError && <Text style={styles.errorNote}>{walletError}</Text>}

            <Button
              label="Play again"
              variant="secondary"
              onPress={() => {
                submit.reset();
                setSubmittedFor(null);
                game.reset();
              }}
              style={{ marginTop: 16, minWidth: 220 }}
            />
          </Overlay>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <View style={styles.overlay}>{children}</View>;
}

function SubmitBanner({ state }: { state: SubmitResult }) {
  if (state.status === 'idle') return null;
  let text: string;
  let color: string;
  switch (state.status) {
    case 'signing':
      text = 'Sign in your wallet…';
      color = COLORS.warn;
      break;
    case 'submitting':
      text = 'Submitting score…';
      color = COLORS.warn;
      break;
    case 'submitted':
      text = state.rank ? `Submitted! Season rank #${state.rank}` : 'Submitted!';
      color = COLORS.accent;
      break;
    case 'offline_saved':
      text = 'Saved — we’ll submit it when you’re back online.';
      color = COLORS.textDim;
      break;
    case 'cancelled':
      text = 'Signing cancelled — retry to submit your score.';
      color = COLORS.textDim;
      break;
    case 'error':
      text = state.message;
      color = COLORS.danger;
      break;
    default:
      return null;
  }
  return (
    <View style={[styles.banner, { borderColor: color }]}>
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 8, paddingBottom: 8 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', letterSpacing: 0.5 },
  subtitle: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  hudWrap: { paddingVertical: 6 },
  arenaWrap: {
    flex: 1,
    backgroundColor: COLORS.bgElev,
    borderRadius: 24,
    marginTop: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bigText: { color: COLORS.text, fontSize: 36, fontWeight: '800', marginBottom: 8 },
  body: { color: COLORS.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 320, marginTop: 4 },
  countdown: { color: COLORS.accent, fontSize: 120, fontWeight: '800' },
  label: { color: COLORS.textDim, fontSize: 12, letterSpacing: 1.5, fontWeight: '700' },
  finalScore: { color: COLORS.accent, fontSize: 72, fontWeight: '800', marginVertical: 4 },
  banner: { marginTop: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  bannerText: { fontSize: 13, fontWeight: '600' },
  errorNote: { color: COLORS.danger, fontSize: 12, marginTop: 10, textAlign: 'center', maxWidth: 300 },
});
