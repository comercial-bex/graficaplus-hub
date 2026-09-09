-- A OS não sabia de qual orçamento nasceu.
--
-- O vínculo existia num sentido só. Medido na OS 44 "Urna e Gatinho Anjo":
--
--   orcamentos_3d.orcamento_id  -> espelho 2D    ✓
--   orcamentos_3d.os_id         -> OS 44         ✓
--   orcamentos.os_id            -> OS 44         ✓
--   ordens_servico.orcamento_id -> NULO          ✗
--
-- Três dos quatro elos preenchidos, e justamente o de volta faltando. Toda
-- consulta que parte da OS para achar o orçamento falha em silêncio:
-- `funil_comercial` junta por `ordens_servico.orcamento_id`, então essa OS
-- some do funil; `rel_previsto_realizado` não acha o preço combinado; e
-- "quanto essa venda rendeu" fica sem resposta.
--
-- A causa é `converter_orcamento_3d_em_os`, que insere a OS sem `orcamento_id`.

-- ---------------------------------------------------------------------------
-- 1. Gatilho que mantém os dois lados amarrados.
--
-- Corrigir só a função resolveria o caso de hoje e deixaria a porta aberta:
-- qualquer caminho novo que grave `orcamentos.os_id` sem preencher o outro lado
-- recria o problema, e ninguém percebe porque nada dá erro.
--
-- O gatilho fecha a classe: quando o orçamento passa a apontar para uma OS, a
-- OS passa a apontar de volta. Só preenche quando está vazio — OS que já tem
-- orçamento não é sobrescrita, porque isso seria trocar o pai por outro em
-- silêncio, que é um defeito pior que o original.
-- ---------------------------------------------------------------------------
create or replace function public.tg_orcamento_amarra_os()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.os_id is null then
    return new;
  end if;

  update public.ordens_servico o
     set orcamento_id = new.id
   where o.id = new.os_id
     and o.orcamento_id is null;

  return new;
end;
$$;

comment on function public.tg_orcamento_amarra_os is
  'Quando o orçamento aponta para uma OS, a OS passa a apontar de volta. Só preenche o que está vazio: trocar o orçamento de uma OS já vinculada seria pior que o defeito original.';

drop trigger if exists tg_orcamento_amarra_os on public.orcamentos;
create trigger tg_orcamento_amarra_os
  after insert or update of os_id on public.orcamentos
  for each row execute function public.tg_orcamento_amarra_os();

