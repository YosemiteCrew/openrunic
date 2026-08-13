import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormsScreen } from '@/app/forms/FormsScreen';
import { emptyApi, fails, never, stubApi } from '@/__tests__/support';
import type { FormTask } from '@/lib/api/types';

async function openFirstForm(api = stubApi()) {
  render(<FormsScreen api={api} />);
  await screen.findByRole('heading', { level: 2, name: 'Before your thyroid review' });
  await userEvent.click(screen.getByRole('button', { name: 'Continue the form' }));
}

describe('FormsScreen', () => {
  it('lists the forms with what each is for and when it is needed', async () => {
    render(<FormsScreen api={stubApi()} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Before your thyroid review' })
    ).toBeInTheDocument();
    expect(screen.getByText('Needed by 1 September 2026')).toBeInTheDocument();
    expect(screen.getByText('Saved, not sent')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('resumes a part-finished form with the saved answers already in place', async () => {
    await openFirstForm();

    expect(screen.getByRole('radio', { name: 'Some days' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Most days' })).not.toBeChecked();
  });

  it('shows progress in words and updates it as questions are answered', async () => {
    await openFirstForm();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuetext', '1 of 3 answered');

    await userEvent.click(screen.getByRole('radio', { name: 'No' }));

    await waitFor(() => expect(bar).toHaveAttribute('aria-valuetext', '2 of 3 answered'));
  });

  it('saves progress and says it can be picked up later', async () => {
    const api = stubApi();
    const saveSpy = vi.spyOn(api, 'saveForm');
    await openFirstForm(api);

    await userEvent.click(screen.getByRole('radio', { name: 'Most days' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and finish later' }));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        'form-1',
        expect.objectContaining({ 'q-1': 'Most days' })
      )
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your answers are saved. You can close this and come back to it later.'
    );
  });

  it('keeps the answers on the page when the save fails', async () => {
    await openFirstForm(stubApi({ saveForm: fails }));

    await userEvent.click(screen.getByRole('radio', { name: 'Most days' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and finish later' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your answers were not saved');
    expect(screen.getByRole('radio', { name: 'Most days' })).toBeChecked();
  });

  it('confirms a submitted form and offers the way back', async () => {
    const api = stubApi();
    const submitSpy = vi.spyOn(api, 'submitForm');
    await openFirstForm(api);

    await userEvent.type(
      screen.getByLabelText(/Is there anything else you want to raise/),
      'Nothing else.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send to the practice' }));

    expect(
      await screen.findByRole('heading', { name: 'Your form has gone to the practice' })
    ).toBeInTheDocument();
    expect(submitSpy).toHaveBeenCalledWith(
      'form-1',
      expect.objectContaining({ 'q-3': 'Nothing else.' })
    );

    await userEvent.click(screen.getByRole('button', { name: 'Back to your forms' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Contact details check' })
    ).toBeInTheDocument();
  });

  it('keeps the answers on the page when the send fails', async () => {
    await openFirstForm(stubApi({ submitForm: fails }));

    await userEvent.click(screen.getByRole('button', { name: 'Send to the practice' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your form did not send');
    expect(screen.getByRole('radio', { name: 'Some days' })).toBeChecked();
  });

  it('closes a form without sending it', async () => {
    await openFirstForm();

    await userEvent.click(screen.getByRole('button', { name: 'Back to your forms' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Contact details check' })
    ).toBeInTheDocument();
  });

  it('opens a not-started form and answers it from the keyboard alone', async () => {
    render(<FormsScreen api={stubApi()} />);
    await screen.findByRole('heading', { level: 2, name: 'Contact details check' });

    await userEvent.click(screen.getByRole('button', { name: 'Open the form' }));

    const yes = screen.getByRole('radio', { name: 'Yes' });
    yes.focus();
    await userEvent.keyboard('{ }');

    expect(yes).toBeChecked();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 of 2 answered');
  });

  it('renders a choice question with no options rather than crashing on it', async () => {
    const broken: FormTask = {
      id: 'form-broken',
      title: 'Odd form',
      purpose: 'A question that arrived without its choices.',
      dueOn: '2026-09-01',
      status: 'not-started',
      answers: {},
      questions: [{ id: 'q-x', prompt: 'Pick one', kind: 'single-choice' }],
    };

    render(<FormsScreen api={stubApi({ getForms: () => Promise.resolve([broken]) })} />);
    await screen.findByRole('heading', { level: 2, name: 'Odd form' });
    await userEvent.click(screen.getByRole('button', { name: 'Open the form' }));

    expect(screen.getByText('Pick one')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('states the loading fact while the forms are on their way', () => {
    render(<FormsScreen api={stubApi({ getForms: never })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your forms.');
  });

  it('says there is nothing to fill in when there is not', async () => {
    render(<FormsScreen api={emptyApi()} />);

    expect(
      await screen.findByRole('heading', { name: 'You have no forms to fill in.' })
    ).toBeInTheDocument();
  });

  it('states the error and recovers when the reader tries again', async () => {
    let attempt = 0;
    const good = stubApi();
    const api = stubApi({
      getForms: () => {
        attempt += 1;
        return attempt === 1 ? fails() : good.getForms();
      },
    });

    render(<FormsScreen api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your forms did not load.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Before your thyroid review' })
    ).toBeInTheDocument();
  });
});
