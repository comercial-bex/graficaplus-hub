# Ensaio da migração: aviso de aprovação só quando o cliente aprova pelo link

Migração: `supabase/migrations/20261118100000_aviso_de_aprovacao_so_quando_o_cliente_aprova.sql`. Estado: **NÃO aplicada e NÃO ensaiada ainda: o script abaixo é para quem aplica rodar. Ele roda a troca dentro de uma transação, prova cada porta de aprovação e termina em RAISE EXCEPTION, que desfaz tudo.** Teste de contrato: `tests/aviso-de-aprovacao-so-pelo-cliente-migracao.test.ts`. O corpo vivo de antes está em `tests/apoio/tg-orcamento-notificar-cliente-vivo.sql`.

## Regra

O cliente só recebe o aviso de orçamento aprovado quando quem aprova é ele, pelo link público. Aprovação registrada pela equipe não avisa o cliente.

## Quem grava aprovado e quem avisa o cliente (lido no banco vivo em 18/11/2026)

Escritores de `status = 'aprovado'` em `orcamentos`: `aprovar_orcamento`, `responder_orcamento_publico`, `sync_orcamento_3d_para_funil` (copia o status do 3D, só quando a transição é permitida) e UPDATE direto de quem tem RLS de escrita. `api_executar` não grava aprovado. A única geradora do aviso ao cliente é `tg_orcamento_notificar_cliente` (AFTER UPDATE OF status), que chama `enfileirar_notificacao` com o template `orcamento_aprovado` e a chave `orcamento:<id>:aprovado`. Gatilhos vizinhos não geram aviso ao cliente: `zz_orcamento_congela_versao` congela versão, `tg_parceiro_pedido_recusado` só olha recusa.

| Caminho de aprovação | Grava `aprovado_por_nome` | Avisa o cliente antes | Avisa o cliente depois |
| --- | --- | --- | --- |
| Link do cliente (`responder_orcamento_publico`, decisão aprovado) | sim, na mesma atualização do status | sim | **sim** |
| Equipe, botão Aprovar (`aprovar_orcamento`) | não | sim | **não** |
| Equipe, "Cliente aprovou: converter em OS" (`aprovar_orcamento` e depois a conversão) | não | sim | **não** |
| UPDATE direto de status para aprovado | não | sim | **não** |
| `sync_orcamento_3d_para_funil` | não | sim | **não** |
| `api_executar` | não grava aprovado | não | não |

Números do banco vivo: dos 47 orçamentos aprovados ou convertidos, 45 foram aprovados pela equipe e 2 pelo link; 46 avisos de aprovação já foram enviados e nenhum está pendente (8 cancelados em agosto e setembro). Ninguém é limpo: a migração não faz UPDATE de dado.

## O que a migração faz

Troca na definição viva: confere o md5 do corpo vivo (`3bc4800aeeb4a19dbaad743d0043bffb`), confere que a linha-âncora aparece uma vez, acrescenta depois dela a guarda `aprovado_por_nome` preenchido nesta atualização, recria a função e confere o md5 do corpo novo (`f8f046865519aecd647bb88b185965d0`). Mesmo destino, mesmos dados, mesma chave de idempotência. Não toca nos avisos internos, no bloqueio de números, no template nem no interruptor da tela de avisos.

## Script do ensaio

Cole inteiro de uma vez. O banco desfaz tudo no RAISE EXCEPTION final; a mensagem do erro é o relatório. Sequências podem avançar, como em todos os ensaios. O que deve aparecer: `[1] ... avisos=1`, `[2] ... avisos=0`, `[3] ... avisos=0`, `[4] ... avisos=1`, `[5] ... avisos=0` e `[6] ... md5 novo=true`. Qualquer `FALHOU` mostra o esperado e o obtido. Precisa de 4 orçamentos enviados, dentro da validade, com token e algum telefone; no banco vivo em 18/11/2026 há 8.

