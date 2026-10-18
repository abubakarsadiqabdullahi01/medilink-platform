import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

afterEach(cleanup);

const base = {
  open: true,
  onOpenChange: () => undefined,
  title: 'Reject this timesheet?',
  object: 'Timesheet · Amina Yusuf · 14 Oct 2026',
  consequence: 'Amina is told it was rejected and why, and can correct and send it again.',
  confirmLabel: 'Reject timesheet',
  onConfirm: () => undefined,
};

describe('ConfirmDialog', () => {
  it('names the object, the consequence and whether it can be undone', () => {
    render(<ConfirmDialog {...base} reversible="She can resubmit." />);
    const dialog = screen.getByRole('dialog', { name: 'Reject this timesheet?' });
    expect(dialog).toHaveTextContent('Timesheet · Amina Yusuf · 14 Oct 2026');
    expect(dialog).toHaveTextContent('can correct and send it again');
    expect(dialog).toHaveTextContent('You can undo this. She can resubmit.');
  });

  it('says plainly when something cannot be undone', () => {
    render(<ConfirmDialog {...base} reversible={false} destructive />);
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('confirms with the verb and the noun, not "OK"', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} reversible onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject timesheet' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels without confirming', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog {...base} reversible onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot be dismissed or cancelled while the action is running', () => {
    render(<ConfirmDialog {...base} reversible loading />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject timesheet' })).toBeDisabled();
  });
});
