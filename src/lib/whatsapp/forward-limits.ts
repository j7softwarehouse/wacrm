// ============================================================
// Tetos do encaminhamento — compartilhados entre a rota
// (api/whatsapp/messages/forward/route.ts) e o ForwardDialog, pra
// nunca divergir (o diálogo bloqueia a seleção ANTES de tentar; a rota
// é a rede de proteção real).
//
// Os dois multiplicam: no pior caso, um encaminhamento dispara
// MAX_FORWARD_MESSAGES × MAX_FORWARD_DESTINATIONS envios numa
// requisição só. 5 × 5 = 25 é o teto deliberadamente conservador —
// mandar a mesma leva de conteúdo pra muita gente de uma vez é o
// padrão que leva o número da escola ao banimento (mesmo raciocínio
// que já limitava só os destinos antes desta função existir).
// ============================================================

export const MAX_FORWARD_DESTINATIONS = 5;
export const MAX_FORWARD_MESSAGES = 5;
