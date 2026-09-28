<p align="center">
  <img src="assets/images/icon.png" width="96" alt="QRelay icon" />
</p>

<h1 align="center">QRelay</h1>

<p align="center">
  Send a file from one phone to another using the screen and the camera.<br />
  No Wi‑Fi, no Bluetooth, no mobile data, no account.
</p>

<p align="center">
  iOS · Android · Expo SDK 57 · React Native 0.86 · TypeScript
</p>

---

## What it does

One phone plays the file as a fast stream of QR codes. The other phone points its camera at the screen and rebuilds the file from what it sees. Nothing leaves either phone over a network, so it works on a plane, in a basement, or in a room where the Wi‑Fi password is on a sticky note nobody can find.

The file is encrypted before the first frame is shown. Only a phone that scanned the key at the start can read the stream, and the receiver checks the finished file against the sender's SHA-256 before it saves anything.

## How a transfer goes

1. **Pick a file** on the sending phone. A PDF, a photo, a Word document, anything up to 20 MB.
2. **Edit it if you want.** Compress it, turn a photo into a PDF, or merge several PDFs into one. A smaller file sends faster.
3. **Show the key.** An amber QR code appears for 3 seconds. The receiver scans it and locks onto this sender.
4. **Stream.** The screen turns green and starts flicking through QR codes, 10 a second. The receiver's grid of cubes fills in as blocks arrive.
5. **Done.** The receiver decrypts the file, checks it, and offers Open, Save a copy and Share.

The receiver can start late, look away, or lose a few frames to glare. The stream carries repair frames, so any missed block comes back a few seconds later without either person doing anything.

## Features

- **Works offline.** Screen to camera. Airplane mode is fine.
- **Encrypted.** AES-256-GCM with a fresh key for every transfer. A bystander filming the green stream gets noise.
- **Verified.** The receiver checks the SHA-256 of the whole file. A file that doesn't match is thrown away, never saved half-broken.
- **Survives missed frames.** Fountain coding means there is no "frame 412 missing, start over".
- **Ignores other senders.** Two people streaming in the same room don't get mixed up; each receiver sticks to the key it scanned.
- **Edits before sending.** Compress images and PDFs, image to PDF, merge PDFs. The Edit screen only shows what fits the file you picked.
- **Shrinks text files for free.** Text, CSV, JSON and Office files are deflated before encryption, often to a third of their size.
- **Three speed presets** for old cameras, normal phones and new phones.
- **Light and dark mode**, haptics on every step, and the screen stays awake and bright while streaming.

## How fast

A QR stream is slow next to Wi‑Fi. It is built for the times Wi‑Fi isn't there.

| Preset | Speed | 100 KB photo | 500 KB PDF | 1 MB PDF | Best for |
| --- | --- | --- | --- | --- | --- |
| Reliable | 2.4 KB/s | ~50 s | ~4 min | ~8 min | Older cameras, cracked screens, low light |
| Balanced | 5 KB/s | ~25 s | ~2 min | ~4 min | Any phone from 2019 on |
| Fast | 10.8 KB/s | ~13 s | ~1 min | ~2 min | Recent phones, steady hands, 20 cm apart |

Compress first. A 3 MB scanned PDF often drops under 1 MB, which cuts the wait by two thirds.

## Install

**Android.** Ask for the APK link, open it on the phone and install. Android asks once to allow installs from your browser. Updates to the app arrive on their own the next time it opens.

**iPhone.** Install **Expo Go** from the App Store, then scan the project QR code with the Camera app.

You need two phones for a transfer: one sends, one receives. Any mix of iPhone and Android works.

## Edit operations

| Operation | Available |
| --- | --- |
| Compress photos | Yes. Sharper (2048 px) or Smaller (1280 px) |
| Compress PDFs | Yes. Re-encodes the images inside; text and drawings stay sharp |
| Photo to PDF | Yes. Fitted to an A4 page |
| Merge PDFs | Yes. Or pick several PDFs at once on the Send screen |
| PDF to Word, Word to PDF, photo to Word (OCR) | Planned. Needs the full native build |

---

## For developers

### Run it

```bash
npm install
npx expo start
```

Scan the QR code in the terminal with Expo Go (Android) or the Camera app (iPhone). The phone and PC must be on the same Wi‑Fi; if they aren't, use `npx expo start --tunnel`.

### Build an Android APK

```bash
npx eas-cli build -p android --profile preview
```

Push JS-only fixes to installed APKs without a rebuild:

```bash
npx eas-cli update --channel preview
```

### Checks

```bash
npm test          # vitest: codec, crypto, sender → receiver round trips
npm run typecheck # tsc --noEmit
npm run lint      # expo lint
```

### Layout

```
src/
  app/                    expo-router screens
    index.tsx             Home
    settings.tsx
    send/  index · edit · check · key · stream
    receive/  index (permission) · camera · done
  core/
    codec/                base45, crc32, frameRng, blockSelector, framing, pack (deflate), encoder, decoder
    crypto/               sessionCrypto (AES-256-GCM via @noble; SHA-256 native through expo-crypto)
    qr/                   matrix (qrcode → module grid → SVG path), frameCache (build-ahead)
    transfer/             presets, senderSession, receiverSession
  features/               stageLock (brightness + keep awake), edit/ (editService, pdfCompress, imageCodec)
  files/                  pick, save, export, share, open
  state/                  zustand stores: settings, history (persisted), send, receive
  ui/                     theme tokens, type, motion, Icons, components/
tests/                    vitest
assets/fonts/             Bricolage Grotesque + JetBrains Mono, SIL OFL
```

`src/core` has no React or Expo imports, so it runs under vitest in Node and inside the app unchanged.

The app compiles with the React Compiler on. Don't call store getters or `Date.now()` during render; the compiler caches the result. Pass snapshots and clock values in as props or state.

### Wire format

Key frame (about 130 bytes; QR v6 to v8 at ECC M, depending on the file name):

```
'QK' (2) · ver (1) · session (4) · key (32) · nonce (12) · K (2) · block size (2) ·
payload size (4) · flags (1) · raw size (4) · sha-256 (32) · mime (1+n) · name (1+n)
```

Data frame (block size + 17 bytes; 517 → QR v18 at ECC M for Balanced):

```
'QD' (2) · ver (1) · session (4) · seed (4) · K (2) · payload (block size) · crc-32 (4)
```

Both are base45-encoded and put in QR alphanumeric mode. Each preset pins one QR version so the symbol size never changes mid-stream and the camera doesn't have to refocus.

Before encryption the file is deflated in 128 KB chunks. The packed form is kept only when it saves at least 3%; flag bit 0 says so and `raw size` is what to inflate to. The SHA-256 is always over the original file.

The stream runs in cycles of `K + ceil(0.35 K)` frames. The first K frames of a cycle carry block 0, 1, 2 and so on in order; the rest are repair frames, each the XOR of a random half of the blocks, chosen by a generator keyed by the frame's seed. The receiver treats every frame as an equation over GF(2) and eliminates as frames arrive, so in-order frames solve on arrival and the last holes close together once the system reaches full rank. A receiver that missed `u` blocks needs about `u + 2` repair frames. In the tests, 200 KB at 15% frame loss completes within 6% of `K / (1 - loss)`.

### Status

| Milestone | State |
| --- | --- |
| M1 Codec | done, 36 tests |
| M2 Send and Receive | on phones, in client testing |
| M3 Edit | three of six operations |
| M4 Motion, dark mode | in; screen reader pass pending |
| M5 Release (EAS Build → TestFlight / Play) | Android preview APK profile ready |
