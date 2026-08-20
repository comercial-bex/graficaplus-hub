-- Estoque: entrada de material e saldo com uma fonte de verdade só.
--
-- O diagnóstico apontou o estoque como o buraco mais caro: ZERO movimentações
-- registradas em 94 tabelas. A causa não era falta de código — era falta do
-- primeiro elo.
--
-- O que já existia e é sólido: reservar_materiais_os -> baixar_estoque_os ->
-- custos_operacionais_os. A baixa é transacional, idempotente (recusa OS já
-- baixada) e alimenta o pós-cálculo. Nada disso precisava mudar.
--
-- O que faltava: NÃO HAVIA COMO DAR ENTRADA. Sem entrada não há lote; sem lote
-- não há reserva; sem reserva a baixa não tem o que baixar. A cadeia inteira
-- estava morta por causa do primeiro passo.
--
-- E havia um problema estrutural por trás: DUAS FONTES DE VERDADE para o mesmo
-- saldo.
--   material_lotes.quantidade  -> o saldo real, por lote, com custo e validade
--   materiais.estoque          -> um total que a tela mostra e que a regra de
--                                 produção consulta (avancar_os_status recusa
--                                 avançar se o material obrigatório faltar)
-- As RPCs mexem em lotes. Ninguém atualizava materiais.estoque. O número que
-- decide se a produção pode começar era, portanto, ficção — hoje zerado em
-- todos os 17 materiais.
--
-- Aqui o lote passa a ser a única fonte de verdade e materiais.estoque vira um
-- total DERIVADO por gatilho. Assim a baixa que já existia também passa a
-- manter o saldo correto, sem precisar saber disso.

