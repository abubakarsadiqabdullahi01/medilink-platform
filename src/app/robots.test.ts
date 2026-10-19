import { describe, expect, it } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';

describe('robots', () => {
  it('lets a search engine read the public pages and keeps it out of the consoles and the API', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule?.allow).toBe('/');
    expect(rule?.disallow).toEqual(['/admin', '/facility', '/practitioner', '/api/']);
  });

  it('points at the sitemap', () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe('sitemap', () => {
  it('lists the pages anybody can read, and nothing behind a sign-in', () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).toEqual(['/', '/login', '/register', '/contact', '/privacy', '/terms']);
    expect(urls.some((path) => /^\/(admin|facility|practitioner|api)/.test(path))).toBe(false);
  });
});
