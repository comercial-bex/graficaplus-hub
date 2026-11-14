-- Atendimento validado pelo gestor, operador escolhido ao mandar para a
-- produção e saldo devedor autorizado pelo gestor (pedido do dono, 14/11/2026).
--
-- "Para chegar na criação, o atendimento vai lá, e o gestor autoriza a
--  criação… ele bota assim ali, avançar, aí avança a criação. Só vamos usar a
--  aba nova de atendimento validado." → nova etapa do quadro, ATENDIMENTO
--  VALIDADO, entre Atendimento e Criação. Usa o status `briefing_ok`, que
--  existia no enum e nenhuma OS usava (conferido em 14/11/2026: 0 OS). Só
--  gestor ou admin valida, escolhendo quem faz a criação — "não marque sempre
--  pelo papel da pessoa": quem decide é o gestor.
--
-- "Um cliente que vai ficar devendo… o gerente tem que autorizar… só quem pode
--  autorizar é o gestor" → a trava "Nenhum pagamento registrado" passa a ter
--  liberação, só de gestor ou admin, com motivo e o valor em aberto registrados.
--
-- "Dentro de um modal, eu seleciono um operador, o Fernando, para seguir para
--  ele" → mandar para a fila de produção escolhe o operador, numa transação só.
--
-- As autorizações moram numa tabela própria, que ninguém grava direto: só as
-- funções abaixo, que conferem o papel de quem chama e gravam auth.uid() como
-- autor. (A liberação de margem baixa, em `aprovacoes`, aceita o usuario_id
-- que quem grava escolher — não é o modelo a seguir.)
--
-- "E que chegue também… hoje é aprovado no grupo do WhatsApp" → os passos
-- avisam o grupo da equipe (o mesmo do aviso de lead), citando quem tem de agir:
--   - o atendimento pede a validação → cita o gestor;
--   - o gestor validou → cita quem faz a criação;
--   - foi para a fila de produção (ou trocou o operador) → cita o operador;
--   - ficou pronta (retirada, entrega ou instalação) → cita o atendimento
--     (vendedor e responsável): "quem entrega é o atendimento".
-- O aviso nunca derruba o passo: falhou, fica o WARNING no log e a OS anda.

-- ---------------------------------------------------------------- 1
CREATE TABLE IF NOT EXISTS public.os_autorizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('atendimento_validado', 'saldo_devedor')),
  autorizado_por uuid NOT NULL REFERENCES public.usuarios(id),
  autorizado_em timestamptz NOT NULL DEFAULT now(),
  motivo text,
  -- atendimento validado: quem faz a criação
  designer_id uuid REFERENCES public.usuarios(id),
  -- saldo devedor: quanto faltava pagar quando o gestor autorizou
  valor_em_aberto numeric(12,2)
);

CREATE INDEX IF NOT EXISTS os_autorizacoes_os_tipo ON public.os_autorizacoes (os_id, tipo);

COMMENT ON TABLE public.os_autorizacoes IS
  'Autorizações do gestor numa OS (atendimento validado, saldo devedor). Só as funções validar_atendimento e autorizar_saldo_devedor gravam; a equipe lê.';

ALTER TABLE public.os_autorizacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "equipe lê as autorizações" ON public.os_autorizacoes;
CREATE POLICY "equipe lê as autorizações" ON public.os_autorizacoes
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
REVOKE ALL ON public.os_autorizacoes FROM PUBLIC, anon, authenticated;
-- O valor em aberto é dinheiro: fica fora do que o navegador lê, como o
-- valor_total da OS (coluna privada). A equipe lê quem autorizou, quando e por quê.
GRANT SELECT (id, os_id, tipo, autorizado_por, autorizado_em, motivo, designer_id)
  ON public.os_autorizacoes TO authenticated;
GRANT ALL ON public.os_autorizacoes TO service_role;

