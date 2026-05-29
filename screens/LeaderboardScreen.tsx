import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/config';
import { useSeason } from '../context/SeasonContext';
import { useWallet } from '../context/WalletContext';
import { fetchLeaderboard, LeaderboardEntry } from '../services/leaderboard';
import { CATEGORIES, DEFAULT_CATEGORY, type CategorySlug } from '../constants/categories';
import { formatCountdown } from '../utils/season';

export default function LeaderboardScreen() {
  const { season, msRemaining } = useSeason();
  const { publicKey } = useWallet();
  const [category, setCategory] = useState<CategorySlug>(DEFAULT_CATEGORY);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const myWallet = publicKey?.toBase58() ?? null;

  // Monotonic request id: if you switch tabs (or refresh) before a slower fetch
  // resolves, the stale response is dropped instead of overwriting the newer
  // board's rows.
  const reqId = useRef(0);
  const load = useCallback(async () => {
    const myReq = ++reqId.current;
    setLoading(true);
    const data = await fetchLeaderboard(season.id, category);
    if (myReq !== reqId.current) return; // a newer load started — drop this result
    if (data === null) {
      // Network / backend failure — keep any entries we already have.
      setFailed(true);
    } else {
      setEntries(data);
      setFailed(false);
    }
    setLoading(false);
    setLoaded(true);
  }, [season.id, category]);

  useEffect(() => {
    load();
  }, [load]);

  const selectCategory = (slug: CategorySlug) => {
    if (slug === category) return;
    // Clear so we show the spinner for the new board, not the old one's rows.
    setEntries([]);
    setLoaded(false);
    setCategory(slug);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>{season.label} · ends in {formatCountdown(msRemaining)}</Text>
      </View>

      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {CATEGORIES.map((c) => {
            const active = c.slug === category;
            return (
              <Pressable key={c.slug} onPress={() => selectCategory(c.slug)} style={[styles.tab, active && styles.tabActive]}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!loaded && loading && entries.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.wallet}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.accent} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            failed ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Couldn’t reach the leaderboard</Text>
                <Text style={styles.emptyBody}>Check your connection and pull down to retry.</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No scores yet</Text>
                <Text style={styles.emptyBody}>Play a round to be the first on the board this season.</Text>
              </View>
            )
          }
          renderItem={({ item }) => <Row entry={item} isMe={item.wallet === myWallet} />}
        />
      )}
    </SafeAreaView>
  );
}

function Row({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const rankColor =
    entry.rank === 1 ? COLORS.gold :
    entry.rank === 2 ? COLORS.silver :
    entry.rank === 3 ? COLORS.bronze : COLORS.textDim;
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={[styles.rank, { color: rankColor }]}>#{entry.rank}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.wallet}>{shortAddr(entry.wallet)}{isMe ? '  (you)' : ''}</Text>
        <Text style={styles.meta}>{entry.rounds} round{entry.rounds === 1 ? '' : 's'}</Text>
      </View>
      <Text style={styles.score}>{entry.score.toLocaleString()}</Text>
    </View>
  );
}

function shortAddr(a: string) {
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgElev,
  },
  tabActive: { borderColor: COLORS.accent, backgroundColor: 'rgba(20, 241, 149, 0.14)' },
  tabText: { color: COLORS.textDim, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: COLORS.accent },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: COLORS.bgElev,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowMe: { borderColor: COLORS.accent },
  rank: { width: 48, fontSize: 18, fontWeight: '800' },
  wallet: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  meta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  score: { color: COLORS.accent, fontSize: 18, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: COLORS.textDim, fontSize: 13, marginTop: 6, textAlign: 'center' },
});
