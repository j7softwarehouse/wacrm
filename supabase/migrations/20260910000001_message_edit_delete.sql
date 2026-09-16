-- ============================================================
-- 20260910000001_message_edit_delete
--
-- Editar/apagar mensagem própria (spec 2026-09-10). Apagar NUNCA
-- limpa content_text — é a UI que troca a exibição por um
-- placeholder quando deleted_at existe. Editar sobrescreve
-- content_text com o texto atual; original_content_text guarda o
-- texto de antes da PRIMEIRA edição, nunca sobrescrito depois.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_content_text TEXT;
