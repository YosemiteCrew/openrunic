# `@openrunic/voice`

Reading an answer aloud, as a port rather than as a browser API.

Everything vendor-shaped - the voice list, the codec, the event names, the SDK
if a deployer ever configures one - lives behind `ReadbackPort`. Nothing on the
other side of it knows what is speaking, which is why replacing the voice is an
adapter change and not a change to any rule about what may be said aloud.

Two rules are load-bearing, and they are here rather than in either app so that
both apps cannot drift apart on them:

- **What is spoken is the text that is already on the screen.** The port is
  handed a string a surface has already decided to render, and it has no way to
  ask for another one. An adapter therefore cannot widen what a reader hears,
  whatever it is wired to, because it is never told there is more.
- **An interrupted answer was not heard.** Stopping is not a quiet way of
  finishing. A browser reports the same `end` for an utterance it cancelled and
  one it read to the last word, so the reducer believes an ending only while the
  utterance it names is still the one being spoken.

The surface decides _which_ turns may be read at all: `useReadback` takes that
rule as an argument, because "this answer is fit to show" is the app's sentence
and reading it aloud must be the same sentence rather than a second one.

`createPlatformReadback` is the default adapter. It is the voice already on the
device, which is what lets readback exist with no configuration surface: the
operating system's own synthesiser has no endpoint, credential or agreement to
name.

`createHostedReadback` is the second, for a deployer who chooses a hosted
text-to-speech service. Like the hosted recogniser below, it takes the endpoint
and a separate acknowledgement naming the executed agreement (ADR-0005 rule 6)
and throws at construction without both. Its `HostedSynthesiser` owns the
request, the audio and the credential, and is handed the answer's text and
language - never the turn id or anything about the record. It is not wired into
either app, and the readback contract suite runs it over a scripted synthesiser
only, not a live service.

## Asking by voice

`CapturePort` is the mirror of `ReadbackPort`: a session is a language and an id
the caller made up, and nothing else. `createPlatformCapture` is the only adapter
shipped, and it is the recogniser **on the device** - a browser that cannot be
asked whether it recognises the page's language locally is refused rather than
tried, because the default recogniser sends the audio to its vendor and ADR-0005
rule 6 forbids that egress without a named endpoint and agreement.

`useDictation` writes what it hears into the box a person types in, through a
callback, and has no way to reach the assistant. One press is one question, the
status says what the microphone is doing rather than what was pressed, and
changing the record, hiding the page or losing on-device support closes it and
drops the words in flight. What goes in the box, and whether it is sent, stays
the surface's decision and a person's press.

## A hosted recogniser

`createRealtimeCapture` is a second `CapturePort`, for a deployer who chooses a
hosted realtime transcription service instead of the device. Both apps use it
only when the assistant's capabilities response names a `dictation` endpoint and
agreement, which the API does only when the session route below is configured:
nothing in the default configuration sends audio anywhere.

- **Named egress, or nothing.** It takes the endpoint and a separate
  acknowledgement naming the executed agreement (ADR-0005 rule 6), and throws at
  construction without both. There is no silent fallback between the device and
  a service, in either direction.
- **Transcription only.** It reads the service's input-transcription events and
  drops everything else, including any reply the service produces in text,
  audio or tool calls. It never asks for one. What a reader hears back is the
  assistant's source-checked answer through `ReadbackPort`, never audio a model
  generated on its own.
- **The media is the deployer's.** A `RealtimeTransport` owns the microphone
  track, the codec, WebRTC or a socket, the model and the credential - which a
  server should mint, short-lived, after the checks the product already makes.
  The transport is handed a language and nothing about the record.

Stop waits for every stretch the service is still transcribing, not the first
one to settle, and commits only audio the service has not committed itself, as
the transport's declared `turnDetection` says.

The contract suite runs the same dictation rules through all three recognisers:
a push-to-talk double, a streaming double and this adapter over a scripted
connection. Swapping one for another is an adapter change. The adapter has been
exercised against that scripted connection only, not against a live service.

### The browser transport

`createBrowserRealtimeTransport` is the `RealtimeTransport` both apps use. On
each press it asks the app's `mint` function for a credential, opens the
microphone, adds it to a WebRTC peer connection send-only, and posts the offer
to the endpoint over `https`. The service's events arrive on a data channel and
go to the capture adapter unread.

- It contacts only the endpoint it was built with. A credential issued for any
  other address is refused before the microphone is asked for.
- No receiving audio track is offered, so a service that speaks cannot be
  heard on the page.
- Every way out - stop, a refusal, a dropped network, closing during the
  permission prompt - stops the microphone track.
- A `wss` endpoint gets no browser transport, and so no hosted dictation.

### Minting the credential

The API mints it: `POST /bff/v0/agent/realtime/sessions` (`apps/api/src/agent/realtime.ts`). The
route exists only when the assistant is enabled, the deployer has passed a `RealtimeSessionMinter`
to `createApp` (their code, holding their vendor key), and the environment below names the endpoint
and its agreement. Otherwise it answers 404.

| Variable                                          | Meaning                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `OPENRUNIC_REALTIME_ENDPOINT`                     | `https` or `wss` address of the service. Absent means off.       |
| `OPENRUNIC_REALTIME_PHI_EGRESS_AGREEMENT`         | Names the executed agreement. Required.                          |
| `OPENRUNIC_REALTIME_PHI_EGRESS_RESPONSIBLE_PARTY` | Names who is answerable for it. Required.                        |
| `OPENRUNIC_REALTIME_LANGUAGES`                    | Comma-separated BCP-47 tags the service transcribes. Required.   |
| `OPENRUNIC_REALTIME_TURN_DETECTION`               | `server` (default) or `manual`.                                  |
| `OPENRUNIC_REALTIME_MAX_TTL_SECONDS`              | Longest a credential may live. Default 60, at most 600.          |
| `OPENRUNIC_REALTIME_DAILY_SESSIONS`               | Per-tenant sessions per day before dictation stops. Default 500. |

The route checks the caller, and any chart the client names the way the chart route does, before a
credential exists. The minter is told a language, a surface and a lifetime, never a person, a chart
or a tool; a client asking for tools, instructions, a model or audio output is refused. A
credential longer-lived than the ceiling, expired or empty is not passed on, and the credential is
never stored or audited.
