// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_CATALOGUE,
  AUDIT_CATEGORIES,
  REQUIRED_CATEGORIES,
  SECURITY_EVENT_CATALOGUE,
  UNAUDITED_WRITES,
  renderCatalogue,
} from './audit-catalogue';
import { AUDITED_MODELS } from '@/lib/audit-coverage';
import { ACTION_LABELS, actionLabel } from '@/components/app/format';

/**
 * M17-01: the list of what the platform records, held to the code from both sides.
 *
 * A trail is only worth reading if it is known what belongs on it. Before this, the answer to
 * "does the trail say who did X?" was a search through a hundred call sites, and a new decision
 * could ship with no row and no question asked (the shift that reopened when a booking was
 * cancelled had one, going the other way, and none coming back). Now every action the code
 * writes is a line in the catalogue, every line is written by something, and a function that
 * changes a table the audit rule covers either writes a row or says here why it does not.
 */

const ROOT = join(__dirname, '../../../..');

function sourcePaths(dir = 'src'): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourcePaths(path);
    const isSource = entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts');
    // The harness that watches writes in tests is not application code, and says so itself.
    return isSource && !path.endsWith('lib/audit-coverage.ts') ? [path] : [];
  });
}

const parsed = sourcePaths().map((path) => {
  const text = readFileSync(join(ROOT, path), 'utf8');
  return { path, sf: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true) };
});

/** The string values an expression can take, or null if it is built at run time. */
function stringValues(node: ts.Expression, sf: ts.SourceFile): string[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return stringValues(node.expression, sf);
  if (ts.isConditionalExpression(node)) {
    const whenTrue = stringValues(node.whenTrue, sf);
    const whenFalse = stringValues(node.whenFalse, sf);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  // `LOOKUP[key]`: every value of the object literal the name was declared as, in this file.
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          const values = declaration.initializer.properties.flatMap((property) =>
            ts.isPropertyAssignment(property) ? (stringValues(property.initializer, sf) ?? []) : [],
          );
          return values.length > 0 ? values : null;
        }
      }
    }
  }
  return null;
}

const propertyOf = (object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) return property.initializer;
  }
  return undefined;
};

interface Written {
  action: string;
  entities: Set<string>;
}

const written = new Map<string, Written>();
const unresolved: string[] = [];
const securityKinds = new Set<string>();

