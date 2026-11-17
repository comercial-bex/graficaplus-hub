-- Ensaio da sequência completa da onda 1 de orçamentos, 17/11/2026 (project ac34095e-c679-402e-90c7-5e6cc505cfc3).
-- NÃO APLICAR. Roda numa chamada só: as seis migrações em ordem (20261117100000, 110000, 120000, 130000, 180000, 190000),
-- sem BEGIN, COMMIT nem SET LOCAL lock_timeout (cada arquivo traz o seu), e o bloco final termina em RAISE EXCEPTION.
-- Este arquivo guarda as partes de apoio e o bloco de conferência; o corpo de cada migração é o do arquivo .sql respectivo.
-- Resultado literal da execução: docs/ensaio-aprovacao-e-renovacao-por-funcao.md (parte da 190000) e abaixo, no fim.

-- 0) retrato do que não pode mudar, antes de qualquer migração
CREATE TEMP TABLE _ens_antes AS SELECT
  (SELECT count(*) FROM public.orcamentos) orc,
  (SELECT count(*) FROM public.orcamento_versoes) vers,
  (SELECT md5(string_agg((to_jsonb(x) - 'area_cobrada')::text, ',' ORDER BY x.id)) FROM public.orcamento_itens x) h_oi,
  (SELECT md5(string_agg((to_jsonb(x) - 'area_cobrada')::text, ',' ORDER BY x.id)) FROM public.itens_os x) h_os,
  (SELECT sum(area_cobrada) FROM public.orcamento_itens) area_orc,
  (SELECT sum(area_cobrada) FROM public.itens_os) area_os;

-- 1) ajudante: chama um SQL como um usuário real, com o papel authenticated, e devolve o resultado ou o erro com o DETAIL
CREATE FUNCTION pg_temp.ens_como(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $c$
DECLARE v text; det text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS det = PG_EXCEPTION_DETAIL;
    v := 'ERRO ' || SQLSTATE || ' | ' || SQLERRM || ' | detalhe=' || coalesce(det, '-');
  END;
  RESET ROLE;
  RETURN v;
END $c$;

-- 2) (aqui entram as seis migrações, na ordem)

-- 3) conferência final, termina em RAISE EXCEPTION
DO $ens$
DECLARE
  v_rel text := '';
  a record; v_admin uuid; v_vend uuid; v_fin uuid; v_gestor uuid;
  r jsonb; v_msg text;
  v_id197 uuid; v_id227 uuid; v_id233 uuid; v_tok197 text; v_h_oi text; v_h_os text; v_st text;
BEGIN
  SELECT * INTO a FROM _ens_antes;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id WHERE ur.role = 'admin'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_gestor FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id WHERE ur.role = 'gestor'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_fin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id WHERE ur.role = 'financeiro'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_vend FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id WHERE ur.role = 'vendedor'::public.app_role AND u.ativo IS NOT FALSE AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role <> 'vendedor'::public.app_role) ORDER BY 1 LIMIT 1;
  SELECT id, token_publico INTO v_id197, v_tok197 FROM public.orcamentos WHERE numero = 197;
  SELECT id INTO v_id227 FROM public.orcamentos WHERE numero = 227;
  SELECT id INTO v_id233 FROM public.orcamentos WHERE numero = 233;

  -- md5 dos corpos e matriz de EXECUTE
  v_rel := E'\n[1] md5 dos corpos: ' || (SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
    ('responder_orcamento_publico','tg_orcamento_so_apaga_rascunho_sem_rastro','orcamento_historico_de_versoes','orcamento_congelar_versao','tg_orcamento_congela_versao','confirmar_envio_documento','aprovar_orcamento','renovar_orcamento_vencido'));

  -- área: só a coluna mudou
  SELECT md5(string_agg((to_jsonb(x) - 'area_cobrada')::text, ',' ORDER BY x.id)) INTO v_h_oi FROM public.orcamento_itens x;
  SELECT md5(string_agg((to_jsonb(x) - 'area_cobrada')::text, ',' ORDER BY x.id)) INTO v_h_os FROM public.itens_os x;
  v_rel := v_rel || E'\n[2] itens iguais a antes (sem area_cobrada)=' || (v_h_oi = a.h_oi AND v_h_os = a.h_os);

  -- o cliente não responde no 197 vencido; a equipe renova; agora responde
  SET LOCAL ROLE service_role;
  r := public.responder_orcamento_publico(v_tok197, 'aprovado', 'Cliente Ensaio', '', '203.0.113.7');
  RESET ROLE;
  v_rel := v_rel || E'\n[3] 197 antes de renovar: ' || r;
  v_rel := v_rel || E'\n    vendedor renova 197: ' || pg_temp.ens_como(v_vend, format('SELECT public.renovar_orcamento_vencido(%L)::text', v_id197));
  SET LOCAL ROLE service_role;
  r := public.responder_orcamento_publico(v_tok197, 'aprovado', 'Cliente Ensaio', '', '203.0.113.7');
  RESET ROLE;
  v_rel := v_rel || E'\n    197 depois de renovar: ' || r;

  -- aprovar só de enviado, histórico, reenvio, exclusão
  v_rel := v_rel || E'\n[4] vendedor aprova 227: ' || pg_temp.ens_como(v_vend, format('SELECT public.aprovar_orcamento(%L)::text', v_id227));
  v_rel := v_rel || E'\n    historico do 227: ' || pg_temp.ens_como(v_fin, format('SELECT jsonb_array_length(public.orcamento_historico_de_versoes(%L))::text', v_id227));
  PERFORM public.confirmar_envio_documento('d15a87fd-f9cc-4515-8621-b1fc24d694bd'::uuid, '092cf54e-d353-4fd7-b612-eaf2286d4d81'::uuid);
  v_rel := v_rel || E'\n[5] historico do 233 depois do reenvio: ' || pg_temp.ens_como(v_admin, format('SELECT public.orcamento_historico_de_versoes(%L)::text', v_id233));
  SET LOCAL ROLE service_role;
  v_msg := 'NAO RECUSOU';
  BEGIN DELETE FROM public.orcamentos WHERE id = v_id197; EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE;
  v_rel := v_rel || E'\n[6] service_role apaga 197: ' || v_msg;
  v_rel := v_rel || E'\n    gestor apaga rascunho livre 253: ' || pg_temp.ens_como(v_gestor, 'WITH d AS (DELETE FROM public.orcamentos WHERE numero = 253 RETURNING 1) SELECT count(*)::text FROM d');
  RAISE EXCEPTION E'ENSAIO OK, DESFEITO:%', v_rel;
