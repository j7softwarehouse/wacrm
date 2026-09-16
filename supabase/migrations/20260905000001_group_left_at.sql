-- ============================================================
-- 20260905000001_group_left_at
--
-- Fase 3: distingue "o número conectado saiu de verdade deste
-- grupo" (left_at preenchido) de "o usuário só desabilitou a
-- exibição, mas ainda é membro" (enabled = false, left_at nulo).
-- ============================================================
ALTER TABLE whatsapp_groups
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;
