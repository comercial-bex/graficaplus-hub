-- Avisos do painel ("O que falta de mim"): acentos, um texto vencido e três
-- links que levavam à tela errada. Achados navegando no sistema em 07/10/2026.
--
-- Links:
--   * "Contas a pagar vencidas" abria /financeiro (Pagamentos e comissões),
--     que não mostra conta a pagar. Agora /fluxo-caixa (Caixa e contas a pagar),
--     como já dizia o passo a passo do guia (src/lib/pendenciasGuia.ts).
--   * "Contas a receber ainda em aberto" e "Trabalhos entregues sem nenhuma
--     cobrança" abriam /financeiro. Agora /a-receber (Contas a receber).
--
-- Texto vencido: "Contas a receber ainda não têm data de vencimento no
-- sistema" deixou de ser verdade em 24/09 (cada parcela tem vencimento, e o
-- próprio painel mostra "Parcelas vencidas" ao lado). O guia do front foi
-- reescrito naquele dia; a frase do banco ficou para trás.
--
-- Como: edita a definição VIVA da função (pg_get_functiondef), trecho por
-- trecho. Cada trecho tem de aparecer exatamente uma vez; se já foi trocado,
-- pula; se não está lá, para tudo — sinal de que alguém mudou a função e a
-- troca precisa ser revista. O resto da função não é tocado.

DO $pendencias$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_vezes int;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ($a$'Entrega concluida e OS ainda aberta'$a$,
       $b$'Entrega concluída e OS ainda aberta'$b$),
      ($a$'O cliente ja recebeu. Abra a OS e veja o que falta para fechar: tarefa obrigatoria, qualidade, baixa de material, custo operacional ou pagamento. Enquanto nao fechar, a venda nao entra no faturado do mes.'$a$,
       $b$'O cliente já recebeu. Abra a OS e veja o que falta para fechar: tarefa obrigatória, qualidade, baixa de material, custo operacional ou pagamento. Enquanto não fechar, a venda não entra no faturado do mês.'$b$),
      ($a$'OS esperando material que nao ha no estoque'$a$,
       $b$'OS esperando material que não há no estoque'$b$),
      ($a$'A peca esta prometida e o material nao esta na prateleira. Abra a OS para ver o que falta e de entrada no estoque, ou avise o cliente do prazo. Enquanto faltar, a OS nao consegue dar baixa nem fechar.'$a$,
       $b$'A peça está prometida e o material não está na prateleira. Abra a OS para ver o que falta e dê entrada no estoque, ou avise o cliente do prazo. Enquanto faltar, a OS não consegue dar baixa nem fechar.'$b$),
      ($a$'Ordens de servico sem nenhum item'$a$,
       $b$'Ordens de serviço sem nenhum item'$b$),
      ($a$'A OS foi aberta e ninguem disse o que produzir.$a$,
       $b$'A OS foi aberta e ninguém disse o que produzir.$b$),
      ($a$'Serviço prestado que nunca virou conta a receber. Gere a cobrança a partir da OS.','/financeiro'$a$,
       $b$'Serviço prestado que nunca virou conta a receber. Gere a cobrança a partir da OS.','/a-receber'$b$),
      ($a$'Vencidas e ainda abertas. Pague ou renegocie; se já foi paga, registre o pagamento para sair daqui.','/financeiro'$a$,
       $b$'Vencidas e ainda abertas. Pague ou renegocie; se já foi paga, registre o pagamento para sair daqui.','/fluxo-caixa'$b$),
      ($a$'Contas a receber ainda não têm data de vencimento no sistema, então não dá para saber quais estão atrasadas — confira uma a uma.','/financeiro'$a$,
       $b$'Há parcela ainda não recebida. Comece pelas atrasadas (o cartão "Vencido" de Contas a receber) e dê baixa no que já entrou.','/a-receber'$b$)
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
