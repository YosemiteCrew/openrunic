import type { Metadata } from 'next';
import { HealthRecordScreen } from './HealthRecordScreen';

export const metadata: Metadata = {
  title: 'Health record',
  description:
    'Your results, conditions, medicines, allergies, vaccinations and documents, each with a plain-language explanation.',
};

export default function HealthRecordPage() {
  return <HealthRecordScreen />;
}
