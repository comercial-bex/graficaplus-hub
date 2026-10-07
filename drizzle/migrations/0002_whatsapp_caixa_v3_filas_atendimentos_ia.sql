
CREATE TYPE public.whatsapp_fila AS ENUM ('comercial','producao','financeiro','administrativo');
CREATE TYPE public.whatsapp_modo AS ENUM ('auto','humano');
CREATE TYPE public.whatsapp_origem_abertura AS ENUM ('mensagem_recebida','manual','reaberto');
CREATE TYPE public.whatsapp_motivo_resolucao AS ENUM ('atendido','sem_resposta_necessaria','spam','duplicado','outro');

ALTER TABLE public.whatsapp_conversas
  ADD COLUMN fila public.whatsapp_fila NOT NULL DEFAULT 'comercial',
  ADD COLUMN modo public.whatsapp_modo NOT NULL DEFAULT 'auto',
  ADD COLUMN aguardando_desde timestamptz;
ALTER TABLE public.usuarios ADD COLUMN filas public.whatsapp_fila[] NOT NULL DEFAULT '{comercial}';

CREATE TABLE public.whatsapp_atendimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  numero text NOT NULL UNIQUE,
  fila public.whatsapp_fila NOT NULL DEFAULT 'comercial',
  aberto_em timestamptz NOT NULL DEFAULT now(),
  aberto_por uuid,
  origem_abertura public.whatsapp_origem_abertura NOT NULL DEFAULT 'mensagem_recebida',
  reaberto_de uuid REFERENCES public.whatsapp_atendimentos(id),
  responsavel_id uuid,
  primeira_resposta_em timestamptz,
  fechado_em timestamptz,
  fechado_por uuid,
  motivo_resolucao public.whatsapp_motivo_resolucao,
  nota_resolucao text,
  CONSTRAINT whatsapp_atendimentos_fechado_check CHECK (
    (fechado_em IS NULL AND fechado_por IS NULL AND motivo_resolucao IS NULL)
    OR (fechado_em IS NOT NULL AND fechado_por IS NOT NULL AND motivo_resolucao IS NOT NULL)),
  CONSTRAINT whatsapp_atendimentos_outro_check CHECK (
    motivo_resolucao IS DISTINCT FROM 'outro' OR nullif(btrim(coalesce(nota_resolucao,'')),'') IS NOT NULL)
);
CREATE UNIQUE INDEX whatsapp_atendimentos_um_aberto ON public.whatsapp_atendimentos (conversa_id) WHERE fechado_em IS NULL;
CREATE INDEX whatsapp_atendimentos_conversa_idx ON public.whatsapp_atendimentos (conversa_id, aberto_em DESC);
GRANT SELECT ON public.whatsapp_atendimentos TO authenticated;
GRANT ALL ON public.whatsapp_atendimentos TO service_role;
ALTER TABLE public.whatsapp_atendimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa atendimentos leitura" ON public.whatsapp_atendimentos FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));

CREATE TABLE public.whatsapp_atendimento_seq (mes text PRIMARY KEY, ultimo integer NOT NULL);
GRANT ALL ON public.whatsapp_atendimento_seq TO service_role;
ALTER TABLE public.whatsapp_atendimento_seq ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.whatsapp_conversas ADD COLUMN atendimento_ativo_id uuid REFERENCES public.whatsapp_atendimentos(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_mensagens ADD COLUMN atendimento_id uuid REFERENCES public.whatsapp_atendimentos(id) ON DELETE SET NULL;

CREATE TABLE public.whatsapp_conversa_leituras (
  conversa_id uuid NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  lido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversa_id, user_id)
);
GRANT SELECT ON public.whatsapp_conversa_leituras TO authenticated;
GRANT ALL ON public.whatsapp_conversa_leituras TO service_role;
ALTER TABLE public.whatsapp_conversa_leituras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa leituras proprias" ON public.whatsapp_conversa_leituras FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE TABLE public.whatsapp_configuracoes (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ia_ativa boolean NOT NULL DEFAULT false,
  horario_inicio time NOT NULL DEFAULT '08:00',
  horario_fim time NOT NULL DEFAULT '18:00',
  dias_semana integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  mensagem_fora_horario text NOT NULL DEFAULT 'Olá! Recebemos sua mensagem fora do horário de atendimento. Assim que abrirmos, alguém da equipe responde você.',
  assinatura text NOT NULL DEFAULT 'Bex Print · assistente',
  endereco text,
  horario_texto text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.whatsapp_configuracoes (id) VALUES (true);
