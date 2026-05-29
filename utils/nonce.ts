// Random hex nonce. Backend rejects duplicate (wallet, season, nonce) tuples to
// stop a captured signed submission from being replayed.
export function randomNonce(bytes: number = 12): string {
  const buf = new Uint8Array(bytes);
  // react-native-get-random-values is polyfilled in index.ts so crypto exists.
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
