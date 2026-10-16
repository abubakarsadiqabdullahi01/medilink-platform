// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS } from '@/lib/events';
import {
  EVENT_COVERAGE,
  JOB_KEYS_WITH_MESSAGES,
  MESSAGES,
  renderMatrix,
  type MessageKind,
} from './notification-matrix';

/**
 * M16-02: who is told what, by which event, over which channel, written down once and held to
 * the code from both sides.
 *
 * The failure it exists for is silent. An event with no handler is marked processed with a
 * warning and the person it concerned hears nothing, so "nobody was told" looks identical to
 * "nobody needed telling". Seven events were in that state when this was written, two of them
 * decisions about a person (a no-show, a sanctions flag). Each is now either a message in this
 * table or a statement here, with its reason, that it sends none.
 */

const ROOT = join(__dirname, '../../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOTIFICATIONS = 'src/modules/notifications/application';
const notificationSource = stripComments(
  readdirSync(join(ROOT, NOTIFICATIONS))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => read(`${NOTIFICATIONS}/${file}`))
    .join('\n'),
);

/** The event types the worker has a handler for, read from its source. */
const registered = new Set(
  [...stripComments(read('src/worker/handlers.ts')).matchAll(/\[EVENTS\.(\w+)\]/g)].map((match) => match[1]!),
);

/**
 * What follows each `eventType:` in a source: the rest of the line, or the whole braces when it is
 * a lookup (the credential decisions pick their event from an object). One publish may choose
 * between two events, so a bare `EVENTS.X` is not the only shape.
 */
function publishedExpressions(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/eventType:\s*/g)) {
    const start = match.index! + match[0].length;
    if (source[start] === '{') {
      let depth = 0;
      let end = start;
      for (; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1;
        if (source[end] === '}') depth -= 1;
        if (depth === 0) break;
      }
      found.push(source.slice(start, end + 1));
    } else {
      found.push(source.slice(start, source.indexOf('\n', start)));
    }
  }
  return found;
}

/** The event types something publishes, read from the sources that call `publishEvent`. */
function published(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        for (const expression of publishedExpressions(stripComments(read(path)))) {
          for (const match of expression.matchAll(/EVENTS\.(\w+)/g)) found.add(match[1]!);
        }
      }
    }
  };
  walk('src');
  return found;
}

const eventNames = Object.keys(EVENTS) as (keyof typeof EVENTS)[];
const kindsOf = (event: string): string[] => {
  const coverage = EVENT_COVERAGE[event as keyof typeof EVENTS];
  return coverage && 'kinds' in coverage ? coverage.kinds : [];
};

describe('every domain event', () => {
  it('is either a message in the table or a stated reason that it sends none', () => {
    const unclassified = eventNames.filter((name) => !(name in EVENT_COVERAGE));
    expect(unclassified, 'add each to EVENT_COVERAGE in notification-matrix.ts').toEqual([]);
  });

  it('has no entry for an event that does not exist', () => {
    const unknown = Object.keys(EVENT_COVERAGE).filter((name) => !eventNames.includes(name as never));
    expect(unknown).toEqual([]);
  });

  it('that sends a message has a handler registered with the worker, and one that sends none says so', () => {
    for (const name of eventNames) {
      const coverage = EVENT_COVERAGE[name];
      const sends = 'kinds' in coverage;
      if (sends) {
        expect(registered.has(name), `${name} sends messages but the worker has no handler for it`).toBe(true);
      } else if (registered.has(name)) {
        // A handler that does other work: the entry must say so, so it is not read as a gap.
        expect((coverage.handlerDoes ?? '').length > 20, `${name} has a handler that sends nothing`).toBe(true);
      } else {
        expect(coverage.handlerDoes, `${name} has no handler, so it cannot claim one`).toBeUndefined();
      }
    }
  });

  it('that is published and has no handler is stated as silent, with its reason', () => {
    for (const name of published()) {
      const coverage = EVENT_COVERAGE[name as keyof typeof EVENTS];
      expect(coverage, `${name} is published`).toBeDefined();
      if (!registered.has(name)) {
        expect('silent' in coverage && coverage.silent.length > 30, `${name}: no handler, so say why`).toBe(true);
      }
    }
  });

  it('that no code publishes is marked as such rather than listed as a message', () => {
    const live = published();
    for (const name of eventNames) {
      if (!live.has(name)) {
        const coverage = EVENT_COVERAGE[name];
        expect('notPublished' in coverage && coverage.notPublished === true, `${name} is never published`).toBe(true);
      }
    }
  });
});

describe('every message', () => {
  it('names an event that sends it, or a scheduled job that does', () => {
    for (const message of MESSAGES) {
      if ('event' in message.trigger) {
        expect(eventNames, message.kind).toContain(message.trigger.event);
        expect(kindsOf(message.trigger.event), `${message.kind} is not listed under its own event`).toContain(
          message.kind,
        );
      } else {
        expect(JOB_KEYS_WITH_MESSAGES, message.kind).toContain(message.trigger.job);
      }
    }
  });

  it('is listed under the event that names it, and each kind is described once', () => {
    const described = MESSAGES.map((message) => message.kind);
    expect(new Set(described).size).toBe(described.length);
    for (const name of eventNames) {
      for (const kind of kindsOf(name)) expect(described, `${name} names ${kind}`).toContain(kind);
    }
  });

  it('exists in the code that sends it', () => {
    for (const message of MESSAGES) {
      const literal = `'${message.kind}'`;
      const anchor = message.anchor ?? literal;
      expect(notificationSource.includes(anchor), `${message.kind}: "${anchor}" is not in the notifications code`).toBe(
        true,
      );
    }
  });

  it('is described for every kind the code names, so one cannot be added unannounced', () => {
    const named = new Set<string>();
    for (const match of notificationSource.matchAll(
      /\bkind(?:: | = )\s*(?:[^'`\n]*\?\s*)?'([a-z_.0-9]+)'(?:\s*:\s*'([a-z_.0-9]+)')?/g,
    )) {
      named.add(match[1]!);
      if (match[2]) named.add(match[2]);
    }
    // The decisions an officer makes about a document share one helper, and a dispute's stages one type.
    for (const match of notificationSource.matchAll(/credentialDecision\(\s*'([a-z_.]+)'/g)) named.add(match[1]!);
    for (const match of notificationSource.matchAll(/'(dispute\.(?:under_review|resolved|withdrawn))'/g)) {
      named.add(match[1]!);
    }

    const described = new Set(MESSAGES.map((message) => message.kind));
    const missing = [...named].filter((kind) => !described.has(kind));
    expect(missing, 'add each to MESSAGES in notification-matrix.ts').toEqual([]);
    expect(named.size).toBeGreaterThan(20);
  });

  it('says who gets it, what makes it go, how often, and what the text may name', () => {
    for (const message of MESSAGES as MessageKind[]) {
      for (const field of ['to', 'when', 'once', 'names'] as const) {
        expect(message[field].length, `${message.kind}.${field}`).toBeGreaterThan(8);
      }
    }
  });
});

describe('the notification matrix document', () => {
  it('is the one rendered from this data, so support reads what the code does', () => {
    expect(read('docs/notification-matrix.md')).toBe(renderMatrix());
  });

  it('lists every message kind and every silent event by name', () => {
    const rendered = renderMatrix();
    for (const message of MESSAGES) expect(rendered).toContain(`\`${message.kind}\``);
    for (const name of eventNames) expect(rendered).toContain(`\`${EVENTS[name]}\``);
  });
});
