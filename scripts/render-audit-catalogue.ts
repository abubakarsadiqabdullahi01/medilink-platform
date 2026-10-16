/**
 * Writes docs/audit-catalogue.md from the catalogue in the code.
 *
 *   pnpm tsx scripts/render-audit-catalogue.ts
 *
 * The document is for the people who answer "does the trail show who did this?", who should not
 * have to read TypeScript; the code is what the tests hold to the call sites. A test fails when
 * they differ, so this is run whenever the catalogue changes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCatalogue } from '../src/modules/audit-compliance/domain/audit-catalogue';

const target = join(__dirname, '../docs/audit-catalogue.md');
writeFileSync(target, renderCatalogue());
console.log(`Wrote ${target}`);
