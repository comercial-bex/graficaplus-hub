-- Valores SIMBÓLICOS com tag, para o que ainda não foi informado (pedido do dono, 25/10/2026:
-- "o que precisar de informação, preenche como temporário, com uma tag, e os avisos ajustam").
-- Nada aqui é dado real: cada valor leva "PROVISÓRIO" na observação e entra no painel "O que falta de mim".
--
--   * plotter de recorte: custo/hora R$ 3,00 (era zero) — maquinas.especificacoes.custo_hora_provisorio;
--   * recorte eletrônico: depuração de 3 min por metro e preço de R$ 2,20/m (custo R$ 1,31 ÷ 60%);
--   * corte a laser: R$ 1,00 por minuto (R$ 60/h) e acabamento manual: R$ 0,75 por minuto (R$ 45/h);
--   * esses três ganham o produto de serviço que os cobra (ACB-LASER, ACB-RECORTE, ACB-MANUAL) e a
--     ligação acabamentos.produto_servico_id, como bainha e laminação;
--   * pendencias_de_preenchimento() ganha dois avisos: acabamento_provisorio e custo_de_producao_estimado
--     (mão de obra a R$ 10,65/h pela média nacional + plotter simbólica).
-- Quando o número real chegar: trocar o valor e apagar o texto "PROVISÓRIO" da observação (o aviso some sozinho).
-- Desfazer: voltar custo_hora da plotter a 0 e apagar os três produtos de serviço (se sem uso).

UPDATE public.maquinas SET custo_hora = 3.00,
  especificacoes = COALESCE(especificacoes, '{}'::jsonb) || '{"custo_hora_provisorio": true, "custo_hora_provisorio_nota": "25/10/2026: valor simbólico até informarem o custo real da plotter de recorte"}'::jsonb
WHERE nome LIKE 'Plotter de Recorte%' AND COALESCE(custo_hora, 0) = 0;

UPDATE public.acabamentos SET minutos_mao_de_obra = 3, preco_venda = COALESCE(preco_venda, 2.20),
  observacao = 'PROVISÓRIO (25/10/2026): depuração de 3 min por metro e custo/hora de R$ 3,00 da plotter são valores simbólicos até informarem os reais. Preço de R$ 2,20 por metro simbólico (custo ÷ 60% de margem). ' || COALESCE(observacao, '')
WHERE nome = 'Recorte eletrônico (plotter de recorte)' AND observacao NOT LIKE 'PROVISÓRIO%';
UPDATE public.acabamentos SET preco_venda = COALESCE(preco_venda, 1.00),
  observacao = 'PROVISÓRIO (25/10/2026): o preço de R$ 1,00 por minuto (R$ 60/h) é simbólico (custo ÷ 60% de margem); trocar pelo preço real. ' || COALESCE(observacao, '')
WHERE nome = 'Corte a laser (CNC Laser)' AND observacao NOT LIKE 'PROVISÓRIO%';
UPDATE public.acabamentos SET preco_venda = COALESCE(preco_venda, 0.75),
  observacao = 'PROVISÓRIO (25/10/2026): o preço de R$ 0,75 por minuto (R$ 45/h) é simbólico (custo ÷ 60% de margem); trocar pelo preço real. ' || COALESCE(observacao, '')
WHERE nome = 'Acabamento manual (mão de obra)' AND observacao NOT LIKE 'PROVISÓRIO%';

WITH novos(acab, sku, unidade, preco, custo) AS (VALUES
  ('Corte a laser (CNC Laser)', 'ACB-LASER', 'hora', 60.00, 34.93),
  ('Recorte eletrônico (plotter de recorte)', 'ACB-RECORTE', 'm', 2.20, 1.31),
  ('Acabamento manual (mão de obra)', 'ACB-MANUAL', 'hora', 45.00, 26.08)
)
INSERT INTO public.produtos (nome, categoria, tipo, unidade, sku, familia, ativo, custo_medio, preco_base, margem_minima, observacoes_internas)
SELECT n.acab, 'acabamento'::categoria_produto, 'servico', n.unidade, n.sku, 'Acabamentos', true, n.custo, n.preco, 40,
       'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (25/10/2026): valores simbólicos (custo do acabamento ÷ 60% de margem) até o preço real ser informado. Serviço que cobra o acabamento "' || n.acab || '" como linha do orçamento.'
  FROM novos n
 WHERE NOT EXISTS (SELECT 1 FROM public.produtos p WHERE p.nome = n.acab);

UPDATE public.acabamentos a SET produto_servico_id = p.id
  FROM public.produtos p
 WHERE a.produto_servico_id IS NULL AND p.tipo = 'servico' AND p.nome = a.nome;

DO $m$
DECLARE d text := pg_get_functiondef('public.pendencias_de_preenchimento()'::regprocedure);
  a text := E'    -- Acabamento com tempo e custo mas sem preço de venda: não dá para cobrar à parte.';
  n int; novo text;
BEGIN
  IF position('acabamento_provisorio' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'âncora aparece % vezes', n; END IF;
  novo := E'    -- Acabamento com tempo ou preço SIMBÓLICO (a observação começa com PROVISÓRIO): vende, mas o número é de enfeite.\n'
    || E'    RETURN QUERY SELECT ''acabamento_provisorio'', ''Acabamentos com tempo ou preço provisórios'', count(*)::int,\n'
    || E'      (SELECT count(*)::int FROM public.acabamentos WHERE ativo), ''atencao'', ''financeiro'',\n'
    || E'      ''Estes acabamentos já podem ser cobrados, com tempo e preço simbólicos (custo ÷ 60% de margem). Abra Produtos › Acabamentos e troque pelo tempo de depuração, velocidade e preço reais.'',\n'
    || E'      ''/produtos''\n'
    || E'    FROM public.acabamentos WHERE ativo AND observacao LIKE ''PROVISÓRIO%'' HAVING count(*) > 0;\n\n'
    || E'    -- Custo de produção ESTIMADO: mão de obra pela média nacional e máquina com custo/hora simbólico.\n'
    || E'    RETURN QUERY SELECT ''custo_de_producao_estimado'', ''Mão de obra e máquina com valor estimado'',\n'
    || E'      ((SELECT count(*) FROM public.custos_mao_de_obra WHERE ativo AND observacoes LIKE ''Estimativa%'')\n'
    || E'       + (SELECT count(*) FROM public.maquinas WHERE ativa AND especificacoes->>''custo_hora_provisorio'' = ''true''))::int,\n'
    || E'      ((SELECT count(*) FROM public.custos_mao_de_obra WHERE ativo) + (SELECT count(*) FROM public.maquinas WHERE ativa))::int,\n'
    || E'      ''atencao'', ''financeiro'',\n'
    || E'      ''O custo cheio de todo produto usa R$ 10,65/h de mão de obra (média nacional de impressor, não o salário real) e o custo/hora simbólico da plotter de recorte. Informe o salário real de cada função e o custo da plotter em Custos de produção.'',\n'
    || E'      ''/custos-producao''\n'
    || E'    WHERE ((SELECT count(*) FROM public.custos_mao_de_obra WHERE ativo AND observacoes LIKE ''Estimativa%'')\n'
    || E'       + (SELECT count(*) FROM public.maquinas WHERE ativa AND especificacoes->>''custo_hora_provisorio'' = ''true'')) > 0;\n\n';
  d := replace(d, a, novo || a);
  EXECUTE d;
END $m$;
