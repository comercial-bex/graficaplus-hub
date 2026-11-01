-- Vencimentos por janela (31/10/2026), Onda 4 do plano
-- docs/plano-interface-holdprint-31-10-2026.md.
--
-- O painel inicial do Holdprint mostra "Total a receber" e "Total a pagar" em
-- quatro janelas: hoje, amanhã, semana e mês. O nosso só tinha totais soltos.
--
-- Aqui as janelas são móveis (próximos 7 e 30 dias), não semana e mês do
-- calendário: num sábado à noite a "semana" do calendário fecha em zero mesmo
-- com três contas a receber na terça, e o painel mentia por omissão (medido em
-- 31/10/2026: no Holdprint o mesmo painel mostrava só o atrasado da semana).
--
-- Uma função só devolve as duas listas, com o dia de hoje do Brasil (hoje_br()):
-- o banco roda em UTC e, das 21h à meia-noite, "hoje" estava um dia à frente
-- (relogio-do-banco-em-utc, corrigido em 30/10).
--
-- Mesma definição de "a receber" da tela de contas a receber (contas_a_receber):
-- parcela que não está paga. A de pagar é a conta em aberto.
--
-- As janelas se somam: "dias7" vai de hoje até hoje + 6 e "dias30" até hoje + 29,
-- então incluem hoje e amanhã. O que já passou do dia vai em "atrasado", sozinho,
-- para ninguém achar que o dinheiro sumiu.
--
-- Só quem vê financeiro chama; os outros recebem 42501 (a tela nem chama).

CREATE OR REPLACE FUNCTION public.vencimentos_por_janela()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := public.hoje_br();
  v_ate_7 date;
  v_ate_30 date;
BEGIN
  IF NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'O dinheiro a vencer é do financeiro.' USING ERRCODE = '42501';
  END IF;

  v_ate_7 := v_hoje + 6;
  v_ate_30 := v_hoje + 29;

  RETURN jsonb_build_object(
    'hoje', v_hoje,
    'ate_7_dias', v_ate_7,
    'ate_30_dias', v_ate_30,
    'receber', (
      SELECT jsonb_build_object(
        'atrasado', COALESCE(sum(p.valor) FILTER (WHERE p.vencimento < v_hoje), 0),
        'hoje',     COALESCE(sum(p.valor) FILTER (WHERE p.vencimento = v_hoje), 0),
        'amanha',   COALESCE(sum(p.valor) FILTER (WHERE p.vencimento = v_hoje + 1), 0),
        'dias7',    COALESCE(sum(p.valor) FILTER (WHERE p.vencimento BETWEEN v_hoje AND v_ate_7), 0),
        'dias30',   COALESCE(sum(p.valor) FILTER (WHERE p.vencimento BETWEEN v_hoje AND v_ate_30), 0)
      )
      FROM public.parcelas_receber p
      WHERE p.status <> 'paga'
    ),
    'pagar', (
      SELECT jsonb_build_object(
        'atrasado', COALESCE(sum(c.valor) FILTER (WHERE c.vencimento < v_hoje), 0),
        'hoje',     COALESCE(sum(c.valor) FILTER (WHERE c.vencimento = v_hoje), 0),
        'amanha',   COALESCE(sum(c.valor) FILTER (WHERE c.vencimento = v_hoje + 1), 0),
        'dias7',    COALESCE(sum(c.valor) FILTER (WHERE c.vencimento BETWEEN v_hoje AND v_ate_7), 0),
        'dias30',   COALESCE(sum(c.valor) FILTER (WHERE c.vencimento BETWEEN v_hoje AND v_ate_30), 0)
      )
      FROM public.contas_pagar c
      WHERE c.status::text = 'aberta'
    )
  );
END $function$;

-- Igual à contas_a_receber: nem PUBLIC nem anon executam.
REVOKE ALL ON FUNCTION public.vencimentos_por_janela() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vencimentos_por_janela() TO authenticated, service_role;
