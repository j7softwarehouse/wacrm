/**
 * Classes dos tiques de status dentro do balão do atendente (fundo
 * primário). Contraste sobre o violeta do tema padrão: branco 85% ≈ 5,3:1,
 * ciano-300 ≈ 4,2:1 — o cinza (`muted-foreground`, 1,26:1) e o `blue-400`
 * (2,40:1) de antes sumiam no fundo. Enviado/entregue usam a cor do texto
 * do balão para acompanhar qualquer tema; só o lido muda de matiz. O
 * `drop-shadow` fino mantém o ciano legível mesmo em temas de fundo claro.
 */
export function statusTickClass(
  status: "sending" | "sent" | "delivered" | "read" | "failed",
): string {
  switch (status) {
    case "sending":
      return "text-primary-foreground/70";
    case "sent":
    case "delivered":
      return "text-primary-foreground/85";
    case "read":
      return "text-cyan-300 drop-shadow-[0_0_1px_rgba(0,0,0,0.5)]";
    case "failed":
      return "text-red-300 drop-shadow-[0_0_1px_rgba(0,0,0,0.5)]";
  }
}
