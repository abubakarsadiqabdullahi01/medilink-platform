import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AttentionList, MetricTile, type AttentionItem } from './dashboard';

afterEach(cleanup);

const item = (n: number, tone: AttentionItem['tone'] = 'warning'): AttentionItem => ({
  id: `i${n}`,
  tone,
  title: `Item ${n}`,
  detail: `Detail ${n}`,
  href: `/somewhere/${n}`,
  action: 'Open',
});

describe('AttentionList', () => {
  it('says plainly that nothing needs attention, instead of drawing an empty box', () => {
    render(
      <AttentionList
        items={[]}
        emptyTitle="You are up to date"
        emptyDetail="Nothing is waiting."
      />,
    );
    expect(screen.getByText('You are up to date')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says it could not find out, which is not the same as there being nothing', () => {
    render(<AttentionList items={[]} error />);
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs your attention')).not.toBeInTheDocument();
  });

  it('makes each row one link to where it is dealt with, and says how urgent it is in words', () => {
    render(<AttentionList items={[item(1, 'danger')]} />);
    const link = screen.getByRole('link', { name: /Urgent: Item 1/ });
    expect(link).toHaveAttribute('href', '/somewhere/1');
    expect(within(link).getByText('Detail 1')).toBeInTheDocument();
  });

  it('shows the most urgent few, counts them all, and lets the rest be opened', () => {
    render(<AttentionList items={[1, 2, 3, 4, 5, 6, 7].map((n) => item(n))} limit={5} />);
    expect(screen.getByText('(7)')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
    expect(screen.getAllByRole('link')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('offers no "show all" when everything already fits', () => {
    render(<AttentionList items={[item(1), item(2)]} limit={5} />);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});

describe('MetricTile', () => {
  it('is a single link as large as the tile', () => {
    render(<MetricTile label="Offers waiting" value={3} href="/practitioner/offers" />);
    const link = screen.getByRole('link', { name: 'Offers waiting' });
    expect(link).toHaveAttribute('href', '/practitioner/offers');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('never shows zero for a figure it could not load', () => {
    render(<MetricTile label="Expected" value={0} error />);
    expect(screen.getByText('Could not load')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('says in words that a tile needs attention, not only by its colour', () => {
    render(<MetricTile label="Timesheets" value={4} tone="warning" />);
    expect(screen.getByText('Needs attention.')).toBeInTheDocument();
  });

  it('keeps a loading tile out of the way of a figure', () => {
    const { container } = render(<MetricTile label="Open shifts" value={9} loading />);
    expect(screen.queryByText('9')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
