/**
 * Deep-merges a locale's message dictionary onto the English base so a
 * key missing from a non-English dictionary falls back to English
 * instead of surfacing as a broken translation (next-intl renders
 * missing keys as the raw key path).
 */
export function mergeMessages(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = base[key];
    if (
      isPlainObject(baseValue) &&
      isPlainObject(overrideValue)
    ) {
      result[key] = mergeMessages(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
