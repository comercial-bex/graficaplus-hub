-- ============================================================================
-- Tela de créditos dos parceiros: a leitura (22/11/2026).
--
-- `parceiros_creditos_painel()` devolve, em um jsonb, tudo o que a tela `/parceiros-creditos` mostra:
--   * `programa`: as regras do crédito de entrada (valor, validade, pedido mínimo, teto por pedido, lembrete);
--   * `parceiros`: um item por parceiro (conta de teste fora) que tem ao menos um lançamento no livro de créditos, com o
--     `saldo` disponível e os `lancamentos` (os 100 mais recentes, do mais antigo ao mais novo), cada um com o pedido
--     (`parceiro_orcamentos.numero`) e a OS (`ordens_servico.numero`) a que se liga e quem lançou.
-- O `saldo` é a MESMA conta que o cartão "Atendimento dos parceiros" e o aviso do grupo já usam (`_parceiros_sem_contato`):
-- soma do livro menos o que venceu sem uso. O que cada lançamento pagou é calculado na tela (domínio puro, testado) a partir
-- destes lançamentos, e a tela confere esse total com o `saldo` do banco.
--
-- Só leitura, sem nenhuma tabela nova. Quem pode ler: `parceiros.read` (a mesma regra de RLS de `parceiro_creditos`).
-- Segurança: nasce fechada: REVOKE ALL de PUBLIC, anon e authenticated e só `authenticated` recebe EXECUTE de volta; a função
-- confere a permissão por dentro (`require_permission`). A conferência no fim da migração prova isso.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.parceiros_creditos_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN jsonb_build_object(
    'agora', now(),
    'programa', (SELECT jsonb_build_object(
                   'entrada_ativa', g.entrada_ativa, 'entrada_valor', g.entrada_valor,
                   'validade_dias', g.entrada_validade_dias, 'pedido_minimo', g.entrada_pedido_minimo,
                   'max_pct', g.entrada_max_pct_pedido,
                   'lembrete_ativo', g.lembrete_credito_ativo, 'lembrete_dias', g.lembrete_credito_dias)
                   FROM public.parceiro_programa g LIMIT 1),
    'parceiros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'parceiro_id', p.id,
               'nome', COALESCE(nullif(btrim(p.marca_nome), ''), c.nome, 'Parceiro'),
               'status', p.status,
               'responsavel_nome', u.nome,
               'saldo', s.disponivel,
               'lancamentos', l.itens)
             ORDER BY COALESCE(nullif(btrim(p.marca_nome), ''), c.nome, 'Parceiro'), p.id)
        FROM public.parceiros p
        LEFT JOIN public.clientes c ON c.id = p.cliente_id
        LEFT JOIN public.usuarios u ON u.id = p.responsavel_id
        CROSS JOIN LATERAL (
          SELECT greatest(coalesce(sum(pc.valor), 0) - greatest(least(coalesce(sum(pc.valor), 0),
                   coalesce(sum(pc.valor) FILTER (WHERE pc.valor > 0 AND pc.expira_em <= now()), 0)
                   - coalesce(-sum(pc.valor) FILTER (WHERE pc.valor < 0 AND pc.tipo <> 'expirado'), 0)
                   - coalesce(-sum(pc.valor) FILTER (WHERE pc.tipo = 'expirado'), 0)), 0), 0) AS disponivel
            FROM public.parceiro_creditos pc WHERE pc.parceiro_id = p.id) s
        CROSS JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', r.id, 'criado_em', r.created_at, 'tipo', r.tipo, 'valor', r.valor, 'descricao', r.descricao,
                   'expira_em', r.expira_em, 'os_id', r.os_id, 'os_numero', os.numero,
                   'orcamento_id', r.parceiro_orcamento_id, 'orcamento_numero', po.numero, 'pedido_total', po.total_pedido,
                   'criado_por_nome', uc.nome) ORDER BY r.created_at, r.id), '[]'::jsonb) AS itens
            FROM (SELECT x.* FROM public.parceiro_creditos x WHERE x.parceiro_id = p.id
                   ORDER BY x.created_at DESC, x.id DESC LIMIT 100) r
            LEFT JOIN public.ordens_servico os ON os.id = r.os_id
            LEFT JOIN public.parceiro_orcamentos po ON po.id = r.parceiro_orcamento_id
            LEFT JOIN public.usuarios uc ON uc.id = r.criado_por) l
       WHERE NOT COALESCE(p.e_teste, false)
         AND EXISTS (SELECT 1 FROM public.parceiro_creditos z WHERE z.parceiro_id = p.id)
    ), '[]'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.parceiros_creditos_painel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiros_creditos_painel() TO authenticated;

-- Conferência final: fechada para anon e public, aberta só a quem entra, e com o search_path fixo.
DO $conferencia$
DECLARE v_oid oid := 'public.parceiros_creditos_painel()'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_oid AND a.grantee = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'Permissões ou search_path de parceiros_creditos_painel fora do esperado.';
  END IF;
END
$conferencia$;

-- ============================================================================
-- DESFAZER (só leitura: nada gravado precisa ser desfeito)
-- ============================================================================
-- DROP FUNCTION public.parceiros_creditos_painel();
