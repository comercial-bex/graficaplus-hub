-- ============================================================================
-- Ver o financeiro não é lançar: a escrita em dinheiro pede chave de pagamento
-- ============================================================================
--
-- POR QUÊ
--   Decisão do dono em 03/10/2026: "o gestor só VÊ o financeiro, como o
--   financeiro vê; não lança, não dá baixa, não estorna". Desde aquele dia o
--   papel gestor tem financeiro.read (e financeiro.sensitive.read) e nenhuma
--   pagamentos.*. Mas a regra de acesso das tabelas de dinheiro era UMA policy
--   ALL por tabela, aberta pela chave de LEITURA (financeiro.read, direto ou via
--   can_see_financials): quem vê, escreve. Medido em 05/10/2026, com a conta do
--   Yvens simulada (claims + SET LOCAL ROLE authenticated, tudo desfeito):
--   ele inseria, alterava e apagava em pagamentos, contas_receber,
--   parcelas_receber, contas_pagar, caixa_movimentos, contas_bancarias,
--   banco_transacoes e compromissos_financeiros, subia comprovante e chamava
--   as 4 funções de compromisso, que aceitavam o PAPEL gestor. As funções que
--   já pediam a chave certa (confirmar_pagamento, confirmar_pagamento_registrado,
--   estornar_pagamento, importar_extrato, conciliar_transacao) já o recusavam.
--   Não há sinal de uso indevido: a última baixa em contas_pagar é de 08/09 e o
--   registro de auditoria de pagamento e caixa só tem Harison e Cibele.
--
-- QUEM ESCREVE NESSAS TABELAS (mapa medido antes de mexer)
--   Banco: TODA função que cita as 8 tabelas de dinheiro é SECURITY DEFINER,
--   dona postgres (BYPASSRLS, dona das tabelas, sem FORCE RLS): converter_
--   orcamento_em_os, converter_orcamento_3d_em_os, confirmar_pagamento(_
--   registrado), estornar_pagamento, importar_extrato, conciliar_transacao,
--   comissoes_pagar, os 4 de compromisso e os gatilhos tg_conta_receber_segue_
--   parcelas, tg_conta_receber_herda_orcamento, tg_auditar, tg_automacao_
--   pagamento_eventos, tg_pagamento_status_financeiro. Nenhum escritor INVOKER
--   existe, então nenhuma policy nova os alcança. Cascata de chave estrangeira
--   (apagar a OS leva os pagamentos) roda como dona da tabela: também não.
--   Os 6 espelhos de custo só são gravados pelos gatilhos tg_sync_* (DEFINER),
--   disparados por quem mexe na FONTE (produtos, orcamentos, orcamento_itens,
--   itens_os, materiais, ordens_servico). eventos_negocio: as 15 funções que
--   gravam nela (direto ou por registrar_evento_os) são DEFINER; o front não
--   grava.
--   Tela: /fluxo-caixa (conta a pagar, movimento, Pagar), /financeiro
--   (registrar pagamento), /os/$id aba Financeiro (pagamento), /contas-bancarias
--   (nova conta), /compromissos (novo compromisso e upload de comprovante),
--   /custos-producao e /planilha-custos (mão de obra), portal do cliente logado
--   (comprovante no bucket, pela policy do portal). O link público do portal
--   sobe por URL assinada da chave de serviço: não passa por RLS.
--
-- O QUE ESTA MIGRAÇÃO FAZ (só acrescenta; nenhuma policy de hoje muda)
--   Policies RESTRICTIVE somam por E lógico com as permissivas: ler continua
--   exatamente como estava; escrever passa a pedir TAMBÉM:
--   1. 8 tabelas de dinheiro (as 7 do estudo + compromissos_financeiros, o
--      contrato que gera as contas a pagar):
--        INSERT  pagamentos.create            (contas_bancarias: create OU update,
--                                              "cadastrar conta bancária")
--        UPDATE  pagamentos.update OU confirm (corrigir ou dar baixa)
--        DELETE  pagamentos.reverse           (estornar ou apagar)
--      e o admin passa sempre (has_role admin). 24 policies.
--   2. 6 espelhos de custo (produto_precos, orcamento_custos,
--      orcamento_item_custos, item_os_custos, material_custos,
--      os_resultados_financeiros): INSERT/UPDATE/DELETE pela API = false. Só o
--      gatilho grava; escrever direto no espelho o descasaria da fonte. 18.
--   3. custos_mao_de_obra: escrever pede custos.update (ou admin). 3.
--   4. eventos_negocio: INSERT só em nome próprio (usuario_id = quem grava);
--      fecha o ramo "ou logs.read", que deixava gravar evento em nome de outro. 1.
--   5. Bucket comprovantes: subir arquivo pede pagamentos.create, update ou
--      confirm (ou admin), ou ser o cliente do portal na própria pasta
--      (portal_pode_enviar_objeto, a mesma regra da policy do portal). 1.
--   As 4 funções de compromisso trocam o PAPEL pela CHAVE (corpo igual ao
--   vivo, só a guarda muda):
--        gerar_parcelas_compromisso   pagamentos.create
--        baixar_parcela_compromisso   pagamentos.confirm
--        quitar_parcelas_ate          pagamentos.confirm
--        anexar_comprovante_parcela   pagamentos.update ou pagamentos.confirm
--   EXECUTE delas e de conciliar_transacao: fora PUBLIC e anon (estavam
--   abertas ao anon), mantidos authenticated e service_role.
--
-- ENSAIO (05/10/2026, DO $$ ... RAISE EXCEPTION, antes e depois na mesma
-- transação, 7 contas: Harison admin, Yvens gestor, Cibele financeiro, Sergio
-- operador, Leonardo vendedor+operador, um cliente de portal criado só no
-- ensaio, e o banco como referência)
--   Yvens   lê exatamente o que o banco lê nas 16 leituras (8 tabelas, 3
--           views, bucket, mão de obra, 2 espelhos, eventos), antes e depois.
--           Lançar/corrigir/apagar nas 8 tabelas: antes ok, depois recusado
--           (INSERT = erro de RLS; UPDATE e DELETE = 0 linhas). As 4 funções:
--           antes ok, depois "Sem permissão".
--           Comprovante: antes ok, depois RLS. Mão de obra e espelhos: idem.
--           Evento em nome de outro: antes ok, depois RLS.
--   Cibele  tudo igual nas 8 tabelas e nas 9 funções de dinheiro. Perde só a
--           escrita em custos_mao_de_obra (não tem custos.update; a tabela tem
--           5 linhas e nunca foi editada: updated_at = created_at = 04/09).
--   Harison tudo igual, exceto escrever direto nos espelhos (agora só o gatilho)
--           e gravar evento em nome de outro.
--   Sergio, Leonardo  nada muda: já não liam nem escreviam dinheiro.
--   Portal  o cliente sobe comprovante na própria pasta antes e depois; fora
--           dela, recusado antes e depois.
--   Caminhos que continuam iguais, conferidos: converter orçamento em OS
--   (gestor e admin: OS + 1 conta a receber + 2 parcelas somando o total +
--   evento + espelhos; vendedor e financeiro recusados antes e depois por não
--   terem orcamentos.convert), item de orçamento novo/apagado pelo vendedor
--   (espelho criado e apagado em cascata), custo de material e valor da OS
--   (espelho atualizado pelo gatilho), apagar OS com pagamento (cascata).
--   Número de OS/orçamento do ensaio: 9905-9910 explícitos e DEFAULT trocado
--   dentro da transação; a sequência não andou (154 e 65 antes e depois).
--
-- RETRATO
--   Aplicada pelo MCP em 05/10/2026 a partir DESTE arquivo. md5(prosrc) das 4
--   funções depois de aplicada (igual ao corpo abaixo, entre os $function$):
--     anexar_comprovante_parcela  6281ad1e5b199c641b8dd2357d58dbb5
--     baixar_parcela_compromisso  f2a2cddb8a8cf4186f10a12feb41c95e
--     gerar_parcelas_compromisso  8d23073a1e6e64518ef29aa8b70818c9
--     quitar_parcelas_ate         eccaf5c1be49f5cee23b140a7a2eeb8b
--   Idempotente: cada policy só é criada se ainda não existe; funções por
--   CREATE OR REPLACE; nada é apagado.
--
-- FICA DE FORA (anotado no relatório da Fase 0)
--   - Apagar a OS ainda apaga os pagamentos dela por cascata, e apagar OS é do
--     PAPEL admin/gestor ("os admin delete"). É outra porta; mexer nela não é
--     aditivo.
--   - comissao_regras (escrita por PAPEL admin/gestor) e as demais decisões por
--     papel do achado C ficam para a Fase 3.
--   - UPDATE não distingue "corrigir" de "dar baixa": quem tem só
--     pagamentos.confirm também corrige o lançamento pela API. O RLS não vê
--     qual coluna mudou; separar isso pede função dedicada.
-- ============================================================================

