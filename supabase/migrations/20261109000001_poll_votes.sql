-- ============================================================
-- Votos de enquete (UAZAPI).
--
-- Um voto chega ao webhook como PollUpdateMessage, ligado à enquete
-- original por `quoted` (= messages.message_id). Guardamos uma linha por
-- pessoa por enquete e, a cada voto, recalculamos a contagem em
-- messages.poll_results — a bolha só lê essa coluna e atualiza pelo
-- realtime de mensagens que já existe.
--
-- Escrita só pelo webhook (service role), então não há policy de
-- insert/update/delete para usuários. Leitura segue a conta da conversa.
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll_results JSONB;

CREATE TABLE IF NOT EXISTS poll_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  voter_jid TEXT NOT NULL,
  voter_name TEXT,
  options TEXT[] NOT NULL DEFAULT '{}',
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, voter_jid)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON poll_votes (message_id);

ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poll_votes_select ON poll_votes;
CREATE POLICY poll_votes_select ON poll_votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = poll_votes.message_id
        AND is_account_member(c.account_id)
    )
  );
