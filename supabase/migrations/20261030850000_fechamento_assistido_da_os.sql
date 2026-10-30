-- Fechamento assistido da OS (decisão tomada por delegação do dono em 30/10/2026; diagnóstico final de
-- 29/10, verificação 8.1 da operação).
--
-- O problema: `fechar_os` exigia seis registros que a equipe ainda não faz (custo lançado a partir do apontamento
-- de hora, baixa de material, inspeção de qualidade, arquivo final do layout, medidas de todo item) e NENHUMA das
-- 18 OS abertas cumpria todos. O painel mostrava 1 de 19 OS concluída: o resto estava vendido, pago e muitas vezes
-- entregue, "parado no quadro", sem entrar em Concluído nem no faturado, e sem o aviso de conclusão ao cliente.
--
-- A decisão (B das duas opções: manter a exigência e treinar, ou fechar com o previsto): a trava passa a separar
-- FATO de REGISTRO.
--   * Fato, continua travando: tarefa obrigatória aberta, qualidade REPROVADA ou em retrabalho, ocorrência aberta,
--     entrega ou instalação pendente, máquina ainda rodando a OS, pagamento por receber e a peça que ainda não saiu
--     (sem retirada ou entrega registrada e fora da etapa de entrega; a exceção é de quem tem os.status.override).
--     Dinheiro e coisa em andamento não se estimam.
--   * Registro, o sistema cobre com o dado real quando existe e com o PREVISTO quando não: custo operacional,
--     baixa de material, inspeção de qualidade, arquivo final do layout e medidas. O que foi estimado fica gravado
--     (`fechamento_estimado`, `fechamento_estimativas` e no snapshot do resultado) e aparece na OS como "fechada com
--     estimativa": a margem real dessa OS é a prevista, e a tela diz isso em vez de fingir medição.
--   * Sem custo lançado E sem custo previsto não há o que estimar: aí a OS não fecha ("sem_custo_previsto").
--   * Medidas só são exigidas de produto vendido em m² (chaveiro e brinde não têm largura nem altura).
--
-- Também: no fechamento (concluido/faturado), `os_bloqueios_para` deixa de repetir as exigências de ENTRAR em
-- produção (arte aprovada, arquivo final, material em estoque): a peça já foi produzida e entregue, e o diálogo
-- "Já foi entregue" ficava desabilitado por elas mesmo com `fechar_os` liberando.
--
-- Ensaio (transação desfeita) nas 19 OS abertas de venda e nos casos de baixa, antes de aplicar: ver o relatório
-- de 30/10 no PR.
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS fechamento_estimado boolean NOT NULL DEFAULT false;
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS fechamento_estimativas jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.ordens_servico.fechamento_estimado IS
  'true quando a OS foi fechada com algum registro coberto pelo PREVISTO (fechamento assistido): a margem real dela é estimada.';
COMMENT ON COLUMN public.ordens_servico.fechamento_estimativas IS
  'O que o fechamento assistido estimou: lista de textos (custo de máquina e mão de obra pelo previsto, material pelo previsto, sem inspeção de qualidade, sem arquivo final, sem medidas).';
GRANT SELECT (fechamento_estimado, fechamento_estimativas) ON public.ordens_servico TO authenticated;