```sql
BEGIN;

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

DO $ensaio$
DECLARE
  v_admin uuid;
  v_ids   uuid[];
  v_tok   text;
  v_r     jsonb;
  v_n     int;
  v_rel   text := '';
  v_falhou boolean := false;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role::text = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'sem conta admin para ensaiar'; END IF;

  SELECT array_agg(id) INTO v_ids FROM (
    SELECT o.id
      FROM public.orcamentos o
      LEFT JOIN public.clientes c ON c.id = o.cliente_id
     WHERE o.status::text = 'enviado' AND o.os_id IS NULL
       AND o.token_publico IS NOT NULL AND length(o.token_publico) >= 10
       AND COALESCE(c.whatsapp_principal, c.telefone, o.contato_telefone) IS NOT NULL
       AND (now() AT TIME ZONE 'America/Sao_Paulo')::date
           <= (COALESCE(o.enviado_em, o.created_at) AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(o.validade_dias, 7)
     ORDER BY o.created_at DESC LIMIT 4) x;
  IF coalesce(array_length(v_ids, 1), 0) < 4 THEN RAISE EXCEPTION 'faltam orçamentos enviados para ensaiar'; END IF;

  -- [1] o cliente aprova pelo link: avisa.
  SELECT token_publico INTO v_tok FROM public.orcamentos WHERE id = v_ids[1];
  v_r := public.responder_orcamento_publico(v_tok, 'aprovado', 'Cliente de Ensaio', '', '127.0.0.1');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key = 'orcamento:' || v_ids[1]::text || ':aprovado';
  v_rel := v_rel || format(E'[1] link do cliente: %s | avisos=%s\n', v_r, v_n);
  IF NOT (v_r->>'ok' = 'true' AND v_n = 1) THEN v_falhou := true; v_rel := v_rel || E'    FALHOU: esperado ok e 1 aviso\n'; END IF;

  -- [2] a equipe aprova pela função: não avisa.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.aprovar_orcamento(v_ids[2], NULL, 'ensaio');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key = 'orcamento:' || v_ids[2]::text || ':aprovado';
  v_rel := v_rel || format(E'[2] equipe aprovar_orcamento: %s | status=%s avisos=%s\n', v_r, (SELECT status::text FROM public.orcamentos WHERE id = v_ids[2]), v_n);
  IF NOT ((SELECT status::text FROM public.orcamentos WHERE id = v_ids[2]) = 'aprovado' AND v_n = 0) THEN v_falhou := true; v_rel := v_rel || E'    FALHOU: esperado aprovado e 0 avisos\n'; END IF;

  -- [3] UPDATE direto da equipe, sem nome: não avisa.
  UPDATE public.orcamentos SET status = 'aprovado', aprovado_em = now() WHERE id = v_ids[3];
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key = 'orcamento:' || v_ids[3]::text || ':aprovado';
  v_rel := v_rel || format(E'[3] UPDATE direto sem nome: status=%s avisos=%s\n', (SELECT status::text FROM public.orcamentos WHERE id = v_ids[3]), v_n);
  IF v_n <> 0 THEN v_falhou := true; v_rel := v_rel || E'    FALHOU: esperado 0 avisos\n'; END IF;

  -- [4] assinatura do link (nome preenchido na mesma atualização): avisa.
  UPDATE public.orcamentos SET status = 'aprovado', aprovado_em = now(), aprovado_por_nome = 'Cliente de Ensaio' WHERE id = v_ids[4];
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key = 'orcamento:' || v_ids[4]::text || ':aprovado';
  v_rel := v_rel || format(E'[4] UPDATE com nome: avisos=%s\n', v_n);
  IF v_n <> 1 THEN v_falhou := true; v_rel := v_rel || E'    FALHOU: esperado 1 aviso\n'; END IF;

  -- [5] regravar aprovado sobre aprovado não cria aviso novo, nem do link.
  UPDATE public.orcamentos SET status = 'aprovado' WHERE id IN (v_ids[1], v_ids[2], v_ids[3], v_ids[4]);
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key IN (
    'orcamento:' || v_ids[2]::text || ':aprovado', 'orcamento:' || v_ids[3]::text || ':aprovado');
  v_rel := v_rel || format(E'[5] regravar aprovado: avisos da equipe=%s\n', v_n);
  IF v_n <> 0 THEN v_falhou := true; v_rel := v_rel || E'    FALHOU: esperado 0\n'; END IF;

  -- [6] corpo novo, atributos e permissões iguais aos de antes.
  v_rel := v_rel || format(E'[6] md5 novo=%s SECURITY DEFINER=%s search_path fixo=%s guarda no corpo=%s gatilho presente=%s\n',
    (SELECT md5(prosrc) = 'f8f046865519aecd647bb88b185965d0' FROM pg_proc WHERE oid = 'public.tg_orcamento_notificar_cliente()'::regprocedure),
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.tg_orcamento_notificar_cliente()'::regprocedure),
    (SELECT 'search_path=public' = ANY(proconfig) FROM pg_proc WHERE oid = 'public.tg_orcamento_notificar_cliente()'::regprocedure),
    (SELECT position('aprovado_por_nome' IN prosrc) > 0 FROM pg_proc WHERE oid = 'public.tg_orcamento_notificar_cliente()'::regprocedure),
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tg_orcamento_notificar_cliente' AND tgrelid = 'public.orcamentos'::regclass));
  IF NOT (SELECT md5(prosrc) = 'f8f046865519aecd647bb88b185965d0' FROM pg_proc WHERE oid = 'public.tg_orcamento_notificar_cliente()'::regprocedure) THEN
    v_falhou := true; v_rel := v_rel || E'    FALHOU: md5 do corpo novo\n';
  END IF;

  RAISE EXCEPTION E'ENSAIO %, DESFEITO:\n%', CASE WHEN v_falhou THEN 'COM FALHAS' ELSE 'OK' END, v_rel;
END
$ensaio$;
```

Se o relatório der `COM FALHAS`, nada foi gravado: a transação inteira é desfeita de qualquer jeito. Depois do ensaio, confirmar no banco vivo que o md5 de `tg_orcamento_notificar_cliente` continua `3bc4800aeeb4a19dbaad743d0043bffb` (o ensaio não aplica).

## Depois de aplicar

Aprovar um orçamento pela tela da equipe deixa de gerar linha em `notificacoes_fila`; aprovar pelo link continua gerando. Conferência: `select count(*) from notificacoes_fila where evento = 'orcamento_aprovado' and created_at > <hora da aplicação>` deve crescer só com aprovação pelo link.
