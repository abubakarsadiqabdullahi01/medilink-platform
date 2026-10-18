import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DataTable, type Column } from './data-table';

interface Row {
  id: string;
  who: string;
  status: string;
  when: string;
  amount: string;
}

const rows: Row[] = [
  { id: '1', who: 'Amina Yusuf', status: 'Submitted', when: '14 Oct 2026', amount: '₦48,000.00' },
  { id: '2', who: 'Blessing Okoro', status: 'Approved', when: '15 Oct 2026', amount: '₦36,500.00' },
];

const columns: Column<Row>[] = [
  { id: 'who', header: 'Practitioner', role: 'identity', cell: (row) => row.who },
  { id: 'status', header: 'Status', role: 'status', cell: (row) => row.status },
  { id: 'when', header: 'Shift date', cell: (row) => row.when },
  { id: 'amount', header: 'Amount', numeric: true, align: 'right', cell: (row) => row.amount },
];

afterEach(cleanup);

describe('DataTable', () => {
  it('is a real table with a caption and column headers', () => {
    render(
      <DataTable caption="Timesheets" rows={rows} columns={columns} getKey={(row) => row.id} />,
    );
    const table = screen.getByRole('table', { name: 'Timesheets' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Practitioner', 'Status', 'Shift date', 'Amount']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('keeps identity, status, date, money and the next step on every narrow-screen card', () => {
    render(
      <DataTable
        caption="Timesheets"
        rows={rows}
        columns={columns}
        getKey={(row) => row.id}
        action={(row) => <button>Review {row.who}</button>}
      />,
    );
    const list = screen.getByRole('list', { name: 'Timesheets' });
    const card = within(list).getAllByRole('listitem')[0]!;
    for (const text of ['Amina Yusuf', 'Submitted', '14 Oct 2026', '₦48,000.00']) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
    expect(within(card).getByRole('button', { name: 'Review Amina Yusuf' })).toBeInTheDocument();
    // The detail labels come from the column headers, so nothing on a card is an unlabelled number.
    expect(within(card).getByText('Amount')).toBeInTheDocument();
  });

  it('can leave a repeated column out of the card', () => {
    render(
      <DataTable
        caption="x"
        rows={rows}
        columns={[
          ...columns,
          { id: 'dupe', header: 'Duplicate', hideOnCard: true, cell: (row) => `dup-${row.id}` },
        ]}
        getKey={(row) => row.id}
      />,
    );
    const card = within(screen.getByRole('list', { name: 'x' })).getAllByRole('listitem')[0]!;
    expect(within(card).queryByText('dup-1')).not.toBeInTheDocument();
  });
});
