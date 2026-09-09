-- Previsto × realizado no relatório: levar o dado para onde se decide preço.
--
-- `vw_resultado_os` já calcula custo previsto, custo realizado, divergência e as
-- duas margens — é a peça de job costing que os MIS do setor consideram central,
-- e ela existe aqui com boa qualidade. Só que aparecia apenas dentro de UMA OS,
-- uma de cada vez.
--
-- Quem precisa desse número é quem forma preço, e essa pessoa olha o conjunto:
-- "em quais trabalhos eu errei a mão, e para que lado". Uma OS por vez não
-- responde isso.

-- security_invoker como as views irmãs: a leitura direta continua sujeita às
-- permissões de quem chama. O dinheiro vem da tabela-espelho
-- os_resultados_financeiros, protegida por can_see_financials — quem não pode ver
-- valor lê a view com os campos zerados, que é o padrão do resto do sistema.
create or replace view public.rel_previsto_realizado with (security_invoker = true) as
select r.os_id,
       o.numero,
       o.titulo,
       coalesce(c.nome, 'Sem cliente') as cliente,
       o.created_at::date as criada_em,
       o.status::text as status,
       r.receita_liquida,
       r.custo_previsto,
       r.custo_realizado,
       r.divergencia_custo,
       -- Percentual sobre o previsto: R$ 50 de estouro num custo de R$ 100 é
       -- outra conversa que R$ 50 num custo de R$ 5.000.
       case when coalesce(r.custo_previsto, 0) > 0
            then round((r.divergencia_custo / r.custo_previsto) * 100, 1)
       end as divergencia_pct,
       r.margem_prevista,
       r.margem_realizada,
       round(coalesce(r.margem_realizada, 0) - coalesce(r.margem_prevista, 0), 2) as variacao_margem,
       r.retrabalho,
       r.atraso
from public.vw_resultado_os r
join public.ordens_servico o on o.id = r.os_id
left join public.clientes c on c.id = o.cliente_id;

comment on view public.rel_previsto_realizado is
  'Custo e margem previstos x realizados por OS, com a divergência em valor e em percentual.';

-- ---------------------------------------------------------------------------
-- A TELA DE RELATÓRIOS NÃO CARREGAVA.
--
-- Descoberto ao acrescentar o novo bloco: `get_relatorios_prioritarios` não era
-- SECURITY DEFINER, e cinco das views rel_* leem `ordens_servico` e `itens_os`
-- diretamente. Como as views são security_invoker, rodavam com as permissões de
-- quem chama — e `authenticated` não tem grant nessas tabelas base, só nas
-- colunas não financeiras. Resultado: a RPC estourava em
-- "permission denied for table ordens_servico" na primeira view financeira, e a
-- tela inteira falhava. Para todo mundo, desde sempre.
--
-- A função vira SECURITY DEFINER. A autorização não se perde: ela já checa
-- is_staff e can_see_financials no começo, e é esse par que decide o que volta.
-- ---------------------------------------------------------------------------
create or replace function public.get_relatorios_prioritarios(
  p_inicio date default ((current_date - '30 days'::interval))::date,
  p_fim date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_inicio DATE := COALESCE(p_inicio, (CURRENT_DATE - INTERVAL '30 days')::date);
  v_fim DATE := COALESCE(p_fim, CURRENT_DATE);
  v_can_fin BOOLEAN := public.can_see_financials(auth.uid());
  v_result JSONB;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado aos relatórios';
  END IF;

  SELECT jsonb_build_object(
    'canSeeFinancials', v_can_fin,
    'periodo', jsonb_build_object('inicio', v_inicio, 'fim', v_fim),
    'financeiro', CASE WHEN v_can_fin THEN jsonb_build_object(
      'faturamentoPorPeriodo', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.periodo) FROM (
        SELECT * FROM public.rel_faturamento_por_periodo WHERE periodo BETWEEN v_inicio AND v_fim
      ) x), '[]'::jsonb),
      'lucroPorOs', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.lucro DESC) FROM (
        SELECT * FROM public.rel_lucro_por_os WHERE criada_em BETWEEN v_inicio AND v_fim LIMIT 100
      ) x), '[]'::jsonb),
      'margemPorProduto', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.margem_valor DESC) FROM (
        SELECT * FROM public.rel_margem_por_produto WHERE ultima_venda BETWEEN v_inicio AND v_fim LIMIT 100
      ) x), '[]'::jsonb),
      -- Ordenado pelo maior estouro: a lista serve para achar onde o preço
      -- está errado, então o pior caso vem primeiro.
      'previstoRealizado', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.divergencia_custo DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_previsto_realizado
        WHERE criada_em BETWEEN v_inicio AND v_fim LIMIT 100
      ) x), '[]'::jsonb)
    ) ELSE NULL END,
    'operacional', jsonb_build_object(
      'osAtrasadas', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.dias_atraso DESC) FROM (
        SELECT * FROM public.rel_os_atrasadas LIMIT 100
      ) x), '[]'::jsonb),
      'retrabalhoPorSetor', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.retrabalhos DESC) FROM (
        SELECT * FROM public.rel_retrabalho_por_setor WHERE ultima_ocorrencia BETWEEN v_inicio AND v_fim
      ) x), '[]'::jsonb),
      'producaoPorMaquina', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade_produzida DESC) FROM (
        SELECT * FROM public.rel_producao_por_maquina WHERE ultimo_apontamento IS NULL OR ultimo_apontamento BETWEEN v_inicio AND v_fim
      ) x), '[]'::jsonb),
      'tempoMedioPorEtapa', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.horas_media DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_tempo_medio_por_etapa
      ) x), '[]'::jsonb)
    ),
    'whatsapp', jsonb_build_object(
      'conversasAbertas', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ultima_mensagem_em DESC) FROM (
        SELECT * FROM public.rel_whatsapp_conversas_abertas WHERE aberta_em::date <= v_fim LIMIT 100
      ) x), '[]'::jsonb),
      'tempoMedioResposta', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.minutos_media_resposta DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_whatsapp_tempo_medio_resposta LIMIT 100
      ) x), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

comment on function public.get_relatorios_prioritarios is
  'Relatórios prioritários. SECURITY DEFINER porque as views rel_* são security_invoker e leem tabelas base sem grant de tabela para authenticated; a autorização é feita aqui, por is_staff e can_see_financials.';