-- ---------------------------------------------------------------------------
-- 1) Saldo derivado do lote
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_estoque_material(p_material_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.materiais m
  SET estoque = COALESCE((
        SELECT sum(l.quantidade) FROM public.material_lotes l
        WHERE l.material_id = p_material_id AND COALESCE(l.status,'disponivel') <> 'descartado'
      ), 0),
      updated_at = now()
  WHERE m.id = p_material_id;
$function$;

CREATE OR REPLACE FUNCTION public.tg_lote_recalcular_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalcular_estoque_material(OLD.material_id);
    RETURN OLD;
  END IF;
  -- lote que troca de material exige recalcular os dois lados
  IF TG_OP = 'UPDATE' AND OLD.material_id IS DISTINCT FROM NEW.material_id THEN
    PERFORM public.recalcular_estoque_material(OLD.material_id);
  END IF;
  PERFORM public.recalcular_estoque_material(NEW.material_id);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_material_lotes_saldo ON public.material_lotes;
CREATE TRIGGER tg_material_lotes_saldo
  AFTER INSERT OR UPDATE OR DELETE ON public.material_lotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_lote_recalcular_estoque();

-- ---------------------------------------------------------------------------
-- 2) Entrada de material
-- ---------------------------------------------------------------------------
-- Cria o lote, registra a movimentação e atualiza o custo médio. O custo médio
-- é ponderado pelo saldo: material que entra mais caro puxa a média para cima
-- na proporção certa. É esse número que vira custo real na OS, então errar aqui
-- contamina o pós-cálculo inteiro.
CREATE OR REPLACE FUNCTION public.registrar_entrada_material(
  p_material_id uuid,
  p_quantidade numeric,
  p_custo_unitario numeric,
  p_fornecedor text DEFAULT NULL,
  p_nota text DEFAULT NULL,
  p_validade date DEFAULT NULL,
  p_localizacao text DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_mat public.materiais%ROWTYPE;
  v_lote_id uuid;
  v_mov_id uuid;
  v_saldo_antes numeric;
  v_custo_novo numeric;
BEGIN
  v_uid := public.require_permission('estoque.entry');

  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade maior que zero';
  END IF;
  IF p_custo_unitario IS NULL OR p_custo_unitario < 0 THEN
    RAISE EXCEPTION 'Informe o custo unitário da entrada';
  END IF;

  SELECT * INTO v_mat FROM public.materiais WHERE id = p_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado'; END IF;

  v_saldo_antes := COALESCE(v_mat.estoque, 0);

  INSERT INTO public.material_lotes (
    material_id, codigo, quantidade, unidade, custo_unitario_snapshot,
    custo_total, fornecedor, validade, localizacao, status, observacao
  )
  VALUES (
    p_material_id,
    'E-' || to_char(now(), 'YYMMDD') || '-' || upper(substring(gen_random_uuid()::text, 1, 4)),
    p_quantidade, v_mat.unidade, p_custo_unitario,
    round(p_quantidade * p_custo_unitario, 2),
    nullif(btrim(coalesce(p_fornecedor, '')), ''),
    p_validade,
    nullif(btrim(coalesce(p_localizacao, '')), ''),
    'disponivel',
    nullif(btrim(coalesce(p_observacao, '')), '')
  )
  RETURNING id INTO v_lote_id;

  INSERT INTO public.movimentacoes_estoque (
    material_id, lote_id, tipo, quantidade, unidade,
    custo_unitario_snapshot, usuario_id, origem, motivo, observacao
  )
  VALUES (
    p_material_id, v_lote_id, 'entrada', p_quantidade, v_mat.unidade,
    p_custo_unitario, v_uid, 'entrada_manual',
    COALESCE(nullif(btrim(coalesce(p_nota, '')), ''), 'Entrada de material'),
    nullif(btrim(coalesce(p_observacao, '')), '')
  )
  RETURNING id INTO v_mov_id;

  -- média ponderada; com saldo anterior zerado, o custo da entrada vira a média
  v_custo_novo := CASE
    WHEN v_saldo_antes + p_quantidade > 0
      THEN round(
        ((v_saldo_antes * COALESCE(v_mat.custo_medio, v_mat.custo_unitario, 0))
         + (p_quantidade * p_custo_unitario))
        / (v_saldo_antes + p_quantidade), 4)
    ELSE p_custo_unitario
  END;

  UPDATE public.materiais
  SET custo_medio = v_custo_novo,
      custo_unitario = p_custo_unitario,
      fornecedor = COALESCE(nullif(btrim(coalesce(p_fornecedor, '')), ''), fornecedor)
  WHERE id = p_material_id;

  RETURN jsonb_build_object(
    'lote_id', v_lote_id,
    'movimentacao_id', v_mov_id,
    'saldo_anterior', v_saldo_antes,
    'saldo_atual', (SELECT estoque FROM public.materiais WHERE id = p_material_id),
    'custo_medio', v_custo_novo
  );
END $function$;

REVOKE ALL ON FUNCTION public.registrar_entrada_material(uuid,numeric,numeric,text,text,date,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_material(uuid,numeric,numeric,text,text,date,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Ajuste de inventário
-- ---------------------------------------------------------------------------
-- Contagem física que não bate com o sistema. Registra a diferença como
-- movimentação, para a sobra ou a falta ficar rastreada em vez de alguém
-- corrigir o número na mão e ninguém saber por quê.
CREATE OR REPLACE FUNCTION public.ajustar_estoque_material(
  p_material_id uuid,
  p_quantidade_contada numeric,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid; v_mat public.materiais%ROWTYPE; v_lote_id uuid;
  v_saldo_antes numeric; v_dif numeric;
BEGIN
  v_uid := public.require_permission('estoque.inventory');
  IF p_quantidade_contada IS NULL OR p_quantidade_contada < 0 THEN
    RAISE EXCEPTION 'Informe a quantidade contada';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo do ajuste';
  END IF;

  SELECT * INTO v_mat FROM public.materiais WHERE id = p_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado'; END IF;

  v_saldo_antes := COALESCE(v_mat.estoque, 0);
  v_dif := p_quantidade_contada - v_saldo_antes;
  IF v_dif = 0 THEN
    RETURN jsonb_build_object('material_id', p_material_id, 'diferenca', 0,
                              'mensagem', 'Contagem confere com o sistema');
  END IF;

  IF v_dif > 0 THEN
    -- sobra vira lote novo, ao custo médio atual
    INSERT INTO public.material_lotes (material_id, codigo, quantidade, unidade,
      custo_unitario_snapshot, custo_total, status, observacao)
    VALUES (p_material_id, 'INV-' || to_char(now(), 'YYMMDD'), v_dif, v_mat.unidade,
      COALESCE(v_mat.custo_medio, 0), round(v_dif * COALESCE(v_mat.custo_medio, 0), 2),
      'disponivel', p_motivo)
    RETURNING id INTO v_lote_id;
  ELSE
    -- falta sai dos lotes mais antigos primeiro
    DECLARE v_restante numeric := -v_dif; l RECORD; v_tira numeric;
    BEGIN
      FOR l IN SELECT * FROM public.material_lotes
               WHERE material_id = p_material_id AND quantidade > 0
               ORDER BY created_at FOR UPDATE LOOP
        EXIT WHEN v_restante <= 0;
        v_tira := LEAST(l.quantidade, v_restante);
        UPDATE public.material_lotes SET quantidade = quantidade - v_tira WHERE id = l.id;
        v_restante := v_restante - v_tira;
      END LOOP;
    END;
  END IF;

  INSERT INTO public.movimentacoes_estoque (material_id, lote_id, tipo, quantidade,
    unidade, custo_unitario_snapshot, usuario_id, origem, motivo)
  VALUES (p_material_id, v_lote_id, CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END,
    abs(v_dif), v_mat.unidade, COALESCE(v_mat.custo_medio, 0), v_uid, 'inventario', p_motivo);

  INSERT INTO public.estoque_inventarios (material_id, lote_id, quantidade_anterior,
    quantidade_nova, motivo, usuario_id)
  VALUES (p_material_id, v_lote_id, v_saldo_antes, p_quantidade_contada, p_motivo, v_uid);

  RETURN jsonb_build_object('material_id', p_material_id, 'saldo_anterior', v_saldo_antes,
    'saldo_atual', (SELECT estoque FROM public.materiais WHERE id = p_material_id),
    'diferenca', v_dif);
END $function$;

REVOKE ALL ON FUNCTION public.ajustar_estoque_material(uuid,numeric,text) FROM public;
GRANT EXECUTE ON FUNCTION public.ajustar_estoque_material(uuid,numeric,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Extrato de movimentações
-- ---------------------------------------------------------------------------
-- A tela lia um array fixo no código (dados inventados). Esta view é a fonte
-- real, já com nome do material, da OS e de quem movimentou.
CREATE OR REPLACE VIEW public.vw_movimentacoes_estoque
WITH (security_invoker = true) AS
SELECT
  mov.id,
  mov.created_at,
  mov.tipo,
  mov.quantidade,
  mov.unidade,
  mov.origem,
  mov.motivo,
  mov.material_id,
  m.nome  AS material_nome,
  mov.lote_id,
  l.codigo AS lote_codigo,
  mov.os_id,
  os.numero AS os_numero,
  mov.usuario_id,
  u.nome AS usuario_nome
FROM public.movimentacoes_estoque mov
JOIN public.materiais m ON m.id = mov.material_id
LEFT JOIN public.material_lotes l ON l.id = mov.lote_id
LEFT JOIN public.ordens_servico os ON os.id = mov.os_id
LEFT JOIN public.usuarios u ON u.id = mov.usuario_id;

GRANT SELECT ON public.vw_movimentacoes_estoque TO authenticated;

-- ordenação do extrato
CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_created_at
  ON public.movimentacoes_estoque (created_at DESC);

-- ---------------------------------------------------------------------------
-- 5) Alinhar o saldo já existente
-- ---------------------------------------------------------------------------
-- Hoje todos os 17 materiais estão com estoque 0 e nenhum lote, então isto não
-- muda nada — mas deixa o saldo coerente com os lotes a partir de agora.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.materiais LOOP
    PERFORM public.recalcular_estoque_material(r.id);
  END LOOP;
END $$;
