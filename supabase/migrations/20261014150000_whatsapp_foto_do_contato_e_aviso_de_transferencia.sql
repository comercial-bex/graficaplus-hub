-- WhatsApp: a foto do contato na caixa e o aviso ao cliente na transferência
-- (pedido do dono em 14/10/2026).
--
-- 1. FOTO DO CONTATO. Todo ReceivedCallback do Z-API traz `photo`: o link da
--    foto de perfil do contato (pps.whatsapp.net). Ninguém guardava — a caixa
--    mostrava só as iniciais, de todo mundo. O link vence (o parâmetro `oe` dos
--    que chegaram aqui dá ~10 dias), então o servidor baixa uma cópia para o
--    bucket privado `whatsapp-midias` (fotos/<conversa>.jpg) e a conversa
--    guarda o caminho. `foto_chave` é o caminho do link sem a assinatura: mudou
--    a chave, o contato trocou de foto e a cópia é refeita. Para quem não
--    escreveu desde então, `whatsapp_fotos_pendentes` devolve a última foto
--    vista no webhook (ainda válida) ou nada — aí o servidor pergunta ao Z-API
--    (GET /profile-picture). Sem foto (privacidade do contato), fica a tentativa
--    anotada e só se tenta de novo em 7 dias.
--
-- 2. AVISO AO CLIENTE NA TRANSFERÊNCIA. Quem transfere pode mandar ao cliente,
--    na mesma transação, a frase "vou passar seu atendimento para a Produção…".
--    Vai como mensagem da pessoa (o despachante assina com o nome e o setor de
--    quem escreveu, na fila de ANTES da transferência — `fila` no payload).
--    A ordem importa: a mensagem entra primeiro (o gatilho a anota como 1ª
--    resposta e marcaria quem escreveu como responsável) e só depois a
--    transferência tira o responsável e muda a fila. Depois de transferida, a
--    conversa fica esperando o novo dono (aguardando_desde), como já faz a
--    transferência da assistente de IA: cai na fila humana do outro setor.
--    WhatsApp desconectado não impede a transferência: o aviso não é
--    enfileirado e a resposta diz por quê.

-- ---------------------------------------------------------------- 1
ALTER TABLE public.whatsapp_conversas
  ADD COLUMN IF NOT EXISTS foto_path text,
  ADD COLUMN IF NOT EXISTS foto_chave text,
  ADD COLUMN IF NOT EXISTS foto_atualizada_em timestamptz,
  ADD COLUMN IF NOT EXISTS foto_tentativa_em timestamptz;

COMMENT ON COLUMN public.whatsapp_conversas.foto_path IS
  'Cópia da foto de perfil do contato no bucket whatsapp-midias (fotos/<conversa>.jpg). Só o servidor grava.';
COMMENT ON COLUMN public.whatsapp_conversas.foto_chave IS
  'Caminho do link do WhatsApp (sem a assinatura que vence): mudou, o contato trocou de foto.';
COMMENT ON COLUMN public.whatsapp_conversas.foto_tentativa_em IS
  'Última vez que o servidor procurou a foto. Sem foto (privacidade), tenta de novo em 7 dias.';

