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
  channel_id UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  group_jid  TEXT NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  -- Opt-in explícito: o número conectado costuma estar em grupos
  -- pessoais que não podem poluir a inbox.
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, channel_id, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_account
  ON whatsapp_groups(account_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_group_channel
  ON conversations (account_id, group_id, channel_id) NULLS NOT DISTINCT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS participant_id UUID
    REFERENCES group_participants(id) ON DELETE SET NULL;

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_groups_all ON whatsapp_groups;
CREATE POLICY whatsapp_groups_all ON whatsapp_groups FOR ALL
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS group_participants_all ON group_participants;
CREATE POLICY group_participants_all ON group_participants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM whatsapp_groups g
    WHERE g.id = group_participants.group_id
      AND is_account_member(g.account_id)
  ));
