-- Custo: segunda rodada da revisão adversarial do PR 425 (04/11/2026).
--
-- A revisão dos itens que o #430 não cobria achou duas coisas no banco:
--
--   1. Alçada do desconto com custo PARCIAL. Produto todo terceirizado (custo-base zero, mas com
--      terceirizado ou fórmula somando em custo_formulas) continuava "sem custo" e caía no limite fixo
--      de 10% sem nenhuma outra conta: se o preço de venda estava perto do custo do terceiro, quem vende
--      dava 10% e vendia ao custo sem chamar o gerente. Agora o que já se sabe do custo dessas linhas é
--      PISO CERTO (o custo real é esse mais o que falta): desconto que leva o total abaixo desse piso
--      passa da alçada, mesmo dentro dos 10%. A regra continua sendo o limite fixo; o piso só aperta.
--      Quem não vê o financeiro não recebe o teto calculado nem o aviso de piso parcial (piso é custo
--      disfarçado), e a mensagem de bloqueio deixa de dizer "acima de 10%" quando o motivo é o piso.
--
--   2. "Repassar" (recalcular_previsao_custos) regravava ordens_servico.custo_previsto SÓ com a soma dos
--      materiais previstos: o que fórmulas e terceirizados somaram ao custo da OS convertida sumia (a OS 174,
--      aberta hoje, iria de R$ 12,48 para R$ 3,39: R$ 7,46 de custo que não é material). Agora repassa só a
--      DIFERENÇA do custo dos materiais que mudaram, e o resto do custo previsto fica (a 174 vai a R$ 10,85).
--      O custo previsto nunca fica abaixo dos materiais previstos (a regra da conversão, GREATEST). OS sem
--      material alterado não é tocada (antes era regravada com a soma, subindo ou descendo sem motivo).
--
-- Itens da revisão que NÃO viraram mudança de banco (decisão registrada em docs/proximos-passos-interface-holdprint.md):
--   - A conversão em OS grava itens_os.custo_unitario em centavos (numeric 12,2): o custo por peça de
--     R$ 100 por pedido em 30.000 peças vira R$ 0,00 NO ITEM da OS. O custo da OS (custo_previsto) vem do
--     custo_estimado do orçamento, que é exato; só o relatório "Margem por produto" lê o item. Mexer na
--     escala exige derrubar e refazer as views que dependem da coluna.
--   - Quantidade entre 0 e 1 mistura GREATEST(q, 1) no custo-base com q nas fórmulas.
--
-- Esclarecimento sobre a migração 20261103410000 (já aplicada, não reescrita): o gatilho de custo do item é
-- o dono do custo ESTIMADO do orçamento no banco, mas a tela ainda recalcula custo_estimado depois de salvar
-- (recalcular() na página do orçamento) e a OS convertida ganha custo_previsto = GREATEST(custo_estimado,
-- materiais). "Rodar de novo é inofensivo" vale para as trocas de função, não para dados já gravados.
--
-- Cada troca é feita sobre a definição VIVA (pg_get_functiondef) com âncora que precisa aparecer o número
-- esperado de vezes: se outra sessão mexeu na função, a migração para em voz alta. Rodar de novo é inofensivo.

-- 1. desconto_avaliar: o custo parcial é piso certo ----------------------------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.desconto_avaliar(uuid,numeric,numeric,numeric)'::regprocedure);
  v_novo text;
  v_de text[];
  v_para text[];
  k integer;
  n integer;
