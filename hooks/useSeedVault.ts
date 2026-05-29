import { useState, useCallback, useEffect } from 'react';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { transact as transactWeb3 } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, Transaction } from '@solana/web3.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { APP_IDENTITY, SOLANA_NETWORK } from '../constants/config';

const PUBKEY_KEY = 'tapclash_pubkey';
const AUTH_TOKEN_KEY = 'tapclash_auth_token';

// Result of a sign attempt. `cancelled` lets callers distinguish a deliberate
// user decline (don't treat as a lost score) from a real failure.
export type SignResult =
  | { ok: true; signature: Uint8Array }
  | { ok: false; reason: 'cancelled' | 'error' };

export type WalletState = {
  publicKey: PublicKey | null;
  authToken: string | null;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<SignResult>;
  // Sign + submit a transaction (v2 paid pools: enter/claim). Returns the
  // signature, or null on failure/cancel.
  signAndSendTransaction: (tx: Transaction) => Promise<string | null>;
};

// MWA account addresses are base64-encoded raw pubkeys.
function addressToPublicKey(address: string): PublicKey {
  return new PublicKey(Buffer.from(address, 'base64'));
}

// Pick the authorized account that matches the pubkey our signed message is
// built from. The wallet can return a different accounts[0] than the one we
// persisted (multi-account auth, account switch, reordering) — signing with the
// wrong key would produce a signature the server rejects against `wallet=`.
function pickMatchingAddress(
  accounts: { address: string }[],
  expected: PublicKey | null
): string | null {
  if (!expected) return accounts[0]?.address ?? null;
  for (const acc of accounts) {
    try {
      if (addressToPublicKey(acc.address).equals(expected)) return acc.address;
    } catch {
      // ignore unparseable addresses
    }
  }
  return null;
}

function isUserCancellation(e: unknown): boolean {
  const any = e as { code?: unknown; name?: unknown; message?: unknown };
  const code = String(any?.code ?? any?.name ?? '').toUpperCase();
  const msg = String(any?.message ?? '').toLowerCase();
  return (
    code.includes('CANCELLED') ||
    code.includes('CANCELED') ||
    code.includes('DECLINED') ||
    msg.includes('cancel') ||
    msg.includes('declined') ||
    msg.includes('dismiss')
  );
}

function humanizeWalletError(e: unknown): string {
  const any = e as { code?: unknown; name?: unknown; message?: unknown };
  const code = String(any?.code ?? any?.name ?? '').toUpperCase();
  const msg = String(any?.message ?? '').toLowerCase();
  if (
    code.includes('WALLET_NOT_FOUND') ||
    code.includes('NOT_FOUND') ||
    msg.includes('no wallet') ||
    msg.includes('not found') ||
    msg.includes('no installed')
  ) {
    return 'No compatible wallet found. Install a Seed Vault wallet to continue.';
  }
  return 'Couldn’t connect to your wallet. Please try again.';
}

