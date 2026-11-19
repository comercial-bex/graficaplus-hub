-- =====================================================================================================
-- O DESCONTO SOME DA TELA E DO PDF: ESPELHOS DE VALOR QUE NÃO SEGUIAM O GATILHO (19/11/2026)
--
-- O defeito, achado no orçamento #261 (Michely Leite de Amorim). O dono deu 20 por cento de desconto. A tabela
-- orcamentos ficou certa: subtotal 1.604,89, desconto 320,98, total 1.283,91. Mas a tela (resumo, cabeçalho, margem)
-- e o PDF do cliente mostravam 1.604,89, sem desconto nenhum.
--
-- Por quê. A tela e o PDF leem o preço pelas visões orcamentos_financeiro e orcamentos_comercial, que tiram o total
-- de um ESPELHO, a tabela orcamento_custos. Quem copia para o espelho é o gatilho tg_sync_orcamento_custos, criado
-- como AFTER UPDATE OF valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada. Um gatilho
-- "UPDATE OF colunas" só dispara quando o UPDATE CITA uma dessas colunas. definir_desconto_do_orcamento grava só
-- desconto_modo e desconto_informado; quem recalcula valor_total e desconto_percentual é o gatilho BEFORE de totais.
-- Mudança feita por gatilho BEFORE não conta para "UPDATE OF" (está na documentação do Postgres). Resultado: todo
-- desconto aplicado pelo quadro de desconto ficava fora do espelho, até alguém mexer num item.
--
-- Em 19/11/2026, quatro orçamentos estavam assim, todos com desconto: #108 (40 por cento, convertido), #187 (19,
-- enviado), #191 (15, aprovado e já com OS) e #261 (20, enviado). As OS 169 e 219 nasceram com o valor certo, porque a
-- conversão lê a tabela, não o espelho. O link do cliente e o texto do WhatsApp também leem a tabela e estavam certos.
-- O PDF do cliente lê a visão e saiu sem desconto nos #187, #191 e #261.
--
-- O mesmo risco existe em tg_sync_item_os_custos: o gatilho BEFORE tg_item_os_precificar_por_area recalcula
-- valor_unitario e valor_total quando muda a quantidade, a largura ou a altura de um item de OS com preço por metro
-- quadrado, e o espelho item_os_custos não seguiria. Hoje não há nenhum item diferente, mas o caminho existe.
--
-- A correção.
-- 1) Os dois gatilhos de espelho passam a disparar quando o VALOR muda, venha de onde vier: AFTER UPDATE com WHEN
--    comparando OLD e NEW das mesmas colunas, mais um gatilho AFTER INSERT para a linha nova. A função de cada um não
--    muda. Os nomes de UPDATE ficam os mesmos, e os de INSERT ficam logo depois na ordem alfabética: a ordem dos
--    gatilhos AFTER não muda.
-- 2) O espelho dos orçamentos é ressincronizado com a tabela. Só se a diferença for a do desconto (valor_total e
--    desconto_percentual); qualquer outra diferença para a migração, porque seria outro defeito.
-- 3) Rastro em logs_auditoria por orçamento corrigido, sem valor: só o número.
--
-- O gatilho da OS (tg_sync_os_resultados_financeiros) fica como está: nenhum gatilho BEFORE de ordens_servico mexe
-- nas colunas que ele espelha.
--
-- Ensaio no banco vivo, com RAISE EXCEPTION final: docs/ensaio-espelhos-de-valor-19-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Os gatilhos que vamos trocar são os que o banco tem hoje.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = 'public.orcamentos'::regclass AND t.tgname = 'tg_sync_orcamento_custos';
  IF v_def IS DISTINCT FROM 'CREATE TRIGGER tg_sync_orcamento_custos AFTER INSERT OR UPDATE OF valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada ON public.orcamentos FOR EACH ROW EXECUTE FUNCTION tg_sync_orcamento_custos()' THEN
    RAISE EXCEPTION 'tg_sync_orcamento_custos mudou no banco: %', v_def;
  END IF;

  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = 'public.itens_os'::regclass AND t.tgname = 'tg_sync_item_os_custos';
  IF v_def IS DISTINCT FROM 'CREATE TRIGGER tg_sync_item_os_custos AFTER INSERT OR UPDATE OF valor_unitario, custo_unitario, valor_total ON public.itens_os FOR EACH ROW EXECUTE FUNCTION tg_sync_item_os_custos()' THEN
    RAISE EXCEPTION 'tg_sync_item_os_custos mudou no banco: %', v_def;
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Orçamento: o espelho segue o valor, não a lista de colunas do UPDATE.
-- ---------------------------------------------------------------------------------------------------
DROP TRIGGER tg_sync_orcamento_custos ON public.orcamentos;