-- Gestor ou admin: quem autoriza.
CREATE OR REPLACE FUNCTION public.eh_gestor(p_usuario uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_usuario IS NOT NULL
     AND (public.has_role(p_usuario, 'admin'::app_role) OR public.has_role(p_usuario, 'gestor'::app_role))
$$;

-- O "@" de uma pessoa da equipe no grupo: 55 + DDD + celular, o formato do
-- `mentioned` do Z-API (o mesmo de `numeroParaMencao`). Sem celular, nulo.
CREATE OR REPLACE FUNCTION public._mencao_whatsapp(p_usuario uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT '55' || x.d
    FROM (SELECT public.normalize_whatsapp_phone(u.telefone) AS d
            FROM public.usuarios u
           WHERE u.id = p_usuario AND u.ativo IS NOT FALSE AND public.is_staff(u.id)) x
   WHERE x.d ~ '^\d{2}9\d{8}$'
$$;

-- O "@nome" no texto: o número quando a pessoa tem celular (o WhatsApp mostra
-- o nome), senão o primeiro nome, sem citar.
CREATE OR REPLACE FUNCTION public._citacao_no_texto(p_usuario uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce('@' || public._mencao_whatsapp(p_usuario),
                  (SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = p_usuario),
                  'a definir')
$$;

-- Um aviso no grupo da equipe sobre uma OS: título, cliente, o corpo e o link
-- que abre a ficha no quadro. Grupo desligado: não enfileira e devolve nulo.
-- Não pega erro: quem chama decide se o aviso pode derrubar o passo.
CREATE OR REPLACE FUNCTION public._os_avisar_grupo(
  p_os_id uuid, p_tipo text, p_titulo text, p_corpo text, p_mencionar text[], p_chave text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grupo text := public.grupo_equipe_destino();
  v_numero text;
  v_titulo text;
  v_cliente text;
  v_texto text;
BEGIN
  IF v_grupo IS NULL THEN RETURN NULL; END IF;
  SELECT o.numero, o.titulo, c.nome INTO v_numero, v_titulo, v_cliente
    FROM public.ordens_servico o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id
   WHERE o.id = p_os_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_texto := format(E'%s · OS nº %s\n👤 %s%s\n%s\nhttps://bexprint.com.br/kanban?os=%s',
    p_titulo, v_numero,
    coalesce(nullif(btrim(v_cliente), ''), 'Cliente sem nome'),
    coalesce(' — ' || left(nullif(btrim(v_titulo), ''), 80), ''),
    p_corpo, p_os_id);

  -- cliente_id fica nulo de propósito: o aviso é da equipe, não do cliente.
  RETURN public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe',
    'ordem_servico', p_os_id, 'aviso_grupo_equipe',
    jsonb_build_object('texto', v_texto,
                       'mencionar', to_jsonb(coalesce(array_remove(p_mencionar, NULL), '{}'::text[]))),
    'grupo_equipe:' || p_tipo || ':' || p_chave);
END $$;

-- A equipe para escolher quem faz a criação e quem opera a máquina. Todo
-- mundo ativo da equipe, com os papéis só para ordenar e mostrar: quem escolhe
-- é o gestor, não o papel ("não marque sempre pelo papel da pessoa").
CREATE OR REPLACE FUNCTION public.equipe_da_producao()
RETURNS TABLE(id uuid, nome text, avatar_url text, papeis text[], tem_whatsapp boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nome, u.avatar_url,
         coalesce((SELECT array_agg(r.role::text ORDER BY r.role::text)
                     FROM public.user_roles r WHERE r.user_id = u.id), '{}'::text[]),
         public._mencao_whatsapp(u.id) IS NOT NULL
    FROM public.usuarios u
   WHERE u.ativo IS NOT FALSE
     AND public.is_staff(u.id)
     AND public.is_staff(auth.uid())
   ORDER BY u.nome
$$;

-- ---------------------------------------------------------------- 2
-- O gestor valida o atendimento: grava a autorização, quem faz a criação e
-- leva a OS para "Atendimento validado" pela porta de sempre (avancar_os_status,
-- que confere as travas e grava o histórico).
CREATE OR REPLACE FUNCTION public.validar_atendimento(
  p_os_id uuid, p_designer_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_os public.ordens_servico%ROWTYPE;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_autorizacao uuid;
  v_aviso uuid;
BEGIN
  IF NOT public.eh_gestor(v_uid) THEN
    RAISE EXCEPTION 'Só o gestor valida o atendimento.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF public.etapa_da_os(v_os.status) <> 'entrada' THEN
    RAISE EXCEPTION 'A OS nº % já passou do atendimento.', v_os.numero;
  END IF;
  IF p_designer_id IS NULL OR NOT public.is_staff(p_designer_id) THEN
    RAISE EXCEPTION 'Escolha quem da equipe faz a criação.';
  END IF;

  INSERT INTO public.os_autorizacoes (os_id, tipo, autorizado_por, designer_id, motivo)
  VALUES (p_os_id, 'atendimento_validado', v_uid, p_designer_id, v_motivo)
  RETURNING id INTO v_autorizacao;

  UPDATE public.ordens_servico SET designer_id = p_designer_id WHERE id = p_os_id;

  -- A porta de sempre: as travas (responsável, margem) e o histórico.
  PERFORM public.avancar_os_status(p_os_id, 'briefing_ok'::status_os);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'atendimento_validado',
          jsonb_build_object('designer_id', p_designer_id, 'motivo', v_motivo, 'autorizacao_id', v_autorizacao));

  BEGIN
    v_aviso := public._os_avisar_grupo(p_os_id, 'atendimento_validado', '✅ Atendimento validado',
      format(E'🎨 Criação: %s\n✍️ Validado por %s%s',
        public._citacao_no_texto(p_designer_id),
        coalesce((SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = v_uid), 'o gestor'),
        coalesce(E'\n💬 ' || left(v_motivo, 200), '')),
      ARRAY[public._mencao_whatsapp(p_designer_id)],
      v_autorizacao::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (atendimento validado, OS %): %', p_os_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'designer_id', p_designer_id,
                            'avisou_o_grupo', v_aviso IS NOT NULL);
END $$;

-- Pedir o aval do gestor pelo grupo da equipe (o que hoje é feito à mão no
-- grupo): a validação do atendimento ou o cliente ficar devendo. Qualquer
-- pessoa da equipe pede; um pedido por OS e assunto a cada 15 minutos, para o
-- botão não virar enxurrada no grupo.
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
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Usuário sem permissão para pedir o aval do gestor.' USING ERRCODE = '42501';
  END IF;
  IF p_assunto IS NULL OR p_assunto NOT IN ('atendimento', 'saldo_devedor') THEN
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
                 WHERE au.os_id = p_os_id AND au.tipo = 'saldo_devedor') THEN
    RAISE EXCEPTION 'O gestor já autorizou a OS nº % a produzir com o cliente devendo.', v_os.numero;
  END IF;

  IF public.grupo_equipe_destino() IS NULL THEN
    RAISE EXCEPTION 'O aviso no grupo da equipe está desligado (WhatsApp › Configurações). Chame o gestor por outro caminho.';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x.m), '{}'::text[]) INTO v_mencoes
    FROM (SELECT public._mencao_whatsapp(u.id) AS m
            FROM public.usuarios u
           WHERE u.ativo IS NOT FALSE AND public.eh_gestor(u.id)) x
   WHERE x.m IS NOT NULL;
  v_citacao := CASE WHEN cardinality(v_mencoes) > 0
                    THEN (SELECT string_agg('@' || m, ' ' ORDER BY m) FROM unnest(v_mencoes) m)
                    ELSE 'Gestor' END;
  v_quem := coalesce((SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = v_uid), 'a equipe');

  v_aviso := public._os_avisar_grupo(p_os_id, 'pedir_aval:' || p_assunto,
    CASE p_assunto WHEN 'atendimento' THEN '🟡 Atendimento para validar'
                   ELSE '💳 Cliente vai ficar devendo' END,
    CASE p_assunto
      WHEN 'atendimento' THEN
        format(E'✍️ Pedido por %s\n%s, confira o pedido, escolha quem faz a criação e valide no quadro:', v_quem, v_citacao)
      ELSE
        format(E'✍️ Pedido por %s\n%s, a OS não tem entrada paga. Se o cliente pode produzir devendo, autorize no quadro:', v_quem, v_citacao)
    END,
    v_mencoes,
    p_os_id::text || ':' || floor(extract(epoch FROM now()) / 900)::bigint::text);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'aval_do_gestor_pedido',
          jsonb_build_object('assunto', p_assunto, 'gestores_citados', cardinality(v_mencoes),
                             'novo_aviso', v_aviso IS NOT NULL));

  -- novo_aviso falso: o mesmo pedido dos últimos 15 minutos já está na fila do grupo.
  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'novo_aviso', v_aviso IS NOT NULL,
                            'gestores_citados', cardinality(v_mencoes));
