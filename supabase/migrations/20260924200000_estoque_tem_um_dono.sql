-- ============================================================================
-- Onda 5 — o saldo de estoque passa a ter um dono só
-- ============================================================================
--
-- `materiais.estoque` tinha TRÊS donos, e eles se contradiziam:
--
--   recalcular_estoque_material   estoque = soma dos lotes      (a verdade)
--   tg_perda_vira_custo_da_os     estoque = estoque − perdido   (no agregado)
--   a tela /materiais             estoque = estoque ± qtd       (no navegador)
--
-- Os dois últimos não tocam em lote. Como o primeiro roda a cada mexida em
-- lote e REFAZ a conta, tudo que os outros dois escreveram é apagado na
-- entrada seguinte: a perda de material some da conta sozinha, e a
-- movimentação lançada na tela desaparece do saldo. Dois cronômetros no mesmo
-- campo, e o pior apaga o melhor.
--
-- E havia uma bomba armada. Quatro materiais carregavam saldo real —
--
--   Lona 440g reforçada        44
--   Bastão + corda p/ banner   10
--   Lona 280g brilho            5
--   Acrílico esp dourado 2mm    4
--
-- — e `material_lotes` estava VAZIA. No instante em que o primeiro lote de um
-- desses materiais nascesse, `estoque = soma dos lotes` substituiria o saldo
-- antigo pela quantidade da entrada nova: uma compra de 10 m² zeraria os 44 e
-- deixaria 10. Pelo mesmo motivo, `ajustar_estoque_material` contando MENOS do
-- que o sistema não tinha lote de onde tirar e não mudava nada — reportava um
-- ajuste que não aconteceu.
--
-- Retrato do banco vivo: aplicado e ensaiado com reversão.

-- ---------------------------------------------------- 1. o lote de abertura
-- O lastro do que já está na prateleira, para que a primeira compra some em
-- vez de substituir.
INSERT INTO public.material_lotes
  (material_id, codigo, quantidade, unidade, custo_unitario_snapshot, custo_total,
   status, observacao)
SELECT m.id, 'ABERTURA', m.estoque, m.unidade,
       COALESCE(m.custo_medio, m.custo_unitario, 0),
       round(m.estoque * COALESCE(m.custo_medio, m.custo_unitario, 0), 2),
       'disponivel',
       'Saldo que ja existia na tabela antes de o controle por lote comecar a valer'
FROM public.materiais m
WHERE COALESCE(m.estoque, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.material_lotes l WHERE l.material_id = m.id);

-- E para os que vierem: cadastrar um material dizendo que já há 44 m² na
-- prateleira é legítimo; o saldo existir sem lote é que não pode.
CREATE OR REPLACE FUNCTION public.tg_material_nasce_com_lote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF COALESCE(NEW.estoque, 0) > 0 THEN
    INSERT INTO public.material_lotes (material_id, codigo, quantidade, unidade,
      custo_unitario_snapshot, custo_total, status, observacao)
    VALUES (NEW.id, 'ABERTURA', NEW.estoque, NEW.unidade,
      COALESCE(NEW.custo_medio, NEW.custo_unitario, 0),
      round(NEW.estoque * COALESCE(NEW.custo_medio, NEW.custo_unitario, 0), 2),
      'disponivel', 'Saldo informado no cadastro do material');
  END IF;
  RETURN NULL;
END $f$;

REVOKE ALL ON FUNCTION public.tg_material_nasce_com_lote() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_material_nasce_com_lote ON public.materiais;
CREATE TRIGGER tg_material_nasce_com_lote
  AFTER INSERT ON public.materiais
  FOR EACH ROW EXECUTE FUNCTION public.tg_material_nasce_com_lote();


