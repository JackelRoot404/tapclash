# TapClash Privacy Policy

_Last updated: 2026-05-23_

TapClash is a Solana-based tap-reaction game. We've designed it to collect as little as possible — no email, no account, no analytics SDK.

## What we collect

| Data | Where it lives | Why |
|---|---|---|
| Your Solana wallet public address | Stored locally on your device (AsyncStorage) and submitted with every score | Identifies your entries on the leaderboard |
| Your score, hit/miss counts, and round duration | Submitted to our leaderboard server when you complete a round | Ranks players within the current season |
| A wallet signature over the score payload | Submitted with the score | Proves the score came from your wallet (anti-cheat) |
| Local stats (best score, total rounds, accuracy) | Stored only on your device | Your in-app profile screen |
| Mobile Wallet Adapter auth token | Stored encrypted on your device (Android Keystore via expo-secure-store) | Lets the app re-sign without re-opening the Seed Vault every round |

## What we do NOT collect

- Your name, email, phone number, or any account identifier other than your wallet address.
- Your wallet private key or seed phrase. These never leave the Seed Vault.
- Any device identifiers, IP-address-derived location, advertising IDs, or contacts.
- Crash logs, analytics events, or third-party telemetry. No Sentry, Firebase, Mixpanel, etc.

## Where data is stored

- **On your device**: wallet address (AsyncStorage), auth token (Android Keystore), gameplay stats (AsyncStorage). Uninstalling TapClash wipes all of it.
- **On our leaderboard server**: only the signed-score submissions described above. No request logs beyond what the hosting provider keeps for abuse prevention. Submissions older than 18 months are deleted.

## Sharing

We do not sell, rent, or share any data with third parties. The leaderboard endpoint is the only outbound request the app makes (besides Solana RPC traffic to public Helius and Solana endpoints for wallet authorization).

## Your choices

- **Disconnect wallet**: Profile → Disconnect. Removes the stored wallet address and auth token from your device.
- **Remove server entries**: Email us at the address below with your wallet address and we will delete your leaderboard entries within 30 days.
- **Uninstall**: Removes everything stored locally.

## Children

TapClash is not directed to children under 13 and we do not knowingly collect data from them.

## Changes

If this policy changes we'll update the "Last updated" date above and post a notice in the app's Season tab before the change takes effect.

## Contact

Questions or data-removal requests: Jackel_00@protonmail.com
