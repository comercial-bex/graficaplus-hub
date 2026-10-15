-- Reembolso (15/10/2026).
--
-- Pedido do dono: "o colaborador foi lá e comprou algo, precisa de reembolso.
-- Só que eu tenho que vincular a quem foi comprado — que projeto, fachada,
-- letra caixa, impressão… Senão a pessoa pede um reembolso de uma sacola de
-- R$ 15 sendo que, pelo mesmo produto, eu ganhei só centavos." Decisões dele:
--   - aprovação por SEMÁFORO: a OS continua com a margem mínima da casa (20%)
--     → o financeiro aprova; aperta a margem, dá prejuízo ou o custo da OS é
--     desconhecido → a gerência aprova (prejuízo exige motivo);
--   - o colaborador recebe TODA SEXTA: os aprovados da semana viram uma conta a
--     pagar por pessoa, com vencimento na sexta;
--   - a foto do cupom/nota é SEMPRE obrigatória.
--
-- Todo gasto tem dono: uma OS (e por ela um produto e um cliente) ou a
-- empresa. O reembolso aprovado de uma OS vira custo real dela
-- (custos_operacionais_os, origem 'reembolso') — a margem real cai na hora e
-- o produto acumula o histórico (vw_reembolsos_por_produto), que é de onde o
-- preço aprende. Despesa da empresa (café, limpeza) não entra em OS.
--
-- Achado que justifica o amarelo de "custo desconhecido": em 15/10 quatro das
-- nove OS abertas tinham custo previsto zero (produto sem ficha técnica) e a
-- tela dizia "margem 100%" — qualquer reembolso pareceria compensar.

-- 0. As chaves --------------------------------------------------------------
INSERT INTO public.permissoes (chave, dominio, descricao) VALUES
  ('reembolsos.request', 'reembolsos',
   'Pedir reembolso de uma compra feita para a gráfica, com a foto do comprovante, dizendo para qual OS foi'),
  ('reembolsos.pay', 'reembolsos',
   'Aprovar o reembolso que não aperta a margem da OS (verde) ou de despesa da empresa, e acompanhar o pagamento de sexta'),
  ('reembolsos.approve', 'reembolsos',
   'Aprovar ou recusar qualquer reembolso, inclusive o que aperta a margem da OS, a deixa no prejuízo ou cai em OS de custo desconhecido')
ON CONFLICT (chave) DO UPDATE SET dominio = EXCLUDED.dominio, descricao = EXCLUDED.descricao;

INSERT INTO public.perfil_permissoes (perfil, permissao) VALUES
  ('admin', 'reembolsos.request'), ('gestor', 'reembolsos.request'), ('financeiro', 'reembolsos.request'),
  ('vendedor', 'reembolsos.request'), ('designer', 'reembolsos.request'), ('operador', 'reembolsos.request'),
  ('estoque', 'reembolsos.request'), ('instalador', 'reembolsos.request'),
  ('admin', 'reembolsos.pay'), ('financeiro', 'reembolsos.pay'),
  ('admin', 'reembolsos.approve'), ('gestor', 'reembolsos.approve')
ON CONFLICT (perfil, permissao) DO NOTHING;

-- 1. A tabela ----------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.reembolsos_numero_seq;

CREATE TABLE IF NOT EXISTS public.reembolsos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL DEFAULT nextval('public.reembolsos_numero_seq') UNIQUE,
  solicitante_id uuid NOT NULL REFERENCES public.usuarios(id),
  valor numeric(12,2) NOT NULL CHECK (valor > 0),
  descricao text NOT NULL CHECK (btrim(descricao) <> ''),
  fornecedor text,
  data_compra date NOT NULL,
  categoria text NOT NULL CHECK (categoria IN
    ('material', 'embalagem', 'acabamento', 'logistica', 'terceiros', 'retrabalho', 'despesa_geral')),
  destino text NOT NULL CHECK (destino IN ('os', 'empresa')),
  os_id uuid REFERENCES public.ordens_servico(id),
  os_item_id uuid REFERENCES public.itens_os(id),
  comprovante_path text NOT NULL,
  status text NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando', 'aprovado', 'recusado', 'pago', 'cancelado')),
  cor text NOT NULL CHECK (cor IN ('verde', 'amarelo', 'vermelho', 'empresa')),
  depois_do_fechamento boolean NOT NULL DEFAULT false,
  decidido_por uuid REFERENCES public.usuarios(id),
  decidido_em timestamptz,
  motivo_decisao text,
  conta_pagar_id uuid REFERENCES public.contas_pagar(id),
  custo_os_id uuid REFERENCES public.custos_operacionais_os(id),
  pago_em date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reembolso_destino_coerente CHECK ((destino = 'os') = (os_id IS NOT NULL)),
  CONSTRAINT reembolso_empresa_e_despesa_geral CHECK ((destino = 'empresa') = (categoria = 'despesa_geral'))
);
ALTER SEQUENCE public.reembolsos_numero_seq OWNED BY public.reembolsos.numero;

