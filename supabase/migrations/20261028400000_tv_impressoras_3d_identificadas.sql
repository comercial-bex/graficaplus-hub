-- 28/10/2026 — as quatro impressoras 3D na parede da TV.
--
-- As 3 impressoras novas deixaram a TV com 8 máquinas ativas: a conferência R6 ("a tela foi desenhada para cinco
-- colunas") falhava e a parede mostraria colunas demais. Agora:
--  * `tv_painel_maquinas()` manda o NOME da máquina (`rotulo`) em cada coluna;
--  * a R6 conta colunas da PAREDE: as impressoras 3D (status de produção em_3d) dividem UMA coluna, com um cartão
--    por impressora (o desenho está em src/components/tv/tela-da-oficina.tsx, `Grupo3D`);
--  * as impressoras ganham os nomes que o dono pediu: Bambu Lab 3D 01 (A1 Combo com AMS Lite), 02, 03 e Mini.
--    A ordem alfabética do nome é a ordem na parede; o apelido anterior fica em `especificacoes`.
-- E a conferência de dados: `maquinas.custo_hora` das impressoras estava 0 (o custo/hora do módulo 3D fica em
-- maquinas_3d_config); passa a espelhá-lo. O saldo de abertura do acrílico dourado (4) tinha só 2 no livro de
-- movimentações; entra o ajuste de 2.

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.tv_painel_maquinas()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    E'        ''tipo'', e.tipo,\n        ''ordem'', e.ordem,\n',
    E'        ''tipo'', e.tipo,\n        ''rotulo'', (select mx.nome from public.maquinas mx where mx.id = e.id),\n        ''ordem'', e.ordem,\n');
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho do rotulo não encontrado'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def, 'v_ativas integer; v_abertas_direto integer; v_ativas_direto integer;',
                           'v_ativas integer; v_abertas_direto integer; v_ativas_direto integer; v_colunas_da_parede integer;');
  IF v_novo = v_def THEN RAISE EXCEPTION 'declaração não encontrada'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    E'  select count(*)::integer into v_ativas_direto from public.maquinas m where m.ativa;\n  if v_ativas_direto > c_colunas then\n    v_falhas := v_falhas || jsonb_build_object(''regra'', ''R6'', ''esperado'', c_colunas, ''obtido'', v_ativas_direto,',
    E'  select count(*)::integer into v_ativas_direto from public.maquinas m where m.ativa;\n  -- as impressoras 3D (status de produção em_3d) dividem uma coluna só na parede\n  select (count(*) filter (where t.status_producao is distinct from ''em_3d'')\n          + case when count(*) filter (where t.status_producao = ''em_3d'') > 0 then 1 else 0 end)::integer\n    into v_colunas_da_parede\n    from public.maquinas m left join public.tipos_de_maquina() t on t.tipo = m.tipo where m.ativa;\n  if v_colunas_da_parede > c_colunas then\n    v_falhas := v_falhas || jsonb_build_object(''regra'', ''R6'', ''esperado'', c_colunas, ''obtido'', v_colunas_da_parede,');
  IF v_novo = v_def THEN RAISE EXCEPTION 'R6 não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

UPDATE public.maquinas SET nome = 'Bambu Lab 3D 01', especificacoes = especificacoes || jsonb_build_object('apelido_anterior','Bambu Lab A1 Combo (AMS Lite)') WHERE id = '39807c59-d6da-42f4-9072-9540978cd3d4';
UPDATE public.maquinas SET nome = 'Bambu Lab 3D 02', especificacoes = especificacoes || jsonb_build_object('apelido_anterior','Bambu Lab A1 (2)') WHERE id = '53d4ed68-2472-48e9-bacf-0adacf3bf193';
UPDATE public.maquinas SET nome = 'Bambu Lab 3D 03', especificacoes = especificacoes || jsonb_build_object('apelido_anterior','Bambu Lab A1 (3)') WHERE id = '4aa6444b-f4c5-4044-8105-08be9cda8d6d';
UPDATE public.maquinas SET nome = 'Bambu Lab 3D Mini', especificacoes = especificacoes || jsonb_build_object('apelido_anterior','Bambu Lab A1 Mini') WHERE id = 'f0b28934-b79b-4079-8f89-e6c743dcf093';

UPDATE public.maquinas m SET custo_hora = c.custo_hora_calculado
  FROM public.maquinas_3d_config c WHERE c.maquina_id = m.id AND m.tipo = 'impressora_3d' AND COALESCE(m.custo_hora,0) = 0;

INSERT INTO public.movimentacoes_estoque (material_id, lote_id, tipo, quantidade, unidade, custo_unitario_snapshot, origem, motivo, created_at)
SELECT l.material_id, l.id, 'entrada', 2, l.unidade, 0, 'inventario',
       'Ajuste do livro: o saldo de abertura (4) estava registrado como 2 nas movimentações (conferência de 28/10/2026)', l.created_at
  FROM public.material_lotes l WHERE l.material_id = '8580e696-c97c-40e9-bbdb-dd9aacebfd8b' AND l.codigo = 'ABERTURA'
   AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque m WHERE m.material_id = l.material_id AND m.motivo LIKE 'Ajuste do livro%');