export function useSeedVault(): WalletState {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore persisted pubkey without opening the Seed Vault.
  // Signing later will re-authorize via the stored auth token.
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(PUBKEY_KEY),
      SecureStore.getItemAsync(AUTH_TOKEN_KEY),
    ])
      .then(([savedPubkey, savedToken]) => {
        if (savedPubkey) {
          try {
            setPublicKey(new PublicKey(savedPubkey));
          } catch {
            AsyncStorage.removeItem(PUBKEY_KEY);
          }
        }
        if (savedToken) setAuthToken(savedToken);
      })
      .catch((e) => {
        // Secure storage can fail (keystore access, corrupted entry). Degrade to
        // disconnected rather than crashing with an unhandled rejection.
        console.warn('wallet restore failed:', e);
      });
  }, []);

  const persistAuth = useCallback(
    async (auth: { auth_token?: string; accounts: { address: string }[] }, hadPubkey: PublicKey | null) => {
      // Wallets may rotate the auth token on (re)authorize — persist the new one.
      if (auth.auth_token && auth.auth_token !== authToken) {
        setAuthToken(auth.auth_token);
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, auth.auth_token);
      }
      // Adopt an account if we didn't have one persisted yet (e.g. signMessage
      // fell back to a full authorize).
      if (!hadPubkey && auth.accounts[0]) {
        try {
          const pk = addressToPublicKey(auth.accounts[0].address);
          setPublicKey(pk);
          await AsyncStorage.setItem(PUBKEY_KEY, pk.toBase58());
        } catch {
          // ignore
        }
      }
    },
    [authToken]
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await transact(async (wallet) => {
        const { accounts, auth_token } = await wallet.authorize({
          cluster: SOLANA_NETWORK,
          identity: APP_IDENTITY,
        });
        const pubkey = addressToPublicKey(accounts[0].address);
        setPublicKey(pubkey);
        setAuthToken(auth_token);
        await AsyncStorage.setItem(PUBKEY_KEY, pubkey.toBase58());
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, auth_token);
      });
    } catch (e) {
      if (isUserCancellation(e)) {
        // User dismissed the sheet — nothing to surface.
      } else {
        console.error('Seed Vault connection failed:', e);
        setError(humanizeWalletError(e));
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const token = authToken;
    setPublicKey(null);
    setAuthToken(null);
    setError(null);
    await AsyncStorage.removeItem(PUBKEY_KEY);
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    // Revoke the authorization wallet-side so a stale token doesn't linger in
    // the wallet's authorization list. Best-effort: the wallet may be offline.
    if (token) {
      try {
        await transact(async (wallet) => {
          await wallet.deauthorize({ auth_token: token });
        });
      } catch (e) {
        console.warn('deauthorize failed (ignored):', e);
      }
    }
  }, [authToken]);

  const signMessage = useCallback(
    async (message: Uint8Array): Promise<SignResult> => {
      try {
        let result: SignResult = { ok: false, reason: 'error' };
        await transact(async (wallet) => {
          // (Re)authorize, recovering from a stale/revoked token by clearing it
          // and doing a fresh authorize instead of wedging on every sign.
          let auth;
          try {
            auth = authToken
              ? await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY })
              : await wallet.authorize({ cluster: SOLANA_NETWORK, identity: APP_IDENTITY });
          } catch (reauthErr) {
            if (isUserCancellation(reauthErr)) throw reauthErr;
            // Token is dead — drop it and re-authorize from scratch.
            setAuthToken(null);
            await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
            auth = await wallet.authorize({ cluster: SOLANA_NETWORK, identity: APP_IDENTITY });
          }

          await persistAuth(auth, publicKey);

          // Sign with the account that matches the pubkey embedded in the message.
          const addr = pickMatchingAddress(auth.accounts, publicKey);
          if (!addr) {
            // The wallet didn't offer the account our score is attributed to —
            // signing with another key would just be rejected by the server.
            console.error('signMessage: authorized account does not match persisted wallet');
            result = { ok: false, reason: 'error' };
            return;
          }

          const signed = await wallet.signMessages({
            addresses: [addr],
            payloads: [Buffer.from(message).toString('base64')],
          });
          // signed_payloads[0] is base64(message || signature). The signature is
          // the last 64 bytes — the MWA spec prepends the original message.
          const combined = Buffer.from(signed.signed_payloads[0], 'base64');
          result = { ok: true, signature: new Uint8Array(combined.subarray(combined.length - 64)) };
        });
        return result;
      } catch (e) {
        if (isUserCancellation(e)) return { ok: false, reason: 'cancelled' };
        console.error('signMessage failed:', e);
        return { ok: false, reason: 'error' };
      }
    },
    [authToken, publicKey, persistAuth]
  );

  const signAndSendTransaction = useCallback(
    async (tx: Transaction): Promise<string | null> => {
      try {
        let sig: string | null = null;
        await transactWeb3(async (wallet) => {
          let auth;
          try {
            auth = authToken
              ? await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY })
              : await wallet.authorize({ cluster: SOLANA_NETWORK, identity: APP_IDENTITY });
          } catch (reauthErr) {
            if (isUserCancellation(reauthErr)) throw reauthErr;
            setAuthToken(null);
            await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
            auth = await wallet.authorize({ cluster: SOLANA_NETWORK, identity: APP_IDENTITY });
          }
          await persistAuth(auth, publicKey);
          const sigs = await wallet.signAndSendTransactions({ transactions: [tx] });
          sig = sigs[0] ?? null;
        });
        return sig;
      } catch (e) {
        if (isUserCancellation(e)) return null;
        console.error('signAndSendTransaction failed:', e);
        setError('Transaction failed. Please try again.');
        return null;
      }
    },
    [authToken, publicKey, persistAuth]
  );

  return {
    publicKey,
    authToken,
    connecting,
    connected: publicKey !== null,
    error,
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction,
  };
}
