-- Máquina escolhida pelo operador e a validação do gestor sem atalho
-- (pedido do dono, 15/11/2026).
--
-- 1. "Eu seleciono o operador e o operador seleciona a máquina, dentro do modal
--    da tarefa do Kanban." Na fila de produção, o operador põe a OS na fila de
--    uma máquina (definir_maquina_da_os) — a TV já mostra a OS na coluna dessa
--    máquina; para começar, a ficha usa comecar_na_maquina, que já existia.
--
-- 2. Atalho achado em 14/11/2026, 21:19: a OS 221 (venda, sem validação) foi de
--    "Entrada" para "Arte aprovada". O registro do aceite da arte na ficha
--    (registrar_aceite_da_arte) muda o status direto, sem passar pelas travas —
--    e o mesmo fazem registrar_aprovacao_interna, decidir_arte_por_token (o link
--    do cliente) e criar_link_aprovacao. As travas de os_bloqueios_para só valem
--    para quem passa por avancar_os_status.
--
--    A guarda agora é da TABELA (gatilho antes de mudar o status), para todo
--    caminho, de hoje e de amanhã:
--      - OS de venda no Atendimento, sem a validação do gestor, não sai para
--        etapa adiante;
--      - se quem mexe é o fluxo da arte (aceite, aprovação, link ao cliente), a
--        decisão do cliente fica gravada e a OS continua no Atendimento,
--        esperando o gestor — o mockup aprovado no orçamento é aceite legítimo;
--      - qualquer outro caminho é recusado com a explicação.
--    registrar_aceite_da_arte passa a devolver o status de verdade (a tela não
--    diz "Arte aprovada" com a OS ainda no Atendimento).

-- ---------------------------------------------------------------- 1
-- A OS espera a validação do gestor? (venda, no Atendimento, não é 3D, sem validação)
CREATE OR REPLACE FUNCTION public.os_espera_validacao_do_gestor(p_os_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ordens_servico o
     WHERE o.id = p_os_id
       AND o.finalidade = 'venda'
       AND public.etapa_da_os(o.status) = 'entrada'
       AND NOT public.os_e_impressao_3d(o.id, o.orcamento_id)
       AND NOT EXISTS (SELECT 1 FROM public.os_autorizacoes au
                        WHERE au.os_id = o.id AND au.tipo = 'atendimento_validado')
  )
$$;

CREATE OR REPLACE FUNCTION public.tg_os_atendimento_sem_atalho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.finalidade = 'venda'
     AND public.etapa_da_os(OLD.status) = 'entrada'
     AND public.etapa_da_os(NEW.status) NOT IN ('entrada', 'fora_do_fluxo')
     AND public.os_espera_validacao_do_gestor(OLD.id) THEN
    -- O fluxo da arte (aceite, aprovação, link ao cliente): a decisão fica
    -- gravada pela função que chamou; a OS continua no Atendimento.
    IF NEW.status IN ('aguardando_aprovacao_arte', 'arte_aprovada', 'arte_rejeitada') THEN
      NEW.status := OLD.status;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A OS nº % ainda não foi validada pelo gestor: valide o atendimento antes de avançar.', OLD.numero
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_os_atendimento_sem_atalho ON public.ordens_servico;
CREATE TRIGGER tg_os_atendimento_sem_atalho
  BEFORE UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_atendimento_sem_atalho();
-- Função de gatilho nasce fechada.
REVOKE ALL ON FUNCTION public.tg_os_atendimento_sem_atalho() FROM PUBLIC, anon, authenticated;

