# QRelay privacy policy

Effective 22 November 2026. This covers QRelay for Windows, Android and iPhone.

## The short version

QRelay collects nothing about you. It has no accounts, no analytics, no ads and no tracking. Files move from one screen to another camera as QR codes. They never pass through a server, ours or anyone else's.

## The camera

QRelay turns the camera on only while the Receive screen is open. Each camera frame is decoded on your device to read the QR code in it, then thrown away. Frames are never saved, recorded or sent anywhere.

On Windows, QRelay only offers Receive when the computer has a camera.

## Your files

- **Sending:** QRelay reads a file only after you pick it. It encrypts the file (AES-256-GCM) and shows it on screen as a stream of QR codes. Anyone whose camera reads the first, amber code (the key) can open the file, so send only to someone in front of you.
- **Receiving:** QRelay asks before it accepts anything. Accepted files are saved on your device: in `Documents\QRelay\received` on Windows, and in the app's own storage on a phone.
- **Edits** such as compressing an image or converting to PDF happen on your device.

## What stays on your device

QRelay keeps a list of your recent transfers (file name, size, time, sent or received) and your settings. Both stay on your device. Uninstalling QRelay from the Microsoft Store or from a phone removes them. Files you received in `Documents\QRelay` stay there until you delete them.

## Network use

- **Windows:** QRelay makes no network connections.
- **Android and iPhone:** when it starts, QRelay asks Expo's update service (expo.dev) whether a newer version of the app is available. That request carries the app version, the platform and a random installation ID that Expo uses to deliver updates. It contains nothing about you or your files. Expo's handling of it is covered by [Expo's privacy policy](https://expo.dev/privacy).

## Children

QRelay collects no personal information from anyone, children included.

## Changes

If this policy changes, the new version will be posted at this address with a new effective date.

## Contact

Questions about privacy: open an issue at [github.com/viniuy/QRelay/issues](https://github.com/viniuy/QRelay/issues).
