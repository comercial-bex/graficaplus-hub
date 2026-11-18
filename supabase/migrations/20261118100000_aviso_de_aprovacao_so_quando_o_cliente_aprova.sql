-- =====================================================================================================
-- AVISO DE APROVAÇÃO SÓ QUANDO O PRÓPRIO CLIENTE APROVA PELO LINK (18/11/2026)
--
-- APLICADA no banco vivo em 18/11/2026, depois do ensaio (6 casos OK): docs/ensaio-aviso-de-aprovacao-so-pelo-cliente.md.
-- aplica rodar (termina em RAISE EXCEPTION e desfaz tudo). Esta migração não faz UPDATE, INSERT nem DELETE de dado.
--
-- REGRA DECIDIDA PELO DONO
--   O cliente só recebe o aviso "recebemos a aprovação do seu orçamento" quando QUEM APROVOU É ELE, pelo link público.
--   Quando a equipe registra a aprovação (cliente confirmou por WhatsApp ou no balcão), o cliente já sabe: não recebe
--   mensagem repetida.
--
-- O QUE ESTAVA ERRADO (lido no banco vivo em 18/11/2026)
--   tg_orcamento_notificar_cliente (AFTER UPDATE OF status em orcamentos, md5 do corpo 3bc4800aeeb4a19dbaad743d0043bffb)
--   enfileirava o aviso em notificacoes_fila para QUALQUER mudança para aprovado, de qualquer porta. Aprovado pela
--   equipe também avisava: dos 47 orçamentos aprovados ou convertidos, 45 foram aprovados pela equipe e só 2 pelo
--   link (aprovado_por_nome preenchido), e 46 avisos de aprovação já saíram para clientes.
--
-- COMO O BANCO DISTINGUE AS DUAS PORTAS (lido no banco vivo)
--   responder_orcamento_publico (link do cliente) grava status, aprovado_em, aprovado_por_nome, aprovado_ip e
--   observacoes NA MESMA atualização. aprovar_orcamento (equipe), a tela (UPDATE direto), api_executar e
--   sync_orcamento_3d_para_funil nunca gravam aprovado_por_nome. A função do link exige nome de pelo menos 3 letras.
--   Como a trava de transição (230000) não deixa nenhum orçamento voltar de aprovado, aprovado_por_nome nunca vem
--   preenchido de antes numa aprovação da equipe. Por isso o gatilho avisa só quando aprovado_por_nome foi preenchido
--   NESTA atualização: é a assinatura do link, sem depender de papel, de token ou de texto de observação.
--
-- CAMINHOS DE APROVAÇÃO, ANTES E DEPOIS
--   link do cliente (responder_orcamento_publico, decisão aprovado)        antes: avisa   depois: avisa
--   equipe, botão Aprovar (AcoesDoStatus, RPC aprovar_orcamento)           antes: avisa   depois: NÃO avisa
--   equipe, "Cliente aprovou: converter em OS" (aprovar_orcamento + OS)    antes: avisa   depois: NÃO avisa
--   UPDATE direto de status para aprovado por quem tem RLS de escrita      antes: avisa   depois: NÃO avisa
--   api_executar (não grava aprovado, só renova)                           antes: não     depois: não
--   sync_orcamento_3d_para_funil (copia status do 3D para o funil)         antes: avisa   depois: NÃO avisa
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   Troca na definição viva (pg_get_functiondef) de tg_orcamento_notificar_cliente: confere o md5 do corpo vivo,
--   confere que a linha-âncora aparece UMA vez, acrescenta logo depois dela a guarda do nome do cliente e recria a
--   função com o texto vivo mais a guarda, conferindo o md5 do corpo novo (f8f046865519aecd647bb88b185965d0).
--   O resto do corpo é idêntico: mesmo destino, mesmos dados, mesma chave de idempotência (orcamento:<id>:aprovado).
--
-- FICA DE FORA, DE PROPÓSITO
--   Os avisos internos para a equipe (lembrete_orcamentos_aprovados_sem_os, alerta de integridade, painel): não
--   passam por este gatilho. O bloqueio de números (whatsapp_numeros_bloqueados) e o consumo da fila: intocados.
--   A regra de cobrança (mensagem ao cliente só com OK do financeiro ou admin): não é enfraquecida, este aviso só
--   fica mais restrito do que era. O template orcamento_aprovado e o interruptor dele na tela de avisos: intocados.
--   Linhas já enfileiradas ou enviadas: nenhum UPDATE, nenhuma limpeza.
--   Os avisos de OS (tg_os_notificar_cliente): intocados.
--
-- COMO DESFAZER
--   Recriar tg_orcamento_notificar_cliente sem o bloco entre "Só o cliente aprovando" e a linha seguinte
--   (o corpo antigo tem md5 3bc4800aeeb4a19dbaad743d0043bffb; está em tests/apoio/tg-orcamento-notificar-cliente-vivo.sql).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $troca$
DECLARE
  v_oid    oid := 'public.tg_orcamento_notificar_cliente()'::regprocedure;
  v_def    text;
  v_ancora text := $a$IF NEW.status::text <> 'aprovado' OR OLD.status::text = 'aprovado' THEN RETURN NEW; END IF;$a$;
  v_guarda text := $g$
  -- Só o cliente aprovando pelo link público avisa o cliente. A função do link grava o nome de quem aprovou
  -- na mesma atualização do status; a aprovação da equipe (aprovar_orcamento, tela, API) nunca grava esse nome.
  IF NULLIF(btrim(COALESCE(NEW.aprovado_por_nome, '')), '') IS NULL
     OR NEW.aprovado_por_nome IS NOT DISTINCT FROM OLD.aprovado_por_nome THEN RETURN NEW; END IF;$g$;
  v_vezes  int;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '3bc4800aeeb4a19dbaad743d0043bffb' THEN
    RAISE EXCEPTION 'tg_orcamento_notificar_cliente mudou desde a revisão: reler o corpo vivo e refazer o ensaio.' USING ERRCODE = '55000';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  IF v_vezes <> 1 THEN
    RAISE EXCEPTION 'a linha-âncora aparece % vezes na definição viva, o esperado é 1.', v_vezes USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(v_def, v_ancora, v_ancora || v_guarda);

  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM 'f8f046865519aecd647bb88b185965d0' THEN
    RAISE EXCEPTION 'o corpo novo de tg_orcamento_notificar_cliente não é o ensaiado.' USING ERRCODE = '55000';
  END IF;
END
$troca$;

COMMIT;
