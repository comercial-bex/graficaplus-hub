# Ensaio da migração: custos fixos pelo financeiro

Migração: `supabase/migrations/20261116120000_custos_fixos_do_financeiro.sql`. Estado: **ensaiada no banco vivo em 16/11/2026, junto com as outras duas (20261116100000 e 20261116110000, nesta ordem), desfeita por RAISE EXCEPTION final. NÃO aplicada: a aplicação é feita depois, pelo dono, na ordem 100000, 110000, 120000.**

Conferido depois do ensaio, no banco vivo: 13 linhas em `custos_tabela`, `custo_admin_hora` em 12,00, `mo_encargos_pct` em 32,19, 0 funções `confirmar_custo_fixo`, `pendencias_de_custo` e `lembrete_diario_de_custos`, 0 linhas de `custos.fixos.update` em `permissoes` e em `perfil_permissoes`, nenhuma coluna `confirmado_em`, o `md5` de `custos_tabela_log` igual ao de antes (`2c6b8d76e3035e7f3d0522fdbc0eafd2`), 0 jobs `pendencias-de-custo`, `integridade-orcamentos` ainda em `0 11-21 * * 1-6`, a view `produto_custo_real` inexistente e 3 linhas em `custos_tabela_historico`, as mesmas de antes. Nenhuma mensagem foi enviada e nenhum preço mudou.

## O que a migração faz

| Parte | O que faz | Muda dado? |
| --- | --- | --- |
| 1 | Cria a permissão `custos.fixos.update` em `permissoes` e a concede em `perfil_permissoes` a admin, gestor e financeiro. Nenhum deles ganha `custos.update` | 1 linha em `permissoes`, 3 em `perfil_permissoes` |
| 2 | Função `confirmar_custo_fixo(p_codigo text, p_valor numeric, p_confirmar boolean default true)`, `SECURITY DEFINER`, `search_path = public`. Exige `custos.fixos.update` pela função do repo (`require_permission`, que olha `has_permission`). Só aceita os 9 códigos do contrato e `energia_tarifa_kwh`. Grava o valor e, só quando `p_confirmar`, `confirmado_por` (o `auth.uid`) e `confirmado_em`. EXECUTE só para `authenticated` | Só quando alguém chamar |
| 3 | `custos_tabela_log` trocada na definição viva (o `md5` do corpo é conferido antes): quando a função grava sem confirmar, o gatilho não confirma sozinho | Não |

Nada toca em `produtos`, `produto_precos`, orçamentos nem itens. A função recusa `preco_base`, margem, markup, imposto, taxa, perda, mão de obra, `custo_admin_hora` (calculado por gatilho) e qualquer código fora da lista.

## Como o "não confirma sozinho" funciona

A regra da migração 100000 continua: mudar o número de uma linha confirma (quem e quando). Isso vale para a tela de parâmetros da casa e para qualquer outra escrita. A função precisa da exceção: ao gravar sem confirmar, ela marca na transação, com `set_config('bex.custo_sem_confirmar', <id da linha>, true)`, qual linha não deve ser confirmada, grava, e zera a marca. O gatilho só obedece quando o id da marca é o da linha que ele está tratando. Sem a marca por linha, o gatilho do rateio, que atualiza `custo_admin_hora` dentro do mesmo comando, teria desconfirmado `custo_admin_hora`. O ensaio prova que não desconfirma (item 4).

O corpo que a 120000 troca é o da 100000, e o guarda confere o `md5` `ed5d77189445ddcb6f068e1d588a3df2`, que é o do corpo escrito na 100000 (o teste do repositório recalcula esse número a partir do arquivo, então ele não envelhece sozinho).

## Códigos aceitos

Os nove do contrato: `aluguel_espaco_mensal`, `outros_fixos_admin_mes`, `plotter_horas_mes_reais`, `energia_comercial_tarifa_kwh`, `tinta_consumo_ml_m2`, `plotter_manutencao_mensal`, `plotter_cabecote_custo`, `plotter_cabecote_vida_m2` e `plotter_limpeza_mensal`. Mais um custo fixo que já existia e é seguro: `energia_tarifa_kwh`. Zero só vale em `outros_fixos_admin_mes` (não há outros custos fixos no mês). Valor nulo, negativo ou acima de 1 bilhão é recusado, e `p_confirmar` nulo também.

