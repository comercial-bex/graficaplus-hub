-- Cliente sem duplicata, e a conversa do WhatsApp aberta a partir do cliente (20/10/2026).
--
-- Dúvida da Jhessy em 20/10: cadastrou a cliente YRLEN, foi ao WhatsApp, buscou
-- "YRLEN" e não achou nada — "como faço para colocar a pessoa no sistema?".
-- Dois defeitos por trás disso:
--
--   1. YRLEN estava cadastrada CINCO vezes, com o mesmo telefone: uma em 19/10 e
--      quatro em 20/10 às 10:39:28, :29.3, :29.5 e :29.8 — cliques repetidos no
--      "Novo cliente", que não travava enquanto salvava e não conferia se o
--      telefone já existia. Cliente duplicado não é só sujeira: o webhook só
--      liga a conversa sozinho quando o telefone bate com UM cliente, então a
--      YRLEN nunca seria ligada automaticamente.
--   2. A caixa de entrada só conhece conversa que CHEGOU pelo Z-API. Cliente
--      cadastrado que ainda não escreveu não tem conversa, e não havia como a
--      equipe começar uma. A busca da caixa procurava só no nome do contato do
--      WhatsApp, não no nome do cliente ligado.
--
-- Aqui: (1) o banco recusa um segundo cliente ATIVO com o mesmo WhatsApp, dizendo
-- qual é o que já existe; (2) `whatsapp_conversa_do_cliente` acha ou cria a
-- conversa do cliente e devolve o id para a tela abrir. As cinco YRLEN e as duas
-- Cibele Oliveira existentes (os únicos grupos repetidos, medido em 20/10) não
-- são tocadas por esta migração: listar antes de apagar, decisão do dono.

-- 1. Um cliente ativo por WhatsApp -------------------------------------------------
-- DEFINER: a conferência olha TODOS os clientes ativos, não só os que a regra de
-- leitura de quem cadastra deixa ver.
CREATE OR REPLACE FUNCTION public.tg_cliente_sem_duplicata_de_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_chave text;
  v_outro record;
BEGIN
  IF NEW.ativo IS DISTINCT FROM true THEN RETURN NEW; END IF;
  -- O cadastro de parceiro por convite cria o cliente da MARCA do parceiro, com o
  -- telefone que ele mesmo digita; quem já comprou aqui como pessoa não pode
  -- ficar sem conseguir virar parceiro por causa disso.
  IF NEW.origem = 'convite_parceiro' THEN RETURN NEW; END IF;
  v_chave := public.normalize_whatsapp_phone(NEW.telefone);
  IF v_chave IS NULL OR v_chave = '' THEN RETURN NEW; END IF;

  SELECT c.id, c.nome INTO v_outro
    FROM public.clientes c
   WHERE c.ativo = true AND c.id <> NEW.id
     AND public.normalize_whatsapp_phone(c.telefone) = v_chave
   ORDER BY c.created_at
   LIMIT 1;
  IF FOUND THEN
    -- Só a frase: o tradutor de erros da tela junta message, details e hint, e
    -- um id no meio do aviso não ajuda ninguém. A tela já avisa antes do clique.
    RAISE EXCEPTION 'Este WhatsApp já é de "%", que está cadastrado. Abra o cadastro dele em vez de criar outro.', btrim(v_outro.nome)
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.tg_cliente_sem_duplicata_de_whatsapp() FROM PUBLIC, anon, authenticated;

-- "ac": depois de aa_/ab_ (que exigem o WhatsApp) e antes do carimbo do autor.
DROP TRIGGER IF EXISTS ac_cliente_sem_duplicata_de_whatsapp ON public.clientes;
CREATE TRIGGER ac_cliente_sem_duplicata_de_whatsapp
  BEFORE INSERT OR UPDATE OF telefone, ativo ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.tg_cliente_sem_duplicata_de_whatsapp();

