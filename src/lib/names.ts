/**
 * A person's name reduced to initials — "Amaka Eze" becomes "A. E.".
 *
 * For screens that must tell one candidate from another before there is a
 * booking, but that have no business holding the name itself. In a state
 * capital's worth of nurses a first name is already enough to find someone,
 * so what is withheld is the name, not just the surname. Contact details and
 * names are released by a booking, not by browsing.
 */
export function initialsOf(fullName: string): string {
  const letters = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Array.from keeps a letter outside the basic plane in one piece.
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase('en') ?? '');
  return letters.length > 0 ? letters.map((letter) => `${letter}.`).join(' ') : '—';
}
