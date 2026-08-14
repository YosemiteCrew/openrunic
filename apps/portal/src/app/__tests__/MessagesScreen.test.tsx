import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MessagesScreen } from '@/app/messages/MessagesScreen';
import { emptyApi, fails, never, stubApi } from '@/__tests__/support';

describe('MessagesScreen', () => {
  it('lists the conversations and opens the first one', async () => {
    render(<MessagesScreen api={stubApi()} />);

    expect(await screen.findByRole('button', { name: /Thyroid result/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /Repeat prescription/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(
      screen.getByText(/Your thyroid result is a little above the usual range\./)
    ).toBeInTheDocument();
  });

  it('switches conversation when another is chosen', async () => {
    render(<MessagesScreen api={stubApi()} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    await userEvent.click(screen.getByRole('button', { name: /Repeat prescription/ }));

    expect(screen.getByRole('button', { name: /Repeat prescription/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getByText(/The repeat has gone to the pharmacy on Elm Row\./)
    ).toBeInTheDocument();
  });

  it('puts the not-for-emergencies notice above the compose box, never below it', async () => {
    render(<MessagesScreen api={stubApi()} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    const notice = screen.getByRole('complementary', { name: 'Not for emergencies' });
    const compose = screen.getByLabelText('Your message');

    // DOCUMENT_POSITION_FOLLOWING means the compose box comes after the notice in the DOM,
    // which is the only ordering that gets the notice read before the message is written.
    expect(notice.compareDocumentPosition(compose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sends a reply, confirms it and clears the box', async () => {
    render(<MessagesScreen api={stubApi()} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    const compose = screen.getByLabelText('Your message');
    await userEvent.type(compose, 'Thank you, that makes sense.');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Message sent.');
    expect(compose).toHaveValue('');
    expect(screen.getByText('Thank you, that makes sense.')).toBeInTheDocument();
  });

  it('keeps the draft on the page when the send fails', async () => {
    render(<MessagesScreen api={stubApi({ sendMessage: fails })} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    const compose = screen.getByLabelText('Your message');
    await userEvent.type(compose, 'Please could you explain the result.');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Your message did not send, and your draft is still in the box.'
    );
    // The whole point: not one character lost.
    expect(compose).toHaveValue('Please could you explain the result.');
  });

  it('will not send an empty message', async () => {
    render(<MessagesScreen api={stubApi()} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Your message'), '   ');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('starts a fresh draft when the reader switches conversation', async () => {
    render(<MessagesScreen api={stubApi()} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    await userEvent.type(screen.getByLabelText('Your message'), 'Half a sentence');
    await userEvent.click(screen.getByRole('button', { name: /Repeat prescription/ }));

    // Carrying half a thought over to a different reader would be worse than losing it.
    expect(screen.getByLabelText('Your message')).toHaveValue('');
  });

  it('composes and sends using the keyboard alone', async () => {
    render(<MessagesScreen api={stubApi()} />);
    await screen.findByRole('button', { name: /Thyroid result/ });

    screen.getByLabelText('Your message').focus();
    await userEvent.keyboard('Sent with the keyboard.');
    await userEvent.tab();

    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Message sent.'));
  });

  it('states the loading fact while the messages are on their way', () => {
    render(<MessagesScreen api={stubApi({ getThreads: never })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your messages.');
  });

  it('says there are no messages when the inbox is empty', async () => {
    render(<MessagesScreen api={emptyApi()} />);

    expect(
      await screen.findByRole('heading', { name: 'You have no messages.' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your message')).not.toBeInTheDocument();
  });

  it('states the error and recovers when the reader tries again', async () => {
    let attempt = 0;
    const good = stubApi();
    const api = stubApi({
      getThreads: () => {
        attempt += 1;
        return attempt === 1 ? fails() : good.getThreads();
      },
    });

    render(<MessagesScreen api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your messages did not load.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Thyroid result/ })).toBeInTheDocument();
  });
});
