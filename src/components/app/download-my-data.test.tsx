import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { get, post, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/ui/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ui/api')>('@/lib/ui/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => get(...args),
      post: (...args: unknown[]) => post(...args),
    },
  };
});

vi.mock('sonner', () => ({ toast }));

import { ApiError } from '@/lib/ui/api';
import { useDownloadMyData } from './download-my-data';

const stepUpRefusal = () =>
  new ApiError({ code: 'step_up_required', message: 'Confirm your password to continue.', status: 401 });

function Screen() {
  const mine = useDownloadMyData();
  return (
    <>
      {mine.dialog}
      <button onClick={() => void mine.download()}>Download my data</button>
    </>
  );
}

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Screen />
    </QueryClientProvider>,
  );
}

const saved: { href: string; download: string }[] = [];

afterEach(cleanup);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue({});
  toast.success.mockReset();
  toast.error.mockReset();
  saved.length = 0;
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
});

describe('downloading my data', () => {
  it('saves what the server returns as a dated file', async () => {
    get.mockResolvedValue({ account: { id: 'u1' } });
    renderScreen();

    fireEvent.click(screen.getByText('Download my data'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(get).toHaveBeenCalledWith('/api/v1/me/export');
    expect(saved[0]!.download).toMatch(/^medilink-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(toast.success).toHaveBeenCalledWith('Downloaded');
  });

  it('asks for the password when the server does, then downloads without being asked twice', async () => {
    get.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValue({ account: { id: 'u1' } });
    renderScreen();

    fireEvent.click(screen.getByText('Download my data'));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a password' } });
    expect(saved).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(post).toHaveBeenCalledWith('/api/v1/auth/step-up', { password: 'a password' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('saves nothing when the password prompt is cancelled', async () => {
    get.mockRejectedValue(stepUpRefusal());
    renderScreen();

    fireEvent.click(screen.getByText('Download my data'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(saved).toHaveLength(0);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('says so when it fails for any other reason, and does not ask for a password', async () => {
    get.mockRejectedValue(new ApiError({ code: 'internal_error', message: 'Something went wrong.', status: 500 }));
    renderScreen();

    fireEvent.click(screen.getByText('Download my data'));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]![0]).toBe('Could not build the export');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });
});
