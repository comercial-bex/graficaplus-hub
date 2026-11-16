-- =====================================================================================================
-- CONTAS A PAGAR — TRAVA DO ESTORNO NO BANCO (16/11/2026)
--
-- APLICADA em 16/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO logo depois de aplicada, md5(prosrc) em pg_proc igual ao corpo abaixo:
--   tg_conta_paga_so_admin_desfaz         b7408c6b2d554d9263d643cc91257224
--   tg_saida_de_conta_paga_so_admin_mexe  82647b5025276e4d17d338ac1f4ed9bc
-- Ensaio no banco vivo em seguida (docs/ensaio-trava-do-estorno.sql): TRAVA OK, nada gravado. O financeiro
-- passou a ser recusado nos 7 caminhos de desfazer pagamento e continua nos 4 legítimos (dar baixa de novo
-- para corrigir a data, mudar a data da saída, apagar conta em aberto, apagar movimento manual); o gestor
-- deixou de reabrir conta paga. O ensaio da fase 1 (docs/ensaio-contas-a-pagar-fase-1.sql) segue OK.
-- Antes da trava, o primeiro estorno real (admin, pela tela, 16/11 13:22 de Macapá) já tinha passado pelo
-- caminho certo: estornar_conta_pagar, com motivo e histórico.
--
-- O QUE ESTAVA ABERTO
--   estornar_conta_pagar (20261116160000) só aceita admin, e isso é conferido no banco. Mas as regras
--   antigas das tabelas (05/10, "lancar/corrigir/estornar exige pagamentos.*") deixavam desfazer um
--   pagamento por fora da função, pela API, sem motivo e sem ser admin. Medido no banco vivo em 16/11, numa
--   transação desfeita, com uma conta paga pela função:
--                                 função   reabrir (UPDATE)   apagar a saída   apagar a conta
--     admin                       passa    passa              passa            passa
--     financeiro                  recusa   PASSA              PASSA            PASSA
--     gestor (também vendedor)    recusa   PASSA              0 linhas         0 linhas
--     vendedor sem financeiro     recusa   0 linhas           0 linhas         0 linhas
--   Nenhuma tela e nenhuma função usa esses caminhos (conferido no código e em pg_proc): só a própria
--   estornar_conta_pagar reabre conta paga e apaga a saída do pagamento.
--
-- O QUE ESTA MIGRAÇÃO FAZ (decisão do usuário em 16/11/2026: "pode aplicar a trava do estorno no banco")
--   Gatilhos BEFORE que recusam, para quem está logado e não é admin:
--     contas_pagar      tirar a conta de 'paga' (para aberta, atrasada ou cancelada) e apagar conta paga;
--     caixa_movimentos  apagar a saída lançada por conta a pagar (origem 'conta_pagar' ligada a uma conta) e
--                       mudar nela conta_pagar_id, valor, tipo, realizado ou origem.
--   Continua igual: pagar, dar baixa em parcela (inclusive dar baixa de novo para corrigir a data: paga ->
--   paga), quitar em lote, gerar parcelas, lançar e corrigir conta em aberto, movimento manual e extrato.
--   Sem usuário logado (auth.uid() nulo: migração, cron, servidor com a chave de serviço) passa, como hoje.
--   O admin passa sempre, e estornar_conta_pagar só roda para admin.
--   Nenhuma policy é alterada; os gatilhos somam uma condição às regras que já existem.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.estornar_conta_pagar(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'estornar_conta_pagar não existe: aplique 20261116160000 antes';
  END IF;
  IF to_regprocedure('public.has_role(uuid, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'has_role não existe';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.tg_conta_paga_so_admin_desfaz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paga' AND NEW.status IS DISTINCT FROM 'paga' THEN
    RAISE EXCEPTION 'Conta paga só volta a ficar em aberto pelo Estornar, e só o administrador estorna.'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'paga' THEN
    RAISE EXCEPTION 'Conta paga não se apaga: peça ao administrador para estornar primeiro.'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

COMMENT ON FUNCTION public.tg_conta_paga_so_admin_desfaz() IS
  'Trava do estorno: quem está logado e não é admin não tira conta a pagar de paga nem apaga conta paga. Desfazer pagamento é estornar_conta_pagar.';

CREATE OR REPLACE FUNCTION public.tg_saida_de_conta_paga_so_admin_mexe()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF OLD.origem IS DISTINCT FROM 'conta_pagar' OR OLD.conta_pagar_id IS NULL
     OR v_uid IS NULL OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A saída de caixa de uma conta a pagar só sai pelo Estornar, e só o administrador estorna.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.conta_pagar_id IS DISTINCT FROM OLD.conta_pagar_id OR NEW.valor IS DISTINCT FROM OLD.valor
     OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.realizado IS DISTINCT FROM OLD.realizado
     OR NEW.origem IS DISTINCT FROM OLD.origem THEN
    RAISE EXCEPTION 'A saída de caixa de uma conta a pagar não se desliga nem muda de valor: só o administrador, pelo Estornar.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.tg_saida_de_conta_paga_so_admin_mexe() IS
  'Trava do estorno: quem está logado e não é admin não apaga, não desliga e não muda valor, tipo, realizado ou origem da saída de caixa lançada por conta a pagar.';

DROP TRIGGER IF EXISTS tg_conta_paga_so_admin_desfaz ON public.contas_pagar;
CREATE TRIGGER tg_conta_paga_so_admin_desfaz
  BEFORE UPDATE OF status OR DELETE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.tg_conta_paga_so_admin_desfaz();

DROP TRIGGER IF EXISTS tg_saida_de_conta_paga_so_admin_mexe ON public.caixa_movimentos;
CREATE TRIGGER tg_saida_de_conta_paga_so_admin_mexe
  BEFORE UPDATE OR DELETE ON public.caixa_movimentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_saida_de_conta_paga_so_admin_mexe();

-- Função de gatilho não precisa de EXECUTE para disparar; ninguém chama direto.
REVOKE ALL ON FUNCTION public.tg_conta_paga_so_admin_desfaz() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_saida_de_conta_paga_so_admin_mexe() FROM PUBLIC, anon, authenticated;

DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.tg_conta_paga_so_admin_desfaz()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_conta_paga_so_admin_desfaz()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.tg_saida_de_conta_paga_so_admin_mexe()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_saida_de_conta_paga_so_admin_mexe()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'função de gatilho ficou executável por anon ou authenticated';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('tg_conta_paga_so_admin_desfaz', 'tg_saida_de_conta_paga_so_admin_mexe')) <> 2 THEN
    RAISE EXCEPTION 'os dois gatilhos da trava não estão no banco';
  END IF;
END $confere$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (não roda):
-- BEGIN;
-- DROP TRIGGER IF EXISTS tg_conta_paga_so_admin_desfaz ON public.contas_pagar;
-- DROP TRIGGER IF EXISTS tg_saida_de_conta_paga_so_admin_mexe ON public.caixa_movimentos;
-- DROP FUNCTION IF EXISTS public.tg_conta_paga_so_admin_desfaz();
-- DROP FUNCTION IF EXISTS public.tg_saida_de_conta_paga_so_admin_mexe();
-- COMMIT;
-- =====================================================================================================
