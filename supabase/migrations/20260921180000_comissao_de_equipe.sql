-- Comissão de equipe: quem traz a venda ganha um % do BRUTO da OS quando ela é paga.
--
-- Organograma real (21/09/2026): quem traz venda nem sempre é vendedor. Leonardo
-- é impressor (operador de máquina) e traz cliente; outros da equipe também,
-- quando selecionados. "Quem trouxe a venda" é `ordens_servico.vendedor_id`,
-- que já existe, aponta para `usuarios` sem restrição de papel e é herdado
-- do orçamento e do cliente (tg_os_tem_dono). Reaproveitar essa coluna mantém
-- kanban, PDF e relatórios funcionando; só o rótulo na tela muda.
--
-- Por que a regra NÃO fica em `usuarios`: a policy "usuarios self update"
-- deixa cada um editar a própria linha — um `comissao_pct` ali seria
-- auto-aumento de salário. Tabela própria, escrita só de admin/gestor.
--
-- Por que só na OS PAGA: comissão sobre venda não recebida é adiantamento de
-- dinheiro que pode não entrar. É o mesmo evento que paga o cashback do
-- parceiro (`status_financeiro` → 'pago'). A base e o % são gravados na hora:
-- mudar o valor da OS ou a regra depois não mexe em comissão já lançada.
--
-- Margem: cada 1 ponto de comissão sobre o bruto tira exatamente 1 ponto da
-- margem daquela OS (margem média do catálogo hoje ≈ 60%).
--
-- COMO DESFAZER:
--   drop trigger zz_comissao_ao_pagar on public.ordens_servico;
--   drop function public.tg_comissao_ao_pagar();
--   drop function public.equipe_para_venda(); drop function public.minhas_comissoes();
--   drop function public.comissoes_painel(); drop function public.comissoes_pagar(uuid[]);
--   drop table public.comissoes; drop table public.comissao_regras;
--   (a pendência `comissoes_a_pagar` sai republicando pendencias_do_sistema sem o bloco)

-- ------------------------------------------------------ 1. a regra por pessoa
CREATE TABLE IF NOT EXISTS public.comissao_regras (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  pct numeric NOT NULL DEFAULT 0 CHECK (pct >= 0 AND pct <= 100),
  ativa boolean NOT NULL DEFAULT true,
  observacao text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
COMMENT ON TABLE public.comissao_regras IS
  'Percentual de comissão sobre o bruto da OS para quem trouxe a venda. Fora de usuarios de propósito: lá a pessoa edita a própria linha.';

ALTER TABLE public.comissao_regras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regra: leitura" ON public.comissao_regras;
CREATE POLICY "regra: leitura" ON public.comissao_regras FOR SELECT
  USING (usuario_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_permission(auth.uid(), 'financeiro.read'));

DROP POLICY IF EXISTS "regra: escrita gestao" ON public.comissao_regras;
CREATE POLICY "regra: escrita gestao" ON public.comissao_regras FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

-- ------------------------------------------------------------- 2. o extrato
CREATE TABLE IF NOT EXISTS public.comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id uuid NOT NULL UNIQUE REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  base numeric NOT NULL CHECK (base >= 0),
  pct numeric NOT NULL CHECK (pct >= 0 AND pct <= 100),
  valor numeric NOT NULL CHECK (valor >= 0),
  status text NOT NULL DEFAULT 'a_pagar' CHECK (status IN ('a_pagar','paga','cancelada')),
  pago_em timestamptz,
  pago_por uuid,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.comissoes IS
  'Uma comissão por OS, gerada quando a OS é paga. base e pct são os da hora do pagamento.';
CREATE INDEX IF NOT EXISTS comissoes_usuario_status ON public.comissoes (usuario_id, status);

ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comissao: leitura" ON public.comissoes;
CREATE POLICY "comissao: leitura" ON public.comissoes FOR SELECT
  USING (usuario_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_permission(auth.uid(), 'financeiro.read'));

-- Ninguém insere à mão: quem lança é o gatilho. Pagar/cancelar é pela RPC.
DROP POLICY IF EXISTS "comissao: pagar" ON public.comissoes;
CREATE POLICY "comissao: pagar" ON public.comissoes FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'pagamentos.confirm'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'pagamentos.confirm'));

