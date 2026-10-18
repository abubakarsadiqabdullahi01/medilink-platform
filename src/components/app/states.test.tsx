import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/ui/api';
import { ErrorState, FilteredEmpty, ListSkeleton, describeError } from './states';

afterEach(cleanup);

const failure = (status: number, message = 'x') => new ApiError({ code: 'c', message, status });

describe('describeError', () => {
  it('tells a refusal from a connection problem from a server problem', () => {
    expect(describeError(failure(403, 'You do not have access to this facility.'))).toMatchObject({
      kind: 'forbidden',
      retryable: false,
      description: 'You do not have access to this facility.',
    });
    expect(describeError(failure(404)).kind).toBe('not-found');
    expect(describeError(failure(401)).kind).toBe('signed-out');
    expect(describeError(failure(503))).toMatchObject({ kind: 'server', retryable: true });
    expect(describeError(new TypeError('Failed to fetch'))).toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });

  it('never calls a refused request something to try again', () => {
    expect(describeError(failure(403)).retryable).toBe(false);
    expect(describeError(failure(404)).retryable).toBe(false);
  });
});

describe('ErrorState', () => {
  it('is announced, explains itself, and retries', () => {
    const retry = vi.fn();
    render(<ErrorState error={new TypeError('offline')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach Medilink');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('offers no retry for a refusal, and a way back in for a signed-out person', () => {
    const { rerender } = render(<ErrorState error={failure(403)} onRetry={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    rerender(<ErrorState error={failure(401)} />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

describe('FilteredEmpty and loading', () => {
  it('names the cause and offers the way out', () => {
    const clear = vi.fn();
    render(<FilteredEmpty noun="shifts" activeCount={2} onClear={clear} />);
    expect(screen.getByText('No shifts match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(clear).toHaveBeenCalled();
  });

  it('tells a screen reader what is loading', () => {
    render(<ListSkeleton label="Loading shifts" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading shifts…');
  });
});
