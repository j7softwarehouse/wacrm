/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Extrai DDD + assinante (8 dígitos, sem o nono opcional do celular) de
 * um número brasileiro COMPLETO (com DDI 55). Retorna null quando o
 * número não começa com 55, ou quando o formato não bate com nenhum
 * padrão reconhecido — nesses casos o chamador cai no fallback genérico
 * em vez de arriscar uma leitura errada.
 */
function extractBrazilianDddSubscriber(
  digits: string,
): { ddd: string; subscriber: string } | null {
  if (!digits.startsWith('55')) return null
  const rest = digits.slice(2)
  if (rest.length === 10) {
    // DDD + 8 dígitos: fixo, ou celular já sem o nono dígito.
    return { ddd: rest.slice(0, 2), subscriber: rest.slice(2) }
  }
  if (rest.length === 11) {
    // DDD + 9 dígitos: só reconhece como celular se o dígito extra for
    // mesmo o "9" que precede o número desde a mudança nacional; um
    // formato de 11 dígitos que não segue essa regra é ambíguo, não
    // arriscamos interpretar.
    const nineDigitSubscriber = rest.slice(2)
    if (!nineDigitSubscriber.startsWith('9')) return null
    return { ddd: rest.slice(0, 2), subscriber: nineDigitSubscriber.slice(1) }
  }
  return null
}

/**
 * Compare two phone numbers accounting for trunk prefix and formatting
 * differences.
 *
 * Números brasileiros completos (com DDI 55) nos dois lados: o DDD faz
 * parte da identidade do número, então a comparação exige DDD igual —
 * dois DDDs diferentes com os mesmos 8 dígitos finais são pessoas
 * diferentes, nunca a mesma pessoa com/sem o nono dígito (confirmado em
 * produção: dois contatos reais, DDD 27 e DDD 31, colidiam aqui antes
 * desta correção).
 *
 * Qualquer outro caso (não-BR, ou só um dos lados reconhecido como BR
 * completo) usa o fallback antigo: tolera prefixo de tronco comparando
 * os últimos 8 dígitos. e.g. "370063949836" (com tronco 0) casa com
 * "37063949836" (sem tronco 0).
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true

  const br1 = extractBrazilianDddSubscriber(n1)
  const br2 = extractBrazilianDddSubscriber(n2)
  if (br1 && br2) {
    return br1.ddd === br2.ddd && br1.subscriber === br2.subscriber
  }

  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Gera todas as formas equivalentes de um número brasileiro nacional
 * (com/sem DDI 55, com/sem o nono dígito do celular), para consultar
 * `contacts.phone_normalized` em UMA query com `.in(...)` e achar o
 * contato independente de como o número foi digitado/salvo.
 *
 * Usa a mesma leitura de `extractBrazilianDddSubscriber`: quando o
 * número não é reconhecido como BR nacional (outro país, ou formato
 * ambíguo), devolve só o valor normalizado — não arrisca gerar
 * variante errada.
 */
export function brazilianPhoneLookupVariants(phone: string): string[] {
  const digits = normalizePhone(phone)
  const withDdi = digits.startsWith('55') ? digits : '55' + digits
  const parsed = extractBrazilianDddSubscriber(withDdi)
  if (!parsed) return [digits]

  const { ddd, subscriber } = parsed
  const variants = new Set<string>()
  for (const ddi of ['55', '']) {
    for (const sub of [subscriber, '9' + subscriber]) {
      variants.add(ddi + ddd + sub)
    }
  }
  return [...variants]
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
