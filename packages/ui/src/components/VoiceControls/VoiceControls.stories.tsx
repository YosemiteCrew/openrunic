import type { Meta, StoryObj } from '@storybook/react-vite';
import { VoiceControls, VoiceIndicator } from './VoiceControls';

const defaultLabels = {
  regionLabel: 'Voice controls',
  startLabel: 'Start',
  stopLabel: 'Stop',
  startTooltip: 'Start voice input',
  stopTooltip: 'Stop voice input',
  waitTooltip: 'Please wait',
  pushToTalkLabel: 'Push to talk',
  pushToTalkTooltip: 'Hold to talk, release to send',
  pushToTalkHint: 'Hold to talk, release to send',
  muteInputTooltip: 'Mute microphone',
  unmuteInputTooltip: 'Unmute microphone',
  muteOutputTooltip: 'Mute playback',
  unmuteOutputTooltip: 'Unmute playback',
  enableCaptionsTooltip: 'Enable captions',
  disableCaptionsTooltip: 'Disable captions',
  unavailableMessage: 'Voice not available',
  states: {
    idle: 'Idle',
    requesting: 'Requesting...',
    capturing: 'Listening...',
    processing: 'Processing...',
    playing: 'Speaking...',
    error: 'Error',
  },
};

const meta = {
  title: 'Assistant/VoiceControls',
  component: VoiceControls,
  parameters: { layout: 'padded' },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['idle', 'requesting', 'capturing', 'processing', 'playing', 'error'],
    },
  },
  args: {
    labels: defaultLabels,
    onStart: () => console.log('Voice start'),
    onStop: () => console.log('Voice stop'),
    available: true,
  },
} satisfies Meta<typeof VoiceControls>;

export default meta;
type Story = StoryObj<typeof meta>;

const handlerArgs = {
  onMuteInput: (muted: boolean) => console.log('Input mute:', muted),
  onMuteOutput: (muted: boolean) => console.log('Output mute:', muted),
  onCaptionsToggle: (enabled: boolean) => console.log('Captions:', enabled),
};

export const Idle: Story = {
  args: {
    state: 'idle',
    ...handlerArgs,
  },
};

export const Requesting: Story = {
  args: {
    state: 'requesting',
    ...handlerArgs,
  },
};

export const Capturing: Story = {
  args: {
    state: 'capturing',
    ...handlerArgs,
  },
};

export const Processing: Story = {
  args: {
    state: 'processing',
    ...handlerArgs,
  },
};

export const Playing: Story = {
  args: {
    state: 'playing',
    ...handlerArgs,
  },
};

export const Error: Story = {
  args: {
    state: 'error',
    error: 'Microphone access denied',
    ...handlerArgs,
  },
};

export const WithCaption: Story = {
  args: {
    state: 'capturing',
    caption: 'Listening for your question...',
    ...handlerArgs,
  },
};

export const WithInputMuted: Story = {
  args: {
    state: 'capturing',
    inputMuted: true,
    ...handlerArgs,
  },
};

export const WithOutputMuted: Story = {
  args: {
    state: 'playing',
    outputMuted: true,
    ...handlerArgs,
  },
};

export const WithCaptionsEnabled: Story = {
  args: {
    state: 'capturing',
    captionsEnabled: true,
    ...handlerArgs,
  },
};

export const Unavailable: Story = {
  args: {
    state: 'idle',
    available: false,
  },
};

/** Push-to-talk is enabled only in idle state; it disables when capture begins. */
export const PushToTalkActive: Story = {
  args: {
    state: 'idle',
    ...handlerArgs,
  },
  play: async ({ canvasElement }) => {
    const pttButton = canvasElement.querySelector('button[aria-label="Push to talk"]');
    if (pttButton) {
      pttButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      pttButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
  },
};

/** VoiceIndicator minimal variant for inline use. */
const indicatorMeta = {
  title: 'Assistant/VoiceIndicator',
  component: VoiceIndicator,
  parameters: { layout: 'padded' },
  args: {
    state: 'capturing',
    labels: { states: defaultLabels.states },
  },
} satisfies Meta<typeof VoiceIndicator>;

export { indicatorMeta as defaultIndicatorMeta };
type IndicatorStory = StoryObj<typeof indicatorMeta>;

export const VoiceIndicatorStory: IndicatorStory = {
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <VoiceIndicator state="idle" labels={args.labels} />
      <VoiceIndicator state="requesting" labels={args.labels} />
      <VoiceIndicator state="capturing" labels={args.labels} />
      <VoiceIndicator state="processing" labels={args.labels} />
      <VoiceIndicator state="playing" labels={args.labels} />
      <VoiceIndicator state="error" labels={args.labels} />
      <VoiceIndicator state="playing" caption="Reading evidence summary..." labels={args.labels} />
    </div>
  ),
};

/** Responsive behaviour: on mobile the controls stack and hit targets meet 44px. */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  args: {
    state: 'capturing',
    caption: 'Listening on mobile...',
    ...handlerArgs,
  },
};

/** Espresso (dark) tone - uses inverse surfaces and bone ink. */
export const Espresso: Story = {
  globals: { backgrounds: { value: 'espresso' } },
  args: {
    state: 'capturing',
    caption: 'Listening in dark mode...',
    ...handlerArgs,
  },
};
