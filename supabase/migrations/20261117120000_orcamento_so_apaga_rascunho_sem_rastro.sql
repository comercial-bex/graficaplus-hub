-- =====================================================================================================
-- ORÇAMENTO SÓ É APAGADO SE FOR RASCUNHO SEM RASTRO (17/11/2026)
--
-- ENSAIADA no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final (ver docs/ensaio-orcamento-so-apaga-rascunho-sem-rastro.md).
-- APLICADA no banco vivo em 17/11/2026 (a 100000, da área cobrada, ficou de fora até o dono dar o OK).
--
-- O QUE ESTAVA ERRADO (lido no banco vivo em 17/11/2026)
--   Não havia nenhum gatilho BEFORE DELETE em public.orcamentos. A única barreira era a policy
--   "orc admin delete" (admin ou gestor, qualquer status). Um DELETE direto pela API, por service_role
--   ou por migração apagava orçamento aprovado, com OS, com comprovante ou já enviado, e levava junto
--   itens, versões, comprovantes e aprovações por cascata (a lição de 29/10: limpeza apagou produção real).
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   Um gatilho novo, BEFORE DELETE FOR EACH ROW, que só deixa apagar orçamento em rascunho E sem nenhum rastro:
--   enviado_em, versão, documento enviado, link aberto, aprovação, OS, comprovante, cobrança, pedido de
--   parceiro, cobrança no WhatsApp, solicitação do portal, peça 3D, arquivo de impressão ou PDF gerado.
--   Vale para todos, inclusive service_role e migração. Quem pode apagar continua sendo só admin e gestor
--   (policy que já existe); o gatilho se soma a ela. Erro com ERRCODE 23001 e mensagem simples, que manda
--   falar com o gestor (não cita Recusado nem Expirado: de rascunho a tela não leva a esses estados).
--   Função e gatilho NOVOS: nenhuma função viva é trocada. Nenhum dado é alterado.
--   NÃO mexe em TRUNCATE nem em DELETE de anon (fora desta onda, decisão do dono).
--
-- COMO DESFAZER (comentado): DROP TRIGGER tg_orcamento_so_apaga_rascunho_sem_rastro ON public.orcamentos;
--   DROP FUNCTION public.tg_orcamento_so_apaga_rascunho_sem_rastro();
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $g$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orcamentos', 'orcamento_versoes', 'documentos_enviados', 'documentos_gerados', 'ordens_servico',
    'orcamento_comprovantes', 'contas_receber', 'aprovacoes', 'whatsapp_cobrancas', 'parceiro_orcamentos',
    'portal_cliente_solicitacoes', 'orcamentos_3d', 'rip_job_vinculos'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'tabela % não existe', t; END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orcamentos'
        AND column_name IN ('status', 'enviado_em', 'aprovado_em', 'os_id', 'versao_aprovada_id', 'visualizado_em', 'visualizacoes')) <> 7 THEN
    RAISE EXCEPTION 'orcamentos perdeu coluna usada pela trava';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orcamentos'::regclass AND tgname = 'tg_orcamento_so_apaga_rascunho_sem_rastro') THEN
    RAISE EXCEPTION 'o gatilho já existe: ler a definição viva antes de reaplicar';
  END IF;
END $g$;

CREATE OR REPLACE FUNCTION public.tg_orcamento_so_apaga_rascunho_sem_rastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE v_motivo text;
BEGIN
  IF OLD.status::text <> 'rascunho' THEN
    v_motivo := 'ele já passou da fase de rascunho';
  ELSIF OLD.enviado_em IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.orcamento_versoes v WHERE v.orcamento_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.documentos_enviados d WHERE d.tipo = 'orcamento' AND d.referencia_id = OLD.id) THEN
    v_motivo := 'ele já foi enviado ao cliente';
  ELSIF OLD.visualizado_em IS NOT NULL OR coalesce(OLD.visualizacoes, 0) > 0 THEN
    v_motivo := 'o cliente já abriu o link';
  ELSIF OLD.aprovado_em IS NOT NULL OR OLD.versao_aprovada_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.aprovacoes a WHERE a.orcamento_id = OLD.id) THEN
    v_motivo := 'ele tem aprovação do cliente';
  ELSIF OLD.os_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.orcamento_id = OLD.id) THEN
    v_motivo := 'ele tem ordem de serviço';
  ELSIF EXISTS (SELECT 1 FROM public.orcamento_comprovantes c WHERE c.orcamento_id = OLD.id) THEN
    v_motivo := 'ele tem comprovante de pagamento';
  ELSIF EXISTS (SELECT 1 FROM public.contas_receber r WHERE r.orcamento_id = OLD.id) THEN
    v_motivo := 'ele tem cobrança lançada';
  ELSIF EXISTS (SELECT 1 FROM public.whatsapp_cobrancas w WHERE w.orcamento_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.parceiro_orcamentos p WHERE p.pedido_orcamento_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.portal_cliente_solicitacoes s WHERE s.orcamento_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.orcamentos_3d d3 WHERE d3.orcamento_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.rip_job_vinculos j WHERE j.orcamento_id = OLD.id) THEN
    v_motivo := 'ele está ligado a pedido de parceiro, cobrança no WhatsApp, peça 3D ou arquivo de impressão';
  ELSIF EXISTS (SELECT 1 FROM public.documentos_gerados g WHERE g.tipo = 'orcamento' AND g.referencia_id = OLD.id) THEN
    v_motivo := 'ele já gerou PDF';
  END IF;
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento não pode ser apagado: %. Fale com o gestor.', v_motivo
      USING ERRCODE = '23001';
  END IF;
  RETURN OLD;
END $f$;

REVOKE ALL ON FUNCTION public.tg_orcamento_so_apaga_rascunho_sem_rastro() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_orcamento_so_apaga_rascunho_sem_rastro
  BEFORE DELETE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_so_apaga_rascunho_sem_rastro();

DO $v$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orcamentos'::regclass
                 AND tgname = 'tg_orcamento_so_apaga_rascunho_sem_rastro' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'gatilho da trava não ficou ligado';
  END IF;
  IF has_function_privilege('anon', 'public.tg_orcamento_so_apaga_rascunho_sem_rastro()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_orcamento_so_apaga_rascunho_sem_rastro()', 'EXECUTE') THEN
    RAISE EXCEPTION 'função de gatilho ficou executável por anon ou authenticated';
  END IF;
END $v$;

COMMIT;
