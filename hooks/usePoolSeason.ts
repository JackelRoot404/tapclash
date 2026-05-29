// v2 paid-pools state for the current season + the player's entry, plus the two
// player-signed actions (enter, claim). Used by Play (Enter), Profile (Claim),
// and Season (pool). Reads are best-effort and return null when there's no paid
// season on-chain (the common case until an oracle opens one).
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSeason } from '../context/SeasonContext';
import { useWallet } from '../context/WalletContext';
import { readSeason, readEntry, prepareTx, getConnection } from '../services/pools';
import { enterIx, claimIx, type SeasonAccount, type EntryAccount } from '../sdk/src';

export function usePoolSeason() {
  const { season } = useSeason();
  const { publicKey, signAndSendTransaction } = useWallet();
  const [poolSeason, setPoolSeason] = useState<SeasonAccount | null>(null);
  const [entry, setEntry] = useState<EntryAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<null | 'enter' | 'claim'>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await readSeason(season.id);
    setPoolSeason(s);
    setEntry(publicKey && s ? await readEntry(season.id, publicKey) : null);
    setLoading(false);
  }, [season.id, publicKey]);

  // Refresh whenever the screen regains focus (also fires on first mount). This
  // keeps Claim status / pool totals current without an app restart — e.g. a
  // player sitting on Profile when the season finalizes will see their payout
  // the next time the tab is focused, not only after a relaunch.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const send = useCallback(
    async (kind: 'enter' | 'claim'): Promise<string | null> => {
      if (!publicKey) return null;
      setBusy(kind);
      try {
        const ix =
          kind === 'enter'
            ? enterIx({ player: publicKey, seasonId: season.id })
            : claimIx({ player: publicKey, seasonId: season.id });
        const tx = await prepareTx(ix, publicKey);
        const sig = await signAndSendTransaction(tx);
        if (sig) {
          await getConnection().confirmTransaction(sig, 'confirmed').catch(() => {});
          await refresh();
        }
        return sig;
      } finally {
        setBusy(null);
      }
    },
    [publicKey, season.id, signAndSendTransaction, refresh]
  );

  return {
    poolSeason,
    entry,
    loading,
    busy,
    refresh,
    enter: () => send('enter'),
    claim: () => send('claim'),
  };
}
