# Deploying TapClash to the Solana Mobile dApp Store

This is the full submission flow, top to bottom. Skip nothing — losing the
keystore or the publisher keypair means **the dApp Store can never accept an
update to this app**, so back both up before you start.

## 0. One-time tooling

```bash
# Solana CLI (for the publisher keypair)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# dApp Store CLI (project-local — no global install needed)
cd ~/dev/solana-seeker-tapclash
npm install --save-dev @solana-mobile/dapp-store-cli
```

You don't need EAS for the dApp Store — it accepts a locally-built AAB.

## 1. Build the signed release AAB

This box needs both a JDK and the Android SDK on the path:

```bash
cd ~/dev/solana-seeker-tapclash
# Point at Android Studio's bundled JDK (skip if Java is already on PATH)
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
# Gradle reads sdk.dir from android/local.properties; create it once:
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties

cd android
./gradlew bundleRelease
# AAB output: android/app/build/outputs/bundle/release/app-release.aab
```

Confirm the signature is the **release** key (not debug):

```bash
keytool -list -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
# Look for: Owner: CN=TapClash, …  SHA-256: 22:86:BD:9D:DC:9B:AF:60:…
```

Back up `android/app/tapclash-release.keystore` to two offline locations now.
Store the passwords from `android/keystore.properties` (gitignored, machine-local) separately.

## 2. Create the publisher keypair (once per identity)

```bash
cd ~/dev/solana-seeker-tapclash/publishing
solana-keygen new --no-bip39-passphrase --outfile publisher-keypair.json
solana-keygen pubkey publisher-keypair.json   # save this address
```

Fund the address with **~0.1 SOL on mainnet** (publisher + app + first release
together cost ~0.05 SOL of rent + tx fees). Send from any wallet:

```bash
solana transfer <publisher-pubkey> 0.1 --allow-unfunded-recipient
```

Back up `publisher-keypair.json` to two offline locations. This is the only
key the dApp Store recognizes as the legitimate updater for `com.tapclash.app`.

## 3. Add screenshots and banner

Capture on a real Seeker, or a 1080×1920 emulator, and drop in `publishing/media/`:

| File | Size | What to capture |
|---|---|---|
| `icon.png` | 512×512 | App icon (already copied from `assets/icon.png`) |
| `banner.png` | 1920×1080 | Hero shot for the listing — render the icon + tagline |
| `screenshot_1.png` | 1080×1920 | Play screen mid-round, several targets visible, high combo |
| `screenshot_2.png` | 1080×1920 | End-of-round overlay showing final score + submit banner |
| `screenshot_3.png` | 1080×1920 | Leaderboard with your wallet highlighted |
| `screenshot_4.png` | 1080×1920 | Season tab showing payout split + countdown |

Quick way to capture from a connected Seeker / emulator:

```bash
adb shell screencap -p /sdcard/shot.png && adb pull /sdcard/shot.png screenshot_1.png
```

## 4. Create the publisher NFT (once per publisher)

```bash
cd ~/dev/solana-seeker-tapclash/publishing
npx dapp-store create publisher -k publisher-keypair.json
# Mints the Publisher NFT to the publisher key. Writes address into config.yaml.
git add config.yaml && git commit -m "chore: add publisher address"
```

## 5. Create the app NFT (once per app)

```bash
npx dapp-store create app -k publisher-keypair.json
# Mints the App NFT under the publisher. Writes address into config.yaml.
git add config.yaml && git commit -m "chore: add app address"
```

## 6. Create + publish the release

```bash
# Rebuild AAB if you changed anything since step 1
( cd ../android && ./gradlew bundleRelease )

npx dapp-store create release -k publisher-keypair.json
# Mints the Release NFT, uploads media + AAB to Solana storage,
# writes release address into config.yaml.

npx dapp-store publish submit \
  -k publisher-keypair.json \
  --requestor-is-authorized
# Submits the release to Solana Mobile for review. Usually 1-3 business days.
```

If validation fails, the CLI prints what's wrong (missing screenshot size,
bad AAB signature, copy too long, etc.). Fix, rebuild if needed, re-run
`create release` + `publish submit`.

## 7. Subsequent updates

```bash
# 1. Bump version
#    app.json:                "version": "1.0.1"
#    android/app/build.gradle: versionCode 2, versionName "1.0.1"

# 2. Rebuild
( cd android && ./gradlew bundleRelease )

# 3. Mint new Release NFT under the same App NFT
( cd publishing && npx dapp-store create release -k publisher-keypair.json )

# 4. Submit for review (use `update` if a prior release is still under review)
( cd publishing && npx dapp-store publish submit -k publisher-keypair.json --requestor-is-authorized )
```

## Reference

- Solana Mobile dApp Publishing docs: https://docs.solanamobile.com/dapp-publishing/intro
- CLI source: https://github.com/solana-mobile/dapp-publishing
- Listing requirements: https://docs.solanamobile.com/dapp-publishing/listing_page_requirements

## Disaster recovery checklist

If you lose the signing keystore: you **cannot** ship updates. You'd have to
publish a brand-new app under a different package id. Treat both of these as
critical secrets:

- [ ] `android/app/tapclash-release.keystore` — backed up to 2 offline drives
- [ ] keystore passwords from `android/keystore.properties` — written down
- [ ] `publishing/publisher-keypair.json` — backed up to 2 offline drives
- [ ] publisher pubkey funded and recorded in `config.yaml`
