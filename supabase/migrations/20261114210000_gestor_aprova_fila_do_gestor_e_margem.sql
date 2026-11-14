-- Quem aprova é o gestor; o atendimento pede e entrega (decisão do dono,
-- 14/11/2026, depois do PR #467).
--
-- "O administrador só visualiza a empresa. Quem trata a aprovação, o
--  atendimento, é o gestor. Vai pelos papéis de atendimento e de gestor."
--
--   1. eh_gestor passa a ser SÓ o papel gestor: o admin deixa de validar o
--      atendimento, de autorizar o saldo devedor e de ser citado nos pedidos.
--   2. "OS pronta" cita o atendimento pelo PAPEL: o vendedor e o responsável
--      da OS que são do atendimento (vendedor) ou gestores; sem nenhum deles,
--      todo o atendimento.
--   3. A fila do gestor: cada "pedir ao gestor" fica registrado em
--      os_pedidos_ao_gestor (quem pediu, quando, o quê), e a autorização do
--      gestor resolve o pedido sozinha (gatilho). O quadro mostra a fila —
--      o pedido chega no aplicativo mesmo com o grupo do WhatsApp desligado.
--   4. Margem abaixo do mínimo ganha o aval do gestor pela ficha, gravado em
--      os_autorizacoes (autorizar_margem_baixa). A liberação antiga, por
--      `aprovacoes`, continua valendo para o que já foi liberado.

-- ---------------------------------------------------------------- 1
CREATE OR REPLACE FUNCTION public.eh_gestor(p_usuario uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Só o gestor: o admin acompanha a empresa, não aprova (decisão do dono).
  SELECT p_usuario IS NOT NULL AND public.has_role(p_usuario, 'gestor'::app_role)
$$;

-- ---------------------------------------------------------------- 2
-- A autorização de margem baixa mora com as outras.
ALTER TABLE public.os_autorizacoes DROP CONSTRAINT IF EXISTS os_autorizacoes_tipo_check;
ALTER TABLE public.os_autorizacoes ADD CONSTRAINT os_autorizacoes_tipo_check
  CHECK (tipo IN ('atendimento_validado', 'saldo_devedor', 'margem_baixa'));

-- A fila do gestor.
CREATE TABLE IF NOT EXISTS public.os_pedidos_ao_gestor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  assunto text NOT NULL CHECK (assunto IN ('atendimento', 'saldo_devedor', 'margem_baixa')),
  pedido_por uuid NOT NULL REFERENCES public.usuarios(id),
  pedido_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por uuid REFERENCES public.usuarios(id)
);
-- Um pedido aberto por OS e assunto: pedir de novo não duplica.
CREATE UNIQUE INDEX IF NOT EXISTS os_pedidos_ao_gestor_aberto
  ON public.os_pedidos_ao_gestor (os_id, assunto) WHERE resolvido_em IS NULL;

COMMENT ON TABLE public.os_pedidos_ao_gestor IS
  'Pedidos de aval ao gestor (validar atendimento, saldo devedor, margem baixa). Grava pedir_aval_do_gestor; a autorização do gestor resolve (gatilho em os_autorizacoes). A equipe lê.';

ALTER TABLE public.os_pedidos_ao_gestor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "equipe lê os pedidos ao gestor" ON public.os_pedidos_ao_gestor;
CREATE POLICY "equipe lê os pedidos ao gestor" ON public.os_pedidos_ao_gestor
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
REVOKE ALL ON public.os_pedidos_ao_gestor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.os_pedidos_ao_gestor TO authenticated;
GRANT ALL ON public.os_pedidos_ao_gestor TO service_role;

-- A autorização resolve o pedido do mesmo assunto.
CREATE OR REPLACE FUNCTION public.tg_os_autorizacao_resolve_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.os_pedidos_ao_gestor
     SET resolvido_em = now(), resolvido_por = NEW.autorizado_por
   WHERE os_id = NEW.os_id
     AND resolvido_em IS NULL
     AND assunto = CASE NEW.tipo WHEN 'atendimento_validado' THEN 'atendimento' ELSE NEW.tipo END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_os_autorizacao_resolve_pedido ON public.os_autorizacoes;
CREATE TRIGGER tg_os_autorizacao_resolve_pedido
  AFTER INSERT ON public.os_autorizacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_autorizacao_resolve_pedido();
REVOKE ALL ON FUNCTION public.tg_os_autorizacao_resolve_pedido() FROM PUBLIC, anon, authenticated;

-- Pedir o aval: grava na fila e avisa o grupo (se ligado), citando os gestores.
-- Com o grupo desligado o pedido fica só na fila do quadro — não falha mais.
CREATE OR REPLACE FUNCTION public.pedir_aval_do_gestor(p_os_id uuid, p_assunto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_os public.ordens_servico%ROWTYPE;
  v_mencoes text[];
  v_citacao text;
  v_quem text;
  v_aviso uuid;
  v_grupo boolean := public.grupo_equipe_destino() IS NOT NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Usuário sem permissão para pedir o aval do gestor.' USING ERRCODE = '42501';
  END IF;
  IF p_assunto IS NULL OR p_assunto NOT IN ('atendimento', 'saldo_devedor', 'margem_baixa') THEN
    RAISE EXCEPTION 'Assunto desconhecido: %.', p_assunto;
  END IF;
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;

  IF p_assunto = 'atendimento' THEN
    IF public.etapa_da_os(v_os.status) <> 'entrada' THEN
      RAISE EXCEPTION 'A OS nº % já saiu do atendimento.', v_os.numero;
    END IF;
    IF EXISTS (SELECT 1 FROM public.os_autorizacoes au
                WHERE au.os_id = p_os_id AND au.tipo = 'atendimento_validado') THEN
      RAISE EXCEPTION 'O atendimento da OS nº % já foi validado.', v_os.numero;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.os_autorizacoes au
                 WHERE au.os_id = p_os_id AND au.tipo = p_assunto) THEN
    RAISE EXCEPTION 'O gestor já autorizou isto na OS nº %.', v_os.numero;
  END IF;

  INSERT INTO public.os_pedidos_ao_gestor (os_id, assunto, pedido_por)
  VALUES (p_os_id, p_assunto, v_uid)
  ON CONFLICT (os_id, assunto) WHERE resolvido_em IS NULL DO NOTHING;

  SELECT coalesce(array_agg(DISTINCT x.m), '{}'::text[]) INTO v_mencoes
    FROM (SELECT public._mencao_whatsapp(u.id) AS m
            FROM public.usuarios u
           WHERE u.ativo IS NOT FALSE AND public.eh_gestor(u.id)) x
   WHERE x.m IS NOT NULL;
  v_citacao := CASE WHEN cardinality(v_mencoes) > 0
                    THEN (SELECT string_agg('@' || m, ' ' ORDER BY m) FROM unnest(v_mencoes) m)
                    ELSE 'Gestor' END;
  v_quem := coalesce((SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = v_uid), 'a equipe');

  IF v_grupo THEN
    -- Sem número de margem nem valor: o operador também lê o grupo.
    v_aviso := public._os_avisar_grupo(p_os_id, 'pedir_aval:' || p_assunto,
      CASE p_assunto WHEN 'atendimento' THEN '🟡 Atendimento para validar'
                     WHEN 'saldo_devedor' THEN '💳 Cliente vai ficar devendo'
                     ELSE '📉 Margem abaixo do mínimo' END,
      CASE p_assunto
        WHEN 'atendimento' THEN
          format(E'✍️ Pedido por %s\n%s, confira o pedido, escolha quem faz a criação e valide no quadro:', v_quem, v_citacao)
        WHEN 'saldo_devedor' THEN
          format(E'✍️ Pedido por %s\n%s, a OS não tem entrada paga. Se o cliente pode produzir devendo, autorize no quadro:', v_quem, v_citacao)
        ELSE
          format(E'✍️ Pedido por %s\n%s, a margem desta OS está abaixo do mínimo. Revise o preço ou autorize no quadro:', v_quem, v_citacao)
      END,
      v_mencoes,
      p_os_id::text || ':' || floor(extract(epoch FROM now()) / 900)::bigint::text);
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'aval_do_gestor_pedido',
          jsonb_build_object('assunto', p_assunto, 'gestores_citados', cardinality(v_mencoes),
                             'novo_aviso', v_aviso IS NOT NULL, 'grupo_ligado', v_grupo));

  -- novo_aviso falso com o grupo ligado: o mesmo pedido dos últimos 15 minutos já está na fila do grupo.
  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'novo_aviso', v_aviso IS NOT NULL,
                            'grupo_ligado', v_grupo, 'gestores_citados', cardinality(v_mencoes));
