# Aura

Aura is a student safety companion prototype with Boundary Buddy chat, quick SOS, trusted-contact location sharing, and opt-in recording review.

**Your space. Your say. Your way.**

## Congressional App Challenge

Aura gives students a student-controlled path from an uncomfortable moment to a practical next step: fast SOS, opt-in voice triggers, and an optional recording review that explains exactly when speech is sent to AI. Safety controls work without the AI service, while sharing stays in the student's hands.

Demo flow: open SOS, enable a custom voice trigger, optionally enable record-after-trigger, stop the sample recording, review the AI-upload consent, then share through the device share sheet. Use a non-sensitive sample recording for a public demo.

## Run locally

Requires Node.js 20 or newer.

1. Copy `.env.example` to `.env`.
2. Set `NVIDIA_NIM_API_KEY` in `.env` to your NVIDIA NIM key. The key is read by the local server and is never sent to the browser.
3. Run `npm start` and open [http://localhost:3000](http://localhost:3000).

`NVIDIA_NIM_MODEL`, `NVIDIA_NIM_BASE_URL`, `NVIDIA_NIM_ASR_MODEL`, `NVIDIA_NIM_ASR_BASE_URL`, and `PORT` can also be set in `.env`. Chat and transcript summaries use `meta/llama-3.2-90b-vision-instruct`; audio transcription uses `nvidia/parakeet-ctc-1.1b-asr`. Recording analysis expects an OpenAI-compatible `/audio/transcriptions` endpoint. Without a key, emergency messages still receive the local SOS response, while chat and recording analysis are unavailable.

## Run tests

Run `npm test` to check emergency bypass, safe-word activation, missing-key behavior for chat and recording analysis, and the privacy-policy route. Tests use Node's built-in test runner and do not need an NVIDIA key.

## Safety and privacy

- SOS opens emergency guidance and a `tel:911` link; it does not place a call automatically.
- Location sharing requires a saved trusted contact and browser location permission. Aura opens a prefilled text for the user to review and send.
- Manual recording starts only after the user presses Start and grants microphone permission. Optional auto-record after a voice SOS trigger is off by default and requires enabling it in Privacy details.
- Finished recordings are saved to downloads. AI analysis is a separate action with a confirmation; the audio is uploaded to NVIDIA for transcription and the transcript is sent to the Llama model for a short summary. Aura does not persist the uploaded audio.
- Sharing is user-controlled through the device share sheet; Aura does not automatically send recordings to contacts.
- An optional private chat phrase is stored in browser storage and triggers SOS only when typed into the open app. It is not sent to NIM; it does not activate the microphone, and someone with access to the device may be able to inspect it.
- Voice SOS is opt-in, starts only after the user presses its button, and stops when the app is no longer visible. “Help” is always a trigger; custom voice words can be set in Privacy details. Browser speech recognition may process audio using the browser provider; check its privacy terms. If unavailable, use the visible SOS button or `Alt+Shift+S`.
- Browser microphone and location features require a secure context. `localhost` is supported for local development; a deployed app must use HTTPS.
- Voice SOS must be started while Aura is open; it stops when the app is no longer visible. The auto-record setting only records after a configured voice trigger, after microphone permission; it does not upload or share automatically.
- Read the [Privacy Policy](http://localhost:3000/privacy.html) for data handling and third-party service details. It is a prototype disclosure; publish with the operator's contact details and review before deployment.
- The hosted NVIDIA ASR endpoint could not be live-verified without credentials. Configure `NVIDIA_NIM_ASR_BASE_URL` for an NVIDIA endpoint that supports `/v1/audio/transcriptions` and test with a non-sensitive sample before using real recordings.