for (const { path, sf } of parsed) {
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const where = `${path}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

      if (ts.isIdentifier(callee) && callee.text === 'recordAudit') {
        const input = node.arguments[1];
        if (input && ts.isObjectLiteralExpression(input)) {
          const actionNode = propertyOf(input, 'action');
          const entityNode = propertyOf(input, 'entityType');
          const actions = actionNode ? stringValues(actionNode, sf) : null;
          const entities = entityNode ? stringValues(entityNode, sf) : null;
          if (!actions || !entities) {
            unresolved.push(where);
          } else {
            for (const action of actions) {
              const entry = written.get(action) ?? { action, entities: new Set<string>() };
              entities.forEach((entity) => entry.entities.add(entity));
              written.set(action, entry);
            }
          }
        } else {
          unresolved.push(where);
        }
      }

      // A bulk insert hides its kinds inside a callback this test does not follow, so one on
      // this table is refused: spell each row out with `create`.
      if (
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === 'createMany' || callee.name.text === 'createManyAndReturn') &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === 'securityEvent'
      ) {
        unresolved.push(where);
      }

      // prisma.securityEvent.create({ data: { kind: '…' } })
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'create' &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === 'securityEvent'
      ) {
        const arg = node.arguments[0];
        const data = arg && ts.isObjectLiteralExpression(arg) ? propertyOf(arg, 'data') : undefined;
        const kind = data && ts.isObjectLiteralExpression(data) ? propertyOf(data, 'kind') : undefined;
        const kinds = kind ? stringValues(kind, sf) : null;
        if (kinds) kinds.forEach((value) => securityKinds.add(value));
        else unresolved.push(where);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

describe('the audit calls in the code', () => {
  it('are found, which is what makes the rest of this file mean something', () => {
    expect(written.size).toBeGreaterThan(120);
    expect(securityKinds.size).toBeGreaterThanOrEqual(4);
  });

  it('all name their action and their table in the call itself, never built at run time', () => {
    expect(unresolved, 'spell the branches out: a name nobody can search for is not on the catalogue').toEqual([]);
  });
});

describe('the catalogue of audit actions', () => {
  it('has a line for every action the code writes', () => {
    const missing = [...written.keys()].filter((action) => !(action in AUDIT_CATALOGUE)).sort();
    expect(missing, 'add each to AUDIT_CATALOGUE in audit-catalogue.ts').toEqual([]);
  });

  it('has no line that nothing writes, so it does not promise a record that is never made', () => {
    const stale = Object.keys(AUDIT_CATALOGUE).filter((action) => !written.has(action)).sort();
    expect(stale).toEqual([]);
  });

  it('names the table the code writes the row against', () => {
    const wrong = Object.entries(AUDIT_CATALOGUE)
      .filter(([action, entry]) => written.has(action) && !written.get(action)!.entities.has(entry.entity))
      .map(([action, entry]) => `${action}: catalogue says ${entry.entity}, code writes ${[...written.get(action)!.entities].join(' or ')}`);
    expect(wrong).toEqual([]);
  });

  it('puts each action in a category that exists, and describes what it records in a sentence', () => {
    for (const [action, entry] of Object.entries(AUDIT_CATALOGUE)) {
      expect(AUDIT_CATEGORIES, `${action}: unknown category ${entry.category}`).toHaveProperty(entry.category);
      expect(entry.what.length, `${action}: say what is recorded`).toBeGreaterThan(30);
      expect(entry.what.endsWith('.'), `${action}: end the sentence`).toBe(true);
    }
  });

  it('says it once: no two actions are described in the same words', () => {
    const sentences = Object.values(AUDIT_CATALOGUE).map((entry) => entry.what);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('covers every kind of decision the plan names: security, verification, booking, money, sanctions and admin', () => {
    for (const category of REQUIRED_CATEGORIES) {
      const entries = Object.values(AUDIT_CATALOGUE).filter((entry) => entry.category === category);
      expect(entries.length, `${category} has nothing on the catalogue`).toBeGreaterThanOrEqual(5);
    }
    for (const category of Object.keys(AUDIT_CATEGORIES)) {
      expect(
        Object.values(AUDIT_CATALOGUE).some((entry) => entry.category === category),
        `${category} is described and holds nothing`,
      ).toBe(true);
    }
  });

  it('keeps a name in the shape the trail is searched by: lower case, a dot between the thing and what happened to it', () => {
    for (const action of Object.keys(AUDIT_CATALOGUE)) {
      expect(action, action).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
    }
  });
});

describe('the catalogue of security events', () => {
  it('has a line for every kind the code writes, and none that nothing writes', () => {
    expect([...securityKinds].filter((kind) => !(kind in SECURITY_EVENT_CATALOGUE)).sort()).toEqual([]);
    expect(Object.keys(SECURITY_EVENT_CATALOGUE).filter((kind) => !securityKinds.has(kind)).sort()).toEqual([]);
  });

  it('says what each records and who is on the other end of it', () => {
    for (const [kind, entry] of Object.entries(SECURITY_EVENT_CATALOGUE)) {
      expect(entry.what.length, kind).toBeGreaterThan(30);
    }
  });
});

/**
 * Functions that change a table the audit rule covers, found by reading the code, so a write
 * path no test happens to reach is looked at as well. (`audit-coverage.ts` watches the writes a
 * test makes; this reads the ones nobody has run.) A function that writes and has no audit
 * call inside it is either a mistake or a decision, and a decision is written down.
 */
describe('a function that changes an audited table', () => {
  const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
  const audited = new Set(
    Object.keys(AUDITED_MODELS).map((model) => model[0]!.toLowerCase() + model.slice(1)),
  );

  interface Frame {
    node: ts.Node;
    name: string;
    writes: Set<string>;
    audits: boolean;
  }

  function findings(): string[] {
    const unaudited = new Set<string>();
    for (const { path, sf } of parsed) {
      const frames: Frame[] = [];
      const nameOf = (node: ts.Node): string => {
        if (
          (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
          node.name
        ) {
          return node.name.getText(sf);
        }
        if (
          (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name)
        ) {
          return node.parent.name.text;
        }
        // A callback: it belongs to the function it sits in.
        return `${frames.at(-1)?.name ?? '(module)'}>callback`;
      };

      const visit = (node: ts.Node) => {
        const isFunction =
          ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node);
        if (isFunction) frames.push({ node, name: nameOf(node), writes: new Set(), audits: false });

        if (ts.isCallExpression(node) && frames.length > 0) {
          const callee = node.expression;
          if (
            ts.isPropertyAccessExpression(callee) &&
            WRITES.has(callee.name.text) &&
            ts.isPropertyAccessExpression(callee.expression) &&
            audited.has(callee.expression.name.text)
          ) {
            frames.at(-1)!.writes.add(`${callee.expression.name.text}.${callee.name.text}`);
          }
          if (ts.isIdentifier(callee) && callee.text === 'recordAudit') frames.forEach((frame) => (frame.audits = true));
        }

        ts.forEachChild(node, visit);

        if (isFunction) {
          const frame = frames.pop()!;
          if (frame.writes.size > 0 && !frame.audits) unaudited.add(`${path}:${frame.name}`);
        }
      };
      visit(sf);
    }
    return [...unaudited].sort();
  }

  const found = findings();

  it('writes an audit row in the same function, or is listed below with the reason it does not', () => {
    const unexplained = found.filter((key) => !(key in UNAUDITED_WRITES));
    expect(
      unexplained,
      'audit the change (recordAudit, in the same transaction) or explain it in UNAUDITED_WRITES',
    ).toEqual([]);
  });

  it('is listed only while it is still true, so the explanations do not outlive the code', () => {
    const stale = Object.keys(UNAUDITED_WRITES).filter((key) => !found.includes(key));
    expect(stale).toEqual([]);
  });

  it('gives each reason in words a reviewer can weigh, naming what does record the change', () => {
    for (const [key, reason] of Object.entries(UNAUDITED_WRITES)) {
      expect(reason.length, key).toBeGreaterThan(60);
    }
  });

  it('refers to files that exist', () => {
    const paths = new Set(parsed.map((entry) => entry.path));
    for (const key of Object.keys(UNAUDITED_WRITES)) {
      expect(paths.has(key.split(':')[0]!), key).toBe(true);
    }
  });
});

/**
 * The audit screen shows each row under a sentence a person reads, and the code only in a hover.
 * An action without one falls back to its own name with the punctuation taken out, which is
 * readable and is not what anybody chose to say.
 */
describe('the words the audit screen uses', () => {
  const recorded = [...Object.keys(AUDIT_CATALOGUE), ...Object.keys(SECURITY_EVENT_CATALOGUE)];

  it('has a label for every action and every security event on the catalogue', () => {
    expect(recorded.filter((name) => !(name in ACTION_LABELS)).sort()).toEqual([]);
  });

  it('has no label for something that is no longer recorded', () => {
    expect(Object.keys(ACTION_LABELS).filter((name) => !recorded.includes(name)).sort()).toEqual([]);
  });

  it('reads as words, and is not the name run together', () => {
    for (const name of recorded) {
      const label = actionLabel(name);
      expect(label, name).toBe(ACTION_LABELS[name]);
      expect(label.length, name).toBeGreaterThan(6);
      expect(label, name).not.toMatch(/[._]/);
    }
  });
});

describe('the catalogue document', () => {
  it('is the one rendered from this data, so what compliance reads is what the code writes', () => {
    expect(readFileSync(join(ROOT, 'docs/audit-catalogue.md'), 'utf8')).toBe(renderCatalogue());
  });

  it('lists every action and every security event by name', () => {
    const rendered = renderCatalogue();
    for (const action of Object.keys(AUDIT_CATALOGUE)) expect(rendered).toContain(`\`${action}\``);
    for (const kind of Object.keys(SECURITY_EVENT_CATALOGUE)) expect(rendered).toContain(`\`${kind}\``);
  });

});
