# TapClash dApp Store publishing

This folder holds the artifacts the Solana Mobile dApp Store CLI needs to
publish and update TapClash on-chain.

## Files

| File | Purpose | Commit? |
|---|---|---|
| `config.yaml` | App metadata, screenshot manifest, listing copy | yes |
| `publisher-keypair.json` | The Solana keypair that signs releases | **NEVER** — gitignored |
| `media/icon.png` | 512×512 store listing icon | yes |
| `media/banner.png` | 1920×1080 banner | yes |
| `media/screenshot_*.png` | 1080×1920 portrait screenshots | yes |

## How to publish

Full step-by-step lives in [`../DEPLOY.md`](../DEPLOY.md). Short version:

```bash
cd ~/solana-seeker-tapclash/publishing

# 1) one-time: generate publisher keypair (or copy in an existing one)
solana-keygen new --no-bip39-passphrase --outfile publisher-keypair.json

# 2) fund it with ~0.1 SOL on mainnet
#    address: $(solana-keygen pubkey publisher-keypair.json)

# 3) create publisher on-chain (once per publisher identity)
npx dapp-store create publisher -k publisher-keypair.json

# 4) create app NFT (once per app)
npx dapp-store create app -k publisher-keypair.json

# 5) build the AAB
( cd ../android && ./gradlew bundleRelease )

# 6) create + publish release
npx dapp-store create release -k publisher-keypair.json
npx dapp-store publish submit -k publisher-keypair.json --requestor-is-authorized
```

## Updating

For every subsequent release, bump `versionCode` and `versionName` in
`../app.json` and `../android/app/build.gradle`, rebuild the AAB, then
re-run steps 5 and 6.
