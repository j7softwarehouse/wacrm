// ============================================================
// Identidade de canal para comparação entre "contas independentes" —
// usada pela restrição de encaminhar só dentro do mesmo canal.
//
// Regra explícita do usuário: dois canais só são independentes quando
// o NÚMERO DE TELEFONE é diferente. Recriar a instância UAZAPI (ex.:
// depois de "Invalid token", token expirado, reconexão) troca o
// `whatsapp_channels.id`, mas se o número do cliente continuar o
// mesmo, NÃO é um canal novo pra fins de encaminhamento — é o mesmo
// WhatsApp de sempre, só com uma instância técnica nova por trás.
//
// Por isso a comparação nunca é feita pelo `channel_id` bruto: sempre
// resolve pro `phone_e164` do canal (ou do canal padrão da conta,
// quando `channel_id` é nulo — conversa órfã de um canal já apagado).
// ============================================================

export function resolveChannelPhone(
  channelId: string | null,
  phoneByChannelId: Map<string, string | null | undefined>,
  defaultChannelId: string | null,
): string | null {
  const effectiveChannelId = channelId ?? defaultChannelId;
  if (!effectiveChannelId) return null;
  return phoneByChannelId.get(effectiveChannelId) ?? null;
}
