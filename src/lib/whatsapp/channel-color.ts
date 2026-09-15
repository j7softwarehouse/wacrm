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

// Tons escolhidos por serem visualmente distintos entre si e legíveis
// tanto no tema claro quanto escuro (mesma família de saturação/brilho
// que os badges de status já usam no resto do app).
const PALETTE: ChannelColorClasses[] = [
  { dot: "bg-sky-500", text: "text-sky-500", border: "border-sky-500/40" },
  { dot: "bg-emerald-500", text: "text-emerald-500", border: "border-emerald-500/40" },
  { dot: "bg-amber-500", text: "text-amber-500", border: "border-amber-500/40" },
  { dot: "bg-fuchsia-500", text: "text-fuchsia-500", border: "border-fuchsia-500/40" },
  { dot: "bg-rose-500", text: "text-rose-500", border: "border-rose-500/40" },
  { dot: "bg-cyan-500", text: "text-cyan-500", border: "border-cyan-500/40" },
  { dot: "bg-lime-500", text: "text-lime-500", border: "border-lime-500/40" },
  { dot: "bg-violet-500", text: "text-violet-500", border: "border-violet-500/40" },
];

export function channelColor(channelId: string): ChannelColorClasses {
  let hash = 0;
  for (let i = 0; i < channelId.length; i++) {
    hash = (hash * 31 + channelId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}
