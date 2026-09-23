import { brazilianPhoneLookupVariants, normalizePhone } from "@/lib/whatsapp/phone-utils";

/**
 * Resolve o nome de exibição de um participante de grupo, na ordem:
 * 1. Nome salvo em Contatos (o nome que a instituição escolheu).
 * 2. Nome do WhatsApp da pessoa, salvo localmente em
 *    `group_participants` quando ela já escreveu no grupo
 *    (`display_name`).
 * 3. O telefone puro, quando não há nem um nem outro.
 *
 * `contactNameByPhoneVariant` é indexado por TODAS as formas
 * equivalentes do telefone (com/sem DDI 55, com/sem o nono dígito) —
 * ver `brazilianPhoneLookupVariants` — porque o contato pode estar
 * salvo em qualquer uma dessas formas, e o telefone que a uazapi
 * devolve para o participante pode não bater byte a byte com o que
 * está gravado.
 *
 * `localDisplayNameByPhone` é indexado por telefone normalizado
 * simples: `group_participants.phone` vem da mesma fonte (JID do
 * WhatsApp) que `phoneNumber` aqui, então não tem a mesma variação de
 * formato que os contatos digitados manualmente.
 */
export function resolveParticipantName(
  phoneNumber: string,
  contactNameByPhoneVariant: Map<string, string>,
  localDisplayNameByPhone: Map<string, string>,
): string {
  for (const variant of brazilianPhoneLookupVariants(phoneNumber)) {
    const contactName = contactNameByPhoneVariant.get(variant);
    if (contactName) return contactName;
  }

  const localName = localDisplayNameByPhone.get(normalizePhone(phoneNumber));
  if (localName) return localName;

  return phoneNumber;
}