CREATE OR REPLACE FUNCTION public.fechar_os(os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_result jsonb; v_cliente uuid; v_bloqueios jsonb := '[]'::jsonb;
        v_receita numeric; v_pago numeric; v_veredito text; v_orc uuid; v_is3d boolean;
        v_suaves text[] := ARRAY[]::text[];
        v_estimativas jsonb := '[]'::jsonb;
        v_prev_total numeric; v_prev_mat numeric; v_nao_mat numeric; v_valor_mat numeric;
BEGIN
  v_uid := public.require_permission('os.close');
  -- valor_total já é o que o cliente paga (total = itens − desconto, desde a
  -- migração 20261006230000); subtrair o desconto de novo contaria duas vezes.
  SELECT o.cliente_id, COALESCE(o.valor_total,0), o.orcamento_id
    INTO v_cliente, v_receita, v_orc
  FROM public.ordens_servico o WHERE o.id = fechar_os.os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;

  v_is3d := public.os_e_impressao_3d(fechar_os.os_id, v_orc);

  -- FATOS: não se estimam, travam.
  IF EXISTS (SELECT 1 FROM public.os_tarefas t WHERE t.os_id = fechar_os.os_id
               AND t.obrigatoria AND t.status NOT IN ('concluida','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"tarefas_obrigatorias"'::jsonb; END IF;

  v_veredito := public.veredito_qualidade_os(fechar_os.os_id);

  IF v_veredito IN ('reprovado','retrabalho')
  THEN v_bloqueios := v_bloqueios || '"qualidade_reprovada_ou_retrabalho"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.ocorrencias oc WHERE oc.os_id = fechar_os.os_id
               AND COALESCE(oc.status,'aberta') NOT IN ('tratada','fechada','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"ocorrencias_tratadas"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.entregas_instalacoes ei WHERE ei.os_id = fechar_os.os_id
               AND ei.status NOT IN ('concluida','cancelada','nao_necessaria'))
  THEN v_bloqueios := v_bloqueios || '"logistica_concluida"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.apontamentos_producao ap WHERE ap.os_id = fechar_os.os_id
               AND ap.finalizado_em IS NULL)
  THEN v_bloqueios := v_bloqueios || '"apontamento_aberto"'::jsonb; END IF;

  -- A peça tem de ter saído: retirada ou entrega registrada, ou a OS já na etapa de entrega. Sem isso, arrastar um
  -- cartão para "Concluído" por engano fecharia a OS (e dispararia a pesquisa de pós-venda ao cliente) com a peça
  -- ainda na produção; a trava antiga barrava isso por tabela, porque ninguém tinha custo lançado nem baixa.
  -- Quem tem a permissão de exceção (os.status.override) pode fechar sem isso.
  IF (SELECT o5.finalidade::text FROM public.ordens_servico o5 WHERE o5.id = fechar_os.os_id) = 'venda'
     AND NOT public.os_saiu_fisicamente(fechar_os.os_id)
     AND (SELECT o6.status::text FROM public.ordens_servico o6 WHERE o6.id = fechar_os.os_id)
           NOT IN ('aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao')
     AND NOT public.has_permission(v_uid, 'os.status.override')
  THEN v_bloqueios := v_bloqueios || '"peca_nao_saiu"'::jsonb; END IF;

  SELECT COALESCE(SUM(pg.valor),0) INTO v_pago FROM public.pagamentos pg
   WHERE pg.os_id = fechar_os.os_id AND pg.status='pago';

  IF v_receita > 0 AND v_pago < v_receita
     AND COALESCE((SELECT o2.status_financeiro::text FROM public.ordens_servico o2
                    WHERE o2.id = fechar_os.os_id),'pendente') <> 'pago'
  THEN v_bloqueios := v_bloqueios || '"pagamentos_pendentes"'::jsonb; END IF;

  -- REGISTROS: o fechamento assistido cobre com o dado real, e com o previsto quando não há.
  IF EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = fechar_os.os_id AND i.requer_qualidade)
     AND COALESCE(v_veredito,'') NOT IN ('aprovado','aprovado_com_ressalva','reprovado','retrabalho')
  THEN v_suaves := array_append(v_suaves, 'qualidade_aprovada'); END IF;

  IF EXISTS (SELECT 1 FROM public.os_materiais_previstos mp WHERE mp.os_id = fechar_os.os_id)
     AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque me
                     WHERE me.os_id = fechar_os.os_id AND me.tipo='saida' AND me.origem='baixa_os')
  THEN v_suaves := array_append(v_suaves, 'materiais_baixados'); END IF;

  -- Custo é a SOMA, não a existência de linha: o estorno de baixa lança a
  -- linha negativa espelho, e baixa + estorno total somam zero (20261015170000).
  IF COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co
                WHERE co.os_id = fechar_os.os_id), 0) <= 0
  THEN v_suaves := array_append(v_suaves, 'custos_operacionais'); END IF;

  -- Prova do que foi feito (22/10/2026): layout final e medidas. Medida só de produto vendido em m²: chaveiro e
  -- brinde não têm largura nem altura, e a trava antiga os impedia de fechar.
  IF NOT v_is3d THEN
    IF NOT EXISTS (SELECT 1 FROM public.arquivos a WHERE a.os_id = fechar_os.os_id AND a.final_producao = true)
    THEN v_suaves := array_append(v_suaves, 'sem_layout'); END IF;
    IF EXISTS (SELECT 1 FROM public.itens_os i JOIN public.produtos pr ON pr.id = i.produto_id
                WHERE i.os_id = fechar_os.os_id AND COALESCE(pr.tipo::text, 'produto') <> 'servico'
                  AND lower(replace(COALESCE(pr.unidade, ''), '²', '2')) = 'm2'
                  AND (COALESCE(i.largura, 0) <= 0 OR COALESCE(i.altura, 0) <= 0))
    THEN v_suaves := array_append(v_suaves, 'sem_medidas'); END IF;
  END IF;

  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;

  IF jsonb_array_length(v_bloqueios) > 0 THEN
    RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', false,
                              'bloqueios', v_bloqueios, 'assistiveis', to_jsonb(v_suaves), 'resultado', v_result);
  END IF;

  -- FECHAMENTO ASSISTIDO. Material: baixa pela reserva quando há estoque lançado e a pessoa pode dar a saída; senão,
  -- o custo do material pelo previsto.
  IF 'materiais_baixados' = ANY(v_suaves) THEN
    BEGIN
      PERFORM public.baixar_estoque_os(fechar_os.os_id);
      v_estimativas := v_estimativas || to_jsonb('Material baixado pela reserva (a quantidade planejada, não pesada).'::text);
    EXCEPTION WHEN OTHERS THEN
      SELECT round(COALESCE(SUM(mp.quantidade * COALESCE(mp.custo_unitario_previsto, 0)), 0), 2) INTO v_valor_mat
        FROM public.os_materiais_previstos mp WHERE mp.os_id = fechar_os.os_id;
      IF v_valor_mat > 0 THEN
        INSERT INTO public.custos_operacionais_os (os_id, categoria, origem, quantidade, valor_unitario, usuario_id)
        VALUES (fechar_os.os_id, 'material', 'fechamento_assistido', 1, v_valor_mat, v_uid);
      END IF;
      v_estimativas := v_estimativas || to_jsonb(('Material pelo previsto (' || public._reais(v_valor_mat)
        || '): não havia estoque lançado para dar a baixa.')::text);
    END;
  END IF;

  -- Máquina e mão de obra: se ninguém apontou nada que não seja material, entra o que o orçamento previu.
  IF NOT EXISTS (SELECT 1 FROM public.custos_operacionais_os co
                  WHERE co.os_id = fechar_os.os_id AND co.categoria <> 'material' AND co.total > 0) THEN
    SELECT r.custo_previsto, r.custo_previsto_materiais INTO v_prev_total, v_prev_mat
      FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;
    v_nao_mat := round(GREATEST(COALESCE(v_prev_total, 0) - COALESCE(v_prev_mat, 0), 0), 2);
    IF v_nao_mat > 0 THEN
      INSERT INTO public.custos_operacionais_os (os_id, categoria, origem, quantidade, valor_unitario, usuario_id)
      VALUES (fechar_os.os_id, 'maquina', 'fechamento_assistido', 1, v_nao_mat, v_uid);
      v_estimativas := v_estimativas || to_jsonb(('Custo de máquina e mão de obra pelo previsto ('
        || public._reais(v_nao_mat) || '): ninguém apontou a hora.')::text);
    END IF;
  END IF;

  -- Sem custo nenhum, nem lançado nem previsto, não há o que estimar: dizer que a margem é 100% seria mentir.
  IF COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co
                WHERE co.os_id = fechar_os.os_id), 0) <= 0 THEN
    SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;
    RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', false,
                              'bloqueios', '["sem_custo_previsto"]'::jsonb, 'assistiveis', to_jsonb(v_suaves),
                              'resultado', v_result);
  END IF;

  IF 'qualidade_aprovada' = ANY(v_suaves) THEN
    v_estimativas := v_estimativas || to_jsonb('Sem inspeção de qualidade registrada.'::text);
  END IF;
  IF 'sem_layout' = ANY(v_suaves) THEN
    v_estimativas := v_estimativas || to_jsonb('Sem arquivo final de produção no sistema.'::text);
  END IF;
  IF 'sem_medidas' = ANY(v_suaves) THEN
    v_estimativas := v_estimativas || to_jsonb('Medidas dos itens em m² não registradas.'::text);
  END IF;

  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;
  v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('estimativas', v_estimativas);

  INSERT INTO public.os_resultado_snapshots(os_id, resultado_json, created_by)
  VALUES (fechar_os.os_id, v_result, v_uid);
  -- `tg_bloquear_update_status_os` só deixa o status mudar por `avancar_os_status` ou para admin e gestor. `fechar_os` é
  -- uma porta com a trava própria (`os.close`, e as de cima): sem abrir a porta aqui, o vendedor e o operador, que
  -- têm `os.close`, registravam a retirada, o gatilho tentava fechar e a OS ficava parada em "aguardando retirada"
  -- (o aviso era engolido). Mesma chave que `avancar_os_status` usa para o faturado.
  PERFORM set_config('app.avancar_os_status', 'on', true);
  UPDATE public.ordens_servico o SET status='concluido', status_geral='fechada', data_fechamento=now(),
         custo_real=COALESCE((v_result->>'custo_realizado')::numeric,0),
         margem_real=COALESCE((v_result->>'margem_realizada')::numeric,0),
         fechamento_estimado = (jsonb_array_length(v_estimativas) > 0),
         fechamento_estimativas = v_estimativas
   WHERE o.id = fechar_os.os_id;
  PERFORM set_config('app.avancar_os_status', '', true);
  IF (SELECT o4.finalidade FROM public.ordens_servico o4 WHERE o4.id = fechar_os.os_id) = 'venda' THEN
    INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);
  END IF;
  PERFORM public.registrar_evento_os(fechar_os.os_id,'os',fechar_os.os_id,'fechamento',
    CASE WHEN jsonb_array_length(v_estimativas) > 0 THEN 'OS fechada com estimativa' ELSE 'OS fechada' END, NULL, v_result);
  RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', true, 'resultado', v_result, 'estimativas', v_estimativas);
