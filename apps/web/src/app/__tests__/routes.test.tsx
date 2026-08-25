import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_ENCOUNTER_IDS } from '@/lib/api/mock/chart';

import { AdminScreen } from '../(app)/admin/AdminScreen';
import AdminPage, { generateMetadata as adminMetadata } from '../(app)/admin/page';
import { AuditScreen } from '../(app)/admin/audit/AuditScreen';
import AuditPage, { generateMetadata as auditMetadata } from '../(app)/admin/audit/page';
import { DeveloperScreen } from '../(app)/admin/developer/DeveloperScreen';
import DeveloperPage, {
  generateMetadata as developerMetadata,
} from '../(app)/admin/developer/page';
import { FacilitiesScreen } from '../(app)/admin/facilities/FacilitiesScreen';
import FacilitiesPage, {
  generateMetadata as facilitiesMetadata,
} from '../(app)/admin/facilities/page';
import { FormsScreen } from '../(app)/admin/forms/FormsScreen';
import FormsPage, { generateMetadata as formsMetadata } from '../(app)/admin/forms/page';
import { IntegrationsScreen } from '../(app)/admin/integrations/IntegrationsScreen';
import IntegrationsPage, {
  generateMetadata as integrationsMetadata,
} from '../(app)/admin/integrations/page';
import { UsersScreen } from '../(app)/admin/users/UsersScreen';
import UsersPage, { generateMetadata as usersMetadata } from '../(app)/admin/users/page';
import { BillingScreen } from '../(app)/billing/BillingScreen';
import BillingPage, { generateMetadata as billingMetadata } from '../(app)/billing/page';
import { ChargesScreen } from '../(app)/billing/charges/ChargesScreen';
import ChargesPage, { generateMetadata as chargesMetadata } from '../(app)/billing/charges/page';
import { ClaimsScreen } from '../(app)/billing/claims/ClaimsScreen';
import ClaimsPage, { generateMetadata as claimsMetadata } from '../(app)/billing/claims/page';
import { PaymentsScreen } from '../(app)/billing/payments/PaymentsScreen';
import PaymentsPage, { generateMetadata as paymentsMetadata } from '../(app)/billing/payments/page';
import { RemittanceScreen } from '../(app)/billing/remittance/RemittanceScreen';
import RemittancePage, {
  generateMetadata as remittanceMetadata,
} from '../(app)/billing/remittance/page';
import { StatementsScreen } from '../(app)/billing/statements/StatementsScreen';
import StatementsPage, {
  generateMetadata as statementsMetadata,
} from '../(app)/billing/statements/page';
import { EncounterNoteScreen } from '../(app)/encounters/[id]/EncounterNoteScreen';
import EncounterPage, {
  generateMetadata as encounterMetadata,
} from '../(app)/encounters/[id]/page';
import { InboxScreen } from '../(app)/inbox/InboxScreen';
import InboxPage, { generateMetadata as inboxMetadata } from '../(app)/inbox/page';
import { OrdersScreen } from '../(app)/orders/OrdersScreen';
import OrdersPage, { generateMetadata as ordersMetadata } from '../(app)/orders/page';
import { NewOrderScreen } from '../(app)/orders/new/NewOrderScreen';
import NewOrderPage, { generateMetadata as newOrderMetadata } from '../(app)/orders/new/page';
import { PatientsScreen } from '../(app)/patients/PatientsScreen';
import PatientsPage, { generateMetadata as patientsMetadata } from '../(app)/patients/page';
import { PatientChartScreen } from '../(app)/patients/[id]/PatientChartScreen';
import PatientChartPage, { generateMetadata as chartMetadata } from '../(app)/patients/[id]/page';
import { InsuranceScreen } from '../(app)/patients/[id]/insurance/InsuranceScreen';
import InsurancePage, {
  generateMetadata as insuranceMetadata,
} from '../(app)/patients/[id]/insurance/page';
import { RegisterPatientScreen } from '../(app)/patients/new/RegisterPatientScreen';
import RegisterPatientPage, {
  generateMetadata as registerMetadata,
} from '../(app)/patients/new/page';
import { ReportsScreen } from '../(app)/reports/ReportsScreen';
import ReportsPage, { generateMetadata as reportsMetadata } from '../(app)/reports/page';
import { ResultsScreen } from '../(app)/results/ResultsScreen';
import ResultsPage, { generateMetadata as resultsMetadata } from '../(app)/results/page';
import { ScheduleScreen } from '../(app)/schedule/ScheduleScreen';
import SchedulePage, { generateMetadata as scheduleMetadata } from '../(app)/schedule/page';
import { FlowBoardScreen } from '../(app)/schedule/flow-board/FlowBoardScreen';
import FlowBoardPage, {
  generateMetadata as flowBoardMetadata,
} from '../(app)/schedule/flow-board/page';

