'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether a pointer is down anywhere on the page.
 *
 * Validation on blur has a nasty side effect with a mouse: pressing a button takes focus out
 * of the field the person was typing in, the field's error text appears, the form grows by a
 * line, and the button slides down from under the pointer *before the button is released*. The
 * press and the release land on different elements, so no click is fired and nothing happens —
 * the person presses Submit and Submit does nothing. Holding back a newly arrived error until
 * the pointer is up (and the click has been delivered) removes the slide without giving up
 * errors on blur.
 *
 * One pair of listeners for the whole page, attached when the first component subscribes and
 * dropped when the last one leaves. Release is delayed a few milliseconds because the click
 * event follows the pointer's release, and on a touch screen the emulated mouse press — and the
 * blur it causes — comes after it.
 */
const RELEASE_DELAY_MS = 80;

let pressing = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (pressing === next) return;
  pressing = next;
  listeners.forEach((listener) => listener());
}

function onDown() {
  clearTimeout(releaseTimer);
  set(true);
}

function onUp() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => set(false), RELEASE_DELAY_MS);
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      clearTimeout(releaseTimer);
      pressing = false;
    }
  };
}

export function usePointerPressing(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pressing,
    () => false,
  );
}
