/**
 * Writes docs/notification-matrix.md from the matrix in the code.
 *
 *   pnpm tsx scripts/render-notification-matrix.ts
 *
 * The document is for the people who answer "why was nobody told?", who should not have to read
 * TypeScript; the code is what the tests hold to the handlers. A test fails when they differ, so
 * this is run whenever the matrix changes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMatrix } from '../src/modules/notifications/domain/notification-matrix';

const target = join(__dirname, '../docs/notification-matrix.md');
writeFileSync(target, renderMatrix());
console.log(`Wrote ${target}`);