COMMENT ON TABLE public.reembolsos IS
  'Compra feita por alguém da equipe para a gráfica, com foto do comprovante, ligada à OS (custo real dela) ou à empresa. Só se escreve pelas funções reembolso_*.';

CREATE INDEX IF NOT EXISTS reembolsos_solicitante_idx ON public.reembolsos (solicitante_id);
CREATE INDEX IF NOT EXISTS reembolsos_os_idx ON public.reembolsos (os_id);
CREATE INDEX IF NOT EXISTS reembolsos_status_idx ON public.reembolsos (status);
CREATE INDEX IF NOT EXISTS reembolsos_conta_idx ON public.reembolsos (conta_pagar_id);

DROP TRIGGER IF EXISTS tg_reembolsos_updated ON public.reembolsos;
CREATE TRIGGER tg_reembolsos_updated BEFORE UPDATE ON public.reembolsos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.reembolsos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reembolso: quem pediu ou quem decide le" ON public.reembolsos;
CREATE POLICY "reembolso: quem pediu ou quem decide le" ON public.reembolsos
  FOR SELECT TO authenticated
  USING (
    solicitante_id = (SELECT auth.uid())
    OR public.has_permission((SELECT auth.uid()), 'reembolsos.approve')
    OR public.has_permission((SELECT auth.uid()), 'reembolsos.pay')
  );
-- Nenhuma escrita direta: só as funções abaixo.
REVOKE ALL ON public.reembolsos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reembolsos TO authenticated;
GRANT ALL ON public.reembolsos TO service_role;
REVOKE ALL ON SEQUENCE public.reembolsos_numero_seq FROM PUBLIC, anon, authenticated;

