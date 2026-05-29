import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/config';
import { useSeason } from '../context/SeasonContext';
import { formatCountdown, PAYOUT_SPLIT_BPS } from '../utils/season';
import { usePoolSeason } from '../hooks/usePoolSeason';
import { lamportsToSol } from '../services/pools';

export default function SeasonScreen() {
  const { season, msRemaining } = useSeason();
  // Real on-chain pool when a paid season exists (v2); else score-only beta.
  const { poolSeason } = usePoolSeason();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        <Text style={styles.title}>Season</Text>
        <Text style={styles.subtitle}>{season.label}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>ENDS IN</Text>
          <Text style={styles.countdown}>{formatCountdown(msRemaining)}</Text>
          <Text style={styles.note}>Seasons reset on the 1st of each month, UTC.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>PRIZE POOL</Text>
          {poolSeason ? (
            <>
              <Text style={styles.poolValue}>{lamportsToSol(poolSeason.poolTotal)} SOL</Text>
              <Text style={styles.note}>
                {poolSeason.entrants} {poolSeason.entrants === 1 ? 'entrant' : 'entrants'} · entry{' '}
                {lamportsToSol(poolSeason.entryFee)} SOL · {poolSeason.finalized ? 'finalized' : 'open'}. Top 10
                split the pool by the breakdown below.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.poolValue}>TBD (score-only beta)</Text>
              <Text style={styles.note}>
                Paid entries arrive in v2 — top 10 will split the season pool by the split below.
              </Text>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>PAYOUT SPLIT</Text>
          {PAYOUT_SPLIT_BPS.map((bps, i) => (
            <View key={i} style={styles.splitRow}>
              <Text style={styles.splitRank}>#{i + 1}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${bps / 100}%` }]} />
              </View>
              <Text style={styles.splitPct}>{(bps / 100).toFixed(0)}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>HOW SCORES WORK</Text>
          <Bullet text="30-second round: hit targets before they vanish." />
          <Bullet text="Hits: 100 pts base, +50 if you tap within 250ms." />
          <Bullet text="Combos add up to +200 per hit while streak is alive." />
          <Bullet text="Final score = base × (0.5 + accuracy). Misses cost points." />
          <Bullet text="Your season rank = best single round this month." />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: COLORS.textDim, fontSize: 14, marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: COLORS.bgElev,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginBottom: 14,
  },
  label: { color: COLORS.textDim, fontSize: 11, letterSpacing: 1.5, fontWeight: '700' },
  countdown: { color: COLORS.accent, fontSize: 32, fontWeight: '800', marginTop: 6 },
  poolValue: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginTop: 6 },
  note: { color: COLORS.textDim, fontSize: 12, marginTop: 10, lineHeight: 18 },
  splitRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  splitRank: { color: COLORS.textDim, width: 36, fontSize: 12, fontWeight: '700' },
  barTrack: { flex: 1, height: 8, backgroundColor: COLORS.bgElev2, borderRadius: 4, marginHorizontal: 10, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.accent },
  splitPct: { color: COLORS.text, fontSize: 12, fontWeight: '700', width: 44, textAlign: 'right' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accent, marginTop: 7, marginRight: 10 },
  bulletText: { color: COLORS.text, fontSize: 13, lineHeight: 20, flex: 1 },
});
