import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ICON } from './icons';
import { NeedsBanner, StatTile } from './dashboard';

afterEach(cleanup);

const tile = (props: Partial<Parameters<typeof StatTile>[0]> = {}) =>
  render(<StatTile href="/facility/shifts" icon={ICON.shift} label="Shifts published" value={13} {...props} />);

describe('StatTile', () => {
  it('is a link to the list behind the number, named by what it counts', () => {
    tile();
    const link = screen.getByRole('link', { name: /Shifts published/ });
    expect(link).toHaveAttribute('href', '/facility/shifts');
    expect(link).toHaveTextContent('13');
  });

  it('says "Could not load" rather than showing zero when the count failed', () => {
    tile({ value: 0, isError: true });
    expect(screen.getByText('Could not load')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows neither a number nor an error while it is still loading', () => {
    tile({ value: 13, isPending: true });
    expect(screen.queryByText('13')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load')).not.toBeInTheDocument();
  });

  it('shows the note that makes the number mean something, but not when there is no number to qualify', () => {
    const { unmount } = tile({ note: 'oldest arrived 5 days ago' });
    expect(screen.getByText('oldest arrived 5 days ago')).toBeInTheDocument();
    unmount();
    tile({ note: 'oldest arrived 5 days ago', isError: true });
    expect(screen.queryByText('oldest arrived 5 days ago')).not.toBeInTheDocument();
  });

  it('shows a time as text, not as a figure', () => {
    tile({ value: '18 Oct, 10:00' });
    expect(screen.getByText('18 Oct, 10:00').className).toMatch(/text-xl/);
  });
});

describe('NeedsBanner', () => {
  it('says how many things are waiting, and how long the oldest has waited', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    render(<NeedsBanner ready count={62} oldest={fiveDaysAgo} />);
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText(/things are waiting on you/)).toBeInTheDocument();
    expect(screen.getByText(/the oldest arrived/)).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    render(<NeedsBanner ready count={1} noun="timesheet" />);
    expect(screen.getByText('timesheet is waiting on you')).toBeInTheDocument();
  });

  it('draws nothing while loading, after a failure, or when nothing is waiting', () => {
    const { container, rerender } = render(<NeedsBanner ready={false} count={9} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NeedsBanner ready count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