-- ---------------------------------------------------------------------------
-- 2. A conversão 3D passa a gravar o vínculo direto.
--
-- O gatilho acima já cobriria, porque a conversão grava `orcamentos_3d.os_id` e
-- há sincronia com o espelho 2D. Mas depender de efeito colateral de outro
-- gatilho para um vínculo essencial é frágil: se a sincronia mudar, o elo some
-- de novo. A função grava o que ela sabe, na hora em que sabe.
-- ---------------------------------------------------------------------------
create or replace function public.converter_orcamento_3d_em_os(p_orcamento_3d_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_uid uuid;
  v_orc public.orcamentos_3d%ROWTYPE;
  v_calc public.orcamento_3d_calculos%ROWTYPE;
  v_os_id uuid;
  v_item_id uuid;
  v_conta_id uuid;
  v_qtd numeric;
  v_custo numeric;
  v_jobs int;
BEGIN
  v_uid := require_permission('impressao3d.quote.approve');
  SELECT * INTO v_orc FROM public.orcamentos_3d WHERE id = p_orcamento_3d_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento 3D não encontrado'; END IF;
  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_3d_id', p_orcamento_3d_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;
  IF v_orc.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Orçamento 3D sem cliente — associe um cliente antes de converter';
  END IF;

  SELECT * INTO v_calc FROM public.orcamento_3d_calculos
   WHERE orcamento_3d_id = p_orcamento_3d_id ORDER BY versao DESC LIMIT 1;

  v_qtd := GREATEST(COALESCE(v_orc.quantidade, 1), 1);
  v_custo := COALESCE(v_calc.custo_operacional, 0);

  -- Sem cálculo salvo, o custo previsto caía em ZERO e a OS relatava margem de
  -- 100%. O filamento das placas é um custo previsto de verdade.
  IF v_custo <= 0 THEN
    SELECT COALESCE(sum(c.custo_total * GREATEST(COALESCE(pl.repeticoes, 1), 1)), 0)
      INTO v_custo
      FROM public.orcamento_3d_placas pl
      JOIN public.orcamento_3d_consumos c ON c.placa_id = pl.id
     WHERE pl.orcamento_3d_id = p_orcamento_3d_id;
  END IF;

  -- `orcamento_id` é o elo de volta: sem ele a OS não sabe de onde veio, e o
  -- funil e o previsto x realizado perdem esta venda.
  INSERT INTO public.ordens_servico (cliente_id, orcamento_id, titulo, observacoes,
                                     valor_total, custo_previsto, created_by, status_geral)
  VALUES (v_orc.cliente_id, v_orc.orcamento_id, v_orc.titulo,
          'Origem: orçamento 3D '||p_orcamento_3d_id::text,
          v_orc.preco_comercial, v_custo, v_uid, 'entrada')
  RETURNING id INTO v_os_id;

  INSERT INTO public.itens_os (os_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem)
  VALUES (v_os_id, v_orc.titulo, v_qtd, 'un',
          round(COALESCE(v_orc.preco_comercial, 0) / v_qtd, 2),
          round(v_custo / v_qtd, 2), COALESCE(v_orc.preco_comercial, 0), 1)
  RETURNING id INTO v_item_id;

  UPDATE public.orcamentos_3d SET os_id = v_os_id, status = 'convertido' WHERE id = p_orcamento_3d_id;

  -- O espelho 2D também acompanha, para o funil enxergar a venda.
  IF v_orc.orcamento_id IS NOT NULL THEN
    UPDATE public.orcamentos SET os_id = v_os_id
     WHERE id = v_orc.orcamento_id AND os_id IS NULL;
  END IF;

  v_jobs := public.criar_jobs_3d_da_os(p_orcamento_3d_id, v_os_id);
  UPDATE public.producao_3d_jobs SET os_item_id = v_item_id
   WHERE os_id = v_os_id AND os_item_id IS NULL;

  INSERT INTO public.contas_receber (cliente_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, v_os_id, COALESCE(v_orc.preco_comercial, 0))
  RETURNING id INTO v_conta_id;

  INSERT INTO public.parcelas_receber (conta_id, parcela, valor, vencimento)
  VALUES (v_conta_id, 1, COALESCE(v_orc.preco_comercial, 0), CURRENT_DATE);

  INSERT INTO public.eventos_negocio (entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id)
  VALUES ('orcamento', p_orcamento_3d_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
          'Orçamento 3D convertido em OS',
          jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'origem', '3d',
                             'jobs', v_jobs, 'orcamento_id', v_orc.orcamento_id), v_uid);

  RETURN jsonb_build_object('orcamento_3d_id', p_orcamento_3d_id, 'os_id', v_os_id,
                            'conta_id', v_conta_id, 'jobs', v_jobs);
END
$function$;

comment on function public.converter_orcamento_3d_em_os is
  'Orçamento 3D vira OS (apontando de volta para o orçamento), item, fila de impressão, conta e parcela.';

-- ---------------------------------------------------------------------------
-- 3. Conserta o que já está gravado.
--
-- Pelo apontamento inverso, que sobreviveu: onde o orçamento aponta para uma OS
-- e a OS não aponta de volta, preenche.
-- ---------------------------------------------------------------------------
update public.ordens_servico o
   set orcamento_id = orc.id
  from public.orcamentos orc
 where orc.os_id = o.id
   and o.orcamento_id is null;
