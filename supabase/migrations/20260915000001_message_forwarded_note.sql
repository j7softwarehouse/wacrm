-- ============================================================
-- 20260915000001_message_forwarded_note
--
-- Mensagem opcional junto do encaminhamento (2026-09-15). Pedido do
-- usuário: sai como parte do MESMO balão pro WhatsApp real (que não
-- suporta duas mensagens "coladas" com cor diferente — content_text já
-- guarda o texto/legenda combinado, é isso que é entregue de verdade).
--
-- `forwarded_note` guarda só a nota, separada, para a BOLHA DO CRM
-- poder estilizar o trecho digitado pelo atendente diferente do
-- trecho encaminhado, dentro do mesmo `content_text` — sem isso não
-- haveria como saber onde um termina e o outro começa depois de
-- salvos como uma string só.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS forwarded_note TEXT;
