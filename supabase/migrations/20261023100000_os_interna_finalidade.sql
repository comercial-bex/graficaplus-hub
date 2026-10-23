-- OS interna: amostra, vitrine, mostruário, uso interno e reposição (23/10/2026).
--
-- Pedido do dono: imprimir um banner de amostra para vendas futuras, um brinquedo
-- 3D de vitrine, gravar um copo na fiber para o mostruário. Trabalho que usa
-- máquina, material e hora de gente, mas não tem cliente nem receita. Até aqui
-- só entrava como venda para um cliente fictício — o que gerava conta a receber,
-- aviso e pesquisa de pós-venda que não deviam existir, e o custo não aparecia
-- como o que é. Decisão do dono: TODOS abrem OS interna.
--
-- `finalidade` diz o que a OS é; o resto do sistema continua igual (material
-- previsto, reserva, baixa, agenda de máquina, apontamento, custo real, quadro):
--   venda        padrão — tudo como sempre
--   mostruario   amostra, vitrine, mostruário (guarda onde está)
--   uso_interno  placa da gráfica, uniforme, teste de máquina
--   reposicao    refazer peça perdida ou com defeito (liga à OS de origem)
-- Para finalidade <> venda não há aviso ao cliente, nem pesquisa de pós-venda,
-- nem automação de evento da OS. Conta a receber nunca nasce (valor 0 e a
-- criação não passa pela conversão de orçamento).
--
-- A OS interna pertence a um cliente da casa ("Bex Print (interno)"), porque
-- `ordens_servico.cliente_id` é obrigatório e as telas esperam um cliente. O
-- telefone dele é um número válido de mentira (96 90000-0000): o cadastro exige
-- WhatsApp, e nada é enviado para ele — as travas acima impedem.

-- 1. Colunas -----------------------------------------------------------------------
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS interno boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.clientes.interno IS 'O cliente da casa: dono das OS internas (mostruário, uso interno, reposição). Nunca recebe mensagem.';

ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS finalidade text NOT NULL DEFAULT 'venda',
  ADD COLUMN IF NOT EXISTS local_mostruario text,
  ADD COLUMN IF NOT EXISTS motivo_interno text,
  ADD COLUMN IF NOT EXISTS os_origem_id uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL;
ALTER TABLE public.ordens_servico DROP CONSTRAINT IF EXISTS ordens_servico_finalidade_check;
ALTER TABLE public.ordens_servico
  ADD CONSTRAINT ordens_servico_finalidade_check CHECK (finalidade IN ('venda', 'mostruario', 'uso_interno', 'reposicao'));
CREATE INDEX IF NOT EXISTS ix_ordens_servico_os_origem ON public.ordens_servico (os_origem_id) WHERE os_origem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ordens_servico_finalidade ON public.ordens_servico (finalidade) WHERE finalidade <> 'venda';

-- Leitura: as views grandes (_operacional/_comercial/_financeiro) não são recriadas
-- (recriar view descarta security_invoker/security_barrier). Uma view pequena só
-- com a finalidade, para quem é da equipe.
CREATE OR REPLACE VIEW public.os_finalidade_v AS
  SELECT o.id, o.finalidade, o.local_mostruario, o.motivo_interno, o.os_origem_id
    FROM public.ordens_servico o
   WHERE public.is_staff(auth.uid());
ALTER VIEW public.os_finalidade_v SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.os_finalidade_v FROM PUBLIC, anon;
GRANT SELECT ON public.os_finalidade_v TO authenticated;

-- 2. O cliente da casa -----------------------------------------------------------------
INSERT INTO public.clientes (nome, tipo, telefone, origem, ativo, interno)
SELECT 'Bex Print (interno)', 'pj', '96900000000', 'interno', true, true
 WHERE NOT EXISTS (SELECT 1 FROM public.clientes WHERE interno);

-- 3. O que uma OS que não é venda NÃO dispara -----------------------------------------
DO $m$
DECLARE
  v_def text;
  v_de text;
  v_para text;
  n int;
