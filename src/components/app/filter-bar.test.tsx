import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterBar } from './filter-bar';
import { Field } from './field';

function mockWidth(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

afterEach(cleanup);

describe('FilterBar on a wide screen', () => {
  beforeEach(() => mockWidth(true));

  it('shows the fields inline and offers "Clear filters" only when something is applied', () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <FilterBar searchValue="" onSearchChange={() => undefined} activeCount={0} onClear={onClear}>
        <Field label="Status">
          <select />
        </Field>
      </FilterBar>,
    );
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();

    rerender(
      <FilterBar searchValue="" onSearchChange={() => undefined} activeCount={2} onClear={onClear}>
        <Field label="Status">
          <select />
        </Field>
      </FilterBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('FilterBar on a phone', () => {
  beforeEach(() => mockWidth(false));

  it('keeps search on screen and puts the rest behind one button that says how many are applied', () => {
    render(
      <FilterBar
        searchLabel="Search"
        searchValue=""
        onSearchChange={() => undefined}
        activeCount={3}
        onClear={() => undefined}
      >
        <Field label="Status">
          <select />
        </Field>
      </FilterBar>,
    );
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('3 applied, 3');
  });

  it('opens the fields in a sheet with a way to clear and a way to see the results', () => {
    const onClear = vi.fn();
    render(
      <FilterBar searchValue="" onSearchChange={() => undefined} activeCount={1} onClear={onClear}>
        <Field label="Status">
          <select />
        </Field>
      </FilterBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show results' })).toBeInTheDocument();
  });
});
