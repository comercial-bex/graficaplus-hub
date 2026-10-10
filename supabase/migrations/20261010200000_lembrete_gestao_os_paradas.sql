-- O que falta, para quem resolve (10/10/2026, "o que falta? vamos criar o
-- plano e resolver").
--
-- 1. O lembrete diário da gerência passa a levar também as OS paradas: paga e
--    ainda aberta (a #44 do Guilherme Menezes, retirada e paga, continuava em
--    Entrada), sem nenhum item (a #49, R$ 0,00 desde 09/09) ou sem movimento
--    há mais de 5 dias. Continua UMA mensagem por gestor e silêncio quando
--    nada está parado.
-- 2. A mensagem da automação vira "o que está parado com a gerência", com o
--    texto montado aqui ({{resumo}}): bloco vazio não deixa título solto.
-- 3. Falso alarme no painel: "Orçamentos sem nenhum item" contava o #1, que é
--    de impressão 3D (os itens moram em orcamentos_3d) e já virou OS.
--    Convertido, rejeitado, expirado e orçamento 3D saem da conta.

-- 1. A varredura -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lembrete_orcamentos_aprovados_sem_os()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_qtd int;
  v_total numeric;
  v_total_txt text;
  v_lista text;
  v_os_qtd int;
  v_os_lista text;
  v_resumo text;
  v_g record;
  v_n int;
  v_enfileirados int := 0;
  v_avisados text[] := '{}';
  v_sem_telefone text[] := '{}';
BEGIN
  -- Orçamentos aprovados pelo cliente que não viraram OS.
  SELECT count(*), coalesce(sum(coalesce(l.valor_total, 0)), 0),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 25)
           || CASE WHEN count(*) > 25 THEN format(E'\n… e mais %s', count(*) - 25) ELSE '' END
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT o.valor_total,
           row_number() OVER (ORDER BY coalesce(o.aprovado_em, o.updated_at), o.numero) AS ordem,
           format('#%s · %s · %s · %s · %s',
             o.numero,
             coalesce(nullif(btrim(c.nome), ''), nullif(btrim(o.contato_nome), ''), 'sem cliente'),
             coalesce(nullif(btrim(o.titulo), ''), 'sem título'),
             'R$ ' || translate(to_char(coalesce(o.valor_total, 0), 'FM999,999,990.00'), ',.', '.,'),
             CASE x.dias WHEN 0 THEN 'aprovado hoje' WHEN 1 THEN 'aprovado ontem'
                         ELSE format('aprovado há %s dias', x.dias) END
           ) AS linha
    FROM public.orcamentos o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id
    CROSS JOIN LATERAL (
      SELECT GREATEST(v_hoje - (coalesce(o.aprovado_em, o.updated_at) AT TIME ZONE 'America/Belem')::date, 0) AS dias
    ) x
    WHERE o.status = 'aprovado' AND o.os_id IS NULL
  ) l;
  v_qtd := coalesce(v_qtd, 0);
  v_total_txt := 'R$ ' || translate(to_char(coalesce(v_total, 0), 'FM999,999,990.00'), ',.', '.,');

  -- OS paradas: abertas e (pagas, ou sem nenhum item, ou sem movimento há 5+ dias).
  SELECT count(*),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 15)
           || CASE WHEN count(*) > 15 THEN format(E'\n… e mais %s', count(*) - 15) ELSE '' END
    INTO v_os_qtd, v_os_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.numero) AS ordem,
           format('#%s · %s · %s · %s',
             os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             coalesce(nullif(btrim(os.titulo), ''), 'sem título'),
             CASE
               WHEN os.status_financeiro::text = 'pago'
                 THEN format('paga e ainda em %s: abra a OS para ver o que falta para concluir',
                             initcap(replace(os.status::text, '_', ' ')))
               WHEN NOT EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = os.id)
                 THEN format('sem nenhum item, parada há %s dias: preencha ou cancele', d.dias)
               ELSE format('sem movimento há %s dias, em %s', d.dias, initcap(replace(os.status::text, '_', ' ')))
             END
           ) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    CROSS JOIN LATERAL (
      SELECT GREATEST(v_hoje - (os.updated_at AT TIME ZONE 'America/Belem')::date, 0) AS dias
    ) d
    WHERE os.status::text NOT IN ('concluido', 'faturado', 'cancelado')
      AND (os.status_financeiro::text = 'pago'
           OR NOT EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = os.id)
           OR os.updated_at < now() - interval '5 days')
  ) l;
  v_os_qtd := coalesce(v_os_qtd, 0);

  -- Silêncio quando nada está parado.
  IF v_qtd = 0 AND v_os_qtd = 0 THEN
    RETURN jsonb_build_object('quantidade', 0, 'os_quantidade', 0, 'enfileirados', 0,
                              'motivo', 'nada parado com a gerência');
  END IF;

  v_resumo := concat_ws(E'\n\n',
    CASE WHEN v_qtd > 0 THEN format(
      E'Orçamentos aprovados pelo cliente que ainda não viraram OS: %s, somando %s.\n%s\n'
      || E'Em cada um: vai produzir ou já entregou, use "Converter em OS" (se já foi pago, dê baixa em Contas a receber); o cliente desistiu, marque o orçamento como rejeitado.',
      v_qtd, v_total_txt, v_lista) END,
    CASE WHEN v_os_qtd > 0 THEN format(
      E'OS paradas: %s.\n%s',
      v_os_qtd, v_os_lista) END
  );

  FOR v_g IN
    SELECT u.id, btrim(u.nome) AS nome, public.normalize_whatsapp_phone(u.telefone) AS tel
    FROM public.usuarios u
    WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'gestor')
    ORDER BY u.nome
  LOOP
    IF v_g.tel IS NULL THEN
      v_sem_telefone := v_sem_telefone || v_g.nome;
      CONTINUE;
    END IF;
    v_n := public.enqueue_automacoes(
      'orcamento_aprovado_sem_os', 'usuarios', v_g.id,
      jsonb_build_object(
        'gestor', jsonb_build_object('nome', split_part(v_g.nome, ' ', 1), 'telefone_normalizado', v_g.tel),
        'quantidade', v_qtd,
        'valor_total', v_total_txt,
        'lista', coalesce(v_lista, ''),
        'os_quantidade', v_os_qtd,
        'os_lista', coalesce(v_os_lista, ''),
        'resumo', v_resumo,
        'link', 'https://bexprint.com.br/dashboard',
        'dia', v_hoje
      )
    );
    v_enfileirados := v_enfileirados + v_n;
    IF v_n > 0 THEN v_avisados := v_avisados || v_g.nome; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'quantidade', v_qtd,
    'os_quantidade', v_os_qtd,
    'enfileirados', v_enfileirados,
    'avisados', to_jsonb(v_avisados),
    'gestores_sem_telefone', to_jsonb(v_sem_telefone)
  );
