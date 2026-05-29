import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/config';
import { Button } from '../components/Button';
import { useWallet } from '../context/WalletContext';
import { useSeason } from '../context/SeasonContext';
import { getLocalStats, LocalStats } from '../services/stats';
import { fetchPlayerStats } from '../services/leaderboard';

export default function ProfileScreen() {
  const { publicKey, connected, connecting, connect, disconnect, error: walletError } = useWallet();
  const { season } = useSeason();
  const [local, setLocal] = useState<LocalStats | null>(null);
  const [serverRank, setServerRank] = useState<number | null>(null);

  useEffect(() => {
    getLocalStats().then(setLocal);
  }, []);

  useEffect(() => {
    // Clear any rank from a previous wallet/season before (and instead of)
    // fetching, so a disconnected or unranked player never shows a stale '#N'.
    setServerRank(null);
    if (!publicKey) return;
    fetchPlayerStats(season.id, publicKey.toBase58()).then((s) => {
      setServerRank(s?.rank ?? null);
    });
  }, [publicKey, season.id]);

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

        <View style={styles.card}>
          <Text style={styles.label}>THIS SEASON</Text>
          <View style={styles.statRow}>
            <Stat title="Best score" value={local && local.lastSeasonId === season.id ? local.bestScore.toString() : '0'} />
            <Stat title="Season rank" value={serverRank ? `#${serverRank}` : '—'} />
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
  errorNote: { color: COLORS.danger, fontSize: 12, marginTop: 10, lineHeight: 18 },
  statRow: { flexDirection: 'row', marginTop: 4 },
  stat: { flex: 1 },
  statTitle: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  statValue: { color: COLORS.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
});
