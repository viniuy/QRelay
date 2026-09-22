# QRelay

Send a file from one phone to another with nothing but a screen and a camera. No network, no account, no server.

The sender encrypts the file (AES-256-GCM), splits the ciphertext into blocks and shows an endless stream of fountain-coded QR frames. Before the stream, one key QR is shown for a few seconds; only a receiver that scanned it can decrypt what follows. The receiver points its camera at the sender, rebuilds the file as frames land, verifies the GCM tag and the SHA-256, and saves it.

Plan and interactive prototype: https://claude.ai/artifact/7CLCn6RxpS1qrRU3cscz8Q

Expo SDK 57 · React Native 0.86 · TypeScript. Runs in Expo Go on iOS and Android; no Mac needed to develop.

## Run it on your phone

1. Install **Expo Go** from the App Store or Play Store.
2. On the PC, in this folder:

   ```bash
   npm install
   npx expo start
   ```

3. Scan the QR code the terminal shows: iPhone with the Camera app, Android with Expo Go's scanner. Phone and PC must be on the same Wi‑Fi; if they are not, use `npx expo start --tunnel`.

A transfer needs two phones. Any second phone with Expo Go can scan the same QR and be the receiver.

## Checks

```bash
npm test          # vitest: codec, crypto, sender → receiver round trips
npm run typecheck # tsc --noEmit
npm run lint      # expo lint
npx expo export --platform ios   # bundles the app the way Expo Go loads it
```

## Layout

```
src/
  app/                    expo-router screens
    index.tsx             Home
    settings.tsx
    send/  index · edit · check · key · stream
    receive/  index (permission) · camera · done
  core/
    codec/                base45, crc32, frameRng, blockSelector, framing, pack (deflate), encoder, decoder
    crypto/               sessionCrypto (AES-256-GCM via @noble; SHA-256 native through expo-crypto, @noble in tests)
    qr/                   matrix (qrcode → module grid → SVG path), frameCache (build-ahead)
    transfer/             presets, senderSession, receiverSession
  features/               stageLock (brightness + keep awake), edit/ (editService, pdfCompress, imageCodec)
  files/                  pick, save, share, open (expo-file-system, expo-sharing)
  state/                  zustand stores: settings, history (persisted), send, receive
  ui/                     theme tokens, type, motion (the one spring), Icons, components/
tests/                    vitest
assets/fonts/             Bricolage Grotesque + JetBrains Mono, SIL OFL
```

`src/core` has no React or Expo imports, which is why it runs under vitest in Node and inside the app unchanged.

## Wire format

Key frame (about 130 bytes, QR v8 at ECC M):

```
'QK' (2) · ver (1) · session (4) · key (32) · nonce (12) · K (2) · block size (2) ·
payload size (4) · flags (1) · raw size (4) · sha-256 (32) · mime (1+n) · name (1+n)
```

Before encryption the file is deflated (`pack.ts`, level 6, in 128 KB chunks that yield to the event loop). The packed form is kept only when it saves at least 3%; flag bit 0 says so and `raw size` is what to inflate to. Text, CSV, JSON and Office files without images shrink a lot; JPEGs, ZIPs and most PDFs (their streams are already deflated) go through as they are, and packing gives up after a megabyte with under 1% saved. The SHA-256 is always over the original file. Ciphertext does not compress, so this is the only place the stream can get shorter without touching the file.

Data frame (block size + 17 bytes; 517 → QR v18 at ECC M for the Balanced preset):

```
'QD' (2) · ver (1) · session (4) · seed (4) · K (2) · payload (block size) · crc-32 (4)
```

Both are base45-encoded and put in QR alphanumeric mode.

The stream runs in cycles of `K + ceil(0.35 K)` frames: the first K seeds of a cycle are the in-order pass (frame q carries block q), the rest are dense repair frames, each the XOR of a random half of the blocks chosen by a generator keyed by the seed. The receiver treats every frame as an equation over GF(2) and eliminates incrementally, so in-order frames solve on arrival and the last holes resolve together at full rank. A receiver that missed `u` blocks in the pass needs about `u + 2` repair frames. Measured in the tests: 200 KB at 15% loss completes within 6% of `K / (1 - loss)`; a repair-only receiver finishes with at most `K + 6` frames.

## Presets

| Preset | Payload | Rate | QR |
| --- | --- | --- | --- |
| Reliable | 300 B | 8 fps | v13 · 69 modules |
| Balanced (default) | 500 B | 10 fps | v18 · 89 modules |
| Fast | 900 B | 12 fps | v25 · 117 modules |

Starting values. The first session on real phones measures the receiver's decode rate (the `decode` stat on the camera screen) and sets them.

## Edit operations

| Operation | Where it runs |
| --- | --- |
| Image → PDF | Expo Go, pure JS (`pdf-lib`) |
| Merge PDFs | Expo Go, pure JS (`pdf-lib`). Also: pick several PDFs at once on the Send screen and they merge on the spot |
| Compress (images) | Expo Go, OS codecs (`expo-image-manipulator`); Sharper 2048 px / q75, Smaller 1280 px / q60 |
| Compress (PDF) | Expo Go. Re-encodes the images inside the PDF through the OS codecs (JPEG and raw Flate RGB/grey; masks, stencils, indexed and Decode-array images are left alone) and re-saves with object streams. Sharper 1800 px / q70, Smaller 1200 px / q55 |

The Edit screen only lists operations that apply to the file's type; the ones this build cannot run are shown muted with the reason.
| PDF → Word, Word → PDF, Image → Word (OCR) | need a development build with native modules; the screen says so |

## Status

| Milestone | State |
| --- | --- |
| M1 Codec | done, 35 tests |
| M2 Send and Receive | written, bundles, not yet run on a phone |
| M3 Edit | three of six operations |
| M4 Motion, dark mode | in; accessibility labels on controls, VoiceOver pass pending |
| M5 Release (EAS Build → TestFlight / Play) | not started |

The Flutter implementation this replaced is kept next door in `../QRelay-flutter` as a reference.
