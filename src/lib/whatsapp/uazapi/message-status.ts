import type { CrmMessageStatus } from "./connection";

/**
 * Estados a partir dos quais um evento pode levar a mensagem ao status
 * `target`. Os eventos de status da UAZAPI chegam em paralelo e fora de
 * ordem (entregue, lido, reenvios de recibo), então o status só pode
 * AVANÇAR: sent → delivered → read. Sem essa regra um "entregue"
 * gravado depois de um "lido" voltava o balão para cinza mesmo com a
 * mensagem já lida no WhatsApp (relato de 20/10/2026).
 *
 * Falha só vale enquanto a mensagem não foi entregue nem lida.
 */
export function statusesThatMayAdvanceTo(target: CrmMessageStatus): CrmMessageStatus[] {
  switch (target) {
    case "read":
      return ["sending", "sent", "delivered", "failed"];
    case "delivered":
      return ["sending", "sent", "failed"];
    case "sent":
      return ["sending"];
    case "failed":
      return ["sending", "sent"];
    default:
      return [];
  }
}
