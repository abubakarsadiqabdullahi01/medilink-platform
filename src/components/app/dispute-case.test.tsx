import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/ui/api', () => ({
  api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) },
  errorMessage: (error: unknown) => String(error),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PartyCaseDialog, type CaseViewer, type PartyCase } from './dispute-case';

/**
 * M14-03 on the screen: who is asked to reply, what they are told about the date, that a reply
 * is a form for the side that owes one and words for everybody else, and which scope each side
 * reads and writes at. What the server leaves out of a party's view it leaves out; this draws
 * what arrives.
 */

const FACILITY: CaseViewer = { side: 'FACILITY', facilityId: 'facility-1' };
const PRACTITIONER: CaseViewer = { side: 'PRACTITIONER' };

const OPENED = '2026-10-10T09:00:00.000Z';
const REPLY_BY = '2026-10-17T09:00:00.000Z';

const base = (fields: Partial<PartyCase> = {}): PartyCase => ({
  id: 'case-1',
  category: 'HOURS',
  reason: 'The hours on the sheet are not the hours I worked.',
  status: 'OPEN',
  outcome: null,
  decisionReason: null,
  resolutionNotes: null,
  raisedParty: 'PRACTITIONER',
  createdAt: OPENED,
  respondBy: REPLY_BY,
  responseNote: null,
  respondedAt: null,
  responseOverdue: false,
  ...fields,
});

/** `row` is what the list had; `fresh` is what the server says now, which differs after a reply. */
function show(viewer: CaseViewer, row: PartyCase, evidence: unknown[] = [], fresh: PartyCase = row) {
  get.mockResolvedValue({ dispute: fresh, side: viewer.side, evidence });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PartyCaseDialog
        viewer={viewer}
        row={row}
        title="Hours"
        description="Shift"
        listKey={['list']}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

const field = () => screen.queryByLabelText('Your side of it');

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue({});
});
afterEach(cleanup);

describe('the reply a case asks for', () => {
  it('is a form for the side that did not raise it, with the date they are asked by', async () => {
    show(FACILITY, base());

    expect(await screen.findByLabelText('Your side of it')).toBeInTheDocument();
    expect(screen.getByTestId('dispute-reply')).toHaveTextContent('You are asked to reply by');
    expect(screen.getByTestId('dispute-reply')).toHaveTextContent('17 Oct 2026');
  });

  it('is not a form for the side that raised it, who is told the other side was asked', async () => {
    show(FACILITY, base({ raisedParty: 'FACILITY' }));

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(field()).not.toBeInTheDocument();
    expect(screen.getByTestId('dispute-reply')).toHaveTextContent('The practitioner is asked to reply by');
  });

  it('is not a form once a reply has been written, and is shown instead, with when', async () => {
    show(
      FACILITY,
      base({
        responseNote: 'Handover was at the scheduled time.',
        respondedAt: '2026-10-12T09:00:00.000Z',
      }),
    );

    expect(await screen.findByText('Handover was at the scheduled time.')).toBeInTheDocument();
    expect(field()).not.toBeInTheDocument();
    expect(screen.getByTestId('dispute-reply')).not.toHaveTextContent('after the reply-by date');
  });

  it('says when a reply came after the date, without making anything of it', async () => {
    show(
      PRACTITIONER,
      base({
        raisedParty: 'FACILITY',
        responseNote: 'I was on the ward until nine.',
        respondedAt: '2026-10-19T09:00:00.000Z',
        responseOverdue: true,
      }),
    );

    expect(await screen.findByText('I was on the ward until nine.')).toBeInTheDocument();
    expect(screen.getByTestId('dispute-reply')).toHaveTextContent('after the reply-by date');
  });

  it('keeps a form open past the date, and says a late reply is still read and may not be waited for', async () => {
    show(PRACTITIONER, base({ raisedParty: 'FACILITY', responseOverdue: true }));

    expect(await screen.findByLabelText('Your side of it')).toBeInTheDocument();
    expect(screen.getByText('Past the date')).toBeInTheDocument();
    expect(screen.getByText(/You can still reply while the case is open/)).toBeInTheDocument();
  });

  it('tells the side that raised it, past the date, that the officer can decide without a reply', async () => {
    show(FACILITY, base({ raisedParty: 'FACILITY', responseOverdue: true }));

    expect(await screen.findByText('The officer can decide without it.')).toBeInTheDocument();
  });

  it('says nobody replied on a case that has finished without one', async () => {
    show(FACILITY, base({ status: 'RESOLVED', outcome: 'DISMISSED', raisedParty: 'FACILITY' }));

    expect(await screen.findByText('The practitioner did not reply.')).toBeInTheDocument();
    expect(field()).not.toBeInTheDocument();
  });

  it('shows the case as it is now, not as the list had it: a reply written a moment ago is there at once', async () => {
    const stale = base();
    const fresh = { ...stale, responseNote: 'Handover was at the scheduled time.', respondedAt: '2026-10-12T09:00:00.000Z' };
    show(FACILITY, stale, [], fresh);

    expect(await screen.findByText('Handover was at the scheduled time.')).toBeInTheDocument();
    expect(field()).not.toBeInTheDocument();
  });

  it('sends nothing until there are words, and then the trimmed words', async () => {
    show(FACILITY, base());

    const box = await screen.findByLabelText('Your side of it');
    const send = screen.getByRole('button', { name: 'Send reply' });
    fireEvent.change(box, { target: { value: 'Too short.' } });
    expect(send).toBeDisabled();
    expect(screen.getByText(/characters to go/)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '   Handover was at the scheduled time.   ' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/disputes/case-1/respond', {
      facilityId: 'facility-1',
      response: 'Handover was at the scheduled time.',
    });
  });
});

