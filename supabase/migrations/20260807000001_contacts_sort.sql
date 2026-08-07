-- ============================================================
-- 20260807000001_contacts_sort
--
-- Adiciona ordenação por nome ou data de criação à tela de Contatos.
--
-- O caminho SEM filtro de tag ordena direto no PostgREST (.order() no
-- cliente), sem precisar de migração. Mas o caminho COM filtro de tag
-- passa pela função `filter_contacts_by_tags` (migração 025), que
-- tinha "ORDER BY created_at DESC" fixo no corpo da query — sem
-- alterar a função, o filtro de tag ignoraria a ordenação escolhida
-- na tela.
--
-- `p_sort_column` aceita só 'name' ou 'created_at' — nunca uma coluna
-- arbitrária vinda do cliente, para não abrir espaço a SQL injection
-- via nome de coluna (não dá para parametrizar identificador com
-- bind variable). Qualquer valor fora dessas duas opções cai no
-- default (created_at), não lança erro — falha para o comportamento
-- anterior em vez de quebrar a tela.
--
-- Idempotente — seguro re-executar.
--
-- Atenção: acrescentar parâmetros muda a assinatura da função aos
-- olhos do Postgres (identidade = nome + tipos dos parâmetros). Um
-- simples CREATE OR REPLACE aqui NÃO substituiria a versão de 4
-- parâmetros — criaria uma SEGUNDA função sobrecarregada, coexistindo
-- com a antiga, e o PostgREST já teve problema de cache justamente com
-- ambiguidade de função nesta base (ver comentário em
-- 20250101000017_account_sharing.sql sobre o embed de account_id).
-- Por isso o DROP explícito da assinatura antiga vem primeiro.
-- ============================================================

DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_sort_column TEXT DEFAULT 'created_at',
  p_sort_ascending BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at, c.name
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY
      -- CASE por coluna (não por expressão dinâmica) — identificador
      -- de coluna não pode ser bind variable em SQL puro; isto evita
      -- string-concatenar o nome da coluna na query.
      CASE WHEN p_sort_column = 'name' AND p_sort_ascending THEN name END ASC NULLS LAST,
      CASE WHEN p_sort_column = 'name' AND NOT p_sort_ascending THEN name END DESC NULLS LAST,
      -- Qualquer coluna que não seja 'name' (inclusive um valor
      -- inesperado) cai aqui — created_at é o default seguro tanto
      -- para o parâmetro quanto para entrada inválida.
      CASE WHEN p_sort_column <> 'name' AND p_sort_ascending THEN created_at END ASC,
      CASE WHEN p_sort_column <> 'name' AND NOT p_sort_ascending THEN created_at END DESC,
      id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY
    CASE WHEN p_sort_column = 'name' AND p_sort_ascending THEN c.name END ASC NULLS LAST,
    CASE WHEN p_sort_column = 'name' AND NOT p_sort_ascending THEN c.name END DESC NULLS LAST,
    CASE WHEN p_sort_column <> 'name' AND p_sort_ascending THEN c.created_at END ASC,
    CASE WHEN p_sort_column <> 'name' AND NOT p_sort_ascending THEN c.created_at END DESC,
    c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, BOOLEAN) TO authenticated;
