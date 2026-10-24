import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NetworkBanner } from './network-banner';

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('NetworkBanner', () => {
  it('draws nothing while the connection is fine', () => {
    render(<NetworkBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says so when the connection goes, and goes by itself when it comes back', () => {
    render(<NetworkBanner />);

    act(() => setOnline(false));
    expect(screen.getByRole('status')).toHaveTextContent(/You are offline/);
    expect(screen.getByRole('status')).toHaveTextContent(/nothing can be saved/);

    act(() => setOnline(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