DO $fase0$
BEGIN
  -- 1. Dinheiro: ver continua com financeiro.read (policy de hoje, intocada);
  --    escrever passa a exigir TAMBÉM a chave de pagamento.

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'pagamentos' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.pagamentos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'pagamentos' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.pagamentos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'pagamentos' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.pagamentos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_receber' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.contas_receber
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_receber' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.contas_receber
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_receber' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.contas_receber
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'parcelas_receber' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.parcelas_receber
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'parcelas_receber' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.parcelas_receber
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'parcelas_receber' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.parcelas_receber
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_pagar' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.contas_pagar
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_pagar' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.contas_pagar
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_pagar' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.contas_pagar
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'caixa_movimentos' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.caixa_movimentos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'caixa_movimentos' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.caixa_movimentos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'caixa_movimentos' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.caixa_movimentos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_bancarias' AND policyname = 'cadastrar conta exige pagamentos.create ou update') THEN
    CREATE POLICY "cadastrar conta exige pagamentos.create ou update" ON public.contas_bancarias
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create')
        OR public.has_permission((select auth.uid()), 'pagamentos.update'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_bancarias' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.contas_bancarias
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'contas_bancarias' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.contas_bancarias
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'banco_transacoes' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.banco_transacoes
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'banco_transacoes' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.banco_transacoes
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'banco_transacoes' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.banco_transacoes
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'compromissos_financeiros' AND policyname = 'lancar exige pagamentos.create') THEN
    CREATE POLICY "lancar exige pagamentos.create" ON public.compromissos_financeiros
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.create'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'compromissos_financeiros' AND policyname = 'corrigir ou dar baixa exige pagamentos.update ou confirm') THEN
    CREATE POLICY "corrigir ou dar baixa exige pagamentos.update ou confirm" ON public.compromissos_financeiros
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.update')
        OR public.has_permission((select auth.uid()), 'pagamentos.confirm'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'compromissos_financeiros' AND policyname = 'estornar ou apagar exige pagamentos.reverse') THEN
    CREATE POLICY "estornar ou apagar exige pagamentos.reverse" ON public.compromissos_financeiros
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'pagamentos.reverse'));
  END IF;

  -- 2. Espelhos de custo: só o gatilho de sincronia (SECURITY DEFINER, dono
  --    postgres, ignora RLS) grava. Pela API ninguém escreve neles.

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'produto_precos' AND policyname = 'espelho: so o gatilho insere') THEN
    CREATE POLICY "espelho: so o gatilho insere" ON public.produto_precos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'produto_precos' AND policyname = 'espelho: so o gatilho altera') THEN
    CREATE POLICY "espelho: so o gatilho altera" ON public.produto_precos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'produto_precos' AND policyname = 'espelho: so o gatilho apaga') THEN
    CREATE POLICY "espelho: so o gatilho apaga" ON public.produto_precos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'orcamento_custos' AND policyname = 'espelho: so o gatilho insere') THEN
    CREATE POLICY "espelho: so o gatilho insere" ON public.orcamento_custos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'orcamento_custos' AND policyname = 'espelho: so o gatilho altera') THEN
    CREATE POLICY "espelho: so o gatilho altera" ON public.orcamento_custos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'orcamento_custos' AND policyname = 'espelho: so o gatilho apaga') THEN
    CREATE POLICY "espelho: so o gatilho apaga" ON public.orcamento_custos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'orcamento_item_custos' AND policyname = 'espelho: so o gatilho insere') THEN
    CREATE POLICY "espelho: so o gatilho insere" ON public.orcamento_item_custos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'orcamento_item_custos' AND policyname = 'espelho: so o gatilho altera') THEN
    CREATE POLICY "espelho: so o gatilho altera" ON public.orcamento_item_custos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'orcamento_item_custos' AND policyname = 'espelho: so o gatilho apaga') THEN
    CREATE POLICY "espelho: so o gatilho apaga" ON public.orcamento_item_custos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'item_os_custos' AND policyname = 'espelho: so o gatilho insere') THEN
    CREATE POLICY "espelho: so o gatilho insere" ON public.item_os_custos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'item_os_custos' AND policyname = 'espelho: so o gatilho altera') THEN
    CREATE POLICY "espelho: so o gatilho altera" ON public.item_os_custos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'item_os_custos' AND policyname = 'espelho: so o gatilho apaga') THEN
    CREATE POLICY "espelho: so o gatilho apaga" ON public.item_os_custos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'material_custos' AND policyname = 'espelho: so o gatilho insere') THEN
    CREATE POLICY "espelho: so o gatilho insere" ON public.material_custos
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'material_custos' AND policyname = 'espelho: so o gatilho altera') THEN
    CREATE POLICY "espelho: so o gatilho altera" ON public.material_custos
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'material_custos' AND policyname = 'espelho: so o gatilho apaga') THEN
    CREATE POLICY "espelho: so o gatilho apaga" ON public.material_custos
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'os_resultados_financeiros' AND policyname = 'espelho: so o gatilho insere') THEN
    CREATE POLICY "espelho: so o gatilho insere" ON public.os_resultados_financeiros
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'os_resultados_financeiros' AND policyname = 'espelho: so o gatilho altera') THEN
    CREATE POLICY "espelho: so o gatilho altera" ON public.os_resultados_financeiros
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'os_resultados_financeiros' AND policyname = 'espelho: so o gatilho apaga') THEN
    CREATE POLICY "espelho: so o gatilho apaga" ON public.os_resultados_financeiros
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (false);
  END IF;

  -- 3. Mão de obra: mudar o custo/hora é mudar a tabela de custos.

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'custos_mao_de_obra' AND policyname = 'lancar mao de obra exige custos.update') THEN
    CREATE POLICY "lancar mao de obra exige custos.update" ON public.custos_mao_de_obra
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'custos.update'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'custos_mao_de_obra' AND policyname = 'alterar mao de obra exige custos.update') THEN
    CREATE POLICY "alterar mao de obra exige custos.update" ON public.custos_mao_de_obra
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'custos.update'))
      WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'custos.update'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'custos_mao_de_obra' AND policyname = 'apagar mao de obra exige custos.update') THEN
    CREATE POLICY "apagar mao de obra exige custos.update" ON public.custos_mao_de_obra
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_permission((select auth.uid()), 'custos.update'));
  END IF;

  -- 4. Eventos de negócio: só em nome próprio (fecha o ramo logs.read).

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'eventos_negocio' AND policyname = 'evento so em nome proprio') THEN
    CREATE POLICY "evento so em nome proprio" ON public.eventos_negocio
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (usuario_id = (select auth.uid()));
  END IF;

  -- 5. Comprovante no Storage: a régua do pagamento, ou o portal do cliente.

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                 AND tablename = 'objects' AND policyname = 'comprovante exige chave de pagamento ou portal') THEN
    CREATE POLICY "comprovante exige chave de pagamento ou portal" ON storage.objects
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (CASE WHEN bucket_id IS DISTINCT FROM 'comprovantes' THEN true
        ELSE (public.has_role(auth.uid(), 'admin'::public.app_role)
              OR public.has_permission(auth.uid(), 'pagamentos.create')
              OR public.has_permission(auth.uid(), 'pagamentos.update')
              OR public.has_permission(auth.uid(), 'pagamentos.confirm')
              OR public.portal_pode_enviar_objeto(bucket_id, name))
      END);
  END IF;