/**
 * The route layer: what each URL is called in the browser tab, and which screen
 * it actually mounts.
 *
 * Two failures this guards against, both of which a screen test cannot see.
 * First, a copy-pasted route file that renders the neighbouring screen: the
 * page still renders something plausible, so nothing goes red until a clinician
 * opens Payments and gets the claim workbench. Second, two routes sharing a tab
 * title, which is how someone with nine tabs open documents in the wrong place.
 *
 * The route files are server components, so they are called rather than
 * rendered: what is asserted is the element each returns, which is exactly the
 * wiring the file exists to declare.
 *
 * The titles are `generateMetadata` rather than a `metadata` constant now,
 * because a tab title is a string a reader reads and every one of them was
 * English. That means these have to be awaited, and it means the route reads
 * the request to find out what language to answer in - so `next/headers` is
 * stubbed the way `(app)/__tests__/layout.test.tsx` stubs it, with a mutable
 * `Headers` a test can set a language on.
 */

let requestHeaders = new Headers();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(requestHeaders) }));

beforeEach(() => {
  requestHeaders = new Headers();
});

/** The header a reader who has chosen Spanish arrives with. */
function readingSpanish(): void {
  requestHeaders = new Headers({ cookie: 'or_locale=es' });
}

const CHART_PATIENT_ID = '0192f1a0-0000-7000-8000-00000000p001';
const ENCOUNTER_ID = MOCK_ENCOUNTER_IDS.testinaUnsigned;

const STATIC_ROUTES = [
  { title: 'Admin', Page: AdminPage, metadata: adminMetadata, Screen: AdminScreen },
  { title: 'Audit trail', Page: AuditPage, metadata: auditMetadata, Screen: AuditScreen },
  {
    title: 'Developer platform',
    Page: DeveloperPage,
    metadata: developerMetadata,
    Screen: DeveloperScreen,
  },
  {
    title: 'Facilities',
    Page: FacilitiesPage,
    metadata: facilitiesMetadata,
    Screen: FacilitiesScreen,
  },
  { title: 'Form builder', Page: FormsPage, metadata: formsMetadata, Screen: FormsScreen },
  {
    title: 'Integrations',
    Page: IntegrationsPage,
    metadata: integrationsMetadata,
    Screen: IntegrationsScreen,
  },
  { title: 'Users and roles', Page: UsersPage, metadata: usersMetadata, Screen: UsersScreen },
  { title: 'Billing', Page: BillingPage, metadata: billingMetadata, Screen: BillingScreen },
  { title: 'Fee sheet', Page: ChargesPage, metadata: chargesMetadata, Screen: ChargesScreen },
  { title: 'Claim workbench', Page: ClaimsPage, metadata: claimsMetadata, Screen: ClaimsScreen },
  { title: 'Payments', Page: PaymentsPage, metadata: paymentsMetadata, Screen: PaymentsScreen },
  {
    title: 'Remittance',
    Page: RemittancePage,
    metadata: remittanceMetadata,
    Screen: RemittanceScreen,
  },
  {
    title: 'Statements and AR',
    Page: StatementsPage,
    metadata: statementsMetadata,
    Screen: StatementsScreen,
  },
  { title: 'Inbox', Page: InboxPage, metadata: inboxMetadata, Screen: InboxScreen },
  { title: 'Orders', Page: OrdersPage, metadata: ordersMetadata, Screen: OrdersScreen },
  { title: 'New order', Page: NewOrderPage, metadata: newOrderMetadata, Screen: NewOrderScreen },
  { title: 'Patients', Page: PatientsPage, metadata: patientsMetadata, Screen: PatientsScreen },
  {
    title: 'Register patient',
    Page: RegisterPatientPage,
    metadata: registerMetadata,
    Screen: RegisterPatientScreen,
  },
  { title: 'Reports', Page: ReportsPage, metadata: reportsMetadata, Screen: ReportsScreen },
  { title: 'Results', Page: ResultsPage, metadata: resultsMetadata, Screen: ResultsScreen },
  { title: 'Schedule', Page: SchedulePage, metadata: scheduleMetadata, Screen: ScheduleScreen },
  {
    title: 'Flow Board',
    Page: FlowBoardPage,
    metadata: flowBoardMetadata,
    Screen: FlowBoardScreen,
  },
] as const;