END $$;

-- ---------------------------------------------------------------- 3
-- Margem abaixo do mínimo: o gestor libera, com o motivo.
CREATE OR REPLACE FUNCTION public.autorizar_margem_baixa(p_os_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_autorizacao uuid;
BEGIN
  IF NOT public.eh_gestor(v_uid) THEN
    RAISE EXCEPTION 'Só o gestor libera margem abaixo do mínimo.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Diga por que a margem pode ficar abaixo do mínimo (ex.: cliente grande, volume, parceria).';
  END IF;
  PERFORM 1 FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.os_autorizacoes (os_id, tipo, autorizado_por, motivo)
  VALUES (p_os_id, 'margem_baixa', v_uid, v_motivo)
  RETURNING id INTO v_autorizacao;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'margem_baixa_autorizada',
          jsonb_build_object('motivo', v_motivo, 'autorizacao_id', v_autorizacao));

  BEGIN
    PERFORM public._os_avisar_grupo(p_os_id, 'margem_baixa', '📉 Margem liberada pelo gestor',
      format(E'✍️ Autorizado por %s\n💬 %s',
        coalesce((SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = v_uid), 'o gestor'),
        left(v_motivo, 200)),
      '{}'::text[],
      v_autorizacao::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (margem baixa, OS %): %', p_os_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id);
END $$;

-- ---------------------------------------------------------------- 4
-- OS pronta: cita o atendimento pelo papel.
CREATE OR REPLACE FUNCTION public.tg_os_pronta_avisa_atendimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pessoas uuid[];
  v_citacoes text;
  v_modo text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.finalidade IS DISTINCT FROM 'venda'
     OR NEW.status NOT IN ('aguardando_retirada', 'aguardando_entrega', 'em_instalacao')
     OR public.etapa_da_os(OLD.status) IN ('saida', 'fora_do_fluxo') THEN
    RETURN NULL;
  END IF;
  BEGIN
    -- O vendedor e o responsável da OS, quando são do atendimento ou gestores.
    SELECT array_agg(DISTINCT p) INTO v_pessoas
      FROM unnest(ARRAY[NEW.vendedor_id, NEW.responsavel_id]) p
     WHERE p IS NOT NULL AND public.is_staff(p)
       AND (public.has_role(p, 'vendedor'::app_role) OR public.has_role(p, 'gestor'::app_role));
    -- Nenhum deles é do atendimento: o atendimento inteiro.
    IF coalesce(cardinality(v_pessoas), 0) = 0 THEN
      SELECT array_agg(u.id ORDER BY u.nome) INTO v_pessoas
        FROM public.usuarios u
       WHERE u.ativo IS NOT FALSE AND public.is_staff(u.id) AND public.has_role(u.id, 'vendedor'::app_role);
    END IF;
    SELECT string_agg(public._citacao_no_texto(p), ' ') INTO v_citacoes FROM unnest(v_pessoas) p;
    v_modo := CASE NEW.status
      WHEN 'aguardando_retirada' THEN '🏪 Retirada no balcão'
      WHEN 'aguardando_entrega' THEN '🚚 Entrega'
      ELSE '🛠️ Instalação' END;

    PERFORM public._os_avisar_grupo(NEW.id, 'os_pronta', '📦 Pronta para entregar',
      format(E'%s\n🤝 Atendimento: %s, combine com o cliente.', v_modo, coalesce(v_citacoes, 'sem ninguém no atendimento')),
      (SELECT array_agg(public._mencao_whatsapp(p)) FROM unnest(v_pessoas) p),
      NEW.id::text || ':' || NEW.status::text || ':' || extract(epoch FROM now())::bigint::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (OS pronta %): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
-- Função de gatilho nasce fechada (recriada aqui: o REVOKE vem junto).
REVOKE ALL ON FUNCTION public.tg_os_pronta_avisa_atendimento() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 5
-- As travas: igual à de 20261114190000, e a margem baixa passa a aceitar
-- também o aval do gestor em os_autorizacoes.
CREATE OR REPLACE FUNCTION public.os_bloqueios_para(os_id uuid, novo_status status_os)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_bloqueios jsonb := '[]'::jsonb;
  v_margem_minima NUMERIC(5,2) := 20;
  v_margem NUMERIC(10,2);
  v_total_pago NUMERIC(12,2);
  v_faltando TEXT;
  v_ve_financeiro BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar a OS.' USING ERRCODE = '42501';
  END IF;

  v_ve_financeiro := public.has_permission(auth.uid(), 'financeiro.read');

  SELECT * INTO v_os FROM public.ordens_servico WHERE id = os_bloqueios_para.os_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada.', os_bloqueios_para.os_id USING ERRCODE = 'P0002';
  END IF;

  IF v_os.status = novo_status THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_os.responsavel_id IS NULL THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'sem_responsavel',
      'titulo', 'Sem responsável definido',
      'resolver', 'Escolha quem responde por esta OS antes de mudar o status.'
    );
  END IF;

  -- Atendimento validado (14/11/2026): só o gestor tira a OS do Atendimento.
  IF v_os.finalidade = 'venda'
     AND public.etapa_da_os(v_os.status) = 'entrada'
     AND public.etapa_da_os(novo_status) NOT IN ('entrada', 'fora_do_fluxo')
     AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.os_autorizacoes au
        WHERE au.os_id = os_bloqueios_para.os_id AND au.tipo = 'atendimento_validado'
     ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'atendimento_nao_validado',
      'titulo', 'Atendimento não validado pelo gestor',
      'resolver', 'O gestor confere o pedido, valida o atendimento e escolhe quem faz a criação.'
    );
  END IF;

  IF public.status_os_exige_validacoes_producao(novo_status) AND novo_status NOT IN ('concluido', 'faturado') THEN
    SELECT COALESCE(SUM(valor), 0) INTO v_total_pago
    FROM public.pagamentos
    WHERE pagamentos.os_id = os_bloqueios_para.os_id
      AND status IN ('parcial','pago')
      AND valor > 0;

    -- Cliente devendo: o gestor pode autorizar (14/11/2026).
    IF v_total_pago <= 0 AND v_os.finalidade = 'venda' AND NOT EXISTS (
      SELECT 1 FROM public.os_autorizacoes au
       WHERE au.os_id = os_bloqueios_para.os_id AND au.tipo = 'saldo_devedor'
    ) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'sem_pagamento',
        'titulo', 'Nenhum pagamento registrado',
        'resolver', 'Registre ao menos a entrada no financeiro da OS, ou peça ao gestor para autorizar o cliente a ficar devendo.'
      );
    END IF;

    -- OS de impressão 3D não passa por aprovação de arte (decisão do dono,
    -- 13/10/2026): o modelo é o que o cliente aprovou no orçamento 3D.
    IF v_os.finalidade = 'venda' AND NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.orcamentos_3d t3
         WHERE t3.os_id = os_bloqueios_para.os_id
            OR (t3.orcamento_id IS NOT NULL AND t3.orcamento_id = v_os.orcamento_id)
       ) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'arte_nao_aprovada',
        'titulo', 'Arte ainda não aprovada',
        'resolver', 'Envie a arte para aprovação e registre o aceite do cliente.'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.arquivos
      WHERE arquivos.os_id = os_bloqueios_para.os_id AND final_producao = true
    ) AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'sem_arquivo_final',
        'titulo', 'Sem arquivo final de produção',
        'resolver', 'Anexe o arquivo fechado e marque-o como final de produção.'
      );
    END IF;

    SELECT string_agg(m.nome || ' (falta ' || ROUND(omo.quantidade - m.estoque, 2) || ')', ', ')
    INTO v_faltando
    FROM public.os_materiais_obrigatorios omo
    JOIN public.materiais m ON m.id = omo.material_id
    WHERE omo.os_id = os_bloqueios_para.os_id AND m.estoque < omo.quantidade;

    IF v_faltando IS NOT NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'material_insuficiente',
        'titulo', 'Material obrigatório em falta',
        'resolver', 'Sem saldo de: ' || v_faltando || '. Dê entrada no estoque ou compre.'
      );
    END IF;
  END IF;

  SELECT margem_estimada INTO v_margem
  FROM public.orcamentos WHERE id = v_os.orcamento_id;

  IF v_margem IS NULL THEN
    v_margem := COALESCE(
      v_os.margem_real,
      CASE
        WHEN v_os.valor_total > 0 THEN ROUND(((v_os.valor_total - COALESCE(NULLIF(v_os.custo_real, 0), v_os.custo_previsto, 0)) / v_os.valor_total) * 100, 2)
        ELSE NULL
      END
    );
  END IF;

  -- Margem baixa: libera o aval do gestor (os_autorizacoes, 14/11/2026) ou a
  -- liberação antiga por `aprovacoes`, que continua valendo para o que já foi liberado.
  IF v_os.finalidade = 'venda' AND v_margem IS NOT NULL AND v_margem < v_margem_minima AND NOT EXISTS (
    SELECT 1 FROM public.os_autorizacoes au
     WHERE au.os_id = os_bloqueios_para.os_id AND au.tipo = 'margem_baixa'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE a.os_id = os_bloqueios_para.os_id AND a.tipo::text = 'margem_baixa' AND a.aprovado = true
  ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'margem_baixa',
      'titulo', CASE WHEN v_ve_financeiro
                     THEN 'Margem de ' || v_margem || '% abaixo do mínimo de ' || v_margem_minima || '%'
                     ELSE 'Margem abaixo do mínimo — precisa de aprovação do gestor' END,
      'resolver', 'Revise o preço ou peça ao gestor para liberar a margem.'
    );
  END IF;

  -- O desconto não trava mais aqui: a régua dele é a do orçamento
  -- (margem mínima e piso, ou 10% sem custo conhecido), conferida pelo gatilho
  -- de totais ao gravar e por converter_orcamento_em_os antes de a OS nascer.

  RETURN v_bloqueios;
END;
$function$;

-- ---------------------------------------------------------------- 6
-- Permissões, conferidas: o REVOKE não reclama quando não surte efeito.
DO $fechar$
DECLARE
  v_funcao regprocedure;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.eh_gestor(uuid)',
    'public.tg_os_autorizacao_resolve_pedido()',
    'public.tg_os_pronta_avisa_atendimento()'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_funcao);
    IF has_function_privilege('anon', v_funcao, 'EXECUTE')
       OR has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION '% continua aberta para o navegador', v_funcao;
    END IF;
  END LOOP;

  FOREACH v_funcao IN ARRAY ARRAY[
    'public.pedir_aval_do_gestor(uuid, text)',
    'public.autorizar_margem_baixa(uuid, text)'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_funcao);
    IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ainda executa %', v_funcao;
    END IF;
  END LOOP;
END
$fechar$;

NOTIFY pgrst, 'reload schema';
