import { describe, expect, it } from 'vitest';
import { describeConnection } from './connection';

describe('describeConnection', () => {
  it('is offline whatever else is reported', () => {
    expect(describeConnection({ online: false })).toBe('offline');
    expect(describeConnection({ online: false, effectiveType: '4g' })).toBe('offline');
  });

  it('is slow on the two slowest effective types', () => {
    expect(describeConnection({ online: true, effectiveType: 'slow-2g' })).toBe('slow');
    expect(describeConnection({ online: true, effectiveType: '2g' })).toBe('slow');
  });

  it('is ok on 3g and up, and where the browser says nothing', () => {
    expect(describeConnection({ online: true, effectiveType: '3g' })).toBe('ok');
    expect(describeConnection({ online: true, effectiveType: '4g' })).toBe('ok');
    expect(describeConnection({ online: true })).toBe('ok');
    expect(describeConnection({ online: true, effectiveType: null })).toBe('ok');
  });
});