-- 2. O semáforo ----------------------------------------------------------------
-- A conta é a do resultado da OS: venda líquida contra o custo — o maior entre
-- o previsto e o já lançado sem reembolsos, MAIS os reembolsos aprovados, MAIS
-- os ainda em análise da mesma OS que chegaram ANTES deste (dois "verdes"
-- juntos podem ser um vermelho — e é o segundo que fica amarelo, não o
-- primeiro: ordem de chegada; o ensaio de 15/10 pegou a sacola de R$ 15
-- virando amarelo por causa da fita pedida depois).
CREATE OR REPLACE FUNCTION public.reembolso_semaforo(p_os_id uuid, p_valor numeric, p_ignorar uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_os public.ordens_servico%ROWTYPE;
  v_venda numeric := 0;
  v_previsto numeric := 0;
  v_lancado numeric := 0;
  v_reembolsado numeric := 0;
  v_pendente numeric := 0;
  v_custo numeric;
  v_depois numeric;
  v_margem_depois numeric;
  v_cor text;
  v_motivo text;
  v_ve_numeros boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para consultar o reembolso.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.'; END IF;

  SELECT coalesce(r.receita_liquida, 0), coalesce(r.custo_previsto, 0), coalesce(r.custo_realizado, 0)
    INTO v_venda, v_previsto, v_lancado
    FROM public.vw_resultado_os r WHERE r.os_id = p_os_id;
  SELECT coalesce(sum(valor), 0) INTO v_pendente
    FROM public.reembolsos
   WHERE os_id = p_os_id AND status = 'aguardando' AND id IS DISTINCT FROM p_ignorar
     AND (p_ignorar IS NULL
          OR created_at < (SELECT r0.created_at FROM public.reembolsos r0 WHERE r0.id = p_ignorar)
          OR (created_at = (SELECT r0.created_at FROM public.reembolsos r0 WHERE r0.id = p_ignorar)
              AND numero < (SELECT r0.numero FROM public.reembolsos r0 WHERE r0.id = p_ignorar)));

  -- Reembolso é gasto FORA do previsto: soma ao previsto, nunca some atrás dele.
  -- (O ensaio de 15/10 pegou o "maior entre previsto e lançado" escondendo a
  -- sacola aprovada atrás dos R$ 534,95 previstos — e a fita passava verde.)
  SELECT coalesce(sum(total), 0) INTO v_reembolsado
    FROM public.custos_operacionais_os WHERE os_id = p_os_id AND origem = 'reembolso';
  v_custo := greatest(coalesce(v_previsto, 0), coalesce(v_lancado, 0) - v_reembolsado)
             + v_reembolsado + v_pendente;
  v_depois := v_custo + coalesce(p_valor, 0);

  IF coalesce(v_venda, 0) <= 0 THEN
    v_cor := 'vermelho';
    v_motivo := 'A OS não tem valor de venda: todo gasto nela é prejuízo.';
  ELSIF coalesce(v_previsto, 0) <= 0 AND coalesce(v_lancado, 0) - v_reembolsado <= 0 THEN
    v_cor := 'amarelo';
    v_motivo := 'O custo desta OS é desconhecido (produto sem ficha técnica): não dá para saber se compensa. A gerência decide.';
  ELSE
    v_margem_depois := (v_venda - v_depois) / v_venda;
    IF v_margem_depois < 0 THEN
      v_cor := 'vermelho';
      v_motivo := 'Com este reembolso a OS dá prejuízo. A gerência decide, com motivo.';
    ELSIF v_margem_depois < 0.20 THEN
      v_cor := 'amarelo';
      v_motivo := 'Com este reembolso a OS fica abaixo da margem mínima da casa (20%). A gerência decide.';
    ELSE
      v_cor := 'verde';
      v_motivo := 'A OS continua com a margem mínima da casa. O financeiro aprova.';
    END IF;
  END IF;

  -- Margem é custo disfarçado: os números só para quem decide ou vê o financeiro.
  v_ve_numeros := public.has_permission(v_uid, 'reembolsos.approve')
               OR public.has_permission(v_uid, 'reembolsos.pay')
               OR public.can_see_financials(v_uid);

  RETURN jsonb_build_object(
      'cor', v_cor,
      'motivo', v_motivo,
      'quem_aprova', CASE WHEN v_cor = 'verde' THEN 'financeiro' ELSE 'gerencia' END,
      'os_fechada', v_os.status IN ('concluido', 'faturado'))
    || CASE WHEN v_ve_numeros THEN jsonb_build_object(
      'venda', v_venda,
      'custo_antes', v_custo,
      'custo_depois', v_depois,
      'pendentes', v_pendente,
      'reembolsado', v_reembolsado,
      'custo_conhecido', NOT (coalesce(v_previsto, 0) <= 0 AND coalesce(v_lancado, 0) - v_reembolsado <= 0),
      'margem_antes', CASE WHEN v_venda > 0 THEN round((v_venda - v_custo) / v_venda * 100, 1) END,
      'margem_depois', CASE WHEN v_venda > 0 THEN round((v_venda - v_depois) / v_venda * 100, 1) END)
    ELSE '{}'::jsonb END;
END $function$;
COMMENT ON FUNCTION public.reembolso_semaforo(uuid, numeric, uuid) IS
  'Semáforo do reembolso numa OS: verde (continua com 20% de margem), amarelo (abaixo de 20% ou custo desconhecido), vermelho (prejuízo). Números só para quem decide.';

-- 3. Pedir -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reembolso_pedir(
  p_valor numeric,
  p_descricao text,
  p_data_compra date,
  p_categoria text,
  p_destino text,
  p_comprovante_path text,
  p_os_id uuid DEFAULT NULL,
  p_os_item_id uuid DEFAULT NULL,
  p_fornecedor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_os public.ordens_servico%ROWTYPE;
  v_semaforo jsonb := '{}'::jsonb;
  v_cor text;
  v_id uuid;
  v_numero int;
  v_repetido int;
BEGIN
  v_uid := public.require_permission('reembolsos.request');

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe o valor que você pagou.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_descricao), '') = '' THEN
    RAISE EXCEPTION 'Diga o que foi comprado.' USING ERRCODE = '22023';
  END IF;
  IF p_data_compra IS NULL OR p_data_compra > v_hoje THEN
    RAISE EXCEPTION 'A data da compra não pode ser depois de hoje.' USING ERRCODE = '22023';
  END IF;
  -- Foto sempre obrigatória (decisão do dono), e da pasta de quem pede.
  IF coalesce(p_comprovante_path, '') !~ ('^reembolsos/' || v_uid::text || '/') THEN
    RAISE EXCEPTION 'Anexe a foto do cupom ou da nota: sem comprovante não há reembolso.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'arquivos-clientes' AND name = p_comprovante_path) THEN
    RAISE EXCEPTION 'A foto do comprovante não chegou. Envie de novo.' USING ERRCODE = '22023';
  END IF;

  IF p_destino = 'os' THEN
    IF p_os_id IS NULL THEN
      RAISE EXCEPTION 'Escolha a OS para a qual a compra foi feita.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.'; END IF;
    IF v_os.status = 'cancelado' THEN
      RAISE EXCEPTION 'A OS nº % foi cancelada: a compra não pode ir para ela.', v_os.numero;
    END IF;
    IF p_os_item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.itens_os WHERE id = p_os_item_id AND os_id = p_os_id) THEN
      RAISE EXCEPTION 'O item escolhido não é desta OS.';
    END IF;
    IF p_categoria NOT IN ('material', 'embalagem', 'acabamento', 'logistica', 'terceiros', 'retrabalho') THEN
      RAISE EXCEPTION 'Categoria inválida para compra de OS.' USING ERRCODE = '22023';
    END IF;
    v_semaforo := public.reembolso_semaforo(p_os_id, p_valor);
    v_cor := v_semaforo->>'cor';
  ELSIF p_destino = 'empresa' THEN
    IF p_os_id IS NOT NULL THEN
      RAISE EXCEPTION 'Despesa da empresa não vai para OS.' USING ERRCODE = '22023';
    END IF;
    v_cor := 'empresa';
  ELSE
    RAISE EXCEPTION 'Diga para onde foi a compra: uma OS ou a empresa.' USING ERRCODE = '22023';
  END IF;

  -- O mesmo cupom duas vezes paga em dobro.
  SELECT numero INTO v_repetido FROM public.reembolsos
   WHERE solicitante_id = v_uid AND valor = round(p_valor, 2) AND data_compra = p_data_compra
     AND status NOT IN ('recusado', 'cancelado')
     AND os_id IS NOT DISTINCT FROM p_os_id
   LIMIT 1;
  IF v_repetido IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe o reembolso nº % com o mesmo valor, data e destino. Se é outra compra, ajuste a descrição e a data do cupom.', v_repetido;
  END IF;

  INSERT INTO public.reembolsos (
    solicitante_id, valor, descricao, fornecedor, data_compra, categoria, destino,
    os_id, os_item_id, comprovante_path, cor, depois_do_fechamento)
  VALUES (
    v_uid, round(p_valor, 2), btrim(p_descricao), nullif(btrim(coalesce(p_fornecedor, '')), ''), p_data_compra,
    CASE WHEN p_destino = 'empresa' THEN 'despesa_geral' ELSE p_categoria END, p_destino,
    p_os_id, p_os_item_id, p_comprovante_path, v_cor,
    p_destino = 'os' AND v_os.status IN ('concluido', 'faturado'))
  RETURNING id, numero INTO v_id, v_numero;

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero, 'cor', v_cor,
    'quem_aprova', CASE WHEN v_cor IN ('verde', 'empresa') THEN 'financeiro' ELSE 'gerencia' END,
    'motivo', coalesce(v_semaforo->>'motivo', 'Despesa da empresa: o financeiro aprova.'));