## O que a tela faz agora

`custos-fixos-da-grafica.tsx` chama `confirmar_custo_fixo` nos dois botões: Salvar e confirmar manda `p_confirmar = true`, Salvar sem confirmar manda `false`. Não há mais UPDATE direto em `custos_tabela` vindo dela. O botão de editar só aparece para quem tem `custos.fixos.update` (ou é admin), a mesma chave que a função exige: ter só `custos.update` não basta. Em `permissions.ts`, gestor e financeiro ganharam a chave no retrato de fallback.

## Ensaio no banco vivo

Roda a 100000, a 110000 e a 120000 em ordem, sem `BEGIN`, `COMMIT` e `SET LOCAL lock_timeout` duplicados, numa chamada só, e o bloco abaixo vem depois. Ele termina em `RAISE EXCEPTION 'ENSAIO OK, DESFEITO'`: nada fica. Antes de tudo, uma foto dos preços vai para uma tabela temporária. Os papéis são simulados com `request.jwt.claims` e `SET LOCAL ROLE authenticated` (ou `anon`), com contas reais do banco: uma de cada papel, e o vendedor é uma conta que só tem esse papel.

```sql
CREATE TEMP TABLE _ens_antes AS SELECT
  (SELECT md5(string_agg(id::text || '|' || COALESCE(preco_base::text, '') || '|' || COALESCE(preco_parceiro::text, '') || '|' || COALESCE(preco_publico::text, '') || '|' || COALESCE(preco_minimo::text, ''), ',' ORDER BY id)) FROM public.produtos) AS h_prod,
  (SELECT md5(string_agg(produto_id::text || '|' || COALESCE(preco_base::text, '') || '|' || COALESCE(preco_parceiro::text, ''), ',' ORDER BY produto_id)) FROM public.produto_precos) AS h_pp,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY (to_jsonb(t)->>'id'))) FROM public.orcamento_itens t) AS h_oi,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY (to_jsonb(t)->>'id'))) FROM public.itens_os t) AS h_os,
  (SELECT count(*)::int FROM public.whatsapp_feriados) AS fer;
-- (as três migrações entram aqui, na ordem 20261116100000, 20261116110000, 20261116120000)
DO $ensaio$
DECLARE
  v_rel text := '';
  v_admin uuid; v_gestor uuid; v_fin uuid; v_vend uuid;
  v_res jsonb; v_msg text; v_n int; v_n2 int; v_txt text; v_def text; v_h1 text; v_h2 text;
  v_valor numeric; v_em timestamptz; v_por uuid; v_adm_antes numeric; v_adm_depois numeric; v_adm_conf timestamptz;
  v_id uuid; v_hist_antes int; v_hist_depois int; v_lin text; v_ref jsonb;
  v_h_prod text; v_h_pp text; v_h_oi text; v_h_os text; v_fer_antes int; v_fer_depois int;
BEGIN
  SELECT h_prod, h_pp, h_oi, h_os, fer INTO v_h_prod, v_h_pp, v_h_oi, v_h_os, v_fer_antes FROM _ens_antes;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'admin'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_gestor FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'gestor'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_fin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'financeiro'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_vend FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'vendedor'::public.app_role AND u.ativo IS NOT FALSE
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role <> 'vendedor'::public.app_role)
   ORDER BY 1 LIMIT 1;
  v_rel := E'\n[0] contas: admin=' || (v_admin IS NOT NULL) || ' gestor=' || (v_gestor IS NOT NULL)
        || ' financeiro=' || (v_fin IS NOT NULL) || ' vendedor=' || (v_vend IS NOT NULL);

  -- [1] depois das tres migracoes, na ordem
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'pendencias_de_custo';
  SELECT prosrc INTO v_txt FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'pendencias_de_custo';
  v_rel := v_rel || E'\n[1] pendencias_de_custo: ' || v_n || ' definicao; e a de 110000 (traz Aluguel do espaço e v_tem_view)='
        || (v_txt LIKE '%Aluguel do espaço%' AND v_txt LIKE '%v_tem_view%');
  v_rel := v_rel || E'\n    custos_tabela_log md5=' || (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'custos_tabela_log')
        || ' (traz bex.custo_sem_confirmar: ' || (SELECT prosrc LIKE '%bex.custo_sem_confirmar%' FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'custos_tabela_log') || ')';
  v_rel := v_rel || E'\n    permissao custos.fixos.update em perfil_permissoes: '
        || (SELECT string_agg(perfil, ',' ORDER BY perfil) FROM public.perfil_permissoes WHERE permissao = 'custos.fixos.update');
  v_rel := v_rel || E'\n    EXECUTE de confirmar_custo_fixo: anon=' || has_function_privilege('anon', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
        || ' authenticated=' || has_function_privilege('authenticated', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
        || ' service_role=' || has_function_privilege('service_role', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
        || ' PUBLIC(proacl)=' || COALESCE((SELECT proacl::text FROM pg_proc WHERE oid = 'public.confirmar_custo_fixo(text, numeric, boolean)'::regprocedure), 'null');
  SELECT count(*) INTO v_n FROM public.pendencias_de_custo();
  SELECT count(*) INTO v_n2 FROM public.pendencias_de_custo() WHERE tipo = 'parametro';
  v_rel := v_rel || E'\n    pendencias hoje (service role): total=' || v_n || ' parametros=' || v_n2;
  SELECT valor INTO v_adm_antes FROM public.custos_tabela WHERE codigo = 'custo_admin_hora';
  v_rel := v_rel || E'\n    custo_admin_hora depois das migracoes=' || v_adm_antes;

  -- [2] vendedor e anon: recusados
  IF v_vend IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_vend::text, true);
    SET LOCAL ROLE authenticated;
    v_msg := 'NAO RECUSOU';
    BEGIN
      PERFORM public.confirmar_custo_fixo('plotter_manutencao_mensal', 150, true);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
    RESET ROLE;
    v_rel := v_rel || E'\n[2] vendedor confirmar_custo_fixo: ' || v_msg;
    SELECT valor INTO v_valor FROM public.custos_tabela WHERE codigo = 'plotter_manutencao_mensal';
    v_rel := v_rel || E'\n    plotter_manutencao_mensal depois do vendedor: valor=' || COALESCE(v_valor::text, 'nulo') || ' (esperado nulo)';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  v_msg := 'NAO RECUSOU';
  BEGIN
    PERFORM public.confirmar_custo_fixo('plotter_manutencao_mensal', 150, true);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE;
  v_rel := v_rel || E'\n    anon confirmar_custo_fixo: ' || v_msg;

  -- [3] financeiro: tem custos.fixos.update, nao tem custos.update; confirma; a escrita comum continua barrada
  IF v_fin IS NOT NULL THEN
    v_rel := v_rel || E'\n[3] financeiro: custos.fixos.update=' || public.has_permission(v_fin, 'custos.fixos.update')
          || ' custos.update=' || public.has_permission(v_fin, 'custos.update');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_fin::text, true);
    SET LOCAL ROLE authenticated;
    v_msg := 'ok';
    BEGIN
      v_res := public.confirmar_custo_fixo('plotter_manutencao_mensal', 150, true);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
    BEGIN
      UPDATE public.custos_tabela SET valor = 999 WHERE codigo = 'plotter_limpeza_mensal';
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN v_n := -1; END;
    RESET ROLE;
    SELECT valor, confirmado_em, confirmado_por INTO v_valor, v_em, v_por FROM public.custos_tabela WHERE codigo = 'plotter_manutencao_mensal';
    v_rel := v_rel || E'\n    confirmar 150 com confirmacao: ' || v_msg || ' valor=' || v_valor || ' confirmado=' || (v_em IS NOT NULL)
          || ' por o financeiro=' || (v_por = v_fin);
    v_rel := v_rel || E'\n    UPDATE direto do financeiro em custos_tabela: linhas afetadas=' || v_n || ' (0 ou erro = barrado)';
    SELECT valor INTO v_valor FROM public.custos_tabela WHERE codigo = 'plotter_limpeza_mensal';
    v_rel := v_rel || E'\n    plotter_limpeza_mensal continua: ' || COALESCE(v_valor::text, 'nulo');
  END IF;

  -- [4] gestor: salvar sem confirmar nao confirma sozinho; o gatilho nao pisa em custo_admin_hora; recusas
  IF v_gestor IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_gestor::text, true);
    SET LOCAL ROLE authenticated;
    v_msg := 'ok';
    BEGIN
      v_res := public.confirmar_custo_fixo('plotter_manutencao_mensal', 160, false);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
    RESET ROLE;
    SELECT valor, confirmado_em, confirmado_por INTO v_valor, v_em, v_por FROM public.custos_tabela WHERE codigo = 'plotter_manutencao_mensal';
    v_rel := v_rel || E'\n[4] gestor, 160 sem confirmar (estava confirmado a 150): ' || v_msg || ' valor=' || v_valor
          || ' confirmado_em nulo=' || (v_em IS NULL) || ' confirmado_por nulo=' || (v_por IS NULL);
    SELECT count(*) INTO v_n FROM public.pendencias_de_custo() WHERE codigo = 'plotter_manutencao_mensal';
    v_rel := v_rel || E'\n    volta para a lista de pendencias: ' || v_n;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_msg := 'ok';
    BEGIN
      v_res := public.confirmar_custo_fixo('outros_fixos_admin_mes', 112, false);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
    RESET ROLE;
    SELECT valor, confirmado_em INTO v_adm_depois, v_adm_conf FROM public.custos_tabela WHERE codigo = 'custo_admin_hora';
    SELECT valor, confirmado_em INTO v_valor, v_em FROM public.custos_tabela WHERE codigo = 'outros_fixos_admin_mes';
    v_rel := v_rel || E'\n    gestor, outros fixos 112 sem confirmar: ' || v_msg || ' valor=' || v_valor || ' confirmado_em nulo=' || (v_em IS NULL)
          || E'\n    custo_admin_hora foi de ' || v_adm_antes || ' para ' || v_adm_depois
          || ' (esperado 13,2 = 2112 sobre 160) e continua confirmado=' || (v_adm_conf IS NOT NULL);

    -- recusas, uma a uma
    FOR v_lin IN SELECT x FROM unnest(ARRAY['markup_padrao', 'mo_encargos_pct', 'impostos_venda', 'preco_base', 'margem_minima', 'custo_admin_hora', 'pct_perda_material', 'codigo_que_nao_existe']) x LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      v_msg := 'NAO RECUSOU';
      BEGIN
        PERFORM public.confirmar_custo_fixo(v_lin, 1, true);
      EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
      RESET ROLE;
      v_rel := v_rel || E'\n    codigo ' || v_lin || ': ' || v_msg;
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_msg := '';
    BEGIN PERFORM public.confirmar_custo_fixo('aluguel_espaco_mensal', 0, true); v_msg := v_msg || 'zero NAO RECUSOU; ';
    EXCEPTION WHEN OTHERS THEN v_msg := v_msg || 'zero=' || SQLSTATE || '; '; END;
    BEGIN PERFORM public.confirmar_custo_fixo('aluguel_espaco_mensal', -5, true); v_msg := v_msg || 'negativo NAO RECUSOU; ';
    EXCEPTION WHEN OTHERS THEN v_msg := v_msg || 'negativo=' || SQLSTATE || '; '; END;
    BEGIN PERFORM public.confirmar_custo_fixo('aluguel_espaco_mensal', NULL, true); v_msg := v_msg || 'nulo NAO RECUSOU; ';
    EXCEPTION WHEN OTHERS THEN v_msg := v_msg || 'nulo=' || SQLSTATE || '; '; END;
    BEGIN PERFORM public.confirmar_custo_fixo('aluguel_espaco_mensal', 2000, NULL); v_msg := v_msg || 'confirmar nulo NAO RECUSOU; ';
    EXCEPTION WHEN OTHERS THEN v_msg := v_msg || 'confirmar nulo=' || SQLSTATE || '; '; END;
    BEGIN PERFORM public.confirmar_custo_fixo('outros_fixos_admin_mes', 0, false); v_msg := v_msg || 'zero em outros fixos aceito; ';
    EXCEPTION WHEN OTHERS THEN v_msg := v_msg || 'zero em outros fixos RECUSADO=' || SQLSTATE || '; '; END;
    RESET ROLE;
    v_rel := v_rel || E'\n    valores invalidos: ' || v_msg;
    SELECT valor INTO v_valor FROM public.custos_tabela WHERE codigo = 'markup_padrao';
    v_rel := v_rel || E'\n    markup_padrao continua em ' || v_valor || ' (era 60)';
  END IF;

  -- [5] admin: confirma o aluguel e a tinta; energia_tarifa_kwh e aceita; confirmado_por e o admin
  IF v_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    SET LOCAL ROLE authenticated;
    v_msg := 'ok';
    BEGIN
      PERFORM public.confirmar_custo_fixo('aluguel_espaco_mensal', 2000, true);
      PERFORM public.confirmar_custo_fixo('tinta_consumo_ml_m2', 10, true);
      PERFORM public.confirmar_custo_fixo('energia_tarifa_kwh', 1.1339, true);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
    RESET ROLE;
    v_rel := v_rel || E'\n[5] admin, aluguel 2000 + tinta 10 + energia_tarifa_kwh 1,1339 com confirmacao: ' || v_msg;
    FOR v_lin IN SELECT codigo || ' valor=' || valor || ' confirmado=' || (confirmado_em IS NOT NULL) || ' por o admin=' || (confirmado_por = v_admin)
                   FROM public.custos_tabela WHERE codigo IN ('aluguel_espaco_mensal', 'tinta_consumo_ml_m2', 'energia_tarifa_kwh') ORDER BY codigo LOOP
      v_rel := v_rel || E'\n    ' || v_lin;
    END LOOP;
    SELECT count(*) INTO v_n FROM public.pendencias_de_custo() WHERE tipo = 'parametro';
    v_rel := v_rel || E'\n    parametros ainda pendentes: ' || v_n;
  END IF;

  -- [6] preco nao mudou: os 4 precos de 70 produtos, produto_precos, orcamento_itens e itens_os, hash por id
  SELECT md5(string_agg(id::text || '|' || COALESCE(preco_base::text, '') || '|' || COALESCE(preco_parceiro::text, '') || '|' || COALESCE(preco_publico::text, '') || '|' || COALESCE(preco_minimo::text, ''), ',' ORDER BY id))
    INTO v_h1 FROM public.produtos;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY (to_jsonb(t)->>'id'))) INTO v_h2 FROM public.orcamento_itens t;
  v_rel := v_rel || E'\n[6] produtos (preco_base, preco_parceiro, preco_publico, preco_minimo): ' || CASE WHEN v_h1 = v_h_prod THEN 'IGUAL' ELSE 'DIFERENTE' END
        || E'\n    orcamento_itens inteiras: ' || CASE WHEN v_h2 = v_h_oi THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(produto_id::text || '|' || COALESCE(preco_base::text, '') || '|' || COALESCE(preco_parceiro::text, ''), ',' ORDER BY produto_id)) INTO v_h1 FROM public.produto_precos;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY (to_jsonb(t)->>'id'))) INTO v_h2 FROM public.itens_os t;
  v_rel := v_rel || E'\n    produto_precos: ' || CASE WHEN v_h1 = v_h_pp THEN 'IGUAL' ELSE 'DIFERENTE' END
        || E'\n    itens_os inteiras: ' || CASE WHEN v_h2 = v_h_os THEN 'IGUAL' ELSE 'DIFERENTE' END;

  -- [7] lembrete: domingo e feriados da lista propria nao enviam, sabado envia, whatsapp_feriados intocada
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  FOR v_lin IN SELECT x FROM unnest(ARRAY['2026-11-16', '2026-11-20', '2026-11-21', '2026-11-22', '2026-12-25', '2027-01-01', '2027-01-02']) x LOOP
    v_ref := public.lembrete_diario_de_custos(false, v_lin::date);
    v_rel := v_rel || E'\n[7] ' || v_lin || ' (' || to_char(v_lin::date, 'Dy') || '): dia_util=' || (v_ref ->> 'dia_util') || ' motivo=' || COALESCE(v_ref ->> 'motivo_sem_envio', '-');
  END LOOP;
  v_ref := public.lembrete_diario_de_custos(false, DATE '2026-11-16');
  v_rel := v_rel || E'\n    texto do grupo tem "dia util e aos sabados, no inicio do dia": '
        || ((v_ref ->> 'texto_grupo') LIKE '%Este aviso volta todo dia útil e aos sábados, no início do dia, até a lista zerar.%')
        || ' e nao tem "as 8h": ' || ((v_ref ->> 'texto_grupo') NOT LIKE '%8h%');
  SELECT count(*) INTO v_fer_depois FROM public.whatsapp_feriados;
  v_rel := v_rel || E'\n    whatsapp_feriados: linhas antes=' || v_fer_antes || ' depois=' || v_fer_depois
        || ' 20/11/2026 cadastrado=' || EXISTS (SELECT 1 FROM public.whatsapp_feriados WHERE data = DATE '2026-11-20');

  -- [8] banco que ja tinha a 100000 com a pendencias_de_custo antiga: a de 110000 vira a unica dona de novo
  v_def := pg_get_functiondef('public.pendencias_de_custo()'::regprocedure);
  SELECT md5(prosrc) INTO v_h1 FROM pg_proc WHERE oid = 'public.pendencias_de_custo()'::regprocedure;
  SELECT count(*) INTO v_n FROM public.pendencias_de_custo();
  EXECUTE $antiga$
    CREATE OR REPLACE FUNCTION public.pendencias_de_custo()
     RETURNS TABLE(codigo text, rotulo text, tipo text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $f$
      SELECT ct.codigo, ct.descricao, 'parametro'::text
        FROM public.custos_tabela ct
       WHERE ct.ativo AND ct.categoria <> 'chave' AND (ct.valor IS NULL OR ct.confirmado_em IS NULL)
      UNION ALL
      SELECT 'material_sem_custo:' || mt.id::text, mt.nome, 'material_sem_custo'::text
        FROM public.materiais mt
       WHERE COALESCE(mt.custo_medio, mt.custo_unitario, 0) <= 0
         AND EXISTS (SELECT 1 FROM public.produto_materiais pm JOIN public.produtos pr ON pr.id = pm.produto_id
                      WHERE pm.material_id = mt.id AND pr.ativo)
      UNION ALL
      SELECT 'parceiro_abaixo_do_piso:' || r.produto_id::text, r.nome, 'parceiro_abaixo_do_piso'::text
        FROM public.produto_custo_real r WHERE r.parceiro_abaixo_do_piso
      ORDER BY 3, 2;
    $f$ $antiga$;
  SELECT md5(prosrc) INTO v_h2 FROM pg_proc WHERE oid = 'public.pendencias_de_custo()'::regprocedure;
  v_rel := v_rel || E'\n[8] antiga instalada: md5 diferente da de 110000=' || (v_h2 <> v_h1);
  EXECUTE v_def;
  SELECT md5(prosrc) INTO v_h2 FROM pg_proc WHERE oid = 'public.pendencias_de_custo()'::regprocedure;
  SELECT count(*) INTO v_n2 FROM public.pendencias_de_custo();
  SELECT count(*) INTO v_n2 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'pendencias_de_custo';
  v_rel := v_rel || E'\n    110000 por cima da antiga: md5 volta ao mesmo=' || (v_h2 = v_h1) || ' definicoes=' || v_n2
        || ' pendencias antes=' || v_n || ' depois=' || (SELECT count(*) FROM public.pendencias_de_custo());

  RAISE EXCEPTION E'ENSAIO OK, DESFEITO\n%', v_rel;
END $ensaio$;
```

