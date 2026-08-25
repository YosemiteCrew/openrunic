import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { InsuranceScreen } from './InsuranceScreen';

/**
 * FD-08 Insurance and eligibility. Owned by the schedule and front desk agent.
 *
 * The route file is a server component and owns metadata only. Like the chart
 * route beside it, this will move to `generateMetadata` reading the patient so
 * the browser tab reads "PATIENTSSON, Testina - Insurance": two tabs on two
 * patients must be impossible to confuse.
 */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ titleKey: 'insurance.page.title' });
}

interface InsurancePageProps {
  params: Promise<{ id: string }>;
}

export default async function InsurancePage({ params }: Readonly<InsurancePageProps>) {
  const { id } = await params;
  return <InsuranceScreen patientId={id} />;
}
