import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Illustration } from './illustration';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const fallback = <span>the icon</span>;

describe('Illustration', () => {
  it('shows the icon, and requests nothing, when the picture was not there at build', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGES', '');
    const { container } = render(<Illustration name="offers" fallback={fallback} />);
    expect(screen.getByText('the icon')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the picture when the build found it', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGES', 'empty/offers.webp');
    const { container } = render(<Illustration name="offers" fallback={fallback} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/images/empty/offers.webp');
    expect(screen.queryByText('the icon')).not.toBeInTheDocument();
  });

  it('goes back to the icon if a picture that should be there fails to load', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGES', 'empty/offers.webp');
    const { container } = render(<Illustration name="offers" fallback={fallback} />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('the icon')).toBeInTheDocument();
  });

  it('is decorative: it has no text alternative to read', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGES', 'empty/shifts.webp');
    const { container } = render(<Illustration name="shifts" />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});
