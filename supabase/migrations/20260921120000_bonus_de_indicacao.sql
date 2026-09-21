-- Fase 2 do clube de revendedores: o bônus de indicação e o crédito de boas-vindas.
--
-- Números vindos do estudo de 20/09/2026 (artifact "Convite, Crédito e Rede"),
-- calculados sobre a margem real dos 21 produtos com preço e custo (57,8% em
-- média, mínima 51,1%):
--
--   indicação        1% das 3 primeiras compras PAGAS do indicado, teto R$ 50
--   boas-vindas      10% da 1ª compra paga, teto R$ 100, validade 60 dias
--   uso do crédito   paga no máximo 15% de cada pedido
--   níveis           um só: quem convidou ganha; quem convidou o convidador, não
--
-- Todos configuráveis em `parceiro_programa` — trocar 1% por 2% é UPDATE, não
-- deploy.
--
-- Por que 1% e não mais: no nível Diamante com faixa extra a margem já cai a
-- 28,9%, abaixo do piso de 34,5% configurado no catálogo. Empilhar mais bônus
-- em cima vende abaixo do custo real em alguns produtos.
--
-- Por que crédito e não dinheiro: crédito volta como compra, mantém o parceiro
-- dentro da gráfica e não cria pagamento a pessoa física.
--
-- O gatilho pendura no MESMO evento que já paga o cashback de nível —
-- `ordens_servico.status_financeiro` virando 'pago'. Cadastro nunca gera bônus:
-- é o que separa indicação comercial de pirâmide.
--
-- COMO DESFAZER:
--   drop trigger zz_parceiro_bonus_indicacao on public.ordens_servico;
--   drop function public.tg_parceiro_bonus_indicacao();
--   drop function public.parceiro_expirar_creditos(uuid);
--   drop table public.parceiro_programa;
--   alter table public.parceiro_creditos drop column expira_em, drop column origem_parceiro_id;
--   (as emendas em parceiro_painel e parceiro_enviar_pedido saem republicando
--    as versões anteriores dessas funções)