describe('route wiring', () => {
  it.each(STATIC_ROUTES)('$title mounts its own screen and nothing else', ({ Page, Screen }) => {
    expect(Page().type).toBe(Screen);
  });

  it.each(STATIC_ROUTES)('$title names the browser tab', async ({ title, metadata }) => {
    expect((await metadata()).title).toBe(title);
  });

  it('names the tab in the language the reader chose', async () => {
    /*
     * The assertion the English ones cannot make. Every title above was an
     * English constant in the route file, so a reader who had chosen Spanish got
     * a Spanish schedule in a tab that said "Schedule" - and nothing in this
     * suite could tell, because every expectation was the English string the
     * route already held.
     *
     * `schedule` and `billing` are the two checked here because their Spanish
     * differs from their English by more than an accent; `Inbox` and `Reports`
     * would look like near-misses rather than translations.
     */
    readingSpanish();

    await expect(scheduleMetadata()).resolves.toEqual({ title: 'Agenda' });
    await expect(billingMetadata()).resolves.toEqual({
      title: 'Facturación',
      description: 'Dónde está el dinero hoy, y el panel que lo mueve.',
    });
  });

  it('leaves a clinical tab in English rather than guessing at it', async () => {
    /*
     * `results` has no Spanish file, for the reason `es/index.ts` gives: a wrong
     * clinical word is more dangerous than an English one. The tab falls back
     * and the translator records that it fell back, so the gap is reported
     * rather than hidden - which is what makes it a decision.
     */
    readingSpanish();

    await expect(resultsMetadata()).resolves.toEqual({ title: 'Results' });
  });

  it('gives every route a tab title no other route shares', () => {
    const titles = STATIC_ROUTES.map((route) => route.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it('passes the patient id from the URL through to the chart screen', async () => {
    const element = await PatientChartPage({ params: Promise.resolve({ id: CHART_PATIENT_ID }) });

    expect(element.type).toBe(PatientChartScreen);
    expect(element.props.patientId).toBe(CHART_PATIENT_ID);
  });

  it('passes the patient id through to the insurance screen and titles the tab', async () => {
    const element = await InsurancePage({ params: Promise.resolve({ id: CHART_PATIENT_ID }) });

    expect(element.type).toBe(InsuranceScreen);
    expect(element.props.patientId).toBe(CHART_PATIENT_ID);
    expect((await insuranceMetadata()).title).toBe('Insurance');
  });

  it('passes the encounter id from the URL through to the note screen', async () => {
    const element = await EncounterPage({ params: Promise.resolve({ id: ENCOUNTER_ID }) });

    expect(element.type).toBe(EncounterNoteScreen);
    expect(element.props.encounterId).toBe(ENCOUNTER_ID);
  });
});

describe('route titles that name the patient', () => {
  /*
   * Two chart tabs open on two patients must be impossible to confuse, so the
   * chart and the note put the patient in the tab title rather than the word
   * "Chart" twice. The family name is upper-cased because that is the form a
   * clinician scans a tab strip for.
   */

  it('titles the chart tab with the patient, family name first', async () => {
    await expect(
      chartMetadata({ params: Promise.resolve({ id: CHART_PATIENT_ID }) })
    ).resolves.toEqual({
      // "Tess" rather than "Testina": the tab says what she is called.
      title: 'PATIENTSSON, Tess - Chart',
    });
  });

  it('falls back to a plain title rather than guessing at an unknown patient', async () => {
    await expect(
      chartMetadata({ params: Promise.resolve({ id: 'no-such-patient' }) })
    ).resolves.toEqual({ title: 'Chart' });
  });

  it('titles the note tab with the patient the note belongs to', async () => {
    const title = (await encounterMetadata({ params: Promise.resolve({ id: ENCOUNTER_ID }) }))
      .title;

    expect(title).toMatch(/^[A-Z]+, .+ - Visit note$/);
  });

  it('falls back to a plain note title when the encounter has no chart behind it', async () => {
    await expect(
      encounterMetadata({ params: Promise.resolve({ id: 'no-such-encounter' }) })
    ).resolves.toEqual({ title: 'Visit note' });
  });

  it('reads no fixture at all once the app is pointed at the live API', async () => {
    /*
     * The tab title is the one place a server component reads the fixtures
     * directly, because the hooks beside it are client modules. Against a real
     * deployment that read has to stop: demo names in a browser tab would be
     * indistinguishable from real ones, and the route has no server-side
     * patient read to replace it with yet. A generic title is honest; a
     * fixture name would not be.
     */
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'live');
    try {
      const chart = await import('../(app)/patients/[id]/page');
      const encounter = await import('../(app)/encounters/[id]/page');

      await expect(
        chart.generateMetadata({ params: Promise.resolve({ id: CHART_PATIENT_ID }) })
      ).resolves.toEqual({ title: 'Chart' });
      await expect(
        encounter.generateMetadata({ params: Promise.resolve({ id: ENCOUNTER_ID }) })
      ).resolves.toEqual({ title: 'Visit note' });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
