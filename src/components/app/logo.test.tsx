import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Logo, LogoMark } from './logo';

afterEach(cleanup);

describe('Logo', () => {
  it('is a link home, named "Medilink home"', () => {
    render(<Logo />);
    const link = screen.getByRole('link', { name: 'Medilink home' });
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveTextContent('Medilink');
  });

  it('is not a link where it sits inside one', () => {
    render(<Logo href={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Medilink')).toBeInTheDocument();
  });

  it('hides the mark from assistive technology: the name beside it says everything', () => {
    const { container } = render(<LogoMark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a white tile on a dark surface', () => {
    const { container } = render(<LogoMark tone="reverse" />);
    expect(container.querySelector('rect')).toHaveAttribute('fill', '#ffffff');
  });
});
