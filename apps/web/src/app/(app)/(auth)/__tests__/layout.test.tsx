import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AuthLayout from '../layout';

/**
 * The sign-in group's layout, which deliberately has almost nothing in it.
 *
 * Worth a test anyway: "renders nothing of its own" is a decision rather than
 * an omission - the shell belongs to people who are signed in and the marketing
 * masthead to people reading about the project - and a later change that
 * wrapped a frame around the sign-in form would be a change to that decision.
 */
describe('AuthLayout', () => {
  it('renders the sign-in form and no frame around it', () => {
    const { container } = render(
      <AuthLayout>
        <p>Sign in to openrunic</p>
      </AuthLayout>
    );

    expect(screen.getByText('Sign in to openrunic')).toBeInTheDocument();
    expect(container.firstElementChild?.tagName).toBe('P');
  });
});
