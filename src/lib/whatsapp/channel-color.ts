// ============================================================
// Cor determinística por canal — pedido do usuário para identificar
// visualmente qual número/canal cada conversa pertence quando a conta
// tem mais de um conectado. Sem coluna nova no banco: a cor é derivada
// do próprio id do canal (hash simples), então funciona pra qualquer
// número de canais sem precisar de configuração ou migration.
// ============================================================

export interface ChannelColorClasses {
  /** Bolinha sólida — ex.: indicador ao lado do rótulo do canal. */
  dot: string;
  /** Texto na cor do canal. */
  text: string;
  /** Borda sutil na cor do canal, pra usar em badge/chip. */
  border: string;
}

// Poucas cores, bem espaçadas no círculo cromático (vermelho, laranja,
// verde, azul, roxo, rosa) em vez de muitas — a primeira versão tinha
// emerald/cyan/lime lado a lado, tons de verde/ciano parecidos demais
// entre si num badge pequeno (achado do usuário testando com 2 canais
// reais). Poucas cores bem separadas garantem contraste mesmo com só
// 2-3 canais ativos, que é o caso comum.
const PALETTE: ChannelColorClasses[] = [
  { dot: "bg-red-500", text: "text-red-500", border: "border-red-500/40" },
  { dot: "bg-orange-500", text: "text-orange-500", border: "border-orange-500/40" },
  { dot: "bg-green-500", text: "text-green-500", border: "border-green-500/40" },
  { dot: "bg-blue-500", text: "text-blue-500", border: "border-blue-500/40" },
  { dot: "bg-violet-500", text: "text-violet-500", border: "border-violet-500/40" },
  { dot: "bg-pink-500", text: "text-pink-500", border: "border-pink-500/40" },
];

export function channelColor(channelId: string): ChannelColorClasses {
  let hash = 0;
  for (let i = 0; i < channelId.length; i++) {
    hash = (hash * 31 + channelId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}
