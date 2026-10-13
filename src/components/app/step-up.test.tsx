import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const post = vi.fn();
vi.mock('@/lib/ui/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ui/api')>('@/lib/ui/api');
  return { ...actual, api: { ...actual.api, post: (...args: unknown[]) => post(...args) } };
});

import { ApiError } from '@/lib/ui/api';
import { useStepUp } from './step-up';

const stepUpRefusal = () =>
  new ApiError({ code: 'step_up_required', message: 'Confirm your password to continue.', status: 401 });
const otherFailure = () => new ApiError({ code: 'nope', message: 'No.', status: 409 });

/** A screen whose action was refused, as the money screens are. */
function Screen({
  error,
  again,
  onHandled,
}: {
  error: ApiError;
  again: () => void;
  onHandled: (handled: boolean) => void;
}) {
  const stepUp = useStepUp('Releasing a payout moves money.');
  return (
    <>
      {stepUp.dialog}
      <button onClick={() => onHandled(stepUp.handle(error, again))}>act</button>
    </>
  );
}

function renderScreen(error: ApiError, again: () => void, onHandled = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Screen error={error} again={again} onHandled={onHandled} />
    </QueryClientProvider>,
  );
  return onHandled;
}

// Vitest runs without globals here, so the library cannot clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({});
});

describe('asking for a fresh password, then trying again', () => {
  it('repeats the refused action once the password has been accepted', async () => {
    const again = vi.fn();
    renderScreen(stepUpRefusal(), again);

    fireEvent.click(screen.getByText('act'));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(again).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/api/v1/auth/step-up', { password: 'a password' });
  });

  it('does not repeat it when the dialog is cancelled', async () => {
    const again = vi.fn();
    renderScreen(stepUpRefusal(), again);

    fireEvent.click(screen.getByText('act'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(again).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not repeat it when the password is wrong', async () => {
    post.mockRejectedValue(
      new ApiError({ code: 'invalid_credentials', message: 'That password is not correct.', status: 401 }),
    );
    const again = vi.fn();
    renderScreen(stepUpRefusal(), again);

    fireEvent.click(screen.getByText('act'));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not correct');
    expect(again).not.toHaveBeenCalled();
  });

  it('leaves any other failure for the screen to report', async () => {
    const again = vi.fn();
    const handled = renderScreen(otherFailure(), again);

    fireEvent.click(screen.getByText('act'));

    expect(handled).toHaveBeenCalledWith(false);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
