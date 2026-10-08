-- ============================================================================
-- Estorno de baixa: o custo que a baixa lançou na OS sai junto com o material
-- ============================================================================
--
-- POR QUÊ
--   `baixar_estoque_os` faz duas coisas para cada material reservado: tira a
--   quantidade do lote e lança o custo na OS (custos_operacionais_os, categoria
--   'material', origem 'baixa_estoque', quantidade × custo do lote).
--   `estornar_baixa_estoque_os` desfazia só a primeira: devolvia o material ao
--   lote e gravava a entrada 'estorno_os', mas nem citava a tabela de custos.
--   Depois do estorno, a OS continuava pagando por um material que voltou para
--   a prateleira: custo realizado, lucro e margem realizados da vw_resultado_os
--   errados, e o snapshot que a fechar_os grava ao fechar, também.
--
--   O mesmo estorno tinha mais dois defeitos, achados no ensaio:
--   * A entrada 'estorno_os' passava pelo gatilho do custo médio como se fosse
--     COMPRA: entrava na média e trocava o "último custo" do material
--     (materiais.custo_unitario) pelo preço do lote antigo. É esse "último
--     custo" que a revisão de previsões (previsoes_desatualizadas e
--     recalcular_previsao_custos) usa para reprecificar as OS abertas.
--   * Aceitava estornar QUALQUER saída. Só a baixa de OS grava o lote na
--     movimentação; nas outras (manual, inventário, perda, impressão 3D) o
--     `UPDATE ... WHERE id = m.lote_id` não acha linha, nada volta ao lote, e
--     a função respondia "feito" e gravava a entrada assim mesmo.
--
-- MEDIDO EM 08/10/2026 (ensaio no banco vivo, tudo desfeito)
--   OS 49 (ac27e850), lote 02d43b03 de lona 440 a R$ 16,23, receita R$ 100,
--   reserva de 2 m² montada como postgres e uma compra mais nova de 10 m² a
--   R$ 18,00. Baixa e estorno chamados como Yvens (gestor) e como Harison
--   (admin), com claims + SET LOCAL ROLE authenticated. Os dois deram igual:
--                          ANTES (função viva)       DEPOIS (esta migração)
--     depois da baixa      lote 42; custo R$ 32,46;  igual
--                          margem 67,54%
--     depois do estorno    lote 44; custo R$ 32,46;  lote 44; custo R$ 0,00
--                          margem 67,54%             (baixa +32,46, estorno
--                                                    −32,46, mesmo item e
--                                                    tarefa); margem 100%
--     "último custo" da    R$ 18,00 → R$ 16,23       fica R$ 18,00
--     lona (média 16,56)   (média 16,55)             (média 16,56)
--     estornar saída       "feito", lote não volta   recusa e diz por quê
--     manual de 1 m²       (53 → 53)
--     estornar de novo     recusa ("já estornada")   igual
--     baixar de novo       recusa ("já foi baixado") igual
--     fechar_os            custo 32,46, margem 67,54 custo 0, margem 100
--
-- QUEM CHAMA
--   Nenhuma tela, edge function, cron ou outra função chama o estorno; ele só
--   existe pela API. Até 08/10/2026 o banco nunca registrou uma baixa nem um
--   estorno (custos_operacionais_os vazia, nenhuma movimentação 'baixa_os' ou
--   'estorno_os'): não há dado antigo para corrigir.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. `estornar_baixa_estoque_os` lança na OS um custo NEGATIVO espelhando o
--      da baixa: categoria 'material', origem 'estorno_baixa', mesmo item e
--      mesma tarefa, quantidade = −(quantidade estornada), valor unitário =
--      custo do lote gravado na movimentação de origem. A baixa grava esse
--      MESMO preço (l.custo_unitario_snapshot) na movimentação e no custo, e a
--      coluna total é round(quantidade × valor_unitario, 2): a soma volta a
--      zero centavo por centavo. A linha da baixa NÃO é apagada: fica o rastro
--      de que houve baixa e estorno, quem fez e quando. (A 20261007233000 tira
--      UPDATE e DELETE da API nessa tabela; esta função é SECURITY DEFINER
--      dona postgres e grava sem depender de regra nem de grant.)
--   2. Só estorna saída de origem 'baixa_os'. As outras são recusadas com a
--      origem na mensagem, e o estorno também recusa se o lote não existir
--      mais (antes: "feito" sem devolver nada).
--   3. O gatilho do custo médio ignora a entrada 'estorno_os', no disparo e no
--      cálculo da média: material que volta para a prateleira não é compra.
--   4. Permissões: o estorno continua com EXECUTE só para authenticated (e
--      service_role, que já tinha). A guarda dele é
--      require_permission('estoque.reverse'), que lê auth.uid(): só funciona
--      chamado por alguém logado, por isso o grant ao authenticated fica. Quem
--      tem a chave: admin e gestor.
--
-- A RESERVA NÃO VOLTA (decisão)
--   Depois do estorno a reserva continua 'baixada' com 2 m² baixados, e o lote
--   fica com os 2 m² LIVRES (quantidade 44, reservada 0). Voltar a reserva
--   prenderia de novo os 2 m² no lote sem nenhuma saída: a baixa recusa rodar
--   duas vezes na mesma OS ("Estoque desta OS já foi baixado", conferido no
--   ensaio) e a reserva automática pula o material que já tem reserva. Nenhuma
--   função libera reserva. O material ficaria preso para sempre e as outras OS
--   não conseguiriam reservá-lo. O livro do estoque continua certo:
--   movimentacoes_estoque tem a saída e a entrada de estorno ligadas por
--   movimentacao_origem_id.
--
-- O QUE FICA DE FORA, DE PROPÓSITO
--   * Estorno total deixa a OS com custo R$ 0 e margem 100%, e a fechar_os não
--     percebe: a trava de material olha se EXISTE baixa, a de custo olha se
--     EXISTE lançamento, e as duas continuam existindo. Antes o erro era o
--     inverso (custo de um material que voltou). Consertar isso pede decidir o
--     que "estornar" quer dizer: refazer a baixa (a reserva volta, a baixa
--     aceita refazer o que foi estornado e a fechar_os desconta o estornado) ou
--     material não usado. É decisão do dono; nenhuma tela estorna hoje.
--   * A OS continua com status_producao 'material_baixado' depois do estorno.
--   * O card "Materiais da OS" soma só as saídas em "consumido" e não desconta
--     a entrada de estorno. Só aparece depois de um estorno, e hoje não há tela
--     para estornar.
--   * Estornar perda, saída manual, inventário ou impressão 3D: não existe.
--     Cada uma precisaria de lote na movimentação (a perda, também do custo
--     'perda' que o gatilho lança).
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select prosrc ~ 'estorno_baixa' as tira_o_custo,
--          prosrc ~ 'baixa_os'      as so_baixa_de_os
--     from pg_proc where oid = 'public.estornar_baixa_estoque_os(uuid,text)'::regprocedure;
--     → t, t
--   select prosrc ~ 'estorno_os' from pg_proc
--    where oid = 'public.tg_material_custo_medio()'::regprocedure;
--     → t
--   select has_function_privilege('anon', 'public.estornar_baixa_estoque_os(uuid,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.estornar_baixa_estoque_os(uuid,text)', 'EXECUTE');
--     → f, t
-- ============================================================================

