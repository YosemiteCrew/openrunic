import type { Metadata } from 'next';
import { AssistantScreen } from './AssistantScreen';

export const metadata: Metadata = {
  title: 'Assistant',
  description:
    'Ask a question about what your care team has written down, and see the records each answer came from.',
};

export default function AssistantPage() {
  return <AssistantScreen />;
}
