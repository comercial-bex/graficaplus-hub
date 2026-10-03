-- ============================================================================
-- Onda 17 — o motor de automações volta a enfileirar (e para de mentir)
-- ============================================================================
--
-- A tela /automacoes só ligava e desligava; ia ganhar "criar". Antes de
-- oferecer o botão, o motor foi lido VIVO — e estava morto:
--
--   enqueue_automacoes:  FOR ... WHERE ativo = true AND gatilho = p_gatilho
--
-- `automacoes.gatilho` é TEXT e `p_gatilho` é o enum `automacao_gatilho`. Não
-- existe operador text = automacao_gatilho (42883). O erro estourava na
-- primeira linha, o `EXCEPTION WHEN OTHERS` do fim engolia com um WARNING que
-- ninguém lê, e a função devolvia 0 para TODO evento. A migração 20260713100000
-- tinha o `::text`; o banco vivo não tinha. Ensaio de 02/10/2026 com uma
-- automação ativa de "OS atrasada" e a OS 49 vencida desde 09/09: retorno 0,
-- fila vazia. Criar automação pela tela seria um botão que finge que fez.
--
-- O que muda, e só isto:
--
-- 1. `p_gatilho::text` na comparação.
--
-- 2. Evento de ESTADO não empilha. "OS atrasada", "pagamento vencido",
--    "estoque no mínimo" e "margem baixa" são situações, não acontecimentos:
--    o gatilho da OS dispara em QUALQUER update de uma OS vencida, e o
--    contexto muda a cada update (updated_at), então a chave de dedupe nunca
--    repetia. Com o processador parado, cada clique numa OS atrasada deixava
--    mais uma mensagem na fila — e quando o processador voltasse, o cliente
--    (ou a equipe) receberia todas de uma vez. Agora, se já há uma execução
--    pendente ou em processamento da mesma automação para a mesma entidade,
--    não entra outra. Mudança de etapa (status_os_alterado) e conclusão
--    continuam entrando uma a uma: cada uma é um acontecimento diferente.
--
-- 3. A falha deixa rastro. O handler continua — automação é ACESSÓRIA: avisar
--    não pode impedir a OS de andar —, mas agora grava em `logs_auditoria`
--    (entidade 'automacoes', acao 'motor_falhou', com SQLSTATE e mensagem). Foi
--    o handler mudo que escondeu o defeito de cima; a tela /automacoes lê esse
--    rastro e mostra.
--
-- 4. Desligar uma automação cancela o que ela tem na fila. O processador
--    (process-automations) não confere `ativo` na hora de mandar: sem isto,
--    "desligar" deixava sair tudo o que já estava enfileirado. O status vai
--    para 'erro' com o texto 'Cancelada: …' porque o CHECK de
--    automacao_execucoes.status só aceita pendente/processando/sucesso/erro, e
--    alargar o CHECK pediria DROP CONSTRAINT.
--    DECISÃO DELIBERADA: este gatilho NÃO tem EXCEPTION. Aqui o UPDATE É o
--    efeito de desligar; engolir a falha deixaria a automação "desligada" com a
--    fila dela ainda saindo. Melhor o desligar falhar na tela, com o motivo.
--
-- 5. Quem lê e quem escreve. A policy existente é `is_staff` para tudo: o
--    operador e o vendedor podiam criar, pela API, uma automação que manda
--    WhatsApp para todo cliente — e ler `automacao_execucoes.contexto`, que
--    guarda a linha INTEIRA da OS (valor, custo e margem). Policies
--    RESTRICTIVE novas, sem tocar na antiga: ler pede automacoes.read ou
--    automacoes.manage; criar, alterar e apagar pedem automacoes.manage (hoje,
--    só admin). O motor roda como dono das tabelas (SECURITY DEFINER, BYPASSRLS)
--    e não é afetado; o processador usa service_role.
--
-- Ensaiado com reversão em 02/10/2026:
--   update da OS 49 (vencida) com "OS atrasada" ativa -> 1 na fila (era 0)
--   segunda chamada com contexto diferente           -> 0, fila continua 1
--   condição status=[arte_aprovada]: design -> 0; arte_aprovada -> 1
--   dentro do cooldown depois de enviada             -> 0
--   desligar a automação                             -> 1 cancelada; a enviada
--                                                       de outra intacta
--   destino quebrado de propósito (CHECK temporário) -> retorno 0, 1 rastro
--   operador: lê 0 automações e 0 execuções; criar barrado (42501); update 0
--   vendedor+operador lê 0; admin lê, cria e altera
-- E depois de aplicado (também com reversão):
--   dois updates seguidos da OS 49 -> 1 na fila; desligar -> 1 cancelada
--   admin desliga com RLS ligada -> pendente cancelada, 'processando' intacta;
--   operador tenta desligar -> 0 linhas, fila intacta
--
-- NÃO resolvido aqui (fora do banco): nada chama o processador. Não há pg_cron
-- nem pg_net neste banco, e os 4 avisos ao cliente que estão em
-- notificacoes_fila desde 28/09 têm 0 tentativas. E o WhatsApp da gráfica está
-- desconectado (falta escanear o QR Code). A tela diz as duas coisas.

