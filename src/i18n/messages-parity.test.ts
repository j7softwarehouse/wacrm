import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ko from '../../messages/ko.json';
import ptBR from '../../messages/pt-BR.json';

type Messages = Record<string, unknown>;

function flatten(obj: Messages, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      for (const [k, v] of flatten(value as Messages, path)) result.set(k, v);
    } else {
      result.set(path, String(value));
    }
  }
  return result;
}

// Extracts ICU MessageFormat argument names (e.g. "count" from
// "{count, plural, =1 {deal} other {deals}}"), ignoring the plural/select
// case bodies themselves — those are translated literal text, not
// placeholders, so they're expected to differ between locales.
function icuArgs(message: string): string {
  const withoutCaseBodies = message.replace(/(?:=\d+|other)\s*\{[^{}]*\}/g, '');
  const args = new Set<string>();
  for (const match of withoutCaseBodies.matchAll(/\{(\w+)/g)) args.add(match[1]);
  return [...args].sort().join(',');
}

function tags(message: string): string {
  return [...new Set((message.match(/<\/?[a-zA-Z]+/g) ?? []).map((t) => t.replace('/', '')))]
    .sort()
    .join(',');
}

const en_ = flatten(en);
const ptBR_ = flatten(ptBR);
const ko_ = flatten(ko);

describe('messages key parity', () => {
  // pt-BR is the locale this suite keeps at 100% coverage — every key
  // added to en.json must land here too, with matching placeholders.
  it('pt-BR.json has no keys missing from en.json', () => {
    const missing = [...en_.keys()].filter((k) => !ptBR_.has(k));
    expect(missing).toEqual([]);
  });

  it('pt-BR.json has no extra keys not present in en.json', () => {
    const extra = [...ptBR_.keys()].filter((k) => !en_.has(k));
    expect(extra).toEqual([]);
  });

  it('pt-BR.json preserves the same ICU placeholders as en.json', () => {
    const mismatches: string[] = [];
    for (const [key, value] of en_) {
      const ptValue = ptBR_.get(key);
      if (ptValue === undefined) continue;
      if (icuArgs(value) !== icuArgs(ptValue)) mismatches.push(key);
    }
    expect(mismatches).toEqual([]);
  });

  it('pt-BR.json preserves the same rich-text tags as en.json', () => {
    const mismatches: string[] = [];
    for (const [key, value] of en_) {
      const ptValue = ptBR_.get(key);
      if (ptValue === undefined) continue;
      if (tags(value) !== tags(ptValue)) mismatches.push(key);
    }
    expect(mismatches).toEqual([]);
  });

  // ko.json is community-maintained and allowed to lag behind en.json —
  // src/i18n/request.ts merges onto the English base, so a missing key
  // falls back to English rather than breaking. What must never happen
  // is a stale/typo'd key that no longer matches anything in en.json.
  it('ko.json has no extra keys not present in en.json', () => {
    const extra = [...ko_.keys()].filter((k) => !en_.has(k));
    expect(extra).toEqual([]);
  });
});
