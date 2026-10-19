import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pager } from './pager';

afterEach(cleanup);

describe('Pager', () => {
  it('draws nothing for a list that fits on one page', () => {
    const { container } = render(
      <Pager pageIndex={0} hasNext={false} onPrevious={vi.fn()} onNext={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('says which page it is on and moves in both directions', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<Pager pageIndex={1} hasNext onPrevious={onPrevious} onNext={onNext} />);

    expect(screen.getByRole('status')).toHaveTextContent('Page 2');
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(
      <Pager pageIndex={0} hasNext onPrevious={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(<Pager pageIndex={2} hasNext={false} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('holds both buttons and says so while the next page loads', () => {
    render(<Pager pageIndex={1} hasNext busy onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Page 2 · loading');
  });
});