-- --------------------------------------------- 2. a perda passa a comer lote
CREATE OR REPLACE FUNCTION public.tg_perda_vira_custo_da_os()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
declare v_total numeric; v_qtd numeric; v_un text; v_restante numeric; v_tira numeric; l RECORD;
begin
  v_qtd   := coalesce(new.quantidade_perdida, 0);
  v_total := round(v_qtd * coalesce(new.custo_unitario, 0), 2);

  -- custo real da OS (alimenta vw_resultado_os -> lucro/margem realizados)
  if new.os_id is not null and v_total > 0 then
    insert into public.custos_operacionais_os
      (os_id, os_item_id, categoria, origem, quantidade, valor_unitario, data, usuario_id)
    values (new.os_id, new.os_item_id, 'perda', 'os_perdas',
            v_qtd, new.custo_unitario, now(),
            coalesce(new.operador_id, new.created_by));
  end if;

  -- baixa fisica do material desperdicado, consumindo lote por lote (FIFO)
  if new.material_id is not null and v_qtd > 0 then
    select coalesce(new.unidade, m.unidade) into v_un
      from public.materiais m where m.id = new.material_id;

    insert into public.movimentacoes_estoque
      (material_id, tipo, quantidade, unidade, custo_unitario_snapshot,
       os_id, os_item_id, usuario_id, origem, motivo, observacao)
    values (new.material_id, 'saida', v_qtd, coalesce(v_un,'un'),
            coalesce(new.custo_unitario, 0), new.os_id, new.os_item_id,
            coalesce(new.operador_id, new.created_by), 'perda',
            new.motivo::text, new.observacoes);

    v_restante := v_qtd;
    for l in select * from public.material_lotes
             where material_id = new.material_id and quantidade > 0
               and coalesce(status,'disponivel') <> 'descartado'
             order by created_at for update loop
      exit when v_restante <= 0;
      v_tira := least(l.quantidade, v_restante);
      update public.material_lotes set quantidade = quantidade - v_tira where id = l.id;
      v_restante := v_restante - v_tira;
    end loop;

    -- Perder mais do que ha na prateleira e informacao, nao erro de digitacao:
    -- o saldo estava errado antes. Fica registrado em vez de silenciar.
    if v_restante > 0 then
      raise warning 'Perda de % % do material % excede o saldo em lote; faltaram % sem lastro.',
        v_qtd, coalesce(v_un,'un'), new.material_id, v_restante;
    end if;
  end if;

  return new;
end $f$;


-- --------------------------------------------------------------- 3. a trava
-- Combinação não basta: é preciso o banco recusar. Mesmo padrão que
-- `tg_bloquear_update_status_os` já usa com o status da OS.
CREATE OR REPLACE FUNCTION public.tg_estoque_tem_um_dono() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.estoque IS NOT DISTINCT FROM OLD.estoque THEN RETURN NEW; END IF;
  IF current_setting('app.recalculo_de_estoque', true) = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'O saldo de estoque nao se escreve direto: ele e a soma dos lotes. Use Entrada de material, Baixa da OS ou Inventario.' USING ERRCODE = '42501';
END $f$;

REVOKE ALL ON FUNCTION public.tg_estoque_tem_um_dono() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_estoque_tem_um_dono ON public.materiais;
CREATE TRIGGER aa_estoque_tem_um_dono
  BEFORE UPDATE OF estoque ON public.materiais
  FOR EACH ROW EXECUTE FUNCTION public.tg_estoque_tem_um_dono();

