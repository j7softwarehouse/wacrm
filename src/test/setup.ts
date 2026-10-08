import { vi } from 'vitest';
import en from '../../messages/en.json';

type Dict = { [key: string]: string | Dict };

function lookup(dict: Dict, path: string): string | Dict | undefined {
  return path.split('.').reduce<string | Dict | undefined>(
    (node, segment) =>
      node && typeof node === 'object' ? node[segment] : undefined,
    dict,
  );
}

// `next-intl/server`'s `getTranslations` resolves to a stub that throws
// ("not supported in Client Components") when Vitest's resolver picks the
// package's `react-client` export condition instead of `react-server` —
// Vite doesn't apply Next's RSC condition the way the Next.js bundler does.
// Route handlers that call `getTranslations('Api')` therefore need this
// mock to run under Vitest at all. Swap in a minimal translator backed
// directly by messages/en.json (source of truth) rather than a full
// next-intl runtime, since tests only assert on status codes / behavior,
// never on translated copy.
vi.mock('next-intl/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl/server')>();
  return {
    ...actual,
    getTranslations: async (namespace?: string) => {
      const base = namespace ? lookup(en as Dict, namespace) : (en as Dict);
      return (key: string, values?: Record<string, unknown>) => {
        const raw = base && typeof base === 'object' ? lookup(base, key) : undefined;
        let text = typeof raw === 'string' ? raw : key;
        if (values) {
          for (const [k, v] of Object.entries(values)) {
            text = text.replaceAll(`{${k}}`, String(v));
          }
        }
        return text;
      };
    },
  };
});
