/**
 * `import.meta.glob`, which Vite rewrites at build time into a table of lazy
 * imports. Declared here, for the one signature the suite uses, rather than by
 * pulling in `vite/client`: Vite is Vitest's dependency and not this project's,
 * so its types are not guaranteed to resolve from here.
 */
interface ImportMeta {
  glob<T = unknown>(pattern: string): Record<string, () => Promise<T>>;
}
