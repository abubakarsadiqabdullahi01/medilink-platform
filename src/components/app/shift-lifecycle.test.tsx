import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ShiftLifecycle } from './shift-lifecycle';
import type { LifecycleInput } from './lifecycle';

afterEach(cleanup);

const BASE: LifecycleInput = {
  published: true,
  offered: true,
  accepted: true,
  confirmed: false,
  started: false,
  attendance: null,
};

describe('ShiftLifecycle', () => {
  it('tells the facility it is their turn when an offer has been accepted', () => {
    render(<ShiftLifecycle viewer="facility" state={BASE} />);
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText(/not a booking until the facility confirms it/)).toBeInTheDocument();
  });

  it('tells the practitioner it is waiting for the facility, for the same shift', () => {
    render(<ShiftLifecycle viewer="practitioner" state={BASE} />);
    expect(screen.getByText('Waiting for the facility')).toBeInTheDocument();
    expect(screen.queryByText('Your turn')).not.toBeInTheDocument();
  });

  it('marks exactly one step as the one in progress, and names the others for a screen reader', () => {
    render(<ShiftLifecycle viewer="facility" state={BASE} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(steps.filter((step) => step.getAttribute('aria-current') === 'step')).toHaveLength(1);
    // Published and Offered are behind it; the rest are ahead.
    expect(screen.getAllByText('(done)', { exact: false, selector: 'span.sr-only' })).toHaveLength(2);
    expect(screen.getAllByText('(not yet)', { exact: false, selector: 'span.sr-only' })).toHaveLength(3);
  });

  it('reports progress as a bar a screen reader can read', () => {
    render(<ShiftLifecycle viewer="facility" state={BASE} />);
    const bar = screen.getByRole('progressbar', { name: 'Shift progress' });
    expect(bar).toHaveAttribute('aria-valuetext', 'Step 3 of 6: Confirmed');
  });

  it('draws only the bar and the sentence when compact', () => {
    render(<ShiftLifecycle viewer="practitioner" compact state={BASE} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
