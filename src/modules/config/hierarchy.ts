/**
 * The professional hierarchy as reference data. Pure, no database.
 *
 * The platform had no idea of level, cadre or registration category: a house officer
 * and a consultant were the same person to it, and a request could not say which it
 * wanted (PRA-01, PRA-02, REQ-01, CFG-04). Retrofitting a level into live shifts,
 * rates and invoices is the most expensive change there is, so the field exists
 * before pilot data does.
 *
 * What the levels are for each profession, and which registrations are provisional
 * or need supervision, are the regulators' to say and compliance's to enter. Nothing
 * here proposes them: this is the shape they go into.
 */

export type LevelProblem = 'name' | 'rank';

export const LEVEL_NAME_MIN = 2;
export const LEVEL_NAME_MAX = 80;
export const RANK_MAX = 1000;

export function levelProblem(input: { name: string; rank: number }): LevelProblem | null {
  const name = input.name.trim();
  if (name.length < LEVEL_NAME_MIN || name.length > LEVEL_NAME_MAX) return 'name';
  if (!Number.isInteger(input.rank) || input.rank < 1 || input.rank > RANK_MAX) return 'rank';
  return null;
}

/** Lower case, no accents, words joined by underscores: stable however a name is typed. */
function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** `doctor.senior_registrar`: the profession's key, then the level's name. */
export function levelKey(categoryKey: string, name: string): string {
  return `${categoryKey}.${slug(name)}`;
}

export function registrationCategoryKey(name: string): string {
  return slug(name);
}

export function categoryNameProblem(name: string): 'name' | null {
  const trimmed = name.trim();
  return trimmed.length < LEVEL_NAME_MIN || trimmed.length > LEVEL_NAME_MAX ? 'name' : null;
}
