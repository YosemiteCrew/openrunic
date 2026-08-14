import type { Metadata } from 'next';
import { FormsScreen } from './FormsScreen';

export const metadata: Metadata = {
  title: 'Forms',
  description:
    'Questionnaires to fill in before your appointments. Save as you go and finish later.',
};

export default function FormsPage() {
  return <FormsScreen />;
}