-- ------------------------------------------------------------- 3. o gatilho
CREATE OR REPLACE FUNCTION public.tg_comissao_ao_pagar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pct numeric; v_base numeric := COALESCE(NEW.valor_total, 0);
BEGIN
  IF NEW.status_financeiro::text <> 'pago' OR OLD.status_financeiro::text = 'pago' THEN
    RETURN NEW;
  END IF;
  IF NEW.vendedor_id IS NULL OR v_base <= 0 THEN RETURN NEW; END IF;

  SELECT r.pct INTO v_pct FROM public.comissao_regras r
   WHERE r.usuario_id = NEW.vendedor_id AND r.ativa AND r.pct > 0;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.comissoes (os_id, usuario_id, base, pct, valor)
  VALUES (NEW.id, NEW.vendedor_id, v_base, v_pct, round(v_base * v_pct / 100, 2))
  ON CONFLICT (os_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_comissao_ao_pagar ON public.ordens_servico;
CREATE TRIGGER zz_comissao_ao_pagar
  AFTER UPDATE OF status_financeiro ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_comissao_ao_pagar();

-- ------------------------------------------------------------ 4. as leituras
-- A equipe que pode ser "quem trouxe". SECURITY DEFINER porque `usuarios` só é
-- legível pelo próprio, admin e gestor — e quem edita OS pode ser outro papel.
CREATE OR REPLACE FUNCTION public.equipe_para_venda()
RETURNS TABLE(id uuid, nome text, tem_comissao boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'os.read') OR public.has_permission(auth.uid(), 'orcamentos.read')) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.id, u.nome,
         EXISTS (SELECT 1 FROM public.comissao_regras r WHERE r.usuario_id = u.id AND r.ativa AND r.pct > 0)
  FROM public.usuarios u
  WHERE u.ativo
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id
                  AND ur.role NOT IN ('cliente','parceiro'))
  ORDER BY u.nome;
END;
$function$;

-- O que é MEU eu vejo sem permissão financeira: é o meu dinheiro.
CREATE OR REPLACE FUNCTION public.minhas_comissoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_pct numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT pct INTO v_pct FROM public.comissao_regras WHERE usuario_id = v_uid AND ativa;
  RETURN jsonb_build_object(
    'pct', v_pct,
    'a_pagar', (SELECT COALESCE(sum(valor),0) FROM public.comissoes WHERE usuario_id = v_uid AND status = 'a_pagar'),
    'pagas_ano', (SELECT COALESCE(sum(valor),0) FROM public.comissoes
                   WHERE usuario_id = v_uid AND status = 'paga' AND pago_em >= date_trunc('year', now())),
    'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', c.id, 'os_numero', o.numero, 'os_titulo', o.titulo, 'cliente', cl.nome,
                 'base', c.base, 'pct', c.pct, 'valor', c.valor, 'status', c.status,
                 'quando', c.created_at, 'pago_em', c.pago_em) ORDER BY c.created_at DESC), '[]'::jsonb)
              FROM public.comissoes c
              JOIN public.ordens_servico o ON o.id = c.os_id
              LEFT JOIN public.clientes cl ON cl.id = o.cliente_id
              WHERE c.usuario_id = v_uid)
  );
END;
$function$;