-- A conversa de um telefone: o mesmo casamento de whatsapp_registrar_mensagem
-- (normalize_whatsapp_phone dos dois lados; o Z-API manda 5596…, a conversa
-- pode ter o 9 a mais).
CREATE OR REPLACE FUNCTION public.whatsapp_conversa_do_telefone(p_instancia_id uuid, p_telefone text)
RETURNS TABLE (conversa_id uuid, telefone text, foto_path text, foto_chave text, foto_atualizada_em timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.telefone, c.foto_path, c.foto_chave, c.foto_atualizada_em
    FROM public.whatsapp_conversas c
   WHERE c.instancia_id = p_instancia_id
     AND public.normalize_whatsapp_phone(c.telefone) = public.normalize_whatsapp_phone(p_telefone)
   ORDER BY c.ultima_mensagem_at DESC NULLS LAST
   LIMIT 1
$$;

-- Conversas sem foto (ou com a última tentativa há mais de 7 dias), da mais
-- recente para a mais antiga, com a última foto que o webhook viu do número
-- nos últimos 10 dias (o link vale isso).
CREATE OR REPLACE FUNCTION public.whatsapp_fotos_pendentes(p_limite integer DEFAULT 5)
RETURNS TABLE (conversa_id uuid, instancia_id uuid, telefone text, ultima_foto text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.instancia_id, c.telefone,
         (SELECT e.payload->>'photo'
            FROM public.whatsapp_webhook_eventos e
           WHERE e.created_at > now() - interval '10 days'
             AND e.payload->>'type' = 'ReceivedCallback'
             AND coalesce(e.payload->>'isGroup', 'false') <> 'true'
             AND e.payload->>'photo' LIKE 'https://%'
             AND public.normalize_whatsapp_phone(e.payload->>'phone') = public.normalize_whatsapp_phone(c.telefone)
           ORDER BY e.created_at DESC
           LIMIT 1)
    FROM public.whatsapp_conversas c
   WHERE c.foto_path IS NULL
     AND (c.foto_tentativa_em IS NULL OR c.foto_tentativa_em < now() - interval '7 days')
   ORDER BY c.ultima_mensagem_at DESC NULLS LAST
   LIMIT greatest(1, least(coalesce(p_limite, 5), 20))
$$;

-- ---------------------------------------------------------------- 2
-- A mensagem da equipe ao cliente, enfileirada por dentro de outra função
-- (hoje, as duas transferências). As mesmas recusas de whatsapp_responder,
-- mas sem exceção: devolve {enfileirado:false, motivo} e quem chamou segue.
CREATE OR REPLACE FUNCTION public._wa_enfileirar_mensagem_da_equipe(
  p_conversa_id uuid, p_usuario uuid, p_texto text, p_fila text, p_origem text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_texto text := btrim(coalesce(p_texto, ''));
  v_conversa public.whatsapp_conversas%ROWTYPE;
  v_conectado boolean;
  v_status text;
  v_ativa boolean;
  v_mensagem_id uuid;
  v_fila_id uuid;
BEGIN
  IF v_texto = '' THEN
    RETURN jsonb_build_object('enfileirado', false, 'motivo', 'texto vazio');
  END IF;
  IF length(v_texto) > 4096 THEN
    RAISE EXCEPTION 'Aviso longo demais: % caracteres (o WhatsApp aceita até 4.096).', length(v_texto);
  END IF;

  SELECT * INTO v_conversa FROM public.whatsapp_conversas WHERE id = p_conversa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;

  SELECT i.conectado, i.status::text, i.ativa INTO v_conectado, v_status, v_ativa
    FROM public.whatsapp_instancias i WHERE i.id = v_conversa.instancia_id;
  IF NOT FOUND OR v_ativa IS NOT TRUE THEN
    RETURN jsonb_build_object('enfileirado', false, 'motivo', 'a instância de WhatsApp desta conversa está desativada');
  END IF;
  IF v_conectado IS NOT TRUE OR v_status IS DISTINCT FROM 'conectada' THEN
    RETURN jsonb_build_object('enfileirado', false, 'motivo', 'WhatsApp desconectado');
  END IF;
  IF NOT public.telefone_recebe_whatsapp(v_conversa.telefone) THEN
    RETURN jsonb_build_object('enfileirado', false, 'motivo', 'o número desta conversa não recebe WhatsApp');
  END IF;

  INSERT INTO public.whatsapp_mensagens (
    conversa_id, instancia_id, direcao, tipo, status, texto,
    cliente_id, os_id, enviada_por, payload
  ) VALUES (
    v_conversa.id, v_conversa.instancia_id, 'saida', 'texto', 'pendente', v_texto,
    v_conversa.cliente_id, v_conversa.os_id, p_usuario,
    jsonb_build_object('origem', p_origem)
  )
  RETURNING id INTO v_mensagem_id;

  -- `fila`: o setor de quem escreveu, para a assinatura (o despachante lê
  -- daqui antes de ler a fila atual da conversa).
  INSERT INTO public.whatsapp_fila_envio (
    conversa_id, mensagem_id, payload, status, idempotency_key, created_by
  ) VALUES (
    v_conversa.id, v_mensagem_id,
    jsonb_build_object('tipo', 'texto', 'texto', v_texto, 'fila', p_fila),
    'pendente', p_origem || ':' || v_mensagem_id::text, p_usuario
  )
  RETURNING id INTO v_fila_id;

  UPDATE public.whatsapp_conversas
     SET ultima_mensagem = left(v_texto, 500), ultima_mensagem_at = now(), nao_lidas = 0
   WHERE id = v_conversa.id;

  RETURN jsonb_build_object('enfileirado', true, 'mensagem_id', v_mensagem_id, 'fila_id', v_fila_id);
END $$;

-- Transferir para outra fila, com aviso opcional ao cliente.
DROP FUNCTION IF EXISTS public.whatsapp_transferir_fila(uuid, uuid, text, text);
CREATE FUNCTION public.whatsapp_transferir_fila(
  p_conversa_id uuid, p_usuario uuid, p_fila text, p_motivo text, p_aviso text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_de text;
  v_at uuid;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_aviso text := nullif(btrim(coalesce(p_aviso, '')), '');
  v_resultado jsonb := NULL;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo da transferência de fila.'; END IF;
  IF p_fila NOT IN ('comercial','producao','financeiro','administrativo') THEN RAISE EXCEPTION 'Fila inválida.'; END IF;
  SELECT fila::text, atendimento_ativo_id INTO v_de, v_at FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF v_de = p_fila THEN RAISE EXCEPTION 'A conversa já está nessa fila.'; END IF;

  -- Primeiro o aviso (escrito no setor de origem), depois a transferência.
  IF v_aviso IS NOT NULL THEN
    v_resultado := public._wa_enfileirar_mensagem_da_equipe(p_conversa_id, p_usuario, v_aviso, v_de, 'transferencia');
  END IF;

  UPDATE public.whatsapp_conversas
     SET fila = p_fila::public.whatsapp_fila,
         responsavel_id = NULL,
         aguardando_desde = coalesce(aguardando_desde, now())
   WHERE id = p_conversa_id;
  UPDATE public.whatsapp_atendimentos SET fila = p_fila::public.whatsapp_fila, responsavel_id = NULL WHERE id = v_at;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'fila', p_usuario,
          jsonb_build_object('de', v_de, 'para', p_fila, 'motivo', v_motivo,
                             'aviso_ao_cliente', coalesce((v_resultado->>'enfileirado')::boolean, false)));
  RETURN jsonb_build_object('ok', true, 'aviso', v_resultado);
END $$;

-- Transferir para uma pessoa, com aviso opcional ao cliente.
DROP FUNCTION IF EXISTS public.whatsapp_transferir(uuid, uuid, uuid);
CREATE FUNCTION public.whatsapp_transferir(
  p_conversa_id uuid, p_usuario uuid, p_para uuid, p_aviso text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_at uuid;
  v_fila text;
  v_aviso text := nullif(btrim(coalesce(p_aviso, '')), '');
  v_resultado jsonb := NULL;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_para IS NULL OR NOT public.is_staff(p_para) THEN
    RAISE EXCEPTION 'Escolha uma pessoa ativa da equipe para transferir.';
  END IF;
  SELECT atendimento_ativo_id, fila::text INTO v_at, v_fila FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;

  IF v_aviso IS NOT NULL THEN
    v_resultado := public._wa_enfileirar_mensagem_da_equipe(p_conversa_id, p_usuario, v_aviso, v_fila, 'transferencia');
  END IF;

  UPDATE public.whatsapp_conversas
     SET responsavel_id = p_para, modo = 'humano',
         aguardando_desde = CASE WHEN v_resultado IS NOT NULL THEN coalesce(aguardando_desde, now()) ELSE aguardando_desde END
   WHERE id = p_conversa_id;
  UPDATE public.whatsapp_atendimentos SET responsavel_id = p_para WHERE id = v_at;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, para_usuario, detalhe)
  VALUES (p_conversa_id, 'transferida', p_usuario, p_para,
          jsonb_build_object('aviso_ao_cliente', coalesce((v_resultado->>'enfileirado')::boolean, false)));
  RETURN jsonb_build_object('ok', true, 'aviso', v_resultado);
END $$;

-- ---------------------------------------------------------------- 3
-- Tudo isto é só do servidor (chave de serviço). Função nasce com EXECUTE
-- para PUBLIC, e anon/authenticated têm grant próprio: revogar dos três e
-- conferir.
DO $fechar$
DECLARE
  v_funcao regprocedure;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.whatsapp_conversa_do_telefone(uuid, text)',
    'public.whatsapp_fotos_pendentes(integer)',
    'public._wa_enfileirar_mensagem_da_equipe(uuid, uuid, text, text, text)',
    'public.whatsapp_transferir_fila(uuid, uuid, text, text, text)',
    'public.whatsapp_transferir(uuid, uuid, uuid, text)'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_funcao);
    IF has_function_privilege('anon', v_funcao, 'EXECUTE')
       OR has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION 'continua aberta para o navegador: %', v_funcao;
    END IF;
  END LOOP;
END
$fechar$;

-- O PostgREST relê as funções (as duas transferências trocaram de assinatura;
-- a chamada antiga, com 4 nomes, continua casando pelo DEFAULT de p_aviso).
NOTIFY pgrst, 'reload schema';
