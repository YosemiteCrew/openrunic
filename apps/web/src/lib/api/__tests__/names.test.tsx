import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';
import { usePatientNames, useProviderNames } from '@/lib/api/names';
import { createMockClient } from '@/lib/api/mock/client';
import { MOCK_DIRECTORY_USERS, MOCK_PATIENTS } from '@/lib/api/mock/fixtures';
import type { ApiClient } from '@/lib/api/types';

/**
 * The seam three worklists name their rows through (#559).
 *
 * What is asserted here is the part a screen test cannot see. A screen test can
 * only tell that a name appeared; these say HOW - one request for a page rather
 * than one per row, an id that cannot be named rendering as absent rather than
 * as anything else, and a failed read leaving the queue of clinical work on
 * screen instead of replacing it with an error.
 */

function ids(): { first: string; second: string } {
  const first = MOCK_PATIENTS[0]?.id;
  const second = MOCK_PATIENTS[1]?.id;
  if (!first || !second) throw new Error('The fixtures need two patients.');
  return { first, second };
}

/** A real mock client with its patient list watched. */
function watched(): { client: ApiClient; list: ReturnType<typeof vi.fn> } {
  const base = createMockClient();
  const list = vi.fn(base.patients.list);
  return { client: { ...base, patients: { ...base.patients, list } }, list };
}

/* A word, not a dash. `toHaveTextContent` matches a SUBSTRING, and every id
   here is a UUID full of dashes - so a lookup that fell back to the id it was
   given read as the absence it was supposed to be distinguished from, and the
   arm that plants exactly that mistake passed. */
const UNNAMED = 'unnamed';

function PatientProbe({
  client,
  rows,
}: Readonly<{ client: ApiClient; rows: readonly (string | null)[] }>) {
  const named = usePatientNames(rows, { client });
  return (
    <ol>
      {rows.map((id, index) => (
        <li key={`${id ?? 'none'}-${index}`}>{named(id)?.mrn ?? UNNAMED}</li>
      ))}
    </ol>
  );
}

function ProviderProbe({ client, id }: Readonly<{ client: ApiClient; id: string | null }>) {
  const named = useProviderNames({ client });
  return <p data-testid="provider">{named(id) ?? UNNAMED}</p>;
}

const rowsOf = async (): Promise<string[]> =>
  (await screen.findAllByRole('listitem')).map((row) => row.textContent ?? '');

describe('usePatientNames', () => {
  it('names a page of rows in one request, whatever the page repeats', async () => {
    const { first, second } = ids();
    const { client, list } = watched();

    render(<PatientProbe client={client} rows={[second, first, second, null]} />);

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    // The distinct ids, sorted: the request is a property of the SET on the
    // page, so a re-sorted page of the same patients is the same read. The size
    // is asked for explicitly because the route's default page is 25, and a
    // longer page would be named down to its first 25 rows.
    const wanted = [first, second].sort((a, b) => a.localeCompare(b));
    expect(list).toHaveBeenCalledWith({ ids: wanted, pageSize: 2 }, expect.anything());

    await waitFor(async () =>
      expect(await rowsOf()).toEqual([
        MOCK_PATIENTS[1]?.mrn,
        MOCK_PATIENTS[0]?.mrn,
        MOCK_PATIENTS[1]?.mrn,
        UNNAMED,
      ])
    );
  });

  it('re-reads nothing when the same patients arrive in another order', async () => {
    const { first, second } = ids();
    const { client, list } = watched();

    const { rerender } = render(<PatientProbe client={client} rows={[first, second]} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    rerender(<PatientProbe client={client} rows={[second, first]} />);
    await waitFor(async () => expect((await rowsOf())[0]).toBe(MOCK_PATIENTS[1]?.mrn));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('leaves an id the read did not answer for unnamed, rather than inventing one', async () => {
    const { first } = ids();
    const stranger = '0192f1a0-0000-7000-8000-0000000000ff';

    render(<PatientProbe client={createMockClient()} rows={[first, stranger]} />);

    await waitFor(async () => expect((await rowsOf())[0]).toBe(MOCK_PATIENTS[0]?.mrn));
    expect((await rowsOf())[1]).toBe(UNNAMED);
  });

  it('asks nothing when the page names no patient at all', async () => {
    const { client, list } = watched();

    render(<PatientProbe client={client} rows={[null, null]} />);

    await waitFor(async () => expect(await rowsOf()).toEqual([UNNAMED, UNNAMED]));
    // A practice-wide inbox must not turn into a read of the whole index.
    expect(list).not.toHaveBeenCalled();
  });

  it('names as many as one read can hold rather than having the whole read refused', async () => {
    const { client, list } = watched();
    // One more than `MAX_PAGE_SIZE`, which the route enforces rather than
    // clamps. Asking for all of them is a 400 and a column with NO names in
    // it; asking for a page of them leaves the rest as the same absence any
    // other unresolvable id renders.
    const many = Array.from(
      { length: 101 },
      (_unused, index) => `0192f1a0-0000-7000-8000-${String(index).padStart(12, '0')}`
    );

    render(<PatientProbe client={client} rows={many} />);

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    const [query] = list.mock.calls[0] as [{ ids: string[]; pageSize: number }];
    expect(query.ids).toHaveLength(100);
    expect(query.pageSize).toBe(100);
  });

  it('leaves the rows unnamed when the read fails, and never throws', async () => {
    const { first } = ids();
    const base = createMockClient();
    const client = {
      ...base,
      patients: {
        ...base.patients,
        list: () => Promise.reject(new ApiError('nope', { kind: 'network' })),
      },
    } as ApiClient;

    render(<PatientProbe client={client} rows={[first]} />);

    // The whole point of the seam answering with a lookup and no state: a
    // queue of clinical work stays on screen when a display name does not.
    await waitFor(async () => expect(await rowsOf()).toEqual([UNNAMED]));
  });
});

describe('useProviderNames', () => {
  it('names a clinician the way the chart does, credential included', async () => {
    const okafor = MOCK_DIRECTORY_USERS[0];
    if (!okafor) throw new Error('The fixtures need a directory user.');

    render(<ProviderProbe client={createMockClient()} id={okafor.id} />);

    await waitFor(() =>
      expect(screen.getByTestId('provider')).toHaveTextContent(
        `${okafor.givenName} ${okafor.familyName}, ${okafor.credential ?? ''}`
      )
    );
  });

  it('answers null for an id the directory does not hold, and for no id at all', async () => {
    render(<ProviderProbe client={createMockClient()} id="0192f1a0-0000-7000-8000-0000000000fe" />);
    await waitFor(() => expect(screen.getByTestId('provider')).toHaveTextContent(/^unnamed$/));

    render(<ProviderProbe client={createMockClient()} id={null} />);
    expect(screen.getAllByTestId('provider')[1]).toHaveTextContent(/^unnamed$/);
  });
});