describe('which scope each side reads and writes at', () => {
  it('has a facility name itself, for the read and for the reply', async () => {
    show(FACILITY, base());

    const box = await screen.findByLabelText('Your side of it');
    expect(get).toHaveBeenCalledWith('/api/v1/disputes/case-1?facilityId=facility-1');

    fireEvent.change(box, { target: { value: 'Handover was at the scheduled time.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/api/v1/disputes/case-1/respond',
      expect.objectContaining({ facilityId: 'facility-1' }),
    );
  });

  it('has a practitioner read as themselves and name no facility', async () => {
    show(PRACTITIONER, base({ raisedParty: 'FACILITY' }));

    const box = await screen.findByLabelText('Your side of it');
    expect(get).toHaveBeenCalledWith('/api/v1/disputes/case-1?as=self');

    fireEvent.change(box, { target: { value: 'I was on the ward until nine.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/disputes/case-1/respond', {
      response: 'I was on the ward until nine.',
    });
  });
});

describe('the decision, as both sides read it', () => {
  it('says what it turned on, in words about the record and never the people, beside the notes', async () => {
    show(
      PRACTITIONER,
      base({
        status: 'RESOLVED',
        outcome: 'UPHELD',
        decisionReason: 'RECORD_WAS_WRONG',
        resolutionNotes: 'The ward log shows ninety minutes past handover.',
      }),
    );

    expect(await screen.findByText(/Decided: upheld\./)).toBeInTheDocument();
    expect(screen.getByText(/The record of the hours or the pay was wrong\./)).toBeInTheDocument();
    expect(screen.getByText('The ward log shows ninety minutes past handover.')).toBeInTheDocument();
  });

  it('shows a case decided before reasons were kept without inventing one', async () => {
    show(
      PRACTITIONER,
      base({ status: 'RESOLVED', outcome: 'DISMISSED', resolutionNotes: 'The hours stand as recorded.' }),
    );

    expect(await screen.findByText(/Decided: dismissed\./)).toBeInTheDocument();
    expect(screen.getByText('The hours stand as recorded.')).toBeInTheDocument();
    expect(screen.queryByText(/The record of the shift was checked/)).not.toBeInTheDocument();
  });
});

describe('evidence, and taking a case back', () => {
  const attached = (fields: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    note: null,
    createdAt: '2026-10-11T09:00:00.000Z',
    attachedBySide: 'PRACTITIONER',
    bySide: false,
    ...fields,
  });

  it('names who attached each piece by side, from the viewer’s own point of view', async () => {
    show(FACILITY, base(), [
      attached({ note: 'photo of the rota', attachedBySide: 'FACILITY', bySide: true }),
      attached({ note: 'a colleague’s letter', attachedBySide: 'FACILITY', bySide: false }),
      attached({ note: 'the nurse’s log', attachedBySide: 'PRACTITIONER', bySide: false }),
    ]);

    await screen.findByText('photo of the rota');
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items[0]).toMatch(/^You/);
    expect(items[1]).toMatch(/^Your colleague/);
    expect(items[2]).toMatch(/^The practitioner/);
  });

  it('names the facility, from the practitioner’s side, for what the facility attached', async () => {
    show(PRACTITIONER, base({ raisedParty: 'FACILITY' }), [
      attached({ note: 'the signed rota', attachedBySide: 'FACILITY', bySide: false }),
    ]);

    await screen.findByText('the signed rota');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)[0]).toMatch(/^The facility/);
  });

  it('offers withdrawing only to the side that raised the case', async () => {
    const mine = show(PRACTITIONER, base({ raisedParty: 'PRACTITIONER' }));
    await screen.findByRole('button', { name: 'Withdraw this case' });
    mine.unmount();

    show(PRACTITIONER, base({ raisedParty: 'FACILITY' }));
    await screen.findByLabelText('Your side of it');
    expect(screen.queryByRole('button', { name: 'Withdraw this case' })).not.toBeInTheDocument();
  });

  it('offers neither evidence nor a reply on a case that has finished', async () => {
    show(PRACTITIONER, base({ status: 'WITHDRAWN', raisedParty: 'FACILITY' }));

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText('Add evidence')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw this case' })).not.toBeInTheDocument();
    expect(field()).not.toBeInTheDocument();
  });
});
