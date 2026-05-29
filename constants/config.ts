// Cluster flag: flip to devnet (EXPO_PUBLIC_SOLANA_CLUSTER=devnet) to test the v2
// paid-pools program (deployed on devnet) without code edits. Drives the MWA
// authorize cluster + RPC. Score submission is signature-based and cluster-
// agnostic, so the MVP leaderboard works on either. Defaults to mainnet-beta.
export const SOLANA_CLUSTER: 'mainnet-beta' | 'devnet' =
  process.env.EXPO_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'mainnet-beta';

export const SOLANA_NETWORK = SOLANA_CLUSTER;

export const HELIUS_API_KEY = process.env.EXPO_PUBLIC_HELIUS_API_KEY ?? '';

export const RPC_ENDPOINT =
  SOLANA_CLUSTER === 'devnet'
    ? 'https://api.devnet.solana.com'
    : HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com';

// Backend that verifies signed scores and serves the season leaderboard.
// Production builds MUST set EXPO_PUBLIC_LEADERBOARD_URL to the deployed (https)
// Worker URL — it's inlined at build time. In dev we fall back to the emulator
// host alias (10.0.2.2 → host machine). In a release build with no env var we
// deliberately leave it empty rather than silently shipping a cleartext dev host
// that fails on a real device; the leaderboard services treat '' as "offline".
const DEV_LEADERBOARD_URL = 'http://10.0.2.2:8787';
export const LEADERBOARD_URL =
  process.env.EXPO_PUBLIC_LEADERBOARD_URL ?? (__DEV__ ? DEV_LEADERBOARD_URL : '');

export const APP_IDENTITY = {
  name: 'TapClash',
  uri: 'https://tapclash.app',
  icon: 'favicon.ico',
};

// Visual palette
export const COLORS = {
  bg: '#0a0a0a',
  bgElev: '#141420',
  bgElev2: '#1c1c2e',
  border: 'rgba(20, 241, 149, 0.18)',
  text: '#f5f5f7',
  textDim: '#8a8aa3',
  accent: '#14F195',
  accent2: '#9945FF',
  danger: '#ff4d6d',
  warn: '#ffb84d',
  gold: '#ffd166',
  silver: '#c0c0c8',
  bronze: '#cd7f32',
};