-- Painel do financeiro: todas, com nome — `usuarios` não é legível pelo financeiro.
CREATE OR REPLACE FUNCTION public.comissoes_painel()
RETURNS TABLE(id uuid, usuario_id uuid, usuario_nome text, os_numero integer, os_titulo text,
              cliente text, base numeric, pct numeric, valor numeric, status text,
              quando timestamptz, pago_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')
          OR public.has_permission(auth.uid(),'financeiro.read')) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id, c.usuario_id, u.nome, o.numero, o.titulo, cl.nome,
         c.base, c.pct, c.valor, c.status, c.created_at, c.pago_em
  FROM public.comissoes c
  JOIN public.usuarios u ON u.id = c.usuario_id
  JOIN public.ordens_servico o ON o.id = c.os_id
  LEFT JOIN public.clientes cl ON cl.id = o.cliente_id
  ORDER BY (c.status = 'a_pagar') DESC, c.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.comissoes_pagar(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n integer; v_total numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'pagamentos.confirm')) THEN
    RAISE EXCEPTION 'Sem permissão para pagar comissões' USING ERRCODE = '42501';
  END IF;
  WITH pagas AS (
    UPDATE public.comissoes SET status = 'paga', pago_em = now(), pago_por = auth.uid()
    WHERE id = ANY(p_ids) AND status = 'a_pagar'
    RETURNING valor
  )
  SELECT count(*), COALESCE(sum(valor),0) INTO v_n, v_total FROM pagas;
  RETURN jsonb_build_object('pagas', v_n, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.equipe_para_venda() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.minhas_comissoes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comissoes_painel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comissoes_pagar(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_para_venda() TO authenticated;
GRANT EXECUTE ON FUNCTION public.minhas_comissoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.comissoes_painel() TO authenticated;
GRANT EXECUTE ON FUNCTION public.comissoes_pagar(uuid[]) TO authenticated;

-- --------------------------------------------- 5. pendência para o financeiro
-- Emenda por substituição de texto na função viva (mesmo motivo das outras:
-- copiar a função inteira congelaria uma versão dela).
DO $patch$
DECLARE d text; alvo text := E'\n  RETURN;\nEND;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pendencias_do_sistema';
  IF position('comissoes_a_pagar' in d) > 0 THEN RETURN; END IF;
  IF position(alvo in d) = 0 THEN RAISE EXCEPTION 'pendencias_do_sistema: não achei o fim da função'; END IF;
  d := replace(d, alvo,
    E'\n  IF v_ve_dinheiro THEN\n'
    || E'    RETURN QUERY SELECT ''comissoes_a_pagar'',''Comissões de venda a pagar'', count(*)::int,\n'
    || E'      (SELECT count(*)::int FROM public.comissoes),''atencao'',''financeiro'',\n'
    || E'      ''Comissão de quem trouxe a venda, gerada quando a OS foi paga. Pague no fechamento e marque como paga em Financeiro › Comissões.'',''/financeiro''\n'
    || E'    FROM public.comissoes WHERE status = ''a_pagar'' HAVING count(*) > 0;\n'
    || E'  END IF;\n' || alvo);
  EXECUTE d;
END $patch$;

-- ------------------------------------------------------ 6. o papel do Leonardo
-- Decisão do Harison (21/09/2026): Leonardo é impressor (operador), não vendedor.
-- Continua podendo ser "quem trouxe a venda" — a coluna não olha papel.
UPDATE public.user_roles SET role = 'operador'
 WHERE role = 'vendedor'
   AND user_id = (SELECT id FROM public.usuarios WHERE lower(email) = 'leolpmalmeida@gmail.com');

-- ------------------------------------------- 7. quem pode mudar "quem trouxe"
-- Operador tem os.update para a produção — não para se apontar numa OS e
-- ganhar comissão. A trava é no banco; a tela só a espelha.
CREATE OR REPLACE FUNCTION public.tg_os_quem_trouxe_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.vendedor_id IS DISTINCT FROM NEW.vendedor_id AND auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')
              OR public.has_permission(auth.uid(),'orcamentos.update')) THEN
    RAISE EXCEPTION 'Só gestão ou atendimento pode mudar quem trouxe a venda' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS aa_os_quem_trouxe_guard ON public.ordens_servico;
CREATE TRIGGER aa_os_quem_trouxe_guard BEFORE UPDATE OF vendedor_id ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_quem_trouxe_guard();

-- As telas definem "quem trouxe" por RPC, com o mesmo guarda, sem depender da
-- RLS de os.update (que o gestor não tem).
CREATE OR REPLACE FUNCTION public.os_definir_quem_trouxe(p_os_id uuid, p_usuario_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_permission(auth.uid(),'orcamentos.update')) THEN
    RAISE EXCEPTION 'Só gestão ou atendimento pode mudar quem trouxe a venda' USING ERRCODE='42501';
  END IF;
  IF p_usuario_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id=u.id
       WHERE u.id=p_usuario_id AND u.ativo AND ur.role NOT IN ('cliente','parceiro')) THEN
    RAISE EXCEPTION 'Essa pessoa não está na equipe ativa' USING ERRCODE='22023';
  END IF;
  UPDATE public.ordens_servico SET vendedor_id = p_usuario_id, updated_at = now() WHERE id = p_os_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.orcamento_definir_quem_trouxe(p_orcamento_id uuid, p_usuario_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_permission(auth.uid(),'orcamentos.update')) THEN
    RAISE EXCEPTION 'Só gestão ou atendimento pode mudar quem trouxe a venda' USING ERRCODE='42501';
  END IF;
  IF p_usuario_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id=u.id
       WHERE u.id=p_usuario_id AND u.ativo AND ur.role NOT IN ('cliente','parceiro')) THEN
    RAISE EXCEPTION 'Essa pessoa não está na equipe ativa' USING ERRCODE='22023';
  END IF;
  UPDATE public.orcamentos SET vendedor_id = p_usuario_id, updated_at = now() WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  -- a OS que nasceu deste orçamento e ainda não foi paga acompanha
  UPDATE public.ordens_servico SET vendedor_id = p_usuario_id
   WHERE orcamento_id = p_orcamento_id AND status_financeiro::text <> 'pago';
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.os_definir_quem_trouxe(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.orcamento_definir_quem_trouxe(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.os_definir_quem_trouxe(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.orcamento_definir_quem_trouxe(uuid,uuid) TO authenticated;