-- ------------------------------------------------------------ 1, 2 e 3
CREATE OR REPLACE FUNCTION public.enqueue_automacoes(p_gatilho automacao_gatilho, p_entidade text, p_entidade_id uuid, p_contexto jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_automacao public.automacoes%ROWTYPE; v_dedupe TEXT; v_count INT := 0; v_estado text; v_erro text;
BEGIN
  -- `gatilho` é TEXT e `p_gatilho` é enum: sem o ::text a comparação não existe.
  FOR v_automacao IN SELECT * FROM public.automacoes WHERE ativo = true AND gatilho = p_gatilho::text LOOP
    IF NOT public.automacao_condicao_ok(p_gatilho, COALESCE(v_automacao.condicao,'{}'::jsonb), p_contexto) THEN CONTINUE; END IF;
    v_dedupe := concat_ws(':', v_automacao.id::text, p_entidade, COALESCE(p_entidade_id::text,'sem-id'), md5(p_contexto::text));
    IF EXISTS (
      SELECT 1 FROM public.automacao_execucoes e
      WHERE e.automacao_id=v_automacao.id AND e.entidade=p_entidade AND e.entidade_id IS NOT DISTINCT FROM p_entidade_id
        AND e.status='sucesso' AND e.processado_em > now() - make_interval(secs => v_automacao.cooldown_segundos)
    ) THEN CONTINUE; END IF;
    -- Situação (não acontecimento): uma na fila por entidade basta.
    IF p_gatilho IN ('os_atrasada','pagamento_atrasado','estoque_minimo','margem_abaixo_minimo') AND EXISTS (
      SELECT 1 FROM public.automacao_execucoes e
      WHERE e.automacao_id=v_automacao.id AND e.entidade=p_entidade AND e.entidade_id IS NOT DISTINCT FROM p_entidade_id
        AND e.status IN ('pendente','processando')
    ) THEN CONTINUE; END IF;
    INSERT INTO public.automacao_execucoes (automacao_id, gatilho, entidade, entidade_id, scheduled_at, dedupe_key, contexto, payload)
    VALUES (v_automacao.id, p_gatilho, p_entidade, p_entidade_id, now() + make_interval(secs => v_automacao.delay_segundos), v_dedupe, p_contexto, v_automacao.payload)
    ON CONFLICT (dedupe_key) WHERE status IN ('pendente','processando') DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  -- Acessório: a OS, o pagamento ou o material seguem. Mas com rastro — o
  -- handler mudo foi o que escondeu o 42883 de cima.
  v_estado := SQLSTATE; v_erro := SQLERRM;
  BEGIN
    INSERT INTO public.logs_auditoria (entidade, entidade_id, acao, detalhes)
    VALUES ('automacoes', NULL, 'motor_falhou', jsonb_build_object('origem','enqueue_automacoes','gatilho',p_gatilho::text,
            'entidade',p_entidade,'entidade_id',p_entidade_id,'sqlstate',v_estado,'erro',v_erro));
  EXCEPTION WHEN OTHERS THEN NULL; -- o rastro nunca pode derrubar quem chamou
  END;
  RAISE WARNING 'enqueue_automacoes falhou (%): operação de origem preservada', v_erro;
  RETURN 0;
END $function$;

REVOKE ALL ON FUNCTION public.enqueue_automacoes(automacao_gatilho, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_automacoes(automacao_gatilho, text, uuid, jsonb) TO service_role;

-- ------------------------------------------------------------ 4
CREATE OR REPLACE FUNCTION public.tg_automacao_desligada_cancela_fila()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  -- DECISÃO DELIBERADA: sem EXCEPTION (ver migração 20261002103002). 'processando'
  -- fica: é o processador no meio do envio, e ele mesmo fecha a linha.
  UPDATE public.automacao_execucoes
     SET status = 'erro', erro = 'Cancelada: a automação foi desligada antes do envio.', processado_em = now()
   WHERE automacao_id = NEW.id AND status = 'pendente';
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_automacao_desligada_cancela_fila() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_automacao_desligada_cancela_fila() TO service_role;

CREATE OR REPLACE TRIGGER tg_automacao_desligada_cancela_fila
  AFTER UPDATE OF ativo ON public.automacoes
  FOR EACH ROW WHEN (OLD.ativo IS TRUE AND NEW.ativo IS FALSE)
  EXECUTE FUNCTION public.tg_automacao_desligada_cancela_fila();

-- ------------------------------------------------------------ 5
-- RESTRICTIVE soma com a policy antiga ("automacoes staff all", is_staff) por
-- E lógico. Sem DROP: guarda de existência para reaplicar sem erro.
DO $p$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automacoes'
                  AND policyname='automacoes: le quem tem automacoes') THEN
    CREATE POLICY "automacoes: le quem tem automacoes" ON public.automacoes AS RESTRICTIVE
      FOR SELECT TO authenticated
      USING (public.has_permission((SELECT auth.uid()), 'automacoes.read')
          OR public.has_permission((SELECT auth.uid()), 'automacoes.manage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automacoes'
                  AND policyname='automacoes: cria quem gerencia') THEN
    CREATE POLICY "automacoes: cria quem gerencia" ON public.automacoes AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (public.has_permission((SELECT auth.uid()), 'automacoes.manage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automacoes'
                  AND policyname='automacoes: altera quem gerencia') THEN
    CREATE POLICY "automacoes: altera quem gerencia" ON public.automacoes AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (public.has_permission((SELECT auth.uid()), 'automacoes.manage'))
      WITH CHECK (public.has_permission((SELECT auth.uid()), 'automacoes.manage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automacoes'
                  AND policyname='automacoes: apaga quem gerencia') THEN
    CREATE POLICY "automacoes: apaga quem gerencia" ON public.automacoes AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (public.has_permission((SELECT auth.uid()), 'automacoes.manage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automacao_execucoes'
                  AND policyname='automacao execucoes: le quem tem automacoes') THEN
    CREATE POLICY "automacao execucoes: le quem tem automacoes" ON public.automacao_execucoes AS RESTRICTIVE
      FOR SELECT TO authenticated
      USING (public.has_permission((SELECT auth.uid()), 'automacoes.read')
          OR public.has_permission((SELECT auth.uid()), 'automacoes.manage'));
  END IF;
END $p$;