BEGIN
  IF position('v_parcial' IN v_def) > 0 THEN
    RAISE NOTICE 'desconto_avaliar já conta o custo parcial como piso';
    RETURN;
  END IF;
  v_de := ARRAY[
    $d$v_f numeric;$d$,
    $d$IF COALESCE(r.valor_total, 0) > 0 THEN v_sem_custo := v_sem_custo + 1; END IF;$d$,
    $d$ELSIF v_desc * 100 > v_sub * 10 THEN$d$,
    $d$v_max_vendedor := round(floor(v_sub * 10) / 100, 2);$d$,
    $d$'margem_impossivel', v_impossivel > 0$d$
  ];
  v_para := ARRAY[
    $d$v_f numeric;
  v_parcial numeric := 0;$d$,
    $d$IF COALESCE(r.valor_total, 0) > 0 THEN
        v_sem_custo := v_sem_custo + 1;
        -- O que já se sabe do custo da linha sem custo-base (fórmulas e terceirizados) é piso CERTO:
        -- o custo real é esse mais o que falta saber (revisão de 04/11/2026).
        v_parcial := v_parcial + v_f;
      END IF;$d$,
    $d$ELSIF v_desc * 100 > v_sub * 10
     OR (v_parcial > 0 AND v_total < round((v_custo + v_parcial) / (1 - v_taxa), 2)) THEN$d$,
    $d$v_max_vendedor := round(floor(v_sub * 10) / 100, 2);
    -- Com custo parcial conhecido, o desconto de quem vende não pode levar o total abaixo dele.
    IF v_parcial > 0 THEN
      v_max_vendedor := LEAST(v_max_vendedor,
        GREATEST(round(v_sub - v_cred - round((v_custo + v_parcial) / (1 - v_taxa), 2), 2), 0));
    END IF;$d$,
    $d$'margem_impossivel', v_impossivel > 0,
    'piso_parcial', v_parcial > 0$d$
  ];
  v_novo := v_def;
  FOR k IN 1 .. array_length(v_de, 1) LOOP
    n := (length(v_novo) - length(replace(v_novo, v_de[k], ''))) / length(v_de[k]);
    IF n <> 1 THEN
      RAISE EXCEPTION 'desconto_avaliar: âncora % apareceu % vez(es) (esperado 1): %', k, n, v_de[k];
    END IF;
    v_novo := replace(v_novo, v_de[k], v_para[k]);
  END LOOP;
  EXECUTE v_novo;
END $m$;

-- 2. desconto_do_orcamento: quem não vê o financeiro não recebe o teto calculado do piso parcial ---------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.desconto_do_orcamento(uuid,text,numeric)'::regprocedure);
  v_novo text;
  v_de text[];
  v_para text[];
  k integer;
  n integer;
BEGIN
  IF position('v_parcial' IN v_def) > 0 THEN
    RAISE NOTICE 'desconto_do_orcamento já esconde o piso parcial de quem não vê o financeiro';
    RETURN;
  END IF;
  v_de := ARRAY[
    $d$v_pode_editar boolean;$d$,
    $d$v_s := v_s - 'custo' - 'minimo' - 'piso' - 'desconto_ate_piso' - 'itens_so_material' - 'taxa';$d$,
    $d$IF v_s->>'regra' = 'margem' THEN$d$
  ];
  v_para := ARRAY[
    $d$v_pode_editar boolean;
  v_parcial boolean;$d$,
    $d$v_parcial := COALESCE((v_s->>'piso_parcial')::boolean, false);
    v_s := v_s - 'custo' - 'minimo' - 'piso' - 'desconto_ate_piso' - 'itens_so_material' - 'taxa' - 'piso_parcial';$d$,
    $d$IF v_s->>'regra' = 'margem' OR v_parcial THEN$d$
  ];
  v_novo := v_def;
  FOR k IN 1 .. array_length(v_de, 1) LOOP
    n := (length(v_novo) - length(replace(v_novo, v_de[k], ''))) / length(v_de[k]);
    IF n <> 1 THEN
      RAISE EXCEPTION 'desconto_do_orcamento: âncora % apareceu % vez(es) (esperado 1): %', k, n, v_de[k];
    END IF;
    v_novo := replace(v_novo, v_de[k], v_para[k]);
  END LOOP;
  EXECUTE v_novo;
END $m$;

-- 3. A mensagem do bloqueio no limite fixo não diz "acima de 10%" quando o motivo é o custo já cadastrado ---------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.tg_parceiro_credito_no_total()'::regprocedure);
  v_de text := $d$Desconto acima de 10%% com item sem custo cadastrado passa da sua alçada.$d$;
  v_para text := $d$Desconto acima de 10%% (ou que deixa o total abaixo do custo já cadastrado) com item sem custo completo passa da sua alçada.$d$;
  n integer;