END $ens$;

/* Resultado literal da sequência completa (resumo; as linhas completas estão nos docs de cada migração):
[1] md5 dos corpos: aprovar_orcamento=c41a77749e1673be56e5ddff732b6ad4 confirmar_envio_documento=c4509f50c6b41e9131f5a6530969be56 orcamento_congelar_versao=60c04a27d5693293c6cb0481afa73b21 orcamento_historico_de_versoes=676b8c35c23fc2cdff16aac6465d83fb renovar_orcamento_vencido=57e68e8f3ad1d5f922b88b4b82d2f827 responder_orcamento_publico=fd8cdb0b9085736f8d63e0965fa9c691 tg_orcamento_congela_versao=16098a54f9fd7b3874894946c7f414ca tg_orcamento_so_apaga_rascunho_sem_rastro=2cab53763268a9fa8a82ae15b4113f04
    EXECUTE (anon / authenticated / service_role): aprovar_orcamento=false/true/true ; confirmar_envio_documento=false/false/true ; orcamento_congelar_versao=false/false/true ; orcamento_historico_de_versoes=false/true/true ; renovar_orcamento_vencido=false/true/true ; responder_orcamento_publico=false/false/true ; tg_orcamento_congela_versao=false/false/true ; tg_orcamento_so_apaga_rascunho_sem_rastro=false/false/true
[2] itens de orcamento sem a coluna area_cobrada iguais a antes=true itens de OS iguais=true soma area_cobrada orc 235.404 para 235.277 ; os 112.841 para 112.786
[3] 197 antes de renovar, cliente tenta aprovar: {"ok": false, "codigo": "vencido", "status": "enviado", "valido_ate": "2026-11-16"}
    vendedor renova 197: {"ok": true, "status": "enviado", "versao_id": "6a0e1a53-...", "enviado_em": "2026-11-17T13:19:47Z", "valido_ate": "2026-11-24", "status_anterior": "enviado"}
    197 depois de renovar, cliente aprova pelo link: {"ok": true, "codigo": "ok", "status": "aprovado"}
    status=aprovado versao_aprovada_id preenchida=true
[4] vendedor aprova 227: ok. gestor aprova 197 (ja aprovado pelo cliente): ja_aprovado=true. historico do 227: versoes=2 a aprovada e a mais nova=true
[5] historico do 233 depois do reenvio: 2 versoes (v2 com o_que_mudou.mudou=true, itens_novos=1, itens_mudados=1; valor_anterior 45.76, valor 148.16)
[6] service_role apaga 197: 23001 Este orçamento não pode ser apagado: ele já passou da fase de rascunho. Fale com o gestor.
    gestor apaga rascunho livre 253: 1
    gestor apaga o enviado 233: ERRO 23001
[7] api_executar, notificar_cliente, precificar_por_area e _integridade_achados intocados; orcamentos agora=126 (antes 127; um rascunho foi apagado dentro do ensaio)
Depois do ensaio, por SELECT: 127 orçamentos, 94 versões, 131 itens de versão, 9 recusados, 31 aprovados, 26 enviados; expressão de area_cobrada igual a antes (61a321931f8b520d6ecf7df6d73859bd) nas duas tabelas; 0 funções novas, 0 gatilho novo, md5 de aprovar_orcamento, tg_orcamento_congela_versao, confirmar_envio_documento e api_executar iguais aos de antes; 0 tokens de ensaio.
*/
