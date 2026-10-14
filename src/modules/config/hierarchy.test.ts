import { describe, expect, it } from 'vitest';
import { categoryNameProblem, levelKey, levelProblem, registrationCategoryKey } from './hierarchy';

describe('a level being defined', () => {
  it('is accepted with a name and a whole positive rank', () => {
    expect(levelProblem({ name: 'Registrar', rank: 30 })).toBeNull();
    expect(levelProblem({ name: 'Consultant', rank: 1000 })).toBeNull();
  });

  it('is refused without a name, or with one that is not a name', () => {
    expect(levelProblem({ name: ' ', rank: 10 })).toBe('name');
    expect(levelProblem({ name: 'A', rank: 10 })).toBe('name');
    expect(levelProblem({ name: 'x'.repeat(81), rank: 10 })).toBe('name');
  });

  it('is refused at a rank that is not a whole number from one to a thousand', () => {
    expect(levelProblem({ name: 'Registrar', rank: 0 })).toBe('rank');
    expect(levelProblem({ name: 'Registrar', rank: -5 })).toBe('rank');
    expect(levelProblem({ name: 'Registrar', rank: 2.5 })).toBe('rank');
    expect(levelProblem({ name: 'Registrar', rank: 1001 })).toBe('rank');
    expect(levelProblem({ name: 'Registrar', rank: Number.NaN })).toBe('rank');
  });
});

describe('the key a level is given', () => {
  it('is the profession and the name, in a form that is safe to store and compare', () => {
    expect(levelKey('doctor', 'Senior Registrar')).toBe('doctor.senior_registrar');
  });

  it('drops accents, punctuation and runs of spaces', () => {
    expect(levelKey('nurse', '  Nurse / Midwife (Grade II)  ')).toBe('nurse.nurse_midwife_grade_ii');
    expect(levelKey('nurse', 'Ọmọ́ Nurse')).toBe('nurse.omo_nurse');
  });

  it('is the same for the same name however it is written', () => {
    expect(levelKey('doctor', 'house officer')).toBe(levelKey('doctor', 'House  Officer'));
  });
});

describe('a registration category', () => {
  it('has a key made from its name', () => {
    expect(registrationCategoryKey('Provisional registration')).toBe('provisional_registration');
  });

  it('is refused without a usable name', () => {
    expect(categoryNameProblem('Full')).toBeNull();
    expect(categoryNameProblem(' ')).toBe('name');
    expect(categoryNameProblem('x'.repeat(81))).toBe('name');
  });
});