END
$function$;

-- No fechamento, as exigências de ENTRAR em produção não se repetem.
DO $migracao$
DECLARE
  v_oid oid;
  v_def text;
  v_antes int;
  v_ancora text := $a$IF public.status_os_exige_validacoes_producao(novo_status) THEN$a$;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'os_bloqueios_para';
  v_def := pg_get_functiondef(v_oid);
  IF position($n$novo_status NOT IN ('concluido', 'faturado')$n$ IN v_def) = 0 THEN
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'os_bloqueios_para: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora,
      $n$IF public.status_os_exige_validacoes_producao(novo_status) AND novo_status NOT IN ('concluido', 'faturado') THEN$n$);
  END IF;
END
$migracao$;

-- A tela da OS lê a OS pela visão do nível (operacional, comercial ou financeiro), que lista as colunas uma a uma:
-- sem entrar nelas, o aviso "fechada com estimativa" nunca chegaria à tela. As duas colunas não são de dinheiro.
-- `CREATE OR REPLACE VIEW` descarta as opções, então elas voltam junto (a comercial é DEFINER por desenho).
DO $migracao$
DECLARE
  alvo record;
  v_def text;
  v_antes int;
BEGIN
  FOR alvo IN
    SELECT c.oid, c.relname, c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
       AND c.relname IN ('ordens_servico_operacional', 'ordens_servico_comercial', 'ordens_servico_financeiro')
  LOOP
    v_def := pg_get_viewdef(alvo.oid);
    IF position('fechamento_estimado' IN v_def) > 0 THEN CONTINUE; END IF;
    SELECT count(*) INTO v_antes FROM regexp_matches(v_def, 'os\.precisa_instalacao\s+FROM', 'g');
    IF v_antes <> 1 THEN RAISE EXCEPTION 'visão %: esperava 1 âncora, achei %', alvo.relname, v_antes; END IF;
    EXECUTE format('CREATE OR REPLACE VIEW public.%I%s AS %s', alvo.relname,
      CASE WHEN alvo.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(alvo.reloptions, ', ') || ')' END,
      rtrim(btrim(regexp_replace(v_def, 'os\.precisa_instalacao(\s+)FROM',
        'os.precisa_instalacao, os.fechamento_estimado, os.fechamento_estimativas\1FROM')), ';'));
  END LOOP;
END
$migracao$;
