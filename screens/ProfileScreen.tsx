import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/config';
import { Button } from '../components/Button';
import { useWallet } from '../context/WalletContext';
import { useSeason } from '../context/SeasonContext';
import { getLocalStats, LocalStats } from '../services/stats';
import { fetchPlayerStats } from '../services/leaderboard';
import { usePoolSeason } from '../hooks/usePoolSeason';
import { claimableLamports } from '../sdk/src';
import { lamportsToSol } from '../services/pools';
import { DEFAULT_CATEGORY, labelForCategory, type CategorySlug } from '../constants/categories';
import { MODE_ORDER } from '../constants/game';

export default function ProfileScreen() {
  const { publicKey, connected, connecting, connect, disconnect, error: walletError } = useWallet();
  const { season } = useSeason();
  const [local, setLocal] = useState<LocalStats | null>(null);
  const [serverRank, setServerRank] = useState<number | null>(null);
  const [category, setCategory] = useState<CategorySlug>(DEFAULT_CATEGORY);
  const { poolSeason, entry, busy: poolBusy, claim } = usePoolSeason();
  const owed = poolSeason && entry ? claimableLamports(poolSeason, entry) : 0n;

  useEffect(() => {
    getLocalStats().then(setLocal);
  }, []);

  // On focus, read the player's current mode (persisted by Play) and fetch their
  // rank in THAT mode's leaderboard category — so the rank tracks how they play,
  // and refreshes when they switch modes and return here. Clearing first means a
  // disconnected/unranked player never shows a stale '#N'.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setServerRank(null);
      (async () => {
        const m = await AsyncStorage.getItem('tapclash:mode').catch(() => null);
        const cat = (m && (MODE_ORDER as string[]).includes(m) ? m : DEFAULT_CATEGORY) as CategorySlug;
        if (cancelled) return;
        setCategory(cat);
        if (!publicKey) return;
        const s = await fetchPlayerStats(season.id, publicKey.toBase58(), cat);
        if (!cancelled) setServerRank(s?.rank ?? null);
      })();
      return () => {
        cancelled = true;
      };
    }, [publicKey, season.id])
  );

  const addr = publicKey?.toBase58() ?? null;
  const accuracy =
    local && local.totalHits + local.totalMisses > 0
      ? ((local.totalHits / (local.totalHits + local.totalMisses)) * 100).toFixed(1)
      : '—';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <Text style={styles.label}>WALLET</Text>
          {connected && addr ? (
            <>
              <Text style={styles.wallet}>{addr}</Text>
              <Button label="Disconnect" variant="ghost" onPress={disconnect} style={{ marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 0 }} />
            </>
          ) : (
            <>
              <Text style={styles.note}>Connect your Seed Vault to submit scores and appear on the leaderboard.</Text>
              <Button
                label={connecting ? 'Opening Seed Vault…' : 'Connect Wallet'}
                onPress={connect}
                loading={connecting}
                style={{ marginTop: 14 }}
              />
              {walletError && <Text style={styles.errorNote}>{walletError}</Text>}
            </>
          )}
        </View>

        {owed > 0n && (
          <View style={styles.card}>
            <Text style={styles.label}>SEASON PAYOUT</Text>
            <Text style={styles.payout}>{lamportsToSol(owed)} SOL</Text>
            <Text style={styles.note}>You finished in the paid top 10 — claim your winnings.</Text>
            <Button
              label={poolBusy === 'claim' ? 'Claiming…' : 'Claim winnings'}
              onPress={claim}
              loading={poolBusy === 'claim'}
              style={{ marginTop: 14 }}
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>THIS SEASON</Text>
          <View style={styles.statRow}>
            <Stat title="Best score" value={local && local.lastSeasonId === season.id ? local.bestScore.toString() : '0'} />
            <Stat title={`Rank · ${labelForCategory(category)}`} value={serverRank ? `#${serverRank}` : '—'} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>ALL-TIME</Text>
          <View style={styles.statRow}>
            <Stat title="Rounds" value={(local?.totalRounds ?? 0).toString()} />
            <Stat title="Hits" value={(local?.totalHits ?? 0).toString()} />
            <Stat title="Accuracy" value={accuracy === '—' ? '—' : `${accuracy}%`} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statTitle}>{title}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginBottom: 16 },
  card: { backgroundColor: COLORS.bgElev, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 18, marginBottom: 14 },
  label: { color: COLORS.textDim, fontSize: 11, letterSpacing: 1.5, fontWeight: '700', marginBottom: 8 },
  wallet: { color: COLORS.text, fontSize: 12, fontFamily: 'monospace' },
  note: { color: COLORS.textDim, fontSize: 13, lineHeight: 20 },
  payout: { color: COLORS.gold, fontSize: 26, fontWeight: '800', marginTop: 6 },
  errorNote: { color: COLORS.danger, fontSize: 12, marginTop: 10, lineHeight: 18 },
  statRow: { flexDirection: 'row', marginTop: 4 },
  stat: { flex: 1 },
  statTitle: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  statValue: { color: COLORS.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
});