CREATE OR REPLACE FUNCTION public.estornar_baixa_estoque_os(p_movimentacao_origem_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; m record; v_new uuid; v_custo uuid; v_valor numeric;
BEGIN
  IF NULLIF(trim(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
  v_uid := public.require_permission('estoque.reverse');

  SELECT * INTO m FROM public.movimentacoes_estoque
   WHERE id = p_movimentacao_origem_id AND tipo = 'saida' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimentação de saída não encontrada'; END IF;

  -- Só a baixa de OS guarda o lote na movimentação e lança custo de material.
  -- Nas outras saídas o UPDATE do lote não acharia linha e o estorno diria
  -- "feito" sem devolver nada.
  IF m.origem IS DISTINCT FROM 'baixa_os' THEN
    RAISE EXCEPTION 'Por aqui só se estorna baixa de material de OS. Esta saída veio de "%".',
      coalesce(m.origem, 'sem origem') USING errcode = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.movimentacoes_estoque
              WHERE movimentacao_origem_id = p_movimentacao_origem_id AND tipo = 'entrada') THEN
    RAISE EXCEPTION 'Movimentação já estornada';
  END IF;

  UPDATE public.material_lotes SET quantidade = quantidade + m.quantidade WHERE id = m.lote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O lote desta baixa não existe mais: o material não tem para onde voltar.'
      USING errcode = 'P0001';
  END IF;

  INSERT INTO public.movimentacoes_estoque
    (material_id, lote_id, tipo, quantidade, unidade, custo_unitario_snapshot,
     os_id, os_item_id, tarefa_id, usuario_id, origem, movimentacao_origem_id, motivo)
  VALUES (m.material_id, m.lote_id, 'entrada', m.quantidade, m.unidade, m.custo_unitario_snapshot,
          m.os_id, m.os_item_id, m.tarefa_id, v_uid, 'estorno_os', p_movimentacao_origem_id, p_motivo)
  RETURNING id INTO v_new;

  -- O custo que a baixa lançou sai junto, por uma linha negativa (a da baixa
  -- fica: é o rastro). Mesmo preço que a baixa gravou na movimentação e no
  -- custo, então a soma da OS volta exatamente ao que era.
  INSERT INTO public.custos_operacionais_os
    (os_id, os_item_id, tarefa_id, categoria, origem, quantidade, valor_unitario, usuario_id)
  VALUES (m.os_id, m.os_item_id, m.tarefa_id, 'material', 'estorno_baixa',
          -m.quantidade, coalesce(m.custo_unitario_snapshot, 0), v_uid)
  RETURNING id, total INTO v_custo, v_valor;

  PERFORM public.registrar_evento_os(m.os_id, 'movimentacoes_estoque', v_new, 'estorno_estoque',
    'Estorno de baixa', p_motivo,
    jsonb_build_object('origem', p_movimentacao_origem_id, 'custo_estornado', v_valor));
  RETURN jsonb_build_object('movimentacao_id', v_new, 'origem_id', p_movimentacao_origem_id,
                            'custo_id', v_custo, 'custo_estornado', v_valor);
END; $function$;

REVOKE ALL ON FUNCTION public.estornar_baixa_estoque_os(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_estoque_os(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.estornar_baixa_estoque_os(uuid, text) IS
  'Desfaz uma baixa de material de OS (só saída de origem baixa_os): devolve a quantidade ao lote, grava a entrada estorno_os ligada à saída e lança na OS o custo negativo (material / estorno_baixa) que zera o custo da baixa; a linha da baixa fica como rastro. A reserva não volta, de propósito: o material fica livre no lote. Exige estoque.reverse e motivo. EXECUTE para authenticated porque a guarda lê auth.uid(). Migração 20261008100000.';

CREATE OR REPLACE FUNCTION public.tg_material_custo_medio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_medio NUMERIC;
BEGIN
  -- Estorno de baixa não é compra: o material só voltou para a prateleira.
  -- Contar como compra trocava o "último custo" pelo preço do lote antigo.
  IF NEW.tipo::text <> 'entrada' OR COALESCE(NEW.custo_unitario_snapshot, 0) <= 0
     OR COALESCE(NEW.origem, '') = 'estorno_os' THEN
    RETURN NULL;
  END IF;

  SELECT CASE WHEN SUM(quantidade) > 0
              THEN ROUND(SUM(quantidade * custo_unitario_snapshot) / SUM(quantidade), 2)
         END
    INTO v_medio
    FROM public.movimentacoes_estoque
   WHERE material_id = NEW.material_id
     AND tipo::text = 'entrada'
     AND COALESCE(custo_unitario_snapshot, 0) > 0
     AND COALESCE(origem, '') <> 'estorno_os';

  UPDATE public.materiais
     SET custo_medio = COALESCE(v_medio, custo_medio),
         custo_unitario = NEW.custo_unitario_snapshot,
         updated_at = now()
   WHERE id = NEW.material_id;

  RETURN NULL;
END;
$function$;

-- Função de gatilho não precisa de grant para disparar (roda pela dona da
-- tabela); o grant só serviria para chamar direto.
REVOKE ALL ON FUNCTION public.tg_material_custo_medio() FROM PUBLIC, anon, authenticated;

-- O REVOKE não reclama quando não surte efeito: conferir de verdade.
DO $guarda$
BEGIN
  IF has_function_privilege('anon', 'public.estornar_baixa_estoque_os(uuid,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa estornar_baixa_estoque_os';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.estornar_baixa_estoque_os(uuid,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdeu estornar_baixa_estoque_os';
  END IF;
  IF has_function_privilege('anon', 'public.tg_material_custo_medio()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_material_custo_medio()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'tg_material_custo_medio continua executável pela API';
  END IF;
END
$guarda$;