-- O aceite devolve o status de verdade: com a OS no Atendimento esperando o
-- gestor, o aceite fica gravado e a OS não muda de etapa. Igual à definição viva
-- de 14/11/2026, menos o v_status inventado depois do UPDATE.
CREATE OR REPLACE FUNCTION public.registrar_aceite_da_arte(p_os_id uuid, p_canal text DEFAULT 'whatsapp'::text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_os public.ordens_servico%ROWTYPE;
  v_arquivo uuid;
  v_obs text := NULLIF(btrim(p_observacao), '');
  v_status text;
BEGIN
  v_uid := public.require_permission('os.update');

  IF p_canal NOT IN ('sistema', 'whatsapp', 'email', 'presencial', 'telefone') THEN
    RAISE EXCEPTION 'Canal invalido: use sistema, whatsapp, email, presencial ou telefone.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_os.status IN ('concluido', 'faturado', 'cancelado') THEN
    RAISE EXCEPTION 'A OS nº % já está encerrada: não há aceite a registrar.', v_os.numero;
  END IF;

  -- Já aceita: devolve sem gravar de novo (dois toques no botão não viram duas aprovações).
  IF public.arte_aprovada_da_os(p_os_id) THEN
    RETURN jsonb_build_object('ok', true, 'ja_aceita', true, 'os_id', p_os_id, 'status', v_os.status::text,
                              'espera_validacao', public.os_espera_validacao_do_gestor(p_os_id));
  END IF;

  -- O arquivo que o cliente viu: o final de produção, senão o mais recente que vale. Pode não haver nenhum
  -- (a arte veio pelo WhatsApp e está no RIP): o aceite vale do mesmo jeito.
  SELECT a.id INTO v_arquivo
    FROM public.arquivos a
   WHERE a.os_id = p_os_id AND a.ativo AND a.substituido_por IS NULL AND a.status <> 'substituido'
   ORDER BY a.final_producao DESC, a.created_at DESC
   LIMIT 1;

  INSERT INTO public.aprovacoes (tipo, os_id, arquivo_id, aprovado, canal, usuario_id, observacao)
  VALUES ('arte'::tipo_aprovacao, p_os_id, v_arquivo, true, p_canal::canal_aprovacao, v_uid,
          COALESCE(v_obs, 'Aceite registrado na ficha do quadro'));

  -- Com arquivo, o histórico da peça fica igual ao de `registrar_aprovacao_interna`.
  IF v_arquivo IS NOT NULL THEN
    INSERT INTO public.arquivo_aprovacoes (arquivo_id, decisao, usuario_id, comentario, canal)
    VALUES (v_arquivo, 'aprovado', v_uid, v_obs, p_canal);
    UPDATE public.arquivos SET status = 'aprovado', data_aprovacao = now() WHERE id = v_arquivo;
  END IF;

  -- Só avança quem ainda está antes de "Arte aprovada". Quem já está adiante fica onde está.
  -- No Atendimento sem a validação do gestor, o gatilho segura a OS onde está (15/11/2026).
  IF v_os.status IN ('entrada', 'aguardando_briefing', 'briefing_ok', 'design', 'aguardando_aprovacao_arte', 'arte_rejeitada') THEN
    PERFORM set_config('app.avancar_os_status', 'on', true);
    UPDATE public.ordens_servico SET status = 'arte_aprovada' WHERE id = p_os_id;
    PERFORM set_config('app.avancar_os_status', '', true);
  END IF;
  SELECT status::text INTO v_status FROM public.ordens_servico WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'ja_aceita', false, 'os_id', p_os_id, 'arquivo_id', v_arquivo, 'status', v_status,
                            'espera_validacao', public.os_espera_validacao_do_gestor(p_os_id));
END
$function$;

-- ---------------------------------------------------------------- 2
-- O operador põe a OS na fila de uma máquina (ainda sem começar). A TV mostra a
-- OS na fila dessa máquina; "Começar" (comecar_na_maquina) troca o status e
-- abre o apontamento. Sem máquina (nulo) tira da fila da máquina.
CREATE OR REPLACE FUNCTION public.definir_maquina_da_os(p_os_id uuid, p_maquina_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_os public.ordens_servico%ROWTYPE;
  v_nome text;
  v_tipo text;
  v_ativa boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid)
     OR NOT (public.has_permission(v_uid, 'producao.start') OR public.eh_gestor(v_uid)) THEN
    RAISE EXCEPTION 'Só o operador (ou o gestor) escolhe a máquina.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF public.etapa_da_os(v_os.status) <> 'fila_producao' THEN
    RAISE EXCEPTION 'A máquina se escolhe na fila de produção. Para começar, use "Começar nesta máquina".';
  END IF;

  IF p_maquina_id IS NOT NULL THEN
    SELECT m.nome, m.tipo, m.ativa INTO v_nome, v_tipo, v_ativa FROM public.maquinas m WHERE m.id = p_maquina_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Máquina não encontrada.' USING ERRCODE = 'P0002'; END IF;
    IF NOT v_ativa THEN RAISE EXCEPTION 'A máquina % está inativa.', v_nome; END IF;
    IF public.status_da_maquina(v_tipo) IS NULL THEN
      RAISE EXCEPTION 'A máquina % é de um tipo (%) que ainda não tem etapa de produção. Avise o gestor.', v_nome, coalesce(v_tipo, 'sem tipo');
    END IF;
  END IF;

  IF v_os.maquina_id IS NOT DISTINCT FROM p_maquina_id THEN
    RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'maquina_id', p_maquina_id, 'mudou', false);
  END IF;

  UPDATE public.ordens_servico SET maquina_id = p_maquina_id WHERE id = p_os_id;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'ordens_servico', p_os_id, 'maquina_definida',
          jsonb_build_object('maquina_id', p_maquina_id, 'antes', v_os.maquina_id, 'origem', 'fila_de_producao'));

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'maquina_id', p_maquina_id, 'maquina_nome', v_nome, 'mudou', true);
END $$;

-- ---------------------------------------------------------------- 3
-- Permissões, conferidas.
DO $fechar$
DECLARE
  v_funcao regprocedure;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.os_espera_validacao_do_gestor(uuid)',
    'public.tg_os_atendimento_sem_atalho()'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_funcao);
    IF has_function_privilege('anon', v_funcao, 'EXECUTE')
       OR has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION '% continua aberta para o navegador', v_funcao;
    END IF;
  END LOOP;

  -- registrar_aceite_da_arte mantém o acesso que já tinha (a ficha chama); só confere o anon.
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.definir_maquina_da_os(uuid, uuid)',
    'public.registrar_aceite_da_arte(uuid, text, text)'
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