END;
$function$;

COMMENT ON FUNCTION public.lembrete_orcamentos_aprovados_sem_os() IS
  'Varredura diária (job lembrete-gestao-orcamentos, 9h de seg a sáb): orçamentos aprovados sem OS e OS paradas. Enfileira UMA mensagem por gestor com telefone, pela automação do gatilho orcamento_aprovado_sem_os. Nada parado, nada enviado.';

REVOKE ALL ON FUNCTION public.lembrete_orcamentos_aprovados_sem_os() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lembrete_orcamentos_aprovados_sem_os() TO service_role;

-- 2. A mensagem (só se ainda for a de 10/10 — edição feita na tela fica) -----
UPDATE public.automacoes
SET nome = 'Lembrete à gerência: o que está parado',
    descricao = 'Todo dia, de segunda a sábado, às 9h: orçamentos aprovados que não viraram OS e OS paradas (paga e aberta, sem item, ou sem movimento há 5+ dias). Cada gestor recebe uma mensagem; nada parado, nada enviado.',
    payload = jsonb_build_object(
      'telefone', '55{{gestor.telefone_normalizado}}',
      'mensagem', E'Olá, {{gestor.nome}}! Lembrete do Bex Print: o que está parado com a gerência.\n\n{{resumo}}\n\n{{link}}'
    ),
    updated_at = now()
WHERE gatilho = 'orcamento_aprovado_sem_os'
  AND payload->>'mensagem' LIKE E'Olá, {{gestor.nome}}! Lembrete do Bex Print.\n\nOrçamentos aprovados pelo cliente%';

-- 3. O falso alarme de "orçamento sem item" -----------------------------------
DO $pendencias$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_vezes int;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ($a$(SELECT count(*)::int FROM public.orcamentos),'critico','atendimento',$a$,
       $b$(SELECT count(*)::int FROM public.orcamentos WHERE status::text NOT IN ('convertido','rejeitado','expirado')),'critico','atendimento',$b$),
      ($a$FROM public.orcamentos o WHERE NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id=o.id) HAVING count(*)>0;$a$,
       $b$FROM public.orcamentos o WHERE o.status::text NOT IN ('convertido','rejeitado','expirado') AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id=o.id) AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d t WHERE t.orcamento_id=o.id) HAVING count(*)>0;$b$)
    ) AS t(de, para)
  LOOP
    v_vezes := (length(v_def) - length(replace(v_def, r.de, ''))) / length(r.de);
    IF v_vezes = 1 THEN
      v_def := replace(v_def, r.de, r.para);
    ELSIF v_vezes = 0 AND position(r.para IN v_def) > 0 THEN
      CONTINUE; -- já trocado
    ELSE
      RAISE EXCEPTION 'pendencias_do_sistema: o trecho % aparece % vez(es); revise a troca', left(r.de, 60), v_vezes;
    END IF;
  END LOOP;
  EXECUTE v_def;
END
$pendencias$;
