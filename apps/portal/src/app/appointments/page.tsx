import type { Metadata } from 'next';
import { AppointmentsScreen } from './AppointmentsScreen';

export const metadata: Metadata = {
  title: 'Appointments',
  description: 'Your upcoming and past appointments, and how to request, move or cancel one.',
};

export default function AppointmentsPage() {
  return <AppointmentsScreen />;
}