GRANT SELECT ON public.whatsapp_configuracoes TO authenticated;
GRANT ALL ON public.whatsapp_configuracoes TO service_role;
ALTER TABLE public.whatsapp_configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa config leitura" ON public.whatsapp_configuracoes FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));

CREATE TABLE public.whatsapp_ia_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  mensagem_id uuid REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  etapa text NOT NULL CHECK (etapa IN ('classificacao','resposta','transferencia')),
  entrada text,
  saida jsonb,
  modelo text,
  tokens_entrada integer,
  tokens_saida integer,
  duracao_ms integer,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_ia_logs_created_idx ON public.whatsapp_ia_logs (created_at DESC);
CREATE INDEX whatsapp_ia_logs_conversa_idx ON public.whatsapp_ia_logs (conversa_id, created_at DESC);
GRANT SELECT ON public.whatsapp_ia_logs TO authenticated;
GRANT ALL ON public.whatsapp_ia_logs TO service_role;
ALTER TABLE public.whatsapp_ia_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa ia logs leitura" ON public.whatsapp_ia_logs FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));

ALTER TABLE public.whatsapp_conversa_eventos DROP CONSTRAINT whatsapp_conversa_eventos_tipo_check;
ALTER TABLE public.whatsapp_conversa_eventos ADD CONSTRAINT whatsapp_conversa_eventos_tipo_check
  CHECK (tipo IN ('assumida','transferida','status','vinculo','nota','fila','transferida_ia','devolvida_ia','atendimento'));

-- Número WA-AAMM-NNNN, sequência por mês com trava.
CREATE OR REPLACE FUNCTION public.whatsapp_proximo_numero_atendimento()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mes text := to_char(now() AT TIME ZONE 'America/Belem', 'YYMM'); n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wa-atendimento-' || v_mes));
  INSERT INTO public.whatsapp_atendimento_seq AS s (mes, ultimo) VALUES (v_mes, 1)
  ON CONFLICT (mes) DO UPDATE SET ultimo = s.ultimo + 1
  RETURNING ultimo INTO n;
  RETURN 'WA-' || v_mes || '-' || lpad(n::text, 4, '0');
END $$;