### Resultado de 16/11/2026

```
[0] contas: admin=true gestor=true financeiro=true vendedor=true
[1] pendencias_de_custo: 1 definicao; e a de 110000 (traz Aluguel do espaço e v_tem_view)=true
    custos_tabela_log md5=ee2792ced1ae661bfd0def7f3ecc3da8 (traz bex.custo_sem_confirmar: true)
    permissao custos.fixos.update em perfil_permissoes: admin,financeiro,gestor
    EXECUTE de confirmar_custo_fixo: anon=false authenticated=true service_role=false proacl={postgres=X/postgres,authenticated=X/postgres}
    pendencias hoje (service role): total=14 parametros=8
    custo_admin_hora depois das migracoes=12.5000
[2] vendedor confirmar_custo_fixo: P0001 Permissão necessária: custos.fixos.update
    plotter_manutencao_mensal depois do vendedor: valor=nulo (esperado nulo)
    anon confirmar_custo_fixo: 42501 permission denied for function confirmar_custo_fixo
[3] financeiro: custos.fixos.update=true custos.update=false
    confirmar 150 com confirmacao: ok valor=150 confirmado=true por o financeiro=true
    UPDATE direto do financeiro em custos_tabela: linhas afetadas=0 (0 ou erro = barrado)
    plotter_limpeza_mensal continua: nulo
[4] gestor, 160 sem confirmar (estava confirmado a 150): ok valor=160 confirmado_em nulo=true confirmado_por nulo=true
    volta para a lista de pendencias: 1
    gestor, outros fixos 112 sem confirmar: ok valor=112 confirmado_em nulo=true
    custo_admin_hora foi de 12.5000 para 13.2000 (esperado 13,2 = 2112 sobre 160) e continua confirmado=true
    codigo markup_padrao: 22023 Este custo não pode ser alterado por aqui.
    codigo mo_encargos_pct: 22023 Este custo não pode ser alterado por aqui.
    codigo impostos_venda: 22023 Este custo não pode ser alterado por aqui.
    codigo preco_base: 22023 Este custo não pode ser alterado por aqui.
    codigo margem_minima: 22023 Este custo não pode ser alterado por aqui.
    codigo custo_admin_hora: 22023 Este custo não pode ser alterado por aqui.
    codigo pct_perda_material: 22023 Este custo não pode ser alterado por aqui.
    codigo codigo_que_nao_existe: 22023 Este custo não pode ser alterado por aqui.
    valores invalidos: zero=22023; negativo=22023; nulo=22023; confirmar nulo=22023; zero em outros fixos aceito;
    markup_padrao continua em 60 (era 60)
[5] admin, aluguel 2000 + tinta 10 + energia_tarifa_kwh 1,1339 com confirmacao: ok
    aluguel_espaco_mensal valor=2000 confirmado=true por o admin=true
    energia_tarifa_kwh valor=1.1339 confirmado=true por o admin=true
    tinta_consumo_ml_m2 valor=10 confirmado=true por o admin=true
    parametros ainda pendentes: 7
[6] produtos (preco_base, preco_parceiro, preco_publico, preco_minimo): IGUAL
    orcamento_itens inteiras: IGUAL
    produto_precos: IGUAL
    itens_os inteiras: IGUAL
[7] 2026-11-16 (Mon): dia_util=true motivo=-
[7] 2026-11-20 (Fri): dia_util=false motivo=feriado
[7] 2026-11-21 (Sat): dia_util=true motivo=-
[7] 2026-11-22 (Sun): dia_util=false motivo=domingo
[7] 2026-12-25 (Fri): dia_util=false motivo=feriado
[7] 2027-01-01 (Fri): dia_util=false motivo=feriado
[7] 2027-01-02 (Sat): dia_util=true motivo=-
    texto do grupo tem "dia util e aos sabados, no inicio do dia": true e nao tem "as 8h": true
    whatsapp_feriados: linhas antes=0 depois=0 20/11/2026 cadastrado=false
[8] antiga instalada: md5 diferente da de 110000=true
    110000 por cima da antiga: md5 volta ao mesmo=true definicoes=1 pendencias antes=14 depois=14
```

