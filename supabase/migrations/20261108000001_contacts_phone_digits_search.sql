-- ============================================================
-- 20261108000001_contacts_phone_digits_search
--
-- A busca de Contatos (com filtro de tag) comparava o termo só com o
-- telefone formatado ("+55 31 8640-5178"). Buscar "86405178" não achava.
-- Agora, quando o termo tem dígitos, compara também com `phone_normalized`
-- (coluna gerada só com dígitos).
--
-- Mesma assinatura da 20260807000001: CREATE OR REPLACE substitui a função.
-- Idempotente.
-- ============================================================

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
        OR (
          regexp_replace(p_search, '\D', '', 'g') <> ''
          AND c.phone_normalized ILIKE '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
        )
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY
      CASE WHEN p_sort_column = 'name' AND p_sort_ascending THEN name END ASC NULLS LAST,
      CASE WHEN p_sort_column = 'name' AND NOT p_sort_ascending THEN name END DESC NULLS LAST,
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