CREATE TRIGGER tg_sync_orcamento_custos
  AFTER UPDATE ON public.orcamentos
  FOR EACH ROW
  WHEN (OLD.valor_subtotal IS DISTINCT FROM NEW.valor_subtotal
     OR OLD.valor_total IS DISTINCT FROM NEW.valor_total
     OR OLD.desconto_percentual IS DISTINCT FROM NEW.desconto_percentual
     OR OLD.custo_estimado IS DISTINCT FROM NEW.custo_estimado
     OR OLD.margem_estimada IS DISTINCT FROM NEW.margem_estimada)
  EXECUTE FUNCTION public.tg_sync_orcamento_custos();

CREATE TRIGGER tg_sync_orcamento_custos_ao_criar
  AFTER INSERT ON public.orcamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_orcamento_custos();

-- ---------------------------------------------------------------------------------------------------
-- 2. Item de OS: o mesmo, porque o preço por metro quadrado é recalculado num gatilho BEFORE.
-- ---------------------------------------------------------------------------------------------------
DROP TRIGGER tg_sync_item_os_custos ON public.itens_os;

CREATE TRIGGER tg_sync_item_os_custos
  AFTER UPDATE ON public.itens_os
  FOR EACH ROW
  WHEN (OLD.valor_unitario IS DISTINCT FROM NEW.valor_unitario
     OR OLD.custo_unitario IS DISTINCT FROM NEW.custo_unitario
     OR OLD.valor_total IS DISTINCT FROM NEW.valor_total)
  EXECUTE FUNCTION public.tg_sync_item_os_custos();

CREATE TRIGGER tg_sync_item_os_custos_ao_criar
  AFTER INSERT ON public.itens_os
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_item_os_custos();

-- ---------------------------------------------------------------------------------------------------
-- 3. O espelho dos orçamentos volta a bater com a tabela. Só a diferença do desconto é esperada.
-- ---------------------------------------------------------------------------------------------------
DO $prova$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orcamentos o JOIN public.orcamento_custos c ON c.orcamento_id = o.id
              WHERE c.valor_subtotal IS DISTINCT FROM o.valor_subtotal
                 OR c.custo_estimado IS DISTINCT FROM o.custo_estimado
                 OR c.margem_estimada IS DISTINCT FROM o.margem_estimada) THEN
    RAISE EXCEPTION 'há orçamento com espelho diferente fora do desconto: é outro defeito, investigue antes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orcamentos o WHERE NOT EXISTS (SELECT 1 FROM public.orcamento_custos c WHERE c.orcamento_id = o.id)) THEN
    RAISE EXCEPTION 'há orçamento sem linha no espelho: é outro defeito, investigue antes';
  END IF;
END
$prova$;

WITH corrigidos AS (
  UPDATE public.orcamento_custos c
     SET valor_total = o.valor_total,
         desconto_percentual = o.desconto_percentual,
         updated_at = now()
    FROM public.orcamentos o
   WHERE c.orcamento_id = o.id
     AND (c.valor_total IS DISTINCT FROM o.valor_total OR c.desconto_percentual IS DISTINCT FROM o.desconto_percentual)
  RETURNING c.orcamento_id, o.numero
)
INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
SELECT NULL, 'orcamentos', x.orcamento_id, 'espelho_de_valor_resincronizado',
       jsonb_build_object('numero', x.numero, 'migracao', '20261119200000')
  FROM corrigidos x;

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: a migração para se algo não ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orcamentos o JOIN public.orcamento_custos c ON c.orcamento_id = o.id
              WHERE c.valor_subtotal IS DISTINCT FROM o.valor_subtotal
                 OR c.valor_total IS DISTINCT FROM o.valor_total
                 OR c.desconto_percentual IS DISTINCT FROM o.desconto_percentual
                 OR c.custo_estimado IS DISTINCT FROM o.custo_estimado
                 OR c.margem_estimada IS DISTINCT FROM o.margem_estimada) THEN
    RAISE EXCEPTION 'o espelho dos orçamentos ainda difere da tabela';
  END IF;
  IF EXISTS (SELECT 1 FROM public.itens_os i JOIN public.item_os_custos c ON c.item_os_id = i.id
              WHERE c.valor_unitario IS DISTINCT FROM i.valor_unitario
                 OR c.custo_unitario IS DISTINCT FROM i.custo_unitario
                 OR c.valor_total IS DISTINCT FROM i.valor_total) THEN
    RAISE EXCEPTION 'o espelho dos itens de OS difere da tabela';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal
         AND ((t.tgrelid = 'public.orcamentos'::regclass AND t.tgname IN ('tg_sync_orcamento_custos', 'tg_sync_orcamento_custos_ao_criar'))
           OR (t.tgrelid = 'public.itens_os'::regclass AND t.tgname IN ('tg_sync_item_os_custos', 'tg_sync_item_os_custos_ao_criar')))) <> 4 THEN
    RAISE EXCEPTION 'os quatro gatilhos de espelho não ficaram no lugar';
  END IF;
  IF has_function_privilege('anon', 'public.tg_sync_orcamento_custos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_sync_orcamento_custos()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tg_sync_item_os_custos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_sync_item_os_custos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'função de gatilho de espelho executável de fora';
  END IF;
END
$confere$;

COMMIT;
