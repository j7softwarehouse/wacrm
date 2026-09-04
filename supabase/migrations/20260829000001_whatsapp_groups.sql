-- ============================================================
-- 20260829000001_whatsapp_groups
--
-- Grupos de WhatsApp como entidade própria. A alternativa —
-- representar o grupo como uma linha em `contacts` com o JID no
-- campo `phone` — contaminaria base de contatos, funil, tags e
-- dashboard, que assumem "contato = pessoa".
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  group_jid  TEXT NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  -- Opt-in explícito: o número conectado costuma estar em grupos
  -- pessoais que não podem poluir a inbox.
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (account_id, channel_id, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_account
  ON whatsapp_groups(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS group_participants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  -- Pode ser @s.whatsapp.net OU @lid (identificador opaco, sem telefone).
  participant_jid TEXT NOT NULL,
  phone           TEXT,
  display_name    TEXT,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, participant_jid)
);

CREATE INDEX IF NOT EXISTS idx_group_participants_group
  ON group_participants(group_id);

-- Conversa passa a ser OU 1:1 OU de grupo, nunca ambos nem nenhum.
ALTER TABLE conversations
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES whatsapp_groups(id) ON DELETE CASCADE;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_contact_xor_group;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_xor_group
    CHECK (num_nonnulls(contact_id, group_id) = 1);

-- A 037 criou este índice quando contact_id ainda era NOT NULL — o
-- NULLS NOT DISTINCT ali só existia para colapsar canal órfão
-- (channel_id NULL após remoção de canal), nunca contact_id. Agora
-- que contact_id pode ser NULL (conversa de grupo), o índice precisa
-- de WHERE para não colapsar todo grupo entre si.
DROP INDEX IF EXISTS idx_conversations_account_contact_channel;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel_id) NULLS NOT DISTINCT
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_group_channel
  ON conversations (account_id, group_id, channel_id) NULLS NOT DISTINCT
  WHERE group_id IS NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS participant_id UUID
    REFERENCES group_participants(id) ON DELETE SET NULL;

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_groups_all ON whatsapp_groups;

CREATE POLICY "members read groups" ON whatsapp_groups
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY "admins write groups" ON whatsapp_groups
  FOR ALL USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS group_participants_all ON group_participants;

CREATE POLICY "members read participants" ON group_participants FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM whatsapp_groups g
    WHERE g.id = group_participants.group_id
      AND is_account_member(g.account_id)
  ));