BEGIN
  IF position(v_para IN v_def) > 0 THEN
    RAISE NOTICE 'tg_parceiro_credito_no_total já fala do custo já cadastrado';
    RETURN;
  END IF;
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'tg_parceiro_credito_no_total: a mensagem apareceu % vez(es) (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 4. Repassar: só a diferença do custo dos materiais, o resto do custo previsto da OS fica ---------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.recalcular_previsao_custos(uuid)'::regprocedure);
BEGIN
  IF position('repassa só a diferença' IN v_def) > 0 THEN
    RAISE NOTICE 'recalcular_previsao_custos já repassa só a diferença';
    RETURN;
  END IF;
  -- A função é pequena: troca inteira, depois de conferir que é a que foi lida em 04/11/2026.
  IF md5(v_def) <> '4a9da77c41553c7acfd2876d60600509' THEN
    RAISE EXCEPTION 'recalcular_previsao_custos mudou desde a leitura de 04/11/2026 (md5 %): reconferir antes de trocar', md5(v_def);
  END IF;
  EXECUTE $f$
CREATE OR REPLACE FUNCTION public.recalcular_previsao_custos(p_os_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; v_atualizados int; v_os_afetadas int;
begin
  v_uid := public.require_permission('custos.update');
  -- O custo previsto da OS convertida soma mais que material (fórmulas e terceirizados): o Repassar
  -- repassa só a diferença do custo dos materiais que mudaram e deixa o resto como está.
  with alvo as (
    select p.id, m.custo_unitario as novo, p.os_id,
           p.quantidade * (coalesce(m.custo_unitario, 0) - coalesce(p.custo_unitario_previsto, 0)) as delta
    from public.os_materiais_previstos p
    join public.materiais m on m.id = p.material_id
    join public.ordens_servico o on o.id = p.os_id
    where (p_os_id is null or p.os_id = p_os_id)
      and o.status::text not in ('concluido','faturado','cancelado')
      and coalesce(p.custo_unitario_previsto, -1) is distinct from m.custo_unitario
      and not exists (select 1 from public.estoque_reservas r
                       where r.os_id = p.os_id and r.material_id = p.material_id)
      and not exists (select 1 from public.movimentacoes_estoque mv
                       where mv.os_id = p.os_id and mv.material_id = p.material_id)
  ), aplicado as (
    update public.os_materiais_previstos p
       set custo_unitario_previsto = a.novo
      from alvo a where p.id = a.id
    returning p.os_id, a.delta
  ), ajuste as (
    -- A diferença passa para o custo previsto da OS, que nunca fica abaixo dos materiais previstos
    -- (a mesma regra da conversão: GREATEST(custo estimado, materiais)).
    update public.ordens_servico o
       set custo_previsto = greatest(coalesce(o.custo_previsto, 0) + d.delta, d.soma_nova, 0)
      from (
        select a.os_id, sum(a.delta) as delta,
               (select coalesce(sum(p2.quantidade * case when n.id is not null then coalesce(n.novo, 0)
                                                           else coalesce(p2.custo_unitario_previsto, 0) end), 0)
                  from public.os_materiais_previstos p2
                  left join alvo n on n.id = p2.id
                 where p2.os_id = a.os_id) as soma_nova
          from aplicado a group by a.os_id
      ) d
     where o.id = d.os_id
    returning o.id
  )
  select count(*)::int, count(distinct os_id)::int into v_atualizados, v_os_afetadas from aplicado;

  return jsonb_build_object('linhas_atualizadas', v_atualizados, 'os_afetadas', v_os_afetadas);
end $function$
  $f$;
  COMMENT ON FUNCTION public.recalcular_previsao_custos(uuid) IS
    'Atualiza o custo previsto dos materiais da OS aberta pelo custo atual e repassa só a diferença ao custo previsto da OS (repassa só a diferença: fórmulas e terceirizados que a OS já somava ficam).';
END $m$;
