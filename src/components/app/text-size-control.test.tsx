import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextSizeControl } from './text-size-control';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-text-size');
});

describe('the text size control', () => {
  it('starts at normal, and says which is chosen', () => {
    render(<TextSizeControl />);
    expect(screen.getByRole('button', { name: /^Normal text/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Larger text/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('makes the text larger, remembers it, and says so', () => {
    render(<TextSizeControl />);

    fireEvent.click(screen.getByRole('button', { name: /^Larger text/ }));

    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
    expect(window.localStorage.getItem('medilink:text-size')).toBe('large');
    expect(screen.getByRole('button', { name: /^Larger text/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a size for a projector', () => {
    render(<TextSizeControl />);
    fireEvent.click(screen.getByRole('button', { name: /projector/i }));
    expect(document.documentElement.getAttribute('data-text-size')).toBe('projector');
  });

  it('restores what was chosen last time', () => {
    window.localStorage.setItem('medilink:text-size', 'large');
    render(<TextSizeControl />);
    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
    expect(screen.getByRole('button', { name: /^Larger text/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('can be put back to normal', () => {
    render(<TextSizeControl />);
    fireEvent.click(screen.getByRole('button', { name: /^Larger text/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Normal text/ }));
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  });
});
