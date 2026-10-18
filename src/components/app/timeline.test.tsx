import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Timeline } from './timeline';
import { StatusBadge, SeverityBadge } from './status-badge';

afterEach(cleanup);

describe('Timeline', () => {
  it('lists the steps in order and says each one’s state in words', () => {
    render(
      <Timeline
        label="Timesheet history"
        steps={[
          { id: 'a', title: 'Submitted', state: 'done', when: '14 Oct 2026, 18:10' },
          { id: 'b', title: 'Awaiting the hospital', state: 'current' },
          { id: 'c', title: 'Approved', state: 'upcoming' },
          { id: 'd', title: 'Rejected', state: 'problem', detail: 'Hours do not match the roster' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Timesheet history' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Done: Submitted');
    expect(items[1]).toHaveTextContent('Current: Awaiting the hospital');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).toHaveTextContent('Not yet: Approved');
    expect(items[3]).toHaveTextContent('Problem: Rejected');
    expect(items[3]).toHaveTextContent('Hours do not match the roster');
  });
});

describe('status badges', () => {
  it('draw a mark beside the word, so no status is colour alone', () => {
    const { container, rerender } = render(<StatusBadge status="APPROVED" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container).toHaveTextContent('Approved');
    rerender(<StatusBadge status="REJECTED" />);
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<SeverityBadge severity="DEATH" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container).toHaveTextContent('Death');
  });
});
