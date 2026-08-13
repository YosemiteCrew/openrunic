import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BillsScreen } from '@/app/bills/BillsScreen';
import { emptyApi, fails, never, stubApi } from '@/__tests__/support';

async function openFirstStatement(api = stubApi()) {
  render(<BillsScreen api={api} />);
  await screen.findByRole('heading', { level: 3, name: 'Issued 15 June 2026' });
  const [first] = screen.getAllByRole('button', { name: 'See what this was for' });
  await userEvent.click(first as HTMLElement);
}

describe('BillsScreen', () => {
  it('lists the statements with their status in words', async () => {
    render(<BillsScreen api={stubApi()} />);

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Issued 15 June 2026' })
    ).toBeInTheDocument();
    expect(screen.getByText('Statement ST-2026-0418')).toBeInTheDocument();
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('In credit')).toBeInTheDocument();
  });

  it('labels a credit in words, not with a minus sign', async () => {
    render(<BillsScreen api={stubApi()} />);
    await screen.findByText('Statement ST-2026-0233');

    expect(screen.getByText('credit')).toBeInTheDocument();
    expect(screen.getByText('£12.00 GBP')).toBeInTheDocument();
    expect(screen.queryByText(/-£/)).not.toBeInTheDocument();
  });

  it('shows line items in plain language, with the code kept beside them', async () => {
    await openFirstStatement();

    const table = screen.getByRole('table');
    expect(
      within(table).getByText('Endocrinology appointment with Dr. Okafor')
    ).toBeInTheDocument();
    expect(within(table).getByText('CONS-30')).toBeInTheDocument();
    expect(within(table).getByText('£65.00')).toBeInTheDocument();
  });

  it('names the currency in the column header and right-aligns the money', async () => {
    await openFirstStatement();

    const amountHeader = screen.getByRole('columnheader', { name: 'Amount (GBP)' });
    expect(amountHeader).toHaveClass('or-table__cell--right');
    expect(screen.getByText(/Amounts are in pounds sterling\./)).toBeInTheDocument();
  });

  it('states the total and what is still to pay', async () => {
    await openFirstStatement();

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Still to pay')).toBeInTheDocument();
    expect(screen.getAllByText('£84.50 GBP')).toHaveLength(2);
  });

  it('confirms before charging, and states that a payment cannot be undone here', async () => {
    const api = stubApi();
    const paySpy = vi.spyOn(api, 'payStatement');
    await openFirstStatement(api);

    await userEvent.click(screen.getByRole('button', { name: 'Pay this statement' }));
    expect(paySpy).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'This takes GBP 84.50 from the card the practice holds for you.'
    );
    expect(dialog).toHaveTextContent('Payments cannot be reversed from this portal.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay now' }));

    await waitFor(() => expect(paySpy).toHaveBeenCalledWith('stmt-1'));
  });

  it('gives a receipt with the amount, the card and a reference', async () => {
    await openFirstStatement();

    await userEvent.click(screen.getByRole('button', { name: 'Pay this statement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pay now' }));

    const receipt = await screen.findByRole('status');
    expect(receipt).toHaveTextContent('Payment received');
    expect(receipt).toHaveTextContent('£84.50');
    expect(receipt).toHaveTextContent('with the card ending 4242');
    expect(receipt).toHaveTextContent(/receipt reference is receipt-/);
  });

  it('backs out of a payment without charging', async () => {
    const api = stubApi();
    const paySpy = vi.spyOn(api, 'payStatement');
    await openFirstStatement(api);

    await userEvent.click(screen.getByRole('button', { name: 'Pay this statement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(paySpy).not.toHaveBeenCalled();
  });

  it('says no money moved when the payment fails', async () => {
    await openFirstStatement(stubApi({ payStatement: fails }));

    await userEvent.click(screen.getByRole('button', { name: 'Pay this statement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pay now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The payment did not go through and you have not been charged.'
    );
  });

  it('offers no pay button on a statement that is not due', async () => {
    render(<BillsScreen api={stubApi()} />);
    await screen.findByText('Statement ST-2026-0233');

    const [, second] = screen.getAllByRole('button', { name: 'See what this was for' });
    await userEvent.click(second as HTMLElement);

    expect(screen.queryByRole('button', { name: 'Pay this statement' })).not.toBeInTheDocument();
  });

  it('goes back to the list from the detail', async () => {
    await openFirstStatement();

    await userEvent.click(screen.getByRole('button', { name: 'Back to your statements' }));

    expect(await screen.findByText('Statement ST-2026-0233')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('pays from the keyboard alone', async () => {
    const api = stubApi();
    const paySpy = vi.spyOn(api, 'payStatement');
    await openFirstStatement(api);

    const trigger = screen.getByRole('button', { name: 'Pay this statement' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    const confirm = screen.getByRole('button', { name: 'Pay now' });
    confirm.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(paySpy).toHaveBeenCalledOnce());
  });

  it('states the loading fact while the statements are on their way', () => {
    render(<BillsScreen api={stubApi({ getStatements: never })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your statements.');
  });

  it('says there are no statements when there are none', async () => {
    render(<BillsScreen api={emptyApi()} />);

    expect(
      await screen.findByRole('heading', { name: 'You have no statements.' })
    ).toBeInTheDocument();
  });

  it('states the error and recovers when the reader tries again', async () => {
    let attempt = 0;
    const good = stubApi();
    const api = stubApi({
      getStatements: () => {
        attempt += 1;
        return attempt === 1 ? fails() : good.getStatements();
      },
    });

    render(<BillsScreen api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your statements did not load.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Statement ST-2026-0418')).toBeInTheDocument();
  });
});
