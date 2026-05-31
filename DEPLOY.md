# Publishing TapClash to the Solana dApp Store

The Solana dApp Store moved to a **web Publishing Portal** flow
(`https://publish.solanamobile.com`). The old `dapp-store create publisher/app/release`
NFT-minting CLI is superseded — the portal mints the Publisher + App NFTs for you
and takes the listing form + APK directly. This doc reflects the current flow
(verified 2026-05-30 against the v1.x CLI + docs).

> **Two irreplaceable secrets — back both up before you start.**
> - `android/app/tapclash-release.keystore` (+ the passwords in
>   `android/keystore.properties`) — the APK signing key. Lose it and you can
>   never ship an update under `com.tapclash.app`.
> - The **Solana wallet** you connect to the portal — it owns the Publisher +
>   App NFTs and is the only key the store accepts as the app's updater.

## 1. Build the signed release APK (the upload artifact)

The portal takes an **APK** (not an AAB).

```bash
cd ~/dev/solana-seeker-tapclash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties   # once
# Bake in the production leaderboard URL (mainnet cluster is the default):
export EXPO_PUBLIC_LEADERBOARD_URL=https://tapclash-leaderboard.twigzzz28.workers.dev
( cd android && ./gradlew assembleRelease )
# APK: android/app/build/outputs/apk/release/app-release.apk
```

Confirm it's the **rotated release key** (not debug):

```bash
APKSIGNER=$(ls ~/Library/Android/sdk/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify --print-certs android/app/build/outputs/apk/release/app-release.apk | grep "certificate SHA-256"
# expect: 2286bd9ddc9baf60771c19c32c6a6d6a334e3ddb956d5982b4f86d878f48211b
```

## 2. Portal account → publisher → app (web, one-time)

At `https://publish.solanamobile.com`:

1. **Sign up** and complete **KYC/KYB** verification.
2. **Connect a Solana wallet** (Phantom / Solflare / Backpack) funded with
   **~0.2 SOL** (covers NFT mint rent + tx fees). This wallet = the permanent
   app owner; back it up.
3. Choose **ArDrive** as the storage provider (hosts the APK + media).
4. **"Add a dApp" → "New dApp"** and fill the listing form. Source the copy from
   `publishing/config.yaml` (catalog `en-US`) and upload media from
   `publishing/media/`:

   | Field | Value / file |
   |---|---|
   | App name | TapClash |
   | Package | com.tapclash.app |
   | Short description | 30-second tap battles. Climb the monthly Solana season leaderboard. |
   | Long description | see `config.yaml` `long_description` |
   | Tagline | Tap fast. Stay accurate. Win the season. |
   | Website | https://jackelroot404.github.io/tapclash/ |
   | Privacy policy | https://jackelroot404.github.io/tapclash/privacy.html |
   | Copyright | https://jackelroot404.github.io/tapclash/copyright.html |
   | Icon | `publishing/media/icon.png` (512×512) |
   | Banner | `publishing/media/banner.png` (1920×1080) |
   | Screenshots | `publishing/media/screenshot_1..4.png` (1080×2403, equal aspect) |
   | Testing instructions | see `config.yaml` `testing_instructions` |

   Submitting the dApp mints the **Publisher NFT** + **App NFT** (approve the
   signing requests in your wallet).

## 3. Submit the first version

1. Open the app's **Home** menu in the portal → **"New Version"**.
2. **Upload** `android/app/build/outputs/apk/release/app-release.apk`.
3. Set **"What's new"** → `Initial release — four game modes, target variety,
   and per-mode signed-score leaderboards.`
4. **Submit** and approve all wallet signing requests.
5. Review results arrive by email in **3–5 business days**.

## 4. Subsequent updates

1. Bump the version: `app.json` `version` + `android/app/build.gradle`
   `versionCode`/`versionName`.
2. Rebuild the APK (step 1).
3. Portal → app Home → **"New Version"** → upload the new APK → set "What's new"
   → Submit.

*(For CI/automation, the portal-backed CLI can upload versions headlessly:
`npx @solana-mobile/dapp-store-cli --apk-file <apk> --whats-new "…" --keypair <wallet> --api-key-env DAPP_STORE_API_KEY` — needs a portal API key. Not required for manual web submission.)*

## Backend note

The app talks to the production leaderboard Worker
(`https://tapclash-leaderboard.twigzzz28.workers.dev`, v2 — per-mode categories).
Redeploy the backend with `cd server && npx wrangler deploy` (requires a valid
`wrangler login`).

## Reference

- dApp Store publishing: https://docs.solanamobile.com/dapp-store/submit-new-app
- Listing guidelines: https://docs.solanamobile.com/dapp-publishing/listing-page-guidelines
- Portal: https://publish.solanamobile.com

## Disaster-recovery checklist

- [ ] `android/app/tapclash-release.keystore` — backed up to 2 offline drives
- [ ] keystore passwords (`android/keystore.properties`) — written down offline
- [ ] portal wallet seed phrase — backed up to 2 offline drives
- [ ] portal wallet funded (~0.2 SOL) before submitting
