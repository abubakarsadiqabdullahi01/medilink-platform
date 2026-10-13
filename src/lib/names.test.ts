import { describe, expect, it } from 'vitest';
import { initialsOf } from './names';

describe('initialsOf', () => {
  it('reduces a full name to dotted initials', () => {
    expect(initialsOf('Amaka Eze')).toBe('A. E.');
    expect(initialsOf('Olufemi Adebayo-Cole')).toBe('O. A.');
  });

  it('copes with one name, extra spaces and lower case', () => {
    expect(initialsOf('Amaka')).toBe('A.');
    expect(initialsOf('  hauwa   abdullahi  ')).toBe('H. A.');
  });

  it('never returns the name itself, and has a stable answer for nothing', () => {
    expect(initialsOf('')).toBe('—');
    expect(initialsOf('   ')).toBe('—');
    expect(initialsOf('Ngozi Okonkwo-Bello')).not.toContain('Ngozi');
  });

  it('takes the first letter of a name that begins outside ASCII', () => {
    expect(initialsOf('Érica Nwosu')).toBe('É. N.');
  });
});
