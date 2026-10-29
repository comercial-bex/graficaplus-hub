-- 29/10/2026 — o aviso de "item sem produto e sem custo" chega ANTES de o cliente pagar.
--
-- Desde 22/10 `converter_orcamento_em_os` recusa o item fora do catálogo sem custo ("a OS nasce sem material e
-- com margem inventada"). A regra está certa, mas a recusa só aparece na hora de converter, quando o cliente
-- já aprovou e, muitas vezes, já pagou. Foi assim com o orçamento 153 (29/10, "3 banner", R$ 42 em Pix já
-- recebido): dois itens digitados à mão como "banner", e a OS não nasce. É também o que explica os cinco
-- orçamentos impressos sem OS (54, 56, 57, 62 e 70, todos "banner" ou "adesivo" digitados à mão): ninguém
-- conseguia converter, então a produção seguiu sem OS.
--
-- Esta função devolve a lista dos itens que o banco vai recusar — o MESMO critério do bloco b2 da conversão
-- (sem produto, custo zero, fora a linha da taxa de prazo). A tela usa a lista para avisar enquanto o
-- orçamento ainda está sendo montado e, de novo, na conferência antes de converter. Só devolve descrições,
-- nunca custo. Sem login de equipe que veja preço, devolve vazio: a recusa do banco segue valendo.

CREATE OR REPLACE FUNCTION public.itens_que_impedem_a_os(p_orcamento_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) OR NOT public.can_see_prices(v_uid) THEN
    RETURN ARRAY[]::text[];
  END IF;

  RETURN COALESCE((
    SELECT array_agg(COALESCE(NULLIF(btrim(i.descricao), ''), 'item sem descrição') ORDER BY i.ordem)
      FROM public.orcamento_itens i
     WHERE i.orcamento_id = p_orcamento_id AND i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0
       AND i.origem_calculo IS DISTINCT FROM 'taxa_prazo'
  ), ARRAY[]::text[]);
END;
$function$;

-- Função nasce com EXECUTE para PUBLIC, e REVOKE de PUBLIC não fecha o anon.
REVOKE ALL ON FUNCTION public.itens_que_impedem_a_os(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itens_que_impedem_a_os(uuid) TO authenticated;

COMMENT ON FUNCTION public.itens_que_impedem_a_os(uuid) IS
  'Descrições dos itens do orçamento que converter_orcamento_em_os vai recusar (sem produto e sem custo). Exige is_staff e can_see_prices; vazio caso contrário. Nunca devolve custo.';