-- Abre atendimento na conversa (já travada pelo chamador). Devolve o id do aberto.
CREATE OR REPLACE FUNCTION public._wa_abrir_atendimento(p_conversa_id uuid, p_origem public.whatsapp_origem_abertura, p_usuario uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_anterior uuid; v_fila public.whatsapp_fila;
BEGIN
  SELECT id INTO v_id FROM public.whatsapp_atendimentos WHERE conversa_id = p_conversa_id AND fechado_em IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT id INTO v_anterior FROM public.whatsapp_atendimentos WHERE conversa_id = p_conversa_id ORDER BY aberto_em DESC LIMIT 1;
  SELECT fila INTO v_fila FROM public.whatsapp_conversas WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_atendimentos (conversa_id, numero, fila, aberto_por, origem_abertura, reaberto_de)
  VALUES (p_conversa_id, public.whatsapp_proximo_numero_atendimento(), coalesce(v_fila,'comercial'), p_usuario,
          CASE WHEN p_origem = 'mensagem_recebida' AND v_anterior IS NOT NULL THEN 'reaberto'::public.whatsapp_origem_abertura ELSE p_origem END,
          v_anterior)
  ON CONFLICT (conversa_id) WHERE fechado_em IS NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.whatsapp_atendimentos WHERE conversa_id = p_conversa_id AND fechado_em IS NULL;
  END IF;
  UPDATE public.whatsapp_conversas
     SET atendimento_ativo_id = v_id,
         responsavel_id = CASE WHEN v_anterior IS NOT NULL AND p_origem = 'mensagem_recebida' THEN NULL ELSE responsavel_id END,
         modo = CASE WHEN v_anterior IS NOT NULL AND p_origem = 'mensagem_recebida' THEN 'auto'::public.whatsapp_modo ELSE modo END
   WHERE id = p_conversa_id;
  RETURN v_id;
END $$;

-- Grava o atendimento NA INSERÇÃO de cada mensagem e mantém espera/1ª resposta.
CREATE OR REPLACE FUNCTION public._wa_mensagem_antes_inserir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.whatsapp_conversas%ROWTYPE; v_at uuid; v_quando timestamptz;
BEGIN
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = NEW.conversa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_quando := coalesce(NEW.recebido_em, NEW.enviado_em, now());
  IF NEW.direcao = 'entrada' THEN
    v_at := coalesce(c.atendimento_ativo_id, public._wa_abrir_atendimento(c.id, 'mensagem_recebida', NULL));
    UPDATE public.whatsapp_conversas SET aguardando_desde = coalesce(aguardando_desde, v_quando) WHERE id = c.id;
  ELSE
    IF NEW.enviada_por IS NULL AND coalesce(NEW.origem,'humano') = 'humano' THEN NEW.origem := 'celular'; END IF;
    v_at := c.atendimento_ativo_id;
    IF NEW.origem IN ('humano','celular') THEN
      IF v_at IS NOT NULL THEN
        UPDATE public.whatsapp_atendimentos
           SET primeira_resposta_em = coalesce(primeira_resposta_em, v_quando),
               responsavel_id = coalesce(responsavel_id, NEW.enviada_por)
         WHERE id = v_at;
      END IF;
      UPDATE public.whatsapp_conversas
         SET aguardando_desde = NULL, modo = 'humano',
             responsavel_id = coalesce(responsavel_id, NEW.enviada_por)
       WHERE id = c.id;
    ELSIF NEW.origem = 'ia' THEN
      UPDATE public.whatsapp_conversas SET aguardando_desde = NULL WHERE id = c.id;
    END IF;
  END IF;
  NEW.atendimento_id := coalesce(NEW.atendimento_id, v_at);
  RETURN NEW;
END $$;
CREATE TRIGGER whatsapp_mensagens_atendimento BEFORE INSERT ON public.whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION public._wa_mensagem_antes_inserir();

-- Migração dos dados existentes.
DO $$
DECLARE r record; v_admin uuid; v_id uuid;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  FOR r IN SELECT * FROM public.whatsapp_conversas ORDER BY created_at LOOP
    IF r.status IN ('aberta','pendente') OR v_admin IS NULL AND r.responsavel_id IS NULL THEN
      INSERT INTO public.whatsapp_atendimentos (conversa_id, numero, fila, aberto_em, origem_abertura, responsavel_id)
      VALUES (r.id, public.whatsapp_proximo_numero_atendimento(), r.fila, r.created_at, 'mensagem_recebida', r.responsavel_id)
      RETURNING id INTO v_id;
      UPDATE public.whatsapp_conversas SET atendimento_ativo_id = v_id WHERE id = r.id;
    ELSE
      INSERT INTO public.whatsapp_atendimentos (conversa_id, numero, fila, aberto_em, origem_abertura, responsavel_id,
        fechado_em, fechado_por, motivo_resolucao, nota_resolucao)
      VALUES (r.id, public.whatsapp_proximo_numero_atendimento(), r.fila, r.created_at, 'mensagem_recebida', r.responsavel_id,
        coalesce(r.updated_at, now()), coalesce(r.responsavel_id, v_admin), 'outro', 'Anterior ao histórico de atendimentos (migração).')
      RETURNING id INTO v_id;
    END IF;
    UPDATE public.whatsapp_mensagens SET atendimento_id = v_id WHERE conversa_id = r.id;
  END LOOP;
  UPDATE public.whatsapp_conversas c SET aguardando_desde = x.quando
    FROM (SELECT DISTINCT ON (conversa_id) conversa_id, direcao, coalesce(recebido_em, enviado_em, created_at) quando
            FROM public.whatsapp_mensagens ORDER BY conversa_id, coalesce(recebido_em, enviado_em, created_at) DESC) x
   WHERE x.conversa_id = c.id AND x.direcao = 'entrada' AND c.status IN ('aberta','pendente');
  UPDATE public.whatsapp_conversas SET modo = 'humano' WHERE responsavel_id IS NOT NULL;
END $$;

-- ===== Leituras (somente leitura, liberadas para a equipe) =====
DROP FUNCTION IF EXISTS public.whatsapp_equipe();
CREATE FUNCTION public.whatsapp_equipe()
RETURNS TABLE (id uuid, nome text, avatar_url text, filas public.whatsapp_fila[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nome, u.avatar_url, u.filas FROM public.usuarios u
  WHERE u.ativo IS NOT FALSE AND public.is_staff(u.id)
    AND public.has_permission(auth.uid(), 'whatsapp.read')
  ORDER BY u.nome
$$;
REVOKE ALL ON FUNCTION public.whatsapp_equipe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_equipe() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_minhas_filas()
RETURNS public.whatsapp_fila[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT filas FROM public.usuarios WHERE id = auth.uid()), '{comercial}')
$$;
REVOKE ALL ON FUNCTION public.whatsapp_minhas_filas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_minhas_filas() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_contagem_por_fila()
RETURNS TABLE (fila public.whatsapp_fila, abertas bigint, aguardando bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.fila, count(c.id) FILTER (WHERE c.status IN ('aberta','pendente')),
         count(c.id) FILTER (WHERE c.status IN ('aberta','pendente') AND c.aguardando_desde IS NOT NULL)
  FROM unnest(enum_range(NULL::public.whatsapp_fila)) AS f(fila)
  LEFT JOIN public.whatsapp_conversas c ON c.fila = f.fila
  WHERE public.has_permission(auth.uid(), 'whatsapp.read')
  GROUP BY f.fila ORDER BY f.fila
$$;
REVOKE ALL ON FUNCTION public.whatsapp_contagem_por_fila() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_contagem_por_fila() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_nao_lidas()
RETURNS TABLE (conversa_id uuid, fila public.whatsapp_fila, nao_lidas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.fila, count(m.id)
  FROM public.whatsapp_conversas c
  JOIN public.whatsapp_mensagens m ON m.conversa_id = c.id AND m.direcao = 'entrada'
  LEFT JOIN public.whatsapp_conversa_leituras l ON l.conversa_id = c.id AND l.user_id = auth.uid()
  WHERE c.status IN ('aberta','pendente')
    AND m.created_at > coalesce(l.lido_em, '-infinity'::timestamptz)
    AND public.has_permission(auth.uid(), 'whatsapp.read')
  GROUP BY c.id, c.fila
$$;
REVOKE ALL ON FUNCTION public.whatsapp_nao_lidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_nao_lidas() TO authenticated, service_role;

-- ===== Escritas (só service_role) =====
CREATE OR REPLACE FUNCTION public.whatsapp_assumir(p_conversa_id uuid, p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_antes uuid; v_at uuid;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  SELECT responsavel_id, atendimento_ativo_id INTO v_antes, v_at FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas SET responsavel_id = p_usuario, modo = 'humano' WHERE id = p_conversa_id;
  UPDATE public.whatsapp_atendimentos SET responsavel_id = p_usuario WHERE id = v_at;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, para_usuario, detalhe)
  VALUES (p_conversa_id, 'assumida', p_usuario, p_usuario, jsonb_build_object('antes', v_antes));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_transferir(p_conversa_id uuid, p_usuario uuid, p_para uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at uuid;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_para IS NULL OR NOT public.is_staff(p_para) THEN
    RAISE EXCEPTION 'Escolha uma pessoa ativa da equipe para transferir.';
  END IF;
  SELECT atendimento_ativo_id INTO v_at FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas SET responsavel_id = p_para, modo = 'humano' WHERE id = p_conversa_id;
  UPDATE public.whatsapp_atendimentos SET responsavel_id = p_para WHERE id = v_at;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, para_usuario)
  VALUES (p_conversa_id, 'transferida', p_usuario, p_para);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_mudar_status(p_conversa_id uuid, p_usuario uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_antes text; v_at uuid;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_status NOT IN ('aberta','pendente','arquivada') THEN
    RAISE EXCEPTION 'Para resolver, use "Resolver" e escolha o motivo.';
  END IF;
  SELECT status::text, atendimento_ativo_id INTO v_antes, v_at FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF p_status = 'arquivada' AND v_at IS NOT NULL THEN
    UPDATE public.whatsapp_atendimentos SET fechado_em = now(), fechado_por = p_usuario,
      motivo_resolucao = 'sem_resposta_necessaria', nota_resolucao = 'Arquivada'
     WHERE id = v_at AND fechado_em IS NULL;
    UPDATE public.whatsapp_conversas SET atendimento_ativo_id = NULL WHERE id = p_conversa_id;
  ELSIF p_status = 'aberta' AND v_at IS NULL THEN
    PERFORM public._wa_abrir_atendimento(p_conversa_id, 'manual', p_usuario);
  END IF;
  UPDATE public.whatsapp_conversas
     SET status = p_status::whatsapp_conversa_status,
         nao_lidas = CASE WHEN p_status = 'arquivada' THEN 0 ELSE nao_lidas END,
         aguardando_desde = CASE WHEN p_status = 'arquivada' THEN NULL ELSE aguardando_desde END
   WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'status', p_usuario, jsonb_build_object('de', v_antes, 'para', p_status));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_resolver(p_conversa_id uuid, p_usuario uuid, p_motivo text, p_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_antes text; v_at uuid; v_ultima text; v_numero text; v_nota text := nullif(btrim(coalesce(p_nota,'')),'');
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_motivo NOT IN ('atendido','sem_resposta_necessaria','spam','duplicado','outro') THEN
    RAISE EXCEPTION 'Escolha o motivo da resolução.';
  END IF;
  IF p_motivo = 'outro' AND v_nota IS NULL THEN RAISE EXCEPTION 'O motivo "outro" exige uma nota.'; END IF;
  SELECT status::text, atendimento_ativo_id INTO v_antes, v_at FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  SELECT direcao::text INTO v_ultima FROM public.whatsapp_mensagens
   WHERE conversa_id = p_conversa_id ORDER BY coalesce(recebido_em, enviado_em, created_at) DESC LIMIT 1;
  IF p_motivo = 'atendido' AND v_ultima = 'entrada' THEN
    RAISE EXCEPTION 'O cliente mandou a última mensagem; responda ou marque outro motivo.';
  END IF;
  IF v_at IS NOT NULL THEN
    UPDATE public.whatsapp_atendimentos
       SET fechado_em = now(), fechado_por = p_usuario, motivo_resolucao = p_motivo::public.whatsapp_motivo_resolucao, nota_resolucao = v_nota
     WHERE id = v_at AND fechado_em IS NULL
     RETURNING numero INTO v_numero;
  END IF;
  UPDATE public.whatsapp_conversas
     SET status = 'resolvida', atendimento_ativo_id = NULL, nao_lidas = 0, aguardando_desde = NULL
   WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'status', p_usuario,
    jsonb_build_object('de', v_antes, 'para', 'resolvida', 'motivo', p_motivo, 'nota', v_nota, 'atendimento', v_numero));
  RETURN jsonb_build_object('ok', true, 'atendimento', v_numero);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_transferir_fila(p_conversa_id uuid, p_usuario uuid, p_fila text, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_de text; v_at uuid; v_motivo text := nullif(btrim(coalesce(p_motivo,'')),'');
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo da transferência de fila.'; END IF;
  IF p_fila NOT IN ('comercial','producao','financeiro','administrativo') THEN RAISE EXCEPTION 'Fila inválida.'; END IF;
  SELECT fila::text, atendimento_ativo_id INTO v_de, v_at FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF v_de = p_fila THEN RAISE EXCEPTION 'A conversa já está nessa fila.'; END IF;
  UPDATE public.whatsapp_conversas SET fila = p_fila::public.whatsapp_fila, responsavel_id = NULL WHERE id = p_conversa_id;
  UPDATE public.whatsapp_atendimentos SET fila = p_fila::public.whatsapp_fila, responsavel_id = NULL WHERE id = v_at;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'fila', p_usuario, jsonb_build_object('de', v_de, 'para', p_fila, 'motivo', v_motivo));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_devolver_ia(p_conversa_id uuid, p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  PERFORM 1 FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas SET modo = 'auto', responsavel_id = NULL WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario) VALUES (p_conversa_id, 'devolvida_ia', p_usuario);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_marcar_lida(p_conversa_id uuid, p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'whatsapp.read') THEN
    RAISE EXCEPTION 'Sem permissão para ler conversas do WhatsApp.';
  END IF;
  INSERT INTO public.whatsapp_conversa_leituras (conversa_id, user_id, lido_em) VALUES (p_conversa_id, p_usuario, now())
  ON CONFLICT (conversa_id, user_id) DO UPDATE SET lido_em = now();
  IF public.has_permission(p_usuario, 'whatsapp.reply') THEN
    UPDATE public.whatsapp_conversas SET nao_lidas = 0 WHERE id = p_conversa_id AND nao_lidas > 0;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_definir_filas_usuario(p_admin uuid, p_usuario_alvo uuid, p_filas text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_admin IS NULL OR NOT public.has_role(p_admin, 'admin') THEN
    RAISE EXCEPTION 'Só o administrador define as filas da equipe.';
  END IF;
  UPDATE public.usuarios SET filas = coalesce(p_filas, '{}')::public.whatsapp_fila[] WHERE id = p_usuario_alvo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada.'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_salvar_configuracoes(p_usuario uuid, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN
    RAISE EXCEPTION 'Configurar o WhatsApp exige a permissão whatsapp › manage.';
  END IF;
  UPDATE public.whatsapp_configuracoes SET
    ia_ativa = coalesce((p_config->>'ia_ativa')::boolean, ia_ativa),
    horario_inicio = coalesce((p_config->>'horario_inicio')::time, horario_inicio),
    horario_fim = coalesce((p_config->>'horario_fim')::time, horario_fim),
    dias_semana = coalesce((SELECT array_agg(x::int) FROM jsonb_array_elements_text(p_config->'dias_semana') x), dias_semana),
    mensagem_fora_horario = coalesce(nullif(btrim(p_config->>'mensagem_fora_horario'),''), mensagem_fora_horario),
    assinatura = coalesce(nullif(btrim(p_config->>'assinatura'),''), assinatura),
    endereco = CASE WHEN p_config ? 'endereco' THEN nullif(btrim(p_config->>'endereco'),'') ELSE endereco END,
    horario_texto = CASE WHEN p_config ? 'horario_texto' THEN nullif(btrim(p_config->>'horario_texto'),'') ELSE horario_texto END,
    updated_at = now(), updated_by = p_usuario
  WHERE id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ===== Assistente de IA (só o servidor) =====
CREATE OR REPLACE FUNCTION public.whatsapp_ia_classificar(p_conversa_id uuid, p_intencao text, p_fila text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.whatsapp_conversas%ROWTYPE; v_etiqueta text;
BEGIN
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  v_etiqueta := CASE p_intencao WHEN 'orcamento' THEN 'Orçamento' WHEN 'acompanhamento_os' THEN 'Acompanhamento de OS'
    WHEN 'financeiro' THEN 'Financeiro' WHEN 'administrativo' THEN 'Administrativo' ELSE NULL END;
  IF v_etiqueta IS NOT NULL AND NOT (v_etiqueta = ANY(coalesce(c.etiquetas,'{}'))) THEN
    UPDATE public.whatsapp_conversas SET etiquetas = array_append(coalesce(etiquetas,'{}'), v_etiqueta) WHERE id = c.id;
  END IF;
  IF p_fila IN ('comercial','producao','financeiro','administrativo') AND p_fila <> c.fila::text AND c.responsavel_id IS NULL THEN
    UPDATE public.whatsapp_conversas SET fila = p_fila::public.whatsapp_fila WHERE id = c.id;
    UPDATE public.whatsapp_atendimentos SET fila = p_fila::public.whatsapp_fila WHERE id = c.atendimento_ativo_id;
    INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, detalhe)
    VALUES (c.id, 'fila', jsonb_build_object('de', c.fila, 'para', p_fila, 'motivo', 'classificação automática'));
    RETURN jsonb_build_object('fila_mudou', true);
  END IF;
  RETURN jsonb_build_object('fila_mudou', false);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_ia_enviar(p_conversa_id uuid, p_texto text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.whatsapp_conversas%ROWTYPE; v_msg uuid; v_fila uuid; v_texto text := btrim(coalesce(p_texto,''));
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Texto vazio.'; END IF;
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, cliente_id, os_id, enviada_por, origem, payload)
  VALUES (c.id, c.instancia_id, 'saida', 'texto', 'pendente', left(v_texto, 4096), c.cliente_id, c.os_id, NULL, 'ia', coalesce(p_payload,'{}'))
  RETURNING id INTO v_msg;
  INSERT INTO public.whatsapp_fila_envio (conversa_id, mensagem_id, payload, status, idempotency_key)
  VALUES (c.id, v_msg, jsonb_build_object('tipo','texto','texto', left(v_texto, 4096)), 'pendente', 'ia:' || v_msg::text)
  RETURNING id INTO v_fila;
  UPDATE public.whatsapp_conversas SET ultima_mensagem = left(v_texto, 500), ultima_mensagem_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('mensagem_id', v_msg, 'fila_id', v_fila);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_ia_transferir(p_conversa_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas SET modo = 'humano', aguardando_desde = now() WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, detalhe)
  VALUES (p_conversa_id, 'transferida_ia', jsonb_build_object('motivo', coalesce(p_motivo, 'transferência do assistente')));
  RETURN jsonb_build_object('ok', true);
END $$;

-- REVOKE em todas as funções que escrevem.
REVOKE ALL ON FUNCTION public.whatsapp_proximo_numero_atendimento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._wa_abrir_atendimento(uuid, public.whatsapp_origem_abertura, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._wa_mensagem_antes_inserir() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assumir(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_transferir(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_mudar_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_resolver(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_transferir_fila(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_devolver_ia(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_marcar_lida(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_definir_filas_usuario(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_salvar_configuracoes(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_ia_classificar(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_ia_transferir(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_proximo_numero_atendimento() TO service_role;
GRANT EXECUTE ON FUNCTION public._wa_abrir_atendimento(uuid, public.whatsapp_origem_abertura, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_assumir(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_transferir(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_mudar_status(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_resolver(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_transferir_fila(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_devolver_ia(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_marcar_lida(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_definir_filas_usuario(uuid, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_salvar_configuracoes(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_ia_classificar(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_ia_transferir(uuid, text) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_atendimentos;
