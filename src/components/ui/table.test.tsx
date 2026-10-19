import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Table, TableBody, TableCell, TableRow } from './table';

afterEach(cleanup);

function measure(widths: { scroll: number; client: number }) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => widths.scroll,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => widths.client,
  });
}

const sample = (
  <Table>
    <caption>Routes by time taken</caption>
    <TableBody>
      <TableRow>
        <TableCell>one</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);

describe('Table', () => {
  it('adds no tab stop when the table fits', () => {
    measure({ scroll: 300, client: 300 });
    render(sample);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('becomes a named, focusable region when it scrolls sideways, so a keyboard can move it', () => {
    measure({ scroll: 900, client: 300 });
    render(sample);
    const region = screen.getByRole('region', { name: 'Routes by time taken, scrolls sideways' });
    expect(region).toHaveAttribute('tabindex', '0');
  });
});