-- O único dono legítimo: era LANGUAGE sql, que não aceita PERFORM. Vira
-- plpgsql para carregar a chave da trava.
CREATE OR REPLACE FUNCTION public.recalcular_estoque_material(p_material_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  PERFORM set_config('app.recalculo_de_estoque', 'on', true);
  UPDATE public.materiais m
  SET estoque = COALESCE((SELECT sum(l.quantidade) FROM public.material_lotes l
        WHERE l.material_id = p_material_id AND COALESCE(l.status,'disponivel') <> 'descartado'), 0),
      updated_at = now()
  WHERE m.id = p_material_id;
  PERFORM set_config('app.recalculo_de_estoque', 'off', true);
END $f$;

REVOKE ALL ON FUNCTION public.recalcular_estoque_material(uuid) FROM PUBLIC, anon, authenticated;


-- -------------------------------------- 4. a saída manual que não existia
-- Havia entrada (`registrar_entrada_material`), baixa por OS
-- (`baixar_estoque_os`) e inventário (`ajustar_estoque_material`) — e nenhuma
-- saída avulsa. É por isso que a tela fazia a conta na mão: amostra, uso
-- interno e brinde não tinham caminho.
CREATE OR REPLACE FUNCTION public.registrar_saida_material(
  p_material_id uuid, p_quantidade numeric, p_motivo text, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid; v_mat public.materiais%ROWTYPE;
        v_restante numeric; v_tira numeric; l RECORD; v_antes numeric;
BEGIN
  v_uid := public.require_permission('estoque.exit');
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade maior que zero.' USING ERRCODE='22023'; END IF;
  IF COALESCE(btrim(p_motivo),'') = '' THEN
    RAISE EXCEPTION 'Diga por que o material saiu: amostra, uso interno, brinde, descarte.' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_mat FROM public.materiais WHERE id = p_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material nao encontrado' USING ERRCODE='P0002'; END IF;

  v_antes := COALESCE(v_mat.estoque, 0);
  IF p_quantidade > v_antes THEN
    RAISE EXCEPTION 'Estoque insuficiente: ha % % de %.', v_antes, v_mat.unidade, v_mat.nome
      USING ERRCODE='22023';
  END IF;

  v_restante := p_quantidade;
  FOR l IN SELECT * FROM public.material_lotes
           WHERE material_id = p_material_id AND quantidade > 0
             AND COALESCE(status,'disponivel') <> 'descartado'
           ORDER BY created_at FOR UPDATE LOOP
    EXIT WHEN v_restante <= 0;
    v_tira := LEAST(l.quantidade, v_restante);
    UPDATE public.material_lotes SET quantidade = quantidade - v_tira WHERE id = l.id;
    v_restante := v_restante - v_tira;
  END LOOP;

  IF v_restante > 0 THEN
    RAISE EXCEPTION 'O saldo diz % mas so ha % em lote. Faca um inventario antes de dar saida.',
      v_antes, p_quantidade - v_restante USING ERRCODE='22023';
  END IF;

  INSERT INTO public.movimentacoes_estoque (material_id, tipo, quantidade, unidade,
    custo_unitario_snapshot, usuario_id, origem, motivo, observacao)
  VALUES (p_material_id, 'saida', p_quantidade, v_mat.unidade,
    COALESCE(v_mat.custo_medio, v_mat.custo_unitario, 0), v_uid, 'manual', p_motivo, p_observacao);

  RETURN jsonb_build_object('material_id', p_material_id, 'saldo_anterior', v_antes,
    'saldo_atual', (SELECT estoque FROM public.materiais WHERE id = p_material_id),
    'quantidade', p_quantidade);
END $f$;

REVOKE ALL ON FUNCTION public.registrar_saida_material(uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_saida_material(uuid,numeric,text,text) TO authenticated;


-- ------------------------------------------------- 5. quem não tem login sai
-- Função de gatilho nasce com EXECUTE para PUBLIC no Postgres. Estas três
-- mexem em saldo e em custo de OS e estavam chamáveis por `anon`. Não têm
-- `require_permission` porque gatilho não deve ter — o que não pode é alguém
-- chamar direto.
REVOKE ALL ON FUNCTION public.tg_lote_recalcular_estoque() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_perda_vira_custo_da_os() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_perda_custo_do_material() FROM PUBLIC, anon, authenticated;

-- Estas duas têm guarda por dentro, então `anon` levaria 42501 — mas conceder
-- EXECUTE a quem não tem login é rede de uma camada só.
REVOKE ALL ON FUNCTION public.registrar_entrada_material(uuid,numeric,numeric,text,text,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_material(uuid,numeric,numeric,text,text,date,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ajustar_estoque_material(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_estoque_material(uuid,numeric,text) TO authenticated;

-- ENSAIADO, tudo com reversão, no material real (Lona 440g, 44 m²):
--   UPDATE direto no saldo          -> recusado, com o caminho certo na mensagem
--   entrada de 10                   -> 54  (antes daria 10: 44 apagados)
--   inventário contando 50          -> 50  (antes não mudava nada)
--   saída de 4                      -> 40, com movimentação registrada
--   saída sem motivo                -> recusada
--   saída além do saldo             -> recusada, dizendo quanto há
--   material novo cadastrado com 44 -> nasce com lote; comprar 10 dá 54
