-- ============================================================
-- 042_channel_webhook_registered_at
--
-- Marca "o webhook deste canal já foi registrado na UAZAPI".
--
-- Antes desta coluna, o registro automático só disparava quando a
-- rota /status observava a TRANSIÇÃO disconnected → connected. Mas
-- /connect também grava `status`: quando o operador conecta a
-- instância pelo painel da UAZAPI ANTES de cadastrá-la no CRM (o
-- caminho de onboarding mais comum), o /instance/connect já responde
-- "connected", a rota grava `status: 'connected'` direto, e o
-- /status seguinte nunca vê transição alguma. Resultado: o canal
-- envia normalmente e não recebe NADA, sem nenhum sinal na UI.
--
-- Com o carimbo, a condição deixa de ser "houve transição" e passa a
-- ser "está conectado e ainda não registrei" — idempotente e
-- independente de qual rota observou a conexão primeiro.
--
-- Idempotente.
-- ============================================================

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS webhook_registered_at TIMESTAMPTZ;
