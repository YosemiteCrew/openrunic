import type { Metadata } from 'next';
import { MessagesScreen } from './MessagesScreen';

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Read what your care team has written and reply to them.',
};

export default function MessagesPage() {
  return <MessagesScreen />;
}