-- ----------------------------------------------------------- 1. o extrato
ALTER TABLE public.parceiro_creditos
  ADD COLUMN IF NOT EXISTS expira_em timestamptz,
  ADD COLUMN IF NOT EXISTS origem_parceiro_id uuid REFERENCES public.parceiros(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.parceiro_creditos.expira_em IS
  'Só em crédito ganho. Quando passa, parceiro_expirar_creditos() lança um estorno do que sobrou — o saldo segue sendo soma simples.';
COMMENT ON COLUMN public.parceiro_creditos.origem_parceiro_id IS
  'De qual parceiro veio este crédito. Em bônus de indicação é o INDICADO; é o que permite contar as 3 primeiras compras dele.';

ALTER TABLE public.parceiro_creditos DROP CONSTRAINT IF EXISTS parceiro_creditos_tipo_check;
ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_tipo_check
  CHECK (tipo = ANY (ARRAY['cashback','recompensa','uso','estorno_uso','ajuste',
                           'boas_vindas','indicacao','expirado']));

ALTER TABLE public.parceiro_creditos DROP CONSTRAINT IF EXISTS parceiro_creditos_check;
ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_check
  CHECK ((tipo <> ALL (ARRAY['cashback','recompensa','estorno_uso','boas_vindas','indicacao']))
         OR valor > 0);

ALTER TABLE public.parceiro_creditos DROP CONSTRAINT IF EXISTS parceiro_creditos_expirado_check;
ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_expirado_check
  CHECK (tipo <> 'expirado' OR valor < 0);

-- --------------------------------------------- 2. as regras, num lugar só
CREATE TABLE IF NOT EXISTS public.parceiro_programa (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  indicacao_ativa boolean NOT NULL DEFAULT true,
  indicacao_pct numeric NOT NULL DEFAULT 1 CHECK (indicacao_pct >= 0 AND indicacao_pct <= 100),
  indicacao_compras integer NOT NULL DEFAULT 3 CHECK (indicacao_compras > 0),
  indicacao_teto numeric NOT NULL DEFAULT 50 CHECK (indicacao_teto > 0),
  boas_vindas_ativa boolean NOT NULL DEFAULT true,
  boas_vindas_pct numeric NOT NULL DEFAULT 10 CHECK (boas_vindas_pct >= 0 AND boas_vindas_pct <= 100),
  boas_vindas_teto numeric NOT NULL DEFAULT 100 CHECK (boas_vindas_teto > 0),
  boas_vindas_validade_dias integer NOT NULL DEFAULT 60 CHECK (boas_vindas_validade_dias > 0),
  credito_max_pct_pedido numeric NOT NULL DEFAULT 15 CHECK (credito_max_pct_pedido > 0 AND credito_max_pct_pedido <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.parceiro_programa (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.parceiro_programa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "programa leitura equipe" ON public.parceiro_programa;
CREATE POLICY "programa leitura equipe" ON public.parceiro_programa FOR SELECT
  USING (public.has_permission(auth.uid(), 'parceiros.read'));

DROP POLICY IF EXISTS "programa escrita gestao" ON public.parceiro_programa;
CREATE POLICY "programa escrita gestao" ON public.parceiro_programa FOR UPDATE
  USING (public.has_permission(auth.uid(), 'parceiros.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'parceiros.manage'));

-- ------------------------------------------------------------ 3. o motor
CREATE OR REPLACE FUNCTION public.tg_parceiro_bonus_indicacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public.parceiro_programa%ROWTYPE;
  v_p public.parceiros%ROWTYPE;
  v_padrinho public.parceiros%ROWTYPE;
  v_total numeric := COALESCE(NEW.valor_total, 0);
  v_compras integer;
  v_ja_pago numeric;
  v_valor numeric;
BEGIN
  IF NEW.status_financeiro::text <> 'pago' OR OLD.status_financeiro::text = 'pago' THEN
    RETURN NEW;
  END IF;
  IF v_total <= 0 THEN RETURN NEW; END IF;

  SELECT * INTO v_cfg FROM public.parceiro_programa WHERE id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_p FROM public.parceiros WHERE cliente_id = NEW.cliente_id AND status = 'ativo';
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_compras
  FROM public.ordens_servico o
  WHERE o.cliente_id = NEW.cliente_id
    AND o.status_financeiro::text = 'pago'
    AND o.id <> NEW.id;

  -- Boas-vindas: só na 1ª compra paga e só para quem entrou por convite. É
  -- verba de aquisição, não de fidelidade — quem já era cliente não precisa
  -- ser atraído.
  IF v_cfg.boas_vindas_ativa AND v_compras = 0 AND v_p.indicado_por IS NOT NULL THEN
    v_valor := LEAST(round(v_total * v_cfg.boas_vindas_pct / 100, 2), v_cfg.boas_vindas_teto);
    IF v_valor > 0 THEN
      INSERT INTO public.parceiro_creditos
        (parceiro_id, tipo, valor, os_id, descricao, expira_em)
      VALUES (v_p.id, 'boas_vindas', v_valor, NEW.id,
              format('Boas-vindas: %s%% da primeira compra (OS nº %s). Use ate %s.',
                     v_cfg.boas_vindas_pct, NEW.numero,
                     to_char(now() + (v_cfg.boas_vindas_validade_dias || ' days')::interval, 'DD/MM/YYYY')),
              now() + (v_cfg.boas_vindas_validade_dias || ' days')::interval);
    END IF;
  END IF;

  -- Indicação: um nível só, e só nas N primeiras compras, com teto por indicado.
  IF v_cfg.indicacao_ativa AND v_p.indicado_por IS NOT NULL
     AND v_compras < v_cfg.indicacao_compras THEN
    SELECT * INTO v_padrinho FROM public.parceiros WHERE id = v_p.indicado_por AND status = 'ativo';
    IF FOUND THEN
      SELECT COALESCE(sum(valor), 0) INTO v_ja_pago
      FROM public.parceiro_creditos
      WHERE parceiro_id = v_padrinho.id AND tipo = 'indicacao' AND origem_parceiro_id = v_p.id;

      v_valor := LEAST(round(v_total * v_cfg.indicacao_pct / 100, 2),
                       GREATEST(v_cfg.indicacao_teto - v_ja_pago, 0));
      IF v_valor > 0 THEN
        INSERT INTO public.parceiro_creditos
          (parceiro_id, tipo, valor, os_id, origem_parceiro_id, descricao)
        VALUES (v_padrinho.id, 'indicacao', v_valor, NEW.id, v_p.id,
                format('Indicacao: %s%% da compra %s de %s de um indicado seu.',
                       v_cfg.indicacao_pct, v_compras + 1, v_cfg.indicacao_compras));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_parceiro_bonus_indicacao ON public.ordens_servico;
CREATE TRIGGER zz_parceiro_bonus_indicacao
  AFTER UPDATE OF status_financeiro ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_bonus_indicacao();

-- ---------------------------------------------------------- 4. a validade
-- Não há pg_cron neste projeto, então a apuração é feita na leitura: o painel
-- do parceiro e o envio de pedido chamam esta função para o parceiro em
-- questão (mesmo padrão de `parceiro_apurar_campanhas`).
--
-- A validade vira um LANÇAMENTO de estorno em vez de um filtro no saldo. Assim
-- o saldo continua sendo `sum(valor)` e os três lugares que o somam não
-- precisam saber de validade nenhuma — nem o próximo que for escrito.
CREATE OR REPLACE FUNCTION public.parceiro_expirar_creditos(p_parceiro_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_saldo numeric; v_expirado_bruto numeric; v_gasto numeric; v_ja_escrito numeric; v_a_expirar numeric;
  v_n integer := 0; v_total numeric := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT parceiro_id FROM public.parceiro_creditos
    WHERE valor > 0 AND expira_em IS NOT NULL AND expira_em <= now()
      AND (p_parceiro_id IS NULL OR parceiro_id = p_parceiro_id)
  LOOP
    SELECT COALESCE(sum(valor), 0) INTO v_saldo
      FROM public.parceiro_creditos WHERE parceiro_id = r.parceiro_id;

    SELECT COALESCE(sum(valor), 0) INTO v_expirado_bruto
      FROM public.parceiro_creditos
     WHERE parceiro_id = r.parceiro_id AND valor > 0
       AND expira_em IS NOT NULL AND expira_em <= now();

    -- Contar o que já saiu é o que impede o estorno de comer crédito NOVO:
    -- sem isto, quem ganhou 100 com prazo e gastou 80 ficava com 80 "a
    -- expirar" para sempre, e o cashback seguinte era engolido (defeito
    -- encontrado no teste do caso C, 21/09/2026). Assume que o gasto saiu
    -- primeiro do crédito que vencia — leitura a favor do parceiro: no limite
    -- expira de menos, nunca de mais, e nunca vira dívida.
    SELECT COALESCE(-sum(valor), 0) INTO v_gasto
      FROM public.parceiro_creditos
     WHERE parceiro_id = r.parceiro_id AND valor < 0 AND tipo <> 'expirado';

    SELECT COALESCE(-sum(valor), 0) INTO v_ja_escrito
      FROM public.parceiro_creditos
     WHERE parceiro_id = r.parceiro_id AND tipo = 'expirado';

    v_a_expirar := round(GREATEST(LEAST(v_saldo, v_expirado_bruto - v_gasto - v_ja_escrito), 0), 2);

    IF v_a_expirar > 0 THEN
      INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, descricao)
      VALUES (r.parceiro_id, 'expirado', -v_a_expirar,
              format('Crédito de boas-vindas que perdeu a validade (R$ %s).',
                     replace(to_char(v_a_expirar, 'FM999999990.00'), '.', ',')));
      v_n := v_n + 1; v_total := v_total + v_a_expirar;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('parceiros', v_n, 'total_expirado', v_total);
END;
$function$;

DROP FUNCTION IF EXISTS public.parceiro_expirar_creditos();
REVOKE ALL ON FUNCTION public.parceiro_expirar_creditos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_expirar_creditos(uuid) TO authenticated;

-- ------------------------------------------------- 5. emendas nas existentes
-- Feitas por substituição de texto sobre a função VIVA, de propósito: copiar
-- `parceiro_painel` e `parceiro_enviar_pedido` inteiras para cá congelaria uma
-- versão delas e desfaria em silêncio qualquer mudança feita por outra
-- migração. A emenda falha alto se o trecho não existir mais.
DO $patch$
DECLARE d text; alvo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='parceiro_painel';
  alvo := 'PERFORM public.parceiro_apurar_campanhas(v_id);';
  IF position(alvo in d) = 0 THEN
    RAISE EXCEPTION 'parceiro_painel: não achei onde apurar a validade';
  END IF;
  IF position('parceiro_expirar_creditos' in d) = 0 THEN
    EXECUTE replace(d, alvo, alvo || E'\n  PERFORM public.parceiro_expirar_creditos(v_id);');
  END IF;
END $patch$;

DO $patch$
DECLARE d text; alvo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='parceiro_enviar_pedido';

  -- a) expirar antes de ler o saldo, senão o parceiro gasta crédito vencido
  alvo := '  IF COALESCE(p_usar_credito, 0) > 0 THEN';
  IF position(alvo in d) = 0 THEN
    RAISE EXCEPTION 'parceiro_enviar_pedido: não achei o bloco do crédito';
  END IF;
  IF position('parceiro_expirar_creditos' in d) = 0 THEN
    d := replace(d, alvo, '  PERFORM public.parceiro_expirar_creditos(v_parceiro);' || E'\n' || alvo);
  END IF;

  -- b) o crédito nunca paga o pedido inteiro
  alvo := 'v_credito := round(LEAST(p_usar_credito, v_saldo, v_subtotal), 2);';
  IF position(alvo in d) > 0 THEN
    d := replace(d, alvo,
      'v_credito := round(LEAST(p_usar_credito, v_saldo, '
      || 'round(v_subtotal * COALESCE((SELECT credito_max_pct_pedido FROM public.parceiro_programa WHERE id), 100) / 100, 2)'
      || '), 2);');
  ELSIF position('credito_max_pct_pedido' in d) = 0 THEN
    RAISE EXCEPTION 'parceiro_enviar_pedido: não achei a conta do crédito';
  END IF;

  EXECUTE d;
END $patch$;
