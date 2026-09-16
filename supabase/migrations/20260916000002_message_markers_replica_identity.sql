-- Sem isso, o payload DELETE do Realtime só traz a primary key (id) da
-- linha apagada — o filtro `conversation_id=eq.X` da subscription do
-- frontend nunca casa, e o cliente nunca recebe o evento de remoção do
-- marcador (mesma pegadinha já documentada em notifications).
ALTER TABLE message_markers REPLICA IDENTITY FULL;
