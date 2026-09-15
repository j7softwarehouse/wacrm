// ============================================================
// Cor por canal — pedido do usuário para identificar visualmente qual
// número/canal cada conversa pertence quando a conta tem mais de um
// conectado.
//
// A cor é a POSIÇÃO do telefone numa lista ordenada (alfanumérica) dos
// telefones da conta — não um hash aleatório do id do canal. Dois
// motivos:
//   1. Ordem fixa e previsível: "começa com verde, o segundo laranja"
//      (pedido explícito), não um sorteio que podia calhar em cores
//      parecidas.
//   2. Estabilidade: ordenar por TELEFONE (não por `created_at` do
//      canal) é o que faz a cor sobreviver a recriar a instância
//      UAZAPI do mesmo número — `created_at` muda a cada recriação,
//      o telefone não (mesmo raciocínio de channel-identity.ts).
// ============================================================

export interface ChannelColorClasses {
  /** Bolinha sólida — ex.: indicador ao lado do rótulo do canal. */
  dot: string;
  /** Texto na cor do canal. */
  text: string;
  /** Borda sutil na cor do canal, pra usar em badge/chip. */
  border: string;
}

// Tons SUAVES (a versão 400 do Tailwind, não a 500 mais saturada —
// achado do usuário: a paleta anterior "pesava" na imagem), em ordem
// fixa começando por verde e laranja como pedido, depois espalhados
// pelo resto do círculo cromático pra continuar distinguível se a
// conta crescer além de 2 canais.
const PALETTE: ChannelColorClasses[] = [
  { dot: "bg-emerald-400", text: "text-emerald-400", border: "border-emerald-400/40" },
  { dot: "bg-orange-400", text: "text-orange-400", border: "border-orange-400/40" },
  { dot: "bg-sky-400", text: "text-sky-400", border: "border-sky-400/40" },
  { dot: "bg-rose-400", text: "text-rose-400", border: "border-rose-400/40" },
  { dot: "bg-violet-400", text: "text-violet-400", border: "border-violet-400/40" },
  { dot: "bg-amber-400", text: "text-amber-400", border: "border-amber-400/40" },
];

export function channelColor(
  phone: string,
  allPhones: string[],
): ChannelColorClasses {
  const ordered = Array.from(new Set(allPhones)).sort();
  const index = ordered.indexOf(phone);
  return PALETTE[Math.max(index, 0) % PALETTE.length];
}