### O que o resultado prova

- **Vendedor recusado.** `P0001 Permissão necessária: custos.fixos.update`, e o valor da linha continua nulo. `anon` recebe 42501 (sem EXECUTE).
- **Financeiro grava sem ter `custos.update`.** A permissão `custos.fixos.update` é verdadeira e `custos.update` falsa. Confirmar pela função funciona e carimba o financeiro. O UPDATE direto dele em `custos_tabela` afeta 0 linhas (a RLS barra, como antes).
- **Gestor salva sem confirmar e fica pendente.** Valor 160 gravado, `confirmado_em` e `confirmado_por` nulos, a linha volta para `pendencias_de_custo()`. O rateio continua certo: `custo_admin_hora` sobe de 12,50 para 13,20 (aluguel 2.000 mais outros fixos 112, sobre 160 horas) e continua confirmado, porque a marca é por linha.
- **Admin confirma** o aluguel, a tinta e a tarifa de energia antiga, e a coluna `confirmado_por` traz o admin.
- **Recusas.** Markup, encargos, imposto, `preco_base`, margem mínima, `custo_admin_hora`, perda e código inexistente: 22023. Zero no aluguel, negativo, nulo e `p_confirmar` nulo: 22023. Zero em outros fixos: aceito.
- **Nenhum preço mudou**, mesmo com a recomposição de custo que o gatilho de `custos_tabela` dispara a cada valor novo: `produtos` (os quatro preços de 70 produtos), `produto_precos`, `orcamento_itens` e `itens_os` inteiras, hash igual antes e depois. Só o custo gravado em `produto_precificacao` pode mudar, como na 100000.
- **Ordem 100000, 110000, 120000** aplicada de uma vez sobre o banco de hoje, sem erro: os guardas de `md5` das três passaram. Com a versão antiga de `pendencias_de_custo()` (a que a 100000 trazia) instalada por cima e a da 110000 aplicada depois, o corpo volta idêntico (`md5` igual), há uma definição só e a contagem de pendências não muda (14 e 14).
- **Lembrete.** Domingo e os três feriados da lista própria não enviam, sábado envia, o texto novo sai, `whatsapp_feriados` fica intocada (0 linhas antes e depois).