END $function$;

-- 4. Decidir -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reembolso_decidir(p_id uuid, p_aprovar boolean, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.reembolsos%ROWTYPE;
  v_aprova_tudo boolean;
  v_aprova_verde boolean;
  v_cor text;
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_sexta date;
  v_nome text;
  v_conta uuid;
  v_custo uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para decidir reembolso.' USING ERRCODE = '42501';
  END IF;
  v_aprova_tudo := public.has_permission(v_uid, 'reembolsos.approve');
  v_aprova_verde := public.has_permission(v_uid, 'reembolsos.pay');
  IF NOT (v_aprova_tudo OR v_aprova_verde) THEN
    RAISE EXCEPTION 'Seu perfil não decide reembolsos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_r FROM public.reembolsos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reembolso não encontrado.'; END IF;
  IF v_r.status <> 'aguardando' THEN
    RAISE EXCEPTION 'O reembolso nº % já foi decidido (%).', v_r.numero, v_r.status;
  END IF;
  IF v_r.solicitante_id = v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Quem pediu não aprova o próprio reembolso.' USING ERRCODE = '42501';
  END IF;

  -- A cor de agora: o custo da OS pode ter mudado desde o pedido.
  v_cor := CASE WHEN v_r.destino = 'os'
                THEN public.reembolso_semaforo(v_r.os_id, v_r.valor, v_r.id)->>'cor'
                ELSE 'empresa' END;
  IF v_cor IN ('amarelo', 'vermelho') AND NOT v_aprova_tudo THEN
    RAISE EXCEPTION 'Este reembolso aperta a margem da OS (%): quem decide é a gerência.', v_cor USING ERRCODE = '42501';
  END IF;
  IF (NOT p_aprovar OR v_cor = 'vermelho') AND coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Escreva o motivo da decisão.' USING ERRCODE = '22023';
  END IF;

  IF NOT p_aprovar THEN
    UPDATE public.reembolsos
       SET status = 'recusado', cor = v_cor, decidido_por = v_uid, decidido_em = now(),
           motivo_decisao = btrim(p_motivo)
     WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id, 'status', 'recusado', 'cor', v_cor);
  END IF;

  -- Custo real da OS: a margem real cai na hora, e o produto acumula o histórico.
  IF v_r.destino = 'os' THEN
    INSERT INTO public.custos_operacionais_os
      (os_id, os_item_id, categoria, origem, quantidade, valor_unitario, data, usuario_id)
    VALUES (v_r.os_id, v_r.os_item_id,
            CASE v_r.categoria WHEN 'embalagem' THEN 'material' ELSE v_r.categoria END,
            'reembolso', 1, v_r.valor, (v_r.data_compra::timestamp AT TIME ZONE 'America/Belem'),
            v_r.solicitante_id)
    RETURNING id INTO v_custo;
  END IF;

  -- A conta a pagar da sexta, uma por pessoa: os aprovados da semana somam nela.
  v_sexta := v_hoje + ((5 - extract(isodow FROM v_hoje)::int + 7) % 7);
  SELECT btrim(nome) INTO v_nome FROM public.usuarios WHERE id = v_r.solicitante_id;
  SELECT cp.id INTO v_conta
    FROM public.contas_pagar cp
   WHERE cp.status = 'aberta' AND cp.categoria = 'reembolso' AND cp.vencimento = v_sexta
     AND EXISTS (SELECT 1 FROM public.reembolsos r WHERE r.conta_pagar_id = cp.id AND r.solicitante_id = v_r.solicitante_id)
   LIMIT 1
   FOR UPDATE;
  IF v_conta IS NULL THEN
    INSERT INTO public.contas_pagar (descricao, fornecedor, categoria, valor, vencimento, status, created_by, observacoes)
    VALUES ('Reembolsos de ' || coalesce(v_nome, 'colaborador') || ' — sexta ' || to_char(v_sexta, 'DD/MM'),
            coalesce(v_nome, 'colaborador'), 'reembolso', v_r.valor, v_sexta, 'aberta', v_uid,
            'Soma dos reembolsos aprovados da semana. Detalhe em Financeiro › Reembolsos.')
    RETURNING id INTO v_conta;
  ELSE
    UPDATE public.contas_pagar SET valor = valor + v_r.valor WHERE id = v_conta;
  END IF;

  UPDATE public.reembolsos
     SET status = 'aprovado', cor = v_cor, decidido_por = v_uid, decidido_em = now(),
         motivo_decisao = nullif(btrim(coalesce(p_motivo, '')), ''),
         conta_pagar_id = v_conta, custo_os_id = v_custo
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'aprovado', 'cor', v_cor,
                            'conta_pagar_id', v_conta, 'vence', v_sexta);
