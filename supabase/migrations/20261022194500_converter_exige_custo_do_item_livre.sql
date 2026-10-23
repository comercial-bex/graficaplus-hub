-- A OS não nasce com item livre de custo zero (22/10/2026, onda 1 do plano).
--
-- Item fora do catálogo não tem ficha: sem custo digitado, entra na OS com
-- custo 0, não reserva nem baixa material, e a margem da OS é inventada. Em
-- 22/10, 16 dos 41 itens de orçamento eram livres, todos com custo 0; 7 dos 8
-- aprovados sem OS têm item assim (os banners de john terry e Max Lima a
-- R$ 12–32, abaixo do custo de R$ 14,50 — prejuízo que a tela mostrava como lucro).
--
-- A trava fica na CONVERSÃO, não no orçamento: quem orça (vendedor) não vê
-- custo; quem converte (orcamentos.convert: gestor e admin) vê. O orçamento
-- continua livre para montar; a OS só nasce com o custo de cada item avulso
-- informado, ou com o item trocado por um produto do catálogo.

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os'::regproc);
  v_de text := E'  IF v_orc.cliente_id IS NULL THEN\n    PERFORM public.vincular_cliente_do_contato(p_orcamento_id);\n';
  v_para text := E'  -- (b2) item livre sem custo não vira OS (22/10/2026)\n'
    || E'  DECLARE v_sem_custo text;\n'
    || E'  BEGIN\n'
    || E'    SELECT string_agg(btrim(i.descricao), ''; '' ORDER BY i.ordem) INTO v_sem_custo\n'
    || E'      FROM public.orcamento_itens i\n'
    || E'     WHERE i.orcamento_id = p_orcamento_id AND i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0;\n'
    || E'    IF v_sem_custo IS NOT NULL THEN\n'
    || E'      RAISE EXCEPTION ''Item fora do catálogo sem custo: %. Troque por um produto do catálogo ou informe o custo do item no orçamento; sem isso a OS nasce sem material e com margem inventada.'', v_sem_custo\n'
    || E'        USING ERRCODE = ''P0001'';\n'
    || E'    END IF;\n'
    || E'  END;\n\n'
    || v_de;
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;
