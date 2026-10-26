# QRelay brag plan

**What it is:** An app that sends a file from one phone to another as a stream of QR codes, with no Wi‑Fi, Bluetooth, data or account.
**Who it's for:** Anyone who has to move a file between two phones somewhere without a network: on a plane, in a basement, or where nobody knows the Wi‑Fi password.
**What sets it apart:** It needs no radio at all, only the screen and the camera. The file is still encrypted (AES-256-GCM) and checked with SHA-256, and missed frames repair themselves.
**Most impressive claim:** "A bystander filming the green stream gets noise."
**Visual hook:** A phone screen flicking through QR codes at 10 a second.
**Real UI shown:** Home (Send a file / Receive a file), the amber key screen with its countdown ring, the black stream screen with telemetry, the receiver's green block grid, and the "Received" screen.
**Tone:** `default`: punchy and clean, set in the app's own Bricolage Grotesque and JetBrains Mono on the app's paper colour.
**Share caption:** "QRelay sends a file between two phones with QR codes. No Wi‑Fi, no Bluetooth, no data."

## Angle

Every other way to send a file needs a network. QRelay has the phone hold the file up and the other phone read it. The video starts with what's missing and ends on the one place this matters: a plane.

## Visual identity

- Paper `#F3F4F0`, ink `#131614`, muted `#66706A`, line `#BCC3BA`
- Key amber `#E39A00` / soft `#FFF0CF` / ink `#8A5C00`
- Lock green `#159A5C` / soft `#D8F3E3`; stage black `#000`
- Bricolage Grotesque 600 for titles, JetBrains Mono for telemetry and labels (the app's own font files)
- The QRelay mark (the app's own SVG), real QR codes generated with the `qrcode` library the app uses

## Storyboard (landscape 1920×1080, 30 fps, 20.5 s)

| # | Time | Scene | On screen | Motion |
|---|---|---|---|---|
| 1 | 0.0–3.2 | Hook | Black. A QR code flickers at 10 fps in the centre. "No Wi‑Fi." "No Bluetooth." "No data." land one after another | Each line slams in with a small scale-down; QR keeps flicking behind |
| 2 | 3.2–6.0 | Reveal | Paper background. The mark draws in, "QRelay", then "Phone to phone. Screen to camera." | Mark pops, wordmark slides, line fades up |
| 3 | 6.0–9.6 | 1 · Key | Sender phone: home screen, a tap on "Send a file", then the amber "Scan this key" screen with the ring counting down. Caption: "Show the key once." / "Fresh AES-256 key every transfer" | Tap ripple, screen slides, ring sweeps |
| 4 | 9.6–14.4 | 2 · Stream | Two phones. Left: black stream screen flicking QR codes, frame counter running. Right: receiver grid filling green; pill goes "Receiving" → "Repairing · 3 missing" → full. Caption: "Stream 10 QR codes a second." / "Missed frames come back on their own" | QR flicker, cells pop green in random order |
| 5 | 14.4–17.4 | 3 · Done | Receiver "Received" screen: checkmark, `boarding-pass.pdf`, Open / Save a copy / Share. Caption: "Checked before it's saved." / "SHA-256 against the sender" | Check draws, file card rises |
| 6 | 17.4–20.5 | Outro | "Works in airplane mode." then the mark + "QRelay" + "iOS · Android" | Line holds, logo settles, hold to end |

Filenames and session labels on screen (`boarding-pass.pdf`, session `K7QF`) are illustrative stand-ins; there's no real user data.

## Sound

Synthesised in one key (A minor, 116 BPM): a soft pulsing pad and bass, a light hat that ticks with the QR flicker during the stream, a low thump on each hook line, a gentle two-note chime when the file is received. Effects sit under the music.
