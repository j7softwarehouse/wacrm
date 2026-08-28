-- ============================================================
-- Sobe o teto de upload dos buckets de mídia de 16 MB para 30 MB.
--
-- O limite de 16 MB foi herdado do teto de vídeo da Meta Cloud API,
-- mas a instalação usa o provider uazapi, que fala o protocolo
-- multi-device direto — ali esse teto não se aplica. Verificado
-- empiricamente: vídeo de 29,3 MB aceito pelo WhatsApp em 1080p, sem
-- recompressão e reproduzível como vídeo.
--
-- A cota de storage do plano free (1 GB) é protegida pela varredura de
-- retenção de 48h em `/api/media/cron`, que apaga vídeos antigos do
-- bucket `chat-media`. Sem essa varredura, subir o teto encheria a
-- cota e derrubaria o upload de TODA mídia.
--
-- `allowed_mime_types` fica inalterado de propósito: só o tamanho muda.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 31457280 -- 30 MB
WHERE id IN ('chat-media', 'flow-media');
