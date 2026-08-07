-- ============================================================
-- 20260731000001_school_adaptation
--
-- Duas colunas aditivas para a adaptação escolar:
--
--   contacts.source          — de onde veio o contato, para distinguir
--                              "família da lista" de "alguém novo que
--                              acabou de escrever". A escola opera dois
--                              números e a secretaria precisa saber, no
--                              meio do atendimento, com quem está falando.
--
--   accounts.disabled_modules — módulos desligados por conta. Opt-out:
--                              o default vazio mantém todo o
--                              comportamento atual, então nenhuma conta
--                              existente muda. Espelha o padrão de
--                              profiles.beta_features (migração 011).
--
-- Idempotente — seguro re-executar.
-- ============================================================

-- ─── contacts.source ────────────────────────────────────────
-- Default 'whatsapp' porque é o que as linhas existentes de fato são:
-- criadas pelo webhook a partir de mensagem recebida.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_source_check
  CHECK (source IN ('whatsapp', 'import', 'manual'));

-- A lista de "não identificados" é a varredura diária da secretaria;
-- o índice parcial serve exatamente essa consulta sem custo nas demais.
CREATE INDEX IF NOT EXISTS idx_contacts_source_new
  ON contacts (account_id)
  WHERE source = 'whatsapp';

COMMENT ON COLUMN contacts.source IS
  'Procedência do contato: whatsapp (criado por mensagem recebida, '
  'ainda não identificado), import (veio da lista da organização) ou '
  'manual (cadastrado à mão). Não é etiqueta editável.';

-- ─── accounts.disabled_modules ──────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS disabled_modules TEXT[]
    NOT NULL
    DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN accounts.disabled_modules IS
  'Módulos desligados nesta conta (ex.: {sales}). Opt-out: vazio '
  'significa tudo ligado, preservando o comportamento padrão.';
