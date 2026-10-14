import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MySuggestionsList, suggestionStatusLabel, type MySuggestion } from './my-suggestions';

afterEach(cleanup);

const suggestion = (fields: Partial<MySuggestion>): MySuggestion => ({
  id: crypto.randomUUID(),
  area: 'ATTENDANCE',
  body: 'The check-in screen is slow on my phone.',
  status: 'NEW',
  response: null,
  answeredAt: null,
  createdAt: '2026-10-12T09:00:00.000Z',
  ...fields,
});

describe('what an author sees of their suggestions', () => {
  it('says so, kindly, when they have sent none', () => {
    render(<MySuggestionsList suggestions={[]} />);

    expect(screen.getByText(/you have not sent a suggestion yet/i)).toBeInTheDocument();
  });

  it('shows what they wrote, what it is about, and that it has been received', () => {
    render(<MySuggestionsList suggestions={[suggestion({})]} />);

    expect(screen.getByText('The check-in screen is slow on my phone.')).toBeInTheDocument();
    expect(screen.getByText('Checking in and out')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText(/we have it/i)).toBeInTheDocument();
  });

  it('shows the answer under a suggestion that has one, with where it stands', () => {
    render(
      <MySuggestionsList
        suggestions={[
          suggestion({
            status: 'DECLINED',
            response: 'It is slow because of the phone network; we will look at a lighter screen later.',
            answeredAt: '2026-10-13T10:00:00.000Z',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Not taken forward')).toBeInTheDocument();
    expect(screen.getByText(/we will look at a lighter screen later/i)).toBeInTheDocument();
  });

  it('names every status in words a person would use, not the queue’s', () => {
    expect(
      (['NEW', 'TRIAGED', 'PLANNED', 'DONE', 'DECLINED'] as const).map(suggestionStatusLabel),
    ).toEqual(['Received', 'Being looked at', 'Planned', 'Done', 'Not taken forward']);
  });

  it('does not show an answer that is not there', () => {
    render(<MySuggestionsList suggestions={[suggestion({ status: 'TRIAGED' })]} />);

    expect(screen.queryByText(/^Answer/i)).not.toBeInTheDocument();
  });
});
