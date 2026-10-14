/**
 * Writes docs/data-inventory.md from the inventory in the code.
 *
 *   pnpm tsx scripts/render-data-inventory.ts
 *
 * The document is for counsel and the data protection officer, who should not
 * have to read TypeScript; the code is what the purge job obeys. A test fails
 * when they differ, so this is run whenever the inventory changes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderInventory } from '../src/modules/audit-compliance/domain/data-inventory';

const target = join(__dirname, '../docs/data-inventory.md');
writeFileSync(target, renderInventory());
console.log(`Wrote ${target}`);