### Linha acrescentada depois do ensaio completo

Depois da rodada acima, a suíte de testes do repositório (`tests/gatilhos-fechados-e-coluna-morta.test.ts`) pediu que toda função de gatilho criada ou trocada em migração nova seja fechada no mesmo arquivo. Foi acrescentada uma linha, `REVOKE ALL ON FUNCTION public.custos_tabela_log() FROM PUBLIC, anon, authenticated;`, logo depois da função, na 100000 e na 120000. Ela não entrou na rodada completa. Foi ensaiada à parte, no banco vivo, também desfeita: com o `REVOKE` aplicado, a ACL da função fica `{postgres=X/postgres,service_role=X/postgres}` e um UPDATE feito por uma conta admin em `custos_tabela` continua funcionando e grava o histórico (3 linhas viram 4 dentro da transação). Gatilho não precisa de EXECUTE do chamador.

## Como desfazer

```sql
DROP FUNCTION IF EXISTS public.confirmar_custo_fixo(text, numeric, boolean);
DELETE FROM public.perfil_permissoes WHERE permissao = 'custos.fixos.update';
DELETE FROM public.permissoes WHERE chave = 'custos.fixos.update';
-- custos_tabela_log: reaplicar o corpo de 20261116100000 (sem a linha v_sem_confirmar e o primeiro IF).
```

A função não deixa rastro de dado além do que as linhas de `custos_tabela` já têm.

## Riscos e o que não foi feito

1. **Front antes da migração.** A tela já chama `confirmar_custo_fixo`. Se o front for publicado antes da migração, os dois botões falham com a mensagem "A confirmação de custos ainda não está ligada no banco". Aplicar a migração antes do Publish.
2. **Retrato de permissões no front.** `permissions.ts` é fallback; o que vale é `perfil_permissoes`. A migração concede às três funções e o fixture `tests/fixtures/perfil-permissoes-2026-10-06.json` (retrato de outubro) não foi mexido.
3. **`energia_tarifa_kwh` aceita pela função, sem linha na tela.** A tela mostra só os nove do contrato. Se o dono não quer o financeiro mudando a tarifa de energia, tirar da lista na função.
4. **`types.ts` gerado não tem a função.** A tela usa `supabase as any` para a chamada, como já fazia.
5. **Quem tinha só `custos.update`** (por exceção por pessoa) deixa de ver o botão. Hoje isso é ninguém: admin e gestor ganham a chave nova.
