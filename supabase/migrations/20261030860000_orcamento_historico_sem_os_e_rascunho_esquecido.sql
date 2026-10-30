-- Dois restos do diagnóstico final de 29/10/2026 (verificações 3.1 e 2.2 da operação).
--
-- 3.1. A decisão do dono, tomada por delegação em 30/10 ("Cinco orçamentos impressos sem virar OS"), foi (b): manter
--      como histórico, sem receita no sistema, os orçamentos 54, 56, 57, 62 e 70 (a Flexi prova que foram impressos,
--      mas nunca viraram OS nem conta a receber; somam R$ 245,71 e foram tomados por clientes de teste). Só que a
--      decisão ficou registrada e o efeito não: eles seguiam "aprovados sem OS", contando no aviso crítico e na
--      mensagem diária que o gestor recebe no WhatsApp (`lembrete_orcamentos_aprovados_sem_os`, 09h). Agora o
--      orçamento ganha `sem_os_motivo`; com ele preenchido sai do aviso e do lembrete. O status segue 'aprovado': nada
--      é reescrito, nenhum dinheiro é lançado, e dá para desfazer limpando a coluna.
--
-- 2.2. Rascunho esquecido: 7 de 8 rascunhos tinham mais de 14 dias, somando R$ 5.606,49 que ninguém enviou nem
--      descartou, e nenhum aviso olhava rascunho (o aviso de orçamento parado só olha o ENVIADO). Aviso novo
--      `orcamento_rascunho_esquecido`, no resumo do atendimento, com o valor parado e os números.
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS sem_os_motivo text;
COMMENT ON COLUMN public.orcamentos.sem_os_motivo IS
  'Orçamento aprovado que, por decisão do dono, fica como histórico e não vira OS (ex.: produzido fora do sistema, sem receita registrada). Preenchido, ele sai do aviso e do lembrete de "aprovado sem OS". Limpar a coluna desfaz.';

DO $migracao$
DECLARE
  v_oid oid;
  v_def text;
  v_antes int;
  v_a text;
  v_aviso text := $aviso$  -- Rascunho esquecido (30/10/2026): 7 de 8 rascunhos tinham mais de 14 dias, somando R$ 5.606,49 que ninguém
  -- enviou nem descartou; o aviso de orçamento parado só olha o ENVIADO.
  RETURN QUERY SELECT 'orcamento_rascunho_esquecido', 'Orçamentos em rascunho há mais de 14 dias', count(*)::int,
    (SELECT count(*)::int FROM public.orcamentos WHERE status = 'rascunho'), 'atencao', 'atendimento',
    'Valor parado: ' || public._reais(sum(coalesce(o.valor_total, 0))) || '. Orçamentos nº ' ||
      string_agg(o.numero::text, ', ' ORDER BY o.numero) ||
      '. Abra cada um: envie ao cliente, ajuste o preço, ou marque como rejeitado se não vale mais.',
    '/orcamentos'
  FROM public.orcamentos o WHERE o.status = 'rascunho' AND o.created_at < now() - interval '14 days' HAVING count(*) > 0;

$aviso$;
  v_ancora text := $a$  -- Reembolsos esperando decisão (15/10/2026): a gerência$a$;
BEGIN
  -- O lembrete diário ao gestor.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lembrete_orcamentos_aprovados_sem_os';
  v_def := pg_get_functiondef(v_oid);
  IF position('o.sem_os_motivo IS NULL' IN v_def) = 0 THEN
    v_a := $a$WHERE o.status = 'aprovado' AND o.os_id IS NULL$a$;
    v_antes := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'lembrete_orcamentos_aprovados_sem_os: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_a, $n$WHERE o.status = 'aprovado' AND o.os_id IS NULL AND o.sem_os_motivo IS NULL$n$);
  END IF;

  -- O aviso crítico e o aviso novo do rascunho.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';
  v_def := pg_get_functiondef(v_oid);
  IF position('sem_os_motivo IS NULL' IN v_def) = 0 THEN
    v_a := $a$FROM public.orcamentos WHERE status = 'aprovado' AND os_id IS NULL HAVING count(*) > 0;$a$;
    v_antes := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'pendencias_do_sistema (aprovado sem OS): esperava 1 âncora, achei %', v_antes; END IF;
    v_def := replace(v_def, v_a,
      $n$FROM public.orcamentos WHERE status = 'aprovado' AND os_id IS NULL AND sem_os_motivo IS NULL HAVING count(*) > 0;$n$);
    EXECUTE v_def;
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('orcamento_rascunho_esquecido' IN v_def) = 0 THEN
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'pendencias_do_sistema (rascunho): esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora, v_aviso || v_ancora);
  END IF;

  -- Os cinco da decisão (b): só marca o que ainda é aprovado e sem OS.
  UPDATE public.orcamentos
     SET sem_os_motivo = 'Histórico: impresso em set/out (prova na Flexi), sem OS nem receita no sistema, por decisão do dono de 30/10/2026.'
   WHERE numero IN (54, 56, 57, 62, 70) AND status = 'aprovado' AND os_id IS NULL AND sem_os_motivo IS NULL;
END
$migracao$;