END $$;

-- O gestor autoriza produzir com o cliente devendo.
CREATE OR REPLACE FUNCTION public.autorizar_saldo_devedor(p_os_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_os public.ordens_servico%ROWTYPE;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_pago numeric(12,2);
  v_aberto numeric(12,2);
  v_autorizacao uuid;
BEGIN
  IF NOT public.eh_gestor(v_uid) THEN
    RAISE EXCEPTION 'Só o gestor autoriza produzir com o cliente devendo.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Diga por que o cliente pode ficar devendo (ex.: cliente antigo, paga na entrega).';
  END IF;
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;

  SELECT coalesce(sum(valor), 0) INTO v_pago
    FROM public.pagamentos
   WHERE pagamentos.os_id = p_os_id AND status IN ('parcial', 'pago') AND valor > 0;
  v_aberto := greatest(coalesce(v_os.valor_total, 0) - v_pago, 0);

  INSERT INTO public.os_autorizacoes (os_id, tipo, autorizado_por, motivo, valor_em_aberto)
  VALUES (p_os_id, 'saldo_devedor', v_uid, v_motivo, v_aberto)
  RETURNING id INTO v_autorizacao;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'saldo_devedor_autorizado',
          jsonb_build_object('motivo', v_motivo, 'valor_em_aberto', v_aberto, 'autorizacao_id', v_autorizacao));

  -- O valor fica fora do grupo: o operador também lê o grupo e não vê preço.
  BEGIN
    PERFORM public._os_avisar_grupo(p_os_id, 'saldo_devedor', '💳 Pode produzir sem a entrada',
      format(E'✍️ Autorizado por %s\n💬 %s',
        coalesce((SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = v_uid), 'o gestor'),
        left(v_motivo, 200)),
      '{}'::text[],
      v_autorizacao::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (saldo devedor, OS %): %', p_os_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'valor_em_aberto', v_aberto);
END $$;

-- Mandar para a fila de produção escolhendo o operador, numa transação só: se
-- uma trava barrar, o operador também não fica gravado.
CREATE OR REPLACE FUNCTION public.mandar_para_fila_de_producao(p_os_id uuid, p_operador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prazo date;
  v_aviso uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Usuário sem permissão para mover a OS.' USING ERRCODE = '42501';
  END IF;
  IF p_operador_id IS NULL OR NOT public.is_staff(p_operador_id) THEN
    RAISE EXCEPTION 'Escolha o operador que vai produzir.';
  END IF;
  SELECT prazo_entrega INTO v_prazo FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.ordens_servico SET operador_id = p_operador_id WHERE id = p_os_id;
  PERFORM public.avancar_os_status(p_os_id, 'aguardando_producao'::status_os);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'operador_definido',
          jsonb_build_object('operador_id', p_operador_id, 'origem', 'fila_de_producao'));

  BEGIN
    v_aviso := public._os_avisar_grupo(p_os_id, 'fila_de_producao', '🏭 Na fila de produção',
      format(E'🔧 Operador: %s%s\n✍️ Mandado por %s',
        public._citacao_no_texto(p_operador_id),
        coalesce(E'\n📅 Prazo: ' || to_char(v_prazo, 'DD/MM'), ''),
        coalesce((SELECT split_part(btrim(u.nome), ' ', 1) FROM public.usuarios u WHERE u.id = v_uid), 'a equipe')),
      ARRAY[public._mencao_whatsapp(p_operador_id)],
      p_os_id::text || ':' || p_operador_id::text || ':' || extract(epoch FROM now())::bigint::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (fila de produção, OS %): %', p_os_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'operador_id', p_operador_id,
                            'avisou_o_grupo', v_aviso IS NOT NULL);
END $$;

-- Trocar o operador de uma OS que já está na fila ou na máquina.
CREATE OR REPLACE FUNCTION public.definir_operador_da_os(p_os_id uuid, p_operador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_antes uuid;
  v_status status_os;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'Usuário sem permissão para mudar a OS.' USING ERRCODE = '42501';
  END IF;
  IF p_operador_id IS NOT NULL AND NOT public.is_staff(p_operador_id) THEN
    RAISE EXCEPTION 'Escolha uma pessoa ativa da equipe.';
  END IF;
  SELECT operador_id, status INTO v_antes, v_status FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_antes IS NOT DISTINCT FROM p_operador_id THEN
    RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'operador_id', p_operador_id, 'mudou', false);
  END IF;

  UPDATE public.ordens_servico SET operador_id = p_operador_id WHERE id = p_os_id;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'operador_definido',
          jsonb_build_object('operador_id', p_operador_id, 'antes', v_antes));

  -- Na fila ou na máquina, o operador novo precisa saber que a peça é dele.
  IF p_operador_id IS NOT NULL AND public.etapa_da_os(v_status) IN ('fila_producao', 'producao') THEN
    BEGIN
      PERFORM public._os_avisar_grupo(p_os_id, 'operador_trocado', '🔁 Operador trocado',
        format(E'🔧 Agora com %s', public._citacao_no_texto(p_operador_id)),
        ARRAY[public._mencao_whatsapp(p_operador_id)],
        p_os_id::text || ':' || p_operador_id::text || ':' || extract(epoch FROM now())::bigint::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'aviso no grupo da equipe falhou (operador trocado, OS %): %', p_os_id, SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'operador_id', p_operador_id, 'mudou', true);
