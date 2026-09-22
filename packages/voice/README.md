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

The microphone is a separate decision and is not here.
