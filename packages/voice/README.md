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

`createPlatformReadback` is the only adapter shipped. It is the voice already on
the device, which is what lets readback exist with no configuration surface:
under ADR-0005 a hosted voice would need an endpoint, a credential and a
separate acknowledgement before it could ship, and the operating system's own
synthesiser has none of those to name.

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
hosted realtime transcription service instead of the device. It is not wired
into either app: nothing in the default configuration sends audio anywhere.

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

The contract suite runs the same dictation rules through all three recognisers:
a push-to-talk double, a streaming double and this adapter over a scripted
connection. Swapping one for another is an adapter change. The adapter has been
exercised against that scripted connection only, not against a live service.
