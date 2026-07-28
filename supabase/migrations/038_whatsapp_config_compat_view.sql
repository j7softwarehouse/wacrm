-- ============================================================
-- 038_whatsapp_config_compat_view
--
-- Shim de compatibilidade para o RENAME da migração 037
-- (`whatsapp_config` → `whatsapp_channels`).
--
-- POR QUÊ
-- Num deploy contínuo existe uma janela em que a migração já rodou mas
-- instâncias com o código ANTIGO ainda servem tráfego (ou o inverso,
-- num rollback). Nessa janela todo caminho de WhatsApp do código
-- antigo quebra — e não só os envios: o webhook de ENTRADA resolve o
-- canal por `whatsapp_config`, então mensagens recebidas seriam
-- perdidas silenciosamente, não apenas falhariam. Uma view com o nome
-- antigo mantém os dois lados funcionando durante a virada.
--
-- ESCOPO — ISTO É TEMPORÁRIO
-- Assim que o deploy tiver rolado por completo e nenhuma instância
-- antiga estiver mais de pé, esta view deve ser removida numa migração
-- de limpeza (`DROP VIEW IF EXISTS public.whatsapp_config;`). Ela não é
-- criada aqui de propósito: o cronograma real do deploy não é conhecido
-- neste momento. Enquanto existir, a view é somente um alias — nenhum
-- código NOVO deve referenciá-la.
--
-- ATUALIZÁVEL
-- Uma view sobre UMA tabela base, sem DISTINCT/GROUP BY/agregação/
-- window/UNION/LIMIT, é *automaticamente atualizável* no Postgres —
-- INSERT/UPDATE/DELETE passam direto para a tabela base. Isso importa
-- porque o código antigo não só lê `whatsapp_config`: ele grava
-- (salvar configuração, atualizar status de conexão, resetar
-- configuração).
--
-- security_invoker = true É OBRIGATÓRIO AQUI
-- Por padrão uma view roda as checagens de permissão como seu DONO, e
-- migrações rodam como `postgres`. Como `whatsapp_channels` tem RLS
-- (037), uma view comum criada por `postgres` faria as políticas serem
-- avaliadas contra o dono — furando o isolamento entre contas e
-- expondo o `access_token` de TODA conta a qualquer usuário
-- autenticado. Com `security_invoker = true` (Postgres 15+) as
-- políticas de `whatsapp_channels` são avaliadas contra quem consulta,
-- então a view herda exatamente a mesma autorização da tabela base —
-- membros leem, admins escrevem.
-- ============================================================

-- Um objeto com o nome antigo pode ter sobrado de uma execução parcial
-- da 037 (ex.: a tabela existia e o rename não chegou a rodar). CREATE
-- OR REPLACE VIEW só substitui uma VIEW: falharia se `whatsapp_config`
-- ainda fosse TABELA, e não consegue trocar o conjunto/tipo de colunas
-- de uma view pré-existente. O DROP condicional abaixo deixa a
-- migração re-executável nos dois casos, sem nunca derrubar uma tabela
-- com dados.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'whatsapp_config'
  ) THEN
    DROP VIEW public.whatsapp_config;
  END IF;
END $$;

CREATE OR REPLACE VIEW public.whatsapp_config
  WITH (security_invoker = true)
  AS SELECT * FROM public.whatsapp_channels;

COMMENT ON VIEW public.whatsapp_config IS
  'Shim de compatibilidade (migração 038) para o rename da 037. '
  'Temporário: remover numa migração de limpeza quando o deploy que '
  'renomeou whatsapp_config → whatsapp_channels tiver rolado por '
  'completo. Nenhum código novo deve usar este nome.';

-- Uma view nova NÃO herda os privilégios da tabela base — sem estes
-- GRANTs o PostgREST responderia permission denied para os papéis do
-- Supabase, e o shim não serviria para nada. A autorização de verdade
-- continua sendo a RLS de `whatsapp_channels`, aplicada via
-- security_invoker; estes GRANTs só abrem a porta para ela ser
-- avaliada. Espelham os privilégios que a tabela base já concede.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_config
  TO authenticated, service_role;