-- 2. A conversa do cliente, achada ou criada -----------------------------------------
-- Como as outras escritas da caixa (whatsapp_assumir, whatsapp_nota…): só o
-- servidor chama, com a chave de serviço, depois de conferir a permissão de quem
-- pediu (abrirConversaDoCliente em whatsapp-caixa.functions.ts); a função confere
-- de novo com `_wa_exigir_resposta` — duas trancas.
DROP FUNCTION IF EXISTS public.whatsapp_conversa_do_cliente(uuid);
CREATE OR REPLACE FUNCTION public.whatsapp_conversa_do_cliente(p_cliente_id uuid, p_usuario uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente public.clientes%ROWTYPE;
  v_telefone text;
  v_chave text;
  v_instancia uuid;
  v_conversa_id uuid;
  v_nova boolean := false;
  v_quem text;
BEGIN
  -- Abrir uma conversa é começar a responder: a mesma porta de responder.
  PERFORM public._wa_exigir_resposta(p_usuario);

  SELECT * INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;

  v_telefone := coalesce(nullif(btrim(v_cliente.whatsapp_principal), ''), nullif(btrim(v_cliente.telefone), ''));
  IF v_telefone IS NULL OR NOT public.telefone_recebe_whatsapp(v_telefone) THEN
    RAISE EXCEPTION 'O cliente "%" não tem um WhatsApp válido no cadastro. Corrija o telefone antes de abrir a conversa.', btrim(v_cliente.nome)
      USING ERRCODE = '22023';
  END IF;
  v_chave := public.normalize_whatsapp_phone(v_telefone);

  -- A instância da gráfica: a ativa, de preferência a conectada.
  SELECT id INTO v_instancia FROM public.whatsapp_instancias
   WHERE ativa ORDER BY conectado DESC NULLS LAST, created_at LIMIT 1;
  IF v_instancia IS NULL THEN
    RAISE EXCEPTION 'O WhatsApp da gráfica não está configurado: nenhuma instância ativa.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_conversa_id FROM public.whatsapp_conversas
   WHERE instancia_id = v_instancia AND telefone_normalizado = v_chave
   LIMIT 1 FOR UPDATE;

  IF v_conversa_id IS NOT NULL THEN
    -- A conversa já existia (o cliente escreveu antes de ser cadastrado, por
    -- exemplo): liga ao cliente se ainda estava solta, e reabre se foi resolvida.
    UPDATE public.whatsapp_conversas
       SET cliente_id = coalesce(cliente_id, p_cliente_id),
           nome_contato = coalesce(nome_contato, btrim(v_cliente.nome)),
           status = CASE WHEN status IN ('resolvida', 'arquivada') THEN 'aberta'::whatsapp_conversa_status ELSE status END
     WHERE id = v_conversa_id;
  ELSE
    SELECT split_part(btrim(nome), ' ', 1) INTO v_quem FROM public.usuarios WHERE id = p_usuario;
    INSERT INTO public.whatsapp_conversas (
      instancia_id, telefone, nome_contato, cliente_id, status, fila, modo,
      ultima_mensagem, ultima_mensagem_at, nao_lidas
    ) VALUES (
      v_instancia, v_telefone, btrim(v_cliente.nome), p_cliente_id, 'aberta', 'comercial', 'humano',
      'Conversa aberta por ' || coalesce(v_quem, 'alguém da equipe') || ' pelo cadastro do cliente', now(), 0
    )
    RETURNING id INTO v_conversa_id;
    v_nova := true;
  END IF;

  RETURN jsonb_build_object('id', v_conversa_id, 'nova', v_nova, 'telefone', v_telefone);
END $function$;
COMMENT ON FUNCTION public.whatsapp_conversa_do_cliente(uuid, uuid) IS
  'A conversa do WhatsApp de um cliente cadastrado: acha a que existe (e liga ao cliente) ou cria uma vazia, para a equipe começar a falar. Só service_role; exige whatsapp.reply de p_usuario.';
REVOKE ALL ON FUNCTION public.whatsapp_conversa_do_cliente(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversa_do_cliente(uuid, uuid) TO service_role;
