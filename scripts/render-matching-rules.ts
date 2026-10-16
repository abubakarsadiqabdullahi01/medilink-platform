/**
 * Writes docs/matching-rules.md from the rules in the code.
 *
 *   pnpm tsx scripts/render-matching-rules.ts
 *
 * The document is for the people who answer "why was nobody offered this shift?", who should not
 * have to read TypeScript; the engine is what decides. A test fails when they differ, so this is
 * run whenever a rule or its description changes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMatchingRules } from '../src/modules/matching/domain/matching-rules';

const target = join(__dirname, '../docs/matching-rules.md');
writeFileSync(target, renderMatchingRules());
console.log(`Wrote ${target}`);
