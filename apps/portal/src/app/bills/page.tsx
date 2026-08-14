import type { Metadata } from 'next';
import { BillsScreen } from './BillsScreen';

export const metadata: Metadata = {
  title: 'Bills',
  description: 'Your statements, what each charge was for, and how to pay.',
};

export default function BillsPage() {
  return <BillsScreen />;
}