END $function$;

-- 5. Cancelar (quem pediu, antes da decisão) ------------------------------------
CREATE OR REPLACE FUNCTION public.reembolso_cancelar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  UPDATE public.reembolsos SET status = 'cancelado'
   WHERE id = p_id AND solicitante_id = v_uid AND status = 'aguardando';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Só quem pediu cancela, e só enquanto ninguém decidiu.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelado');
END $function$;

REVOKE ALL ON FUNCTION public.reembolso_semaforo(uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reembolso_pedir(numeric, text, date, text, text, text, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reembolso_decidir(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reembolso_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reembolso_semaforo(uuid, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reembolso_pedir(numeric, text, date, text, text, text, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reembolso_decidir(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reembolso_cancelar(uuid) TO authenticated, service_role;

-- 6. Conta da sexta paga → reembolsos pagos ---------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reembolso_pago_com_a_conta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paga' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.reembolsos
       SET status = 'pago', pago_em = coalesce(NEW.data_pagamento, (now() AT TIME ZONE 'America/Belem')::date)
     WHERE conta_pagar_id = NEW.id AND status = 'aprovado';
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.tg_reembolso_pago_com_a_conta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_reembolso_pago_com_a_conta ON public.contas_pagar;
CREATE TRIGGER tg_reembolso_pago_com_a_conta
  AFTER UPDATE OF status ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.tg_reembolso_pago_com_a_conta();

-- 7. A foto do comprovante -----------------------------------------------------------
-- reembolsos/<quem pediu>/<instante>_<arquivo>, no bucket arquivos-clientes.
DROP POLICY IF EXISTS "reembolso: quem pede envia o comprovante" ON storage.objects;
CREATE POLICY "reembolso: quem pede envia o comprovante" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'arquivos-clientes'
    AND (storage.foldername(name))[1] = 'reembolsos'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND public.has_permission((SELECT auth.uid()), 'reembolsos.request')
  );
DROP POLICY IF EXISTS "reembolso: quem pediu ou quem decide ve o comprovante" ON storage.objects;
CREATE POLICY "reembolso: quem pediu ou quem decide ve o comprovante" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'arquivos-clientes'
    AND (storage.foldername(name))[1] = 'reembolsos'
    AND ((storage.foldername(name))[2] = (SELECT auth.uid())::text
         OR public.has_permission((SELECT auth.uid()), 'reembolsos.approve')
         OR public.has_permission((SELECT auth.uid()), 'reembolsos.pay'))
  );

-- 8. O que o produto ensina ------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_reembolsos_por_produto
WITH (security_invoker = true) AS
 SELECT coalesce(nullif(btrim(p.nome), ''), nullif(btrim(i.descricao), ''), 'Sem produto') AS produto,
        r.categoria,
        count(*)::int AS reembolsos,
        count(DISTINCT r.os_id)::int AS os,
        sum(r.valor) AS total,
        round(avg(r.valor), 2) AS media
   FROM public.reembolsos r
   LEFT JOIN public.itens_os i ON i.id = coalesce(r.os_item_id,
        (SELECT i2.id FROM public.itens_os i2 WHERE i2.os_id = r.os_id ORDER BY i2.ordem, i2.id LIMIT 1))
   LEFT JOIN public.produtos p ON p.id = i.produto_id
  WHERE r.destino = 'os' AND r.status IN ('aprovado', 'pago')
  GROUP BY 1, 2;
COMMENT ON VIEW public.vw_reembolsos_por_produto IS
  'Quanto cada produto gerou de compra por fora (reembolso aprovado): o custo que a ficha técnica e o preço ainda não carregam.';
REVOKE ALL ON public.vw_reembolsos_por_produto FROM PUBLIC, anon;
GRANT SELECT ON public.vw_reembolsos_por_produto TO authenticated;

-- 9. Pendências do painel -------------------------------------------------------------
DO $pend$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_de text := E'\n\n  -- Portal do cliente: o que o cliente mandou';
  v_para text := E'\n\n'
    || E'  -- Reembolsos esperando decisão (15/10/2026): a gerência decide o que aperta\n'
    || E'  -- a margem da OS; o financeiro, o verde e a despesa da empresa.\n'
    || E'  RETURN QUERY SELECT ''reembolsos_para_a_gerencia'', ''Reembolsos que apertam a margem da OS esperando decisão'', count(*)::int,\n'
    || E'    NULL::int, CASE WHEN bool_or(r.cor = ''vermelho'') THEN ''critico'' ELSE ''atencao'' END, ''gestao'',\n'
    || E'    ''Pedidos de: '' || string_agg(DISTINCT u.nome, '', '') || ''. Abra Financeiro › Reembolsos, veja a margem antes e depois e decida.'',\n'
    || E'    ''/reembolsos''\n'
    || E'  FROM public.reembolsos r JOIN public.usuarios u ON u.id = r.solicitante_id\n'
    || E'  WHERE r.status = ''aguardando'' AND r.cor IN (''amarelo'', ''vermelho'')\n'
    || E'  HAVING count(*) > 0;\n'
    || E'\n'
    || E'  RETURN QUERY SELECT ''reembolsos_para_o_financeiro'', ''Reembolsos verdes e despesas da empresa esperando aprovação'', count(*)::int,\n'
    || E'    NULL::int, ''atencao'', ''financeiro'',\n'
    || E'    ''Pedidos de: '' || string_agg(DISTINCT u.nome, '', '') || ''. Confira a foto do comprovante em Financeiro › Reembolsos e aprove; o aprovado entra na conta da sexta.'',\n'
    || E'    ''/reembolsos''\n'
    || E'  FROM public.reembolsos r JOIN public.usuarios u ON u.id = r.solicitante_id\n'
    || E'  WHERE r.status = ''aguardando'' AND r.cor IN (''verde'', ''empresa'')\n'
    || E'  HAVING count(*) > 0;\n'
    || E'\n  -- Portal do cliente: o que o cliente mandou';
BEGIN
  IF position('reembolsos_para_a_gerencia' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'pendencias_do_sistema: o trecho do portal não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$pend$;

-- 10. Lembrete diário da gerência ---------------------------------------------------------
DO $lemb$
DECLARE
  v_def text := pg_get_functiondef('public.lembrete_orcamentos_aprovados_sem_os()'::regprocedure);
  v_de1 text := E'  v_wa_lista text;\n';
  v_para1 text := E'  v_wa_lista text;\n  v_re_qtd int;\n  v_re_lista text;\n';
  v_de2 text := E'  -- Silêncio quando nada está parado.\n  IF v_qtd = 0 AND v_os_qtd = 0 AND v_wa_qtd = 0 THEN';
  v_para2 text :=
       E'  -- Reembolsos que apertam a margem da OS esperando a gerência (15/10/2026).\n'
    || E'  SELECT count(*),\n'
    || E'         string_agg(format(''nº %s · %s · %s · %s'', r.numero, split_part(btrim(u.nome), '' '', 1),\n'
    || E'           left(r.descricao, 60), CASE r.cor WHEN ''vermelho'' THEN ''deixa a OS no prejuízo'' ELSE ''aperta a margem ou a OS não tem custo'' END),\n'
    || E'           E''\\n'' ORDER BY r.created_at)\n'
    || E'    INTO v_re_qtd, v_re_lista\n'
    || E'    FROM public.reembolsos r JOIN public.usuarios u ON u.id = r.solicitante_id\n'
    || E'   WHERE r.status = ''aguardando'' AND r.cor IN (''amarelo'', ''vermelho'');\n'
    || E'  v_re_qtd := coalesce(v_re_qtd, 0);\n\n'
    || E'  -- Silêncio quando nada está parado.\n  IF v_qtd = 0 AND v_os_qtd = 0 AND v_wa_qtd = 0 AND v_re_qtd = 0 THEN';
  v_de3 text := E'      v_wa_qtd, v_wa_lista) END\n  );';
  v_para3 text := E'      v_wa_qtd, v_wa_lista) END,\n'
    || E'    CASE WHEN v_re_qtd > 0 THEN format(\n'
    || E'      E''Reembolsos esperando sua decisão: %s.\\n%s\\nAbra Financeiro › Reembolsos: a tela mostra a margem da OS antes e depois.'',\n'
    || E'      v_re_qtd, v_re_lista) END\n  );';
BEGIN
  IF position('v_re_qtd' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de1, ''))) / length(v_de1) <> 1
     OR (length(v_def) - length(replace(v_def, v_de2, ''))) / length(v_de2) <> 1
     OR (length(v_def) - length(replace(v_def, v_de3, ''))) / length(v_de3) <> 1 THEN
    RAISE EXCEPTION 'lembrete_orcamentos_aprovados_sem_os: os trechos não estão como esperado; revise a troca';
  END IF;
  EXECUTE replace(replace(replace(v_def, v_de1, v_para1), v_de2, v_para2), v_de3, v_para3);
END
$lemb$;

-- 11. Lembrete diário do financeiro --------------------------------------------------------
DO $fin$
DECLARE
  v_def text := pg_get_functiondef('public.lembretes_da_equipe()'::regprocedure);
  v_de text := E'  -- 3. Comprovantes do portal para conferir.\n';
  v_para text :=
       E'  -- Reembolsos (15/10/2026): os verdes para aprovar e o total da sexta.\n'
    || E'  SELECT count(*), coalesce(sum(r.valor), 0),\n'
    || E'         string_agg(format(''nº %s · %s · %s · %s'', r.numero, split_part(btrim(u.nome), '' '', 1),\n'
    || E'           left(r.descricao, 60), public._reais(r.valor)), E''\\n'' ORDER BY r.created_at)\n'
    || E'    INTO v_qtd, v_total, v_lista\n'
    || E'    FROM public.reembolsos r JOIN public.usuarios u ON u.id = r.solicitante_id\n'
    || E'   WHERE r.status = ''aguardando'' AND r.cor IN (''verde'', ''empresa'');\n'
    || E'  IF v_qtd > 0 THEN\n'
    || E'    v_fin := concat_ws(E''\\n\\n'', nullif(v_fin, ''''), format(\n'
    || E'      E''Reembolsos para aprovar: %s, somando %s.\\n%s\\nConfira a foto do comprovante em Financeiro › Reembolsos.'',\n'
    || E'      v_qtd, public._reais(v_total), v_lista));\n'
    || E'    v_nfin := v_nfin + 1;\n'
    || E'  END IF;\n'
    || E'  SELECT count(*), coalesce(sum(cp.valor), 0),\n'
    || E'         string_agg(format(''%s · %s · vence %s'', cp.fornecedor, public._reais(cp.valor), to_char(cp.vencimento, ''DD/MM'')),\n'
    || E'           E''\\n'' ORDER BY cp.vencimento)\n'
    || E'    INTO v_qtd, v_total, v_lista\n'
    || E'    FROM public.contas_pagar cp\n'
    || E'   WHERE cp.categoria = ''reembolso'' AND cp.status = ''aberta'' AND cp.vencimento >= v_hoje;\n'
    || E'  IF v_qtd > 0 THEN\n'
    || E'    v_fin := concat_ws(E''\\n\\n'', nullif(v_fin, ''''), format(\n'
    || E'      E''Reembolsos aprovados a pagar: %s.\\n%s\\nPague em Caixa e contas a pagar; os reembolsos viram pagos sozinhos.'',\n'
    || E'      public._reais(v_total), v_lista));\n'
    || E'    v_nfin := v_nfin + 1;\n'
    || E'  END IF;\n\n'
    || E'  -- 3. Comprovantes do portal para conferir.\n';
BEGIN
  IF position('Reembolsos para aprovar' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'lembretes_da_equipe: o trecho dos comprovantes não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$fin$;
