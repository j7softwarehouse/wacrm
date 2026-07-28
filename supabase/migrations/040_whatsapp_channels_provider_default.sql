-- ============================================================
-- 040_whatsapp_channels_provider_default
--
-- A 037 tornou `whatsapp_channels.provider` NOT NULL sem DEFAULT.
-- Toda linha existente foi backfillada naquela mesma migração, então
-- SELECT/UPDATE/DELETE nunca sentiram o problema — mas qualquer INSERT
-- que não passe `provider` explicitamente falha com 23502.
--
-- Isso já se provou um problema real e não hipotético, por dois
-- caminhos independentes:
--   1. src/app/api/whatsapp/config/route.ts nunca setava `provider` no
--      seu insert — toda primeira conexão de WhatsApp (ou reconexão
--      após "Reset Configuration") vinha falhando desde que a 037
--      landou. Corrigido separadamente no código (baseRow agora inclui
--      `provider: 'meta'`, o único provider que essa rota conhece).
--   2. A view de compatibilidade da 038 (`whatsapp_config`) delega
--      INSERT para esta tabela; qualquer código legado que ainda
--      grave por ali sem `provider` bate na mesma parede — e não há
--      como auditar/corrigir todo código legado hipotético que possa
--      existir durante a janela de deploy misto que a 038 existe para
--      cobrir.
--
-- DEFAULT 'meta' é a escolha certa (não 'uazapi'): toda linha que já
-- existe antes desta feature é Meta, e é o único provider que código
-- pré-multi-canal (como a rota acima) jamais tentaria inserir.
-- ============================================================

ALTER TABLE public.whatsapp_channels
  ALTER COLUMN provider SET DEFAULT 'meta';
