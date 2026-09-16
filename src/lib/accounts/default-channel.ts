import type { WhatsAppProviderKind } from "@/types";

/**
 * True quando o canal mais antigo da conta suporta modelos (Meta) — ou
 * quando ainda não sabemos qual é esse canal (`null`: perfil carregando,
 * ou a conta ainda não tem canal nenhum).
 *
 * Espelha `resolveDefaultChannelId` (`src/lib/whatsapp/providers/resolve.ts`):
 * Broadcasts e a fila de envio de modelo sempre usam o canal criado há
 * mais tempo na conta, nunca um escolhido por conversa — então é ESSE
 * canal, e só ele, que decide se "Broadcasts"/"Modelos" fazem sentido
 * pra conta inteira. Uma conta com canal Meta mais NOVO que um canal
 * uazapi continua sem Broadcasts funcional, porque é assim que o envio
 * de verdade se comporta hoje — esconder a tela nesse caso é honestidade
 * com o que aconteceria ao clicar, não um bug desta função.
 *
 * Fail-open (`true`) enquanto `provider` é `null`, no mesmo espírito de
 * `salesEnabled`: nenhuma tela pisca "escondida" antes de sabermos de
 * verdade que o canal é uazapi.
 */
export function defaultChannelSupportsTemplates(
  provider: WhatsAppProviderKind | null,
): boolean {
  return provider === null || provider !== "uazapi";
}