END $$;

-- Ficou pronta: a produção devolve a peça ao atendimento, que combina a
-- entrega com o cliente ("quem entrega é o atendimento"). Só a OS de venda, e
-- só quando ENTRA na saída: andar dentro da saída (retirada → entrega) não é
-- ficar pronta de novo. O cliente tem o aviso dele (tg_os_notificar_cliente).
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
    SELECT array_agg(DISTINCT p) INTO v_pessoas
      FROM unnest(ARRAY[NEW.vendedor_id, NEW.responsavel_id]) p
     WHERE p IS NOT NULL AND public.is_staff(p);
    SELECT string_agg(public._citacao_no_texto(p), ' ') INTO v_citacoes FROM unnest(v_pessoas) p;
    v_modo := CASE NEW.status
      WHEN 'aguardando_retirada' THEN '🏪 Retirada no balcão'
      WHEN 'aguardando_entrega' THEN '🚚 Entrega'
      ELSE '🛠️ Instalação' END;

    PERFORM public._os_avisar_grupo(NEW.id, 'os_pronta', '📦 Pronta para entregar',
      format(E'%s\n🤝 Atendimento: %s, combine com o cliente.', v_modo, coalesce(v_citacoes, 'sem responsável')),
      (SELECT array_agg(public._mencao_whatsapp(p)) FROM unnest(v_pessoas) p),
      NEW.id::text || ':' || NEW.status::text || ':' || extract(epoch FROM now())::bigint::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (OS pronta %): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_os_pronta_avisa_atendimento ON public.ordens_servico;
CREATE TRIGGER tg_os_pronta_avisa_atendimento
  AFTER UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_pronta_avisa_atendimento();

-- ---------------------------------------------------------------- 3
-- A etapa nova: `briefing_ok` vira "Atendimento validado". A TV agrupa a etapa
-- nova com a entrada e a arte, como antes (o bloco de cada status não muda).
CREATE OR REPLACE FUNCTION public.etapa_da_os(p_status status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status IN ('entrada', 'aguardando_briefing') THEN 'entrada'
    WHEN p_status IN ('briefing_ok') THEN 'validado'
    WHEN p_status IN ('design', 'aguardando_aprovacao_arte', 'arte_aprovada', 'arte_rejeitada') THEN 'pre_impressao'
    WHEN p_status IN ('aguardando_producao') THEN 'fila_producao'
    WHEN p_status IN ('em_impressao', 'em_corte', 'em_laser_cnc', 'em_3d', 'em_uv', 'em_producao', 'producao') THEN 'producao'
    WHEN p_status IN ('em_acabamento', 'controle_qualidade', 'retrabalho') THEN 'acabamento'
    WHEN p_status IN ('aguardando_retirada', 'aguardando_entrega', 'em_entrega', 'em_instalacao', 'concluido', 'faturado') THEN 'saida'
    WHEN p_status IN ('pausado', 'cancelado') THEN 'fora_do_fluxo'
  END
$function$;

CREATE OR REPLACE FUNCTION public.bloco_da_tv(p_status status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status = 'pausado' THEN 'pausada'
    WHEN public.os_esta_encerrada(p_status) THEN 'fora'
    ELSE CASE public.etapa_da_os(p_status)
      WHEN 'entrada' THEN 'entrada_arte'
      WHEN 'validado' THEN 'entrada_arte'
      WHEN 'pre_impressao' THEN 'entrada_arte'
      WHEN 'fila_producao' THEN 'oficina'
      WHEN 'producao' THEN 'oficina'
      WHEN 'acabamento' THEN 'acabamento'
      WHEN 'saida' THEN 'saida'
    END
  END
$function$;

-- ---------------------------------------------------------------- 4
-- As travas. Mudam duas coisas, o resto é a definição viva de 14/11/2026:
--   - sair do Atendimento para qualquer etapa adiante pede a validação do
--     gestor (`atendimento_nao_validado`) — OS de venda; a de impressão 3D não
--     passa pela criação e fica de fora, como na trava da arte;
--   - "Nenhum pagamento registrado" deixa de travar quando o gestor autorizou o
--     saldo devedor (`os_autorizacoes`, tipo saldo_devedor).
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

    -- Uma pergunta so, para os dois caminhos de aprovacao. Ver
    -- `arte_aprovada_da_os`: lendo so `aprovacoes`, a aprovacao que o cliente
    -- dava pelo link nao contava aqui e a producao ficava barrada.
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

  IF v_os.finalidade = 'venda' AND v_margem IS NOT NULL AND v_margem < v_margem_minima AND NOT EXISTS (
    SELECT 1 FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE a.os_id = os_bloqueios_para.os_id AND a.tipo::text = 'margem_baixa' AND a.aprovado = true
  ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'margem_baixa',
      'titulo', CASE WHEN v_ve_financeiro
                     THEN 'Margem de ' || v_margem || '% abaixo do mínimo de ' || v_margem_minima || '%'
                     ELSE 'Margem abaixo do mínimo — precisa de aprovação do gestor' END,
      'resolver', 'Peça aprovação de um gestor ou revise o preço.'
    );
  END IF;

  -- O desconto não trava mais aqui: a régua dele é a do orçamento
  -- (margem mínima e piso, ou 10% sem custo conhecido), conferida pelo gatilho
  -- de totais ao gravar e por converter_orcamento_em_os antes de a OS nascer.
  -- Os 10% fixos daqui travavam vendedor dentro da alçada e todo pedido de
  -- parceiro com crédito (até 15%), e a aprovação vinha de `aprovacoes`, onde
  -- quem cria orçamento grava qualquer usuario_id.

  RETURN v_bloqueios;
END;
$function$;

-- ---------------------------------------------------------------- 5
-- Permissões: função nasce com EXECUTE para PUBLIC, e anon/authenticated têm
-- grant próprio (revogar só de PUBLIC deixa os dois de pé). As que o navegador
-- chama ficam só para authenticated (cada uma confere o papel por dentro); as
-- de dentro (eh_gestor, as do aviso e o gatilho) só para service_role.
-- Conferido com has_function_privilege: o REVOKE não reclama quando não surte
-- efeito.
DO $fechar$
DECLARE
  v_funcao regprocedure;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.eh_gestor(uuid)',
    'public._mencao_whatsapp(uuid)',
    'public._citacao_no_texto(uuid)',
    'public._os_avisar_grupo(uuid, text, text, text, text[], text)',
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
    'public.validar_atendimento(uuid, uuid, text)',
    'public.pedir_aval_do_gestor(uuid, text)',
    'public.autorizar_saldo_devedor(uuid, text)',
    'public.mandar_para_fila_de_producao(uuid, uuid)',
    'public.definir_operador_da_os(uuid, uuid)',
    'public.equipe_da_producao()'
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
