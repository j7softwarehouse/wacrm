/**
 * Chave canônica de telefone brasileiro: DDD + últimos 8 dígitos.
 *
 * Um mesmo número aparece no sistema de formas diferentes: com ou sem o
 * código do país (55), com ou sem o 9º dígito, com máscara. Esta chave
 * ignora essas diferenças, então `31 98640-5178`, `553186405178` e
 * `+5531986405178` viram a mesma chave (`3186405178`).
 *
 * Mesma regra do SQL usado na checagem de duplicados em produção, para os
 * dois lados concordarem. Ver [[wacrm-corte-1000-linhas]].
 */
export function canonicalPhoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  // Telefone com DDD (10 ou 11 dígitos sem o 55): DDD + últimos 8.
  if (digits.length === 10 || digits.length === 11) {
    return digits.slice(0, 2) + digits.slice(-8);
  }

  // Formato fora do padrão (sem DDD, internacional etc.): chave é o próprio número.
  return digits;
}

/**
 * Mantém um item por chave de telefone, na ordem recebida. Itens sem
 * telefone são mantidos (não há como compará-los). Não altera a lista de entrada.
 */
export function dedupeByPhoneKey<T extends { phone?: string | null }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = canonicalPhoneKey(item.phone);
    if (key === null) {
      out.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Formato padrão de SALVAMENTO de contato (decisão do usuário, 2026-11-08):
 *   - Celular (9 dígitos depois do DDD, começando com 9): "+55 31 98640-5178"
 *   - Fixo (8 dígitos depois do DDD, começando com 2 a 5): "+55 31 3333-4444"
 *   - Celular antigo, com 8 dígitos começando com 6 a 9: recebe o 9 na frente
 *     (é como a regra do 9º dígito converteu esses números).
 *
 * Chave de duplicidade não muda: DDD + 8 últimos dígitos, então o formato
 * salvo não afeta a deduplicação.
 *
 * Números que não são brasileiros reconhecíveis voltam como vieram.
 */
export function formatContactPhone(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return raw;

  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  const ddd = digits.slice(0, 2);

  // DDD + 9 dígitos: celular com o 9 já presente.
  if (digits.length === 11 && digits[2] === '9') {
    const sub = digits.slice(2);
    return `+55 ${ddd} ${sub.slice(0, 5)}-${sub.slice(5)}`;
  }

  // DDD + 8 dígitos.
  if (digits.length === 10) {
    const sub = digits.slice(2);
    const first = sub[0];
    if (first >= '6' && first <= '9') {
      // Celular antigo (8 dígitos): recebe o 9 na frente.
      const nine = '9' + sub;
      return `+55 ${ddd} ${nine.slice(0, 5)}-${nine.slice(5)}`;
    }
    if (first >= '2' && first <= '5') {
      // Fixo: 8 dígitos, sem 9.
      return `+55 ${ddd} ${sub.slice(0, 4)}-${sub.slice(4)}`;
    }
  }

  return raw;
}