BEGIN
  -- aviso ao cliente
  v_def := pg_get_functiondef('public.tg_os_notificar_cliente'::regproc);
  v_de := E'v_evento := public.marco_notificavel_os(NEW.status);';
  v_para := E'IF NEW.finalidade <> ''venda'' THEN RETURN NEW; END IF;\n  v_evento := public.marco_notificavel_os(NEW.status);';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'tg_os_notificar_cliente: âncora % vezes (esperado 1)', n; END IF;
  EXECUTE replace(v_def, v_de, v_para);

  -- pesquisa de pós-venda (gatilho)
  v_def := pg_get_functiondef('public.trg_os_pos_venda'::regproc);
  v_de := 'AND NEW.cliente_id IS NOT NULL';
  v_para := 'AND NEW.cliente_id IS NOT NULL AND NEW.finalidade = ''venda''';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'trg_os_pos_venda: âncora % vezes (esperado 1)', n; END IF;
  EXECUTE replace(v_def, v_de, v_para);

  -- automação por evento da OS
  v_def := pg_get_functiondef('public.tg_automacao_os_eventos'::regproc);
  v_de := 'v_contexto := public.automacao_contexto_os(NEW);';
  v_para := E'IF NEW.finalidade <> ''venda'' THEN RETURN NEW; END IF;\n  v_contexto := public.automacao_contexto_os(NEW);';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'tg_automacao_os_eventos: âncora % vezes (esperado 1)', n; END IF;
  EXECUTE replace(v_def, v_de, v_para);

  -- pesquisa de pós-venda no fechamento
  v_def := pg_get_functiondef('public.fechar_os'::regproc);
  v_de := 'INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);';
  v_para := E'IF (SELECT o4.finalidade FROM public.ordens_servico o4 WHERE o4.id = fechar_os.os_id) = ''venda'' THEN\n    INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);\n  END IF;';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'fechar_os: âncora % vezes (esperado 1)', n; END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 4. Abrir a OS interna -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_os_interna(
  p_finalidade text, p_titulo text, p_produto_id uuid, p_quantidade numeric,
  p_motivo text, p_largura numeric DEFAULT NULL, p_altura numeric DEFAULT NULL,
  p_local text DEFAULT NULL, p_os_origem uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_casa uuid;
  v_prod public.produtos%ROWTYPE;
  v_os uuid;
  v_numero int;
  v_item uuid;
  v_area numeric;
  v_qtd numeric := greatest(coalesce(p_quantidade, 1), 1);
  v_custo numeric;
  v_reserva jsonb;
  v_agenda jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Só a equipe abre OS interna.' USING ERRCODE = '42501';
  END IF;
  IF p_finalidade NOT IN ('mostruario', 'uso_interno', 'reposicao') THEN
    RAISE EXCEPTION 'Finalidade inválida: use mostruário, uso interno ou reposição.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_titulo), '') = '' THEN RAISE EXCEPTION 'Dê um nome ao trabalho.' USING ERRCODE = '22023'; END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN RAISE EXCEPTION 'Diga para que é este trabalho (o motivo fica no registro).' USING ERRCODE = '22023'; END IF;
  IF p_finalidade = 'reposicao' AND p_os_origem IS NULL THEN
    RAISE EXCEPTION 'Reposição precisa da OS que está sendo refeita.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um produto do catálogo (ativo).' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_casa FROM public.clientes WHERE interno ORDER BY created_at LIMIT 1;
  IF v_casa IS NULL THEN RAISE EXCEPTION 'O cliente da casa não existe. Avise o administrador.'; END IF;

  v_area := CASE WHEN coalesce(p_largura, 0) > 0 AND coalesce(p_altura, 0) > 0
                 THEN greatest(round(p_largura * p_altura, 3), coalesce(v_prod.area_minima_cobrada, 0)) END;
  -- Custo previsto do item: custo do produto (por m² se vendido por área).
  v_custo := round(coalesce(v_prod.custo_medio, 0) * coalesce(v_area, 1), 2);

  INSERT INTO public.ordens_servico
    (cliente_id, titulo, briefing, valor_total, custo_previsto, status_geral, finalidade,
     local_mostruario, motivo_interno, os_origem_id, responsavel_id, created_by,
     precisa_entrega, precisa_instalacao)
  VALUES (v_casa, btrim(p_titulo), btrim(p_motivo), 0, v_custo * v_qtd, 'entrada', p_finalidade,
          nullif(btrim(p_local), ''), btrim(p_motivo), p_os_origem, v_uid, v_uid, false, false)
  RETURNING id, numero INTO v_os, v_numero;

  INSERT INTO public.itens_os
    (os_id, produto_id, descricao, quantidade, unidade, valor_unitario, custo_unitario,
     largura, altura, area_minima, ordem)
  VALUES (v_os, v_prod.id, v_prod.nome, v_qtd, v_prod.unidade, 0, v_custo,
          CASE WHEN v_area IS NOT NULL THEN p_largura END, CASE WHEN v_area IS NOT NULL THEN p_altura END,
          v_prod.area_minima_cobrada, 0)
  RETURNING id INTO v_item;

  -- Material previsto nasce do item (gatilho); aqui a reserva e a agenda, como na
  -- conversão. Acessórios: a OS existe mesmo que a agenda não ache horário.
  v_reserva := public.reservar_materiais_os_interno(v_os, v_uid);
  BEGIN
    v_agenda := public.agendar_os_interno(v_os);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'OS interna %: não deu para agendar a máquina: %', v_numero, SQLERRM;
    v_agenda := jsonb_build_object('erro', SQLERRM);
  END;

  RETURN jsonb_build_object('os_id', v_os, 'numero', v_numero, 'reserva', v_reserva, 'agenda', v_agenda);
END $function$;
COMMENT ON FUNCTION public.criar_os_interna(text, text, uuid, numeric, text, numeric, numeric, text, uuid) IS
  'Abre uma OS interna (mostruário, uso interno, reposição) para o cliente da casa: material previsto e reservado, máquina agendada, sem conta a receber, aviso nem pós-venda. Qualquer pessoa da equipe.';
REVOKE ALL ON FUNCTION public.criar_os_interna(text, text, uuid, numeric, text, numeric, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_os_interna(text, text, uuid, numeric, text, numeric, numeric, text, uuid) TO authenticated;