END $fase0$;

CREATE OR REPLACE FUNCTION public.anexar_comprovante_parcela(p_conta_id uuid, p_comprovante_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_qtd integer;
begin
  -- Anexar o comprovante é corrigir o lançamento: a mesma régua do UPDATE em
  -- contas_pagar (pagamentos.update ou pagamentos.confirm), não o papel. Até
  -- 05/10/2026 o PAPEL gestor passava aqui; a decisão de 03/10 é que o gestor
  -- só vê o financeiro.
  if not (public.has_role(auth.uid(),'admin')
          or public.has_permission(auth.uid(),'pagamentos.update')
          or public.has_permission(auth.uid(),'pagamentos.confirm')) then
    raise exception 'Sem permissão para anexar comprovante';
  end if;

  update public.contas_pagar
     set comprovante_url = p_comprovante_url, updated_at = now()
   where id = p_conta_id and compromisso_id is not null;

  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Parcela de compromisso não encontrada'; end if;
  return jsonb_build_object('conta_id', p_conta_id, 'anexado', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.baixar_parcela_compromisso(p_conta_id uuid, p_data_pagamento date, p_comprovante_url text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_lancar_caixa boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_p public.contas_pagar%rowtype;
  v_ja_no_caixa integer;
begin
  -- Dar baixa (marcar paga e lançar a saída no caixa) pede a chave de dar
  -- baixa, a mesma de confirmar_pagamento e importar_extrato — não o papel.
  if not (public.has_role(auth.uid(),'admin')
          or public.has_permission(auth.uid(),'pagamentos.confirm')) then
    raise exception 'Sem permissão para dar baixa em parcela';
  end if;

  select * into v_p from public.contas_pagar where id = p_conta_id;
  if not found then raise exception 'Parcela não encontrada'; end if;
  if v_p.compromisso_id is null then
    raise exception 'Esta conta não pertence a um compromisso';
  end if;

  update public.contas_pagar
     set status = 'paga',
         data_pagamento = p_data_pagamento,
         comprovante_url = coalesce(p_comprovante_url, comprovante_url),
         forma_pagamento = coalesce(p_forma_pagamento, forma_pagamento),
         updated_at = now()
   where id = p_conta_id;

  -- Movimento de caixa só se pedido E se ainda não existe: dar baixa duas vezes
  -- na mesma parcela (corrigir a data, anexar o comprovante depois) não pode
  -- lançar a saída duas vezes.
  if p_lancar_caixa then
    select count(*) into v_ja_no_caixa
      from public.caixa_movimentos where conta_pagar_id = p_conta_id;
    if v_ja_no_caixa = 0 then
      insert into public.caixa_movimentos
        (tipo, origem, descricao, categoria, valor, data, realizado, conta_pagar_id)
      values ('saida', 'conta_pagar', v_p.descricao, v_p.categoria, v_p.valor,
              p_data_pagamento, true, p_conta_id);
    end if;
  end if;

  return jsonb_build_object(
    'conta_id', p_conta_id,
    'data_pagamento', p_data_pagamento,
    'com_comprovante', coalesce(p_comprovante_url, v_p.comprovante_url) is not null,
    'lancado_no_caixa', p_lancar_caixa and coalesce(v_ja_no_caixa, 0) = 0
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_parcelas_compromisso(p_compromisso_id uuid, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c public.compromissos_financeiros%rowtype;
  v_passo interval; v_limite date; v_i integer; v_venc date;
  v_criadas integer := 0; v_ajustadas integer := 0; v_total integer;
begin
  -- Lançar o cronograma cria contas a pagar: pede a chave de lançar
  -- (pagamentos.create), não o papel. Realinhar só mexe nas parcelas em
  -- aberto, que fazem parte do mesmo lançamento.
  if not (public.has_role(auth.uid(),'admin')
          or public.has_permission(auth.uid(),'pagamentos.create')) then
    raise exception 'Sem permissão para gerar parcelas de compromisso';
  end if;

  select * into v_c from public.compromissos_financeiros where id = p_compromisso_id;
  if not found then raise exception 'Compromisso não encontrado'; end if;

  v_passo := case v_c.periodicidade
    when 'semanal' then interval '7 days'      when 'quinzenal' then interval '15 days'
    when 'mensal' then interval '1 month'      when 'bimestral' then interval '2 months'
    when 'trimestral' then interval '3 months' when 'semestral' then interval '6 months'
    when 'anual' then interval '1 year' end;

  v_limite := coalesce(p_ate, (current_date + interval '12 months')::date);
  v_total := v_c.total_parcelas;
  if v_total is null then
    v_total := 1;
    while (v_c.primeira_parcela + (v_total * v_passo))::date <= v_limite loop
      v_total := v_total + 1;
    end loop;
  end if;

  for v_i in 1..v_total loop
    v_venc := (v_c.primeira_parcela + ((v_i - 1) * v_passo))::date;

    insert into public.contas_pagar
      (descricao, fornecedor, categoria, valor, vencimento, status,
       recorrente, periodicidade, compromisso_id, parcela_numero, observacoes)
    values (
      v_c.descricao || ' — parcela ' || v_i ||
        case when v_c.total_parcelas is not null then '/' || v_c.total_parcelas else '' end,
      v_c.credor, coalesce(v_c.categoria, v_c.tipo), v_c.valor_parcela, v_venc,
      'aberta'::status_conta_pagar,
      true, v_c.periodicidade, v_c.id, v_i, v_c.numero_contrato
    )
    on conflict (compromisso_id, parcela_numero) where compromisso_id is not null do nothing;

    if found then
      v_criadas := v_criadas + 1;
    else
      update public.contas_pagar
         set vencimento = v_venc, valor = v_c.valor_parcela, updated_at = now()
       where compromisso_id = v_c.id and parcela_numero = v_i
         and status not in ('paga','cancelada')
         and (vencimento <> v_venc or valor <> v_c.valor_parcela);
      if found then v_ajustadas := v_ajustadas + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('compromisso_id', v_c.id, 'parcelas_criadas', v_criadas,
    'parcelas_ajustadas', v_ajustadas, 'parcelas_previstas', v_total,
    'horizonte', v_limite, 'sem_fim', v_c.total_parcelas is null);
end; $function$;

CREATE OR REPLACE FUNCTION public.quitar_parcelas_ate(p_compromisso_id uuid, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_qtd integer;
begin
  -- Quitar em lote é dar baixa (sem lançar no caixa): pede pagamentos.confirm,
  -- não o papel.
  if not (public.has_role(auth.uid(),'admin')
          or public.has_permission(auth.uid(),'pagamentos.confirm')) then
    raise exception 'Sem permissão para quitar parcelas';
  end if;
  update public.contas_pagar
     set status = 'paga', data_pagamento = vencimento,
         observacoes = coalesce(observacoes || ' · ', '') || 'quitada antes da entrada no sistema',
         updated_at = now()
   where compromisso_id = p_compromisso_id and vencimento <= p_ate
     and status not in ('paga','cancelada');
  get diagnostics v_qtd = row_count;
  return jsonb_build_object('parcelas_quitadas', v_qtd, 'ate', p_ate);
end; $function$;

-- Função nasce com EXECUTE para PUBLIC, e no Supabase anon e authenticated têm
-- grant próprio: REVOKE de PUBLIC sozinho não fecha o anon. Quem chama é a tela
-- logada (authenticated) e o servidor (service_role).
REVOKE ALL ON FUNCTION public.anexar_comprovante_parcela(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gerar_parcelas_compromisso(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quitar_parcelas_ate(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conciliar_transacao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anexar_comprovante_parcela(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gerar_parcelas_compromisso(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quitar_parcelas_ate(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conciliar_transacao(uuid, uuid) TO authenticated, service_role;
