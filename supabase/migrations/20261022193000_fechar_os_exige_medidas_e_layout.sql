-- Fechar a OS exige a prova mínima que o dono definiu (22/10/2026): as MEDIDAS
-- da impressão/confecção e o LAYOUT (o arquivo do que foi produzido).
--
-- `fechar_os` já barrava tarefa, qualidade, baixa, ocorrência, entrega,
-- apontamento aberto, custo e pagamento — mas não perguntava O QUE foi feito. O
-- layout só era exigido para ENTRAR em produção (os_bloqueios_para); a OS 44 foi
-- de "entrada" a "concluído" sem arquivo nenhum (teste, confirmado pelo dono).
--
--   sem_layout   nenhum arquivo da OS marcado como final de produção
--   sem_medidas  algum item sem largura × altura
--
-- Fora da regra: OS de impressão 3D (o modelo aprovado no orçamento 3D é o
-- layout, e a peça não tem "largura × altura" de impressão) e item de produto
-- do tipo serviço (instalação, arte, deslocamento). Mesma porta de sempre: o
-- Kanban, o painel e a tela da OS chegam aqui por avancar_os_status.

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.fechar_os'::regproc);
  v_de text := E'  SELECT COALESCE(SUM(pg.valor),0) INTO v_pago FROM public.pagamentos pg\n';
  v_para text := E'  -- Prova do que foi feito (22/10/2026): layout final e medidas de cada item.\n'
    || E'  IF NOT public.os_e_impressao_3d(fechar_os.os_id, (SELECT o3.orcamento_id FROM public.ordens_servico o3 WHERE o3.id = fechar_os.os_id)) THEN\n'
    || E'    IF NOT EXISTS (SELECT 1 FROM public.arquivos a WHERE a.os_id = fechar_os.os_id AND a.final_producao = true)\n'
    || E'    THEN v_bloqueios := v_bloqueios || ''"sem_layout"''::jsonb; END IF;\n'
    || E'    IF EXISTS (SELECT 1 FROM public.itens_os i LEFT JOIN public.produtos pr ON pr.id = i.produto_id\n'
    || E'                WHERE i.os_id = fechar_os.os_id AND COALESCE(pr.tipo::text, ''produto'') <> ''servico''\n'
    || E'                  AND (COALESCE(i.largura, 0) <= 0 OR COALESCE(i.altura, 0) <= 0))\n'
    || E'    THEN v_bloqueios := v_bloqueios || ''"sem_medidas"''::jsonb; END IF;\n'
    || E'  END IF;\n\n'
    || v_de;
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'fechar_os: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;
