-- =====================================================================================================
-- TRAVA DE TRANSIÇÃO DE STATUS DO ORÇAMENTO NO BANCO (17/11/2026)
--
-- APLICADA no banco vivo em 17/11/2026, depois do ensaio (36 combinações, 0 falhas) em docs/ensaio-orcamento-transicao-de-status.md.
--
-- POR QUE
--   O front novo (AcoesDoStatus, aprovar_orcamento, renovar_orcamento_vencido, responder_orcamento_publico) já
--   só faz transições legítimas, mas o banco aceita qualquer UPDATE de status por quem tem RLS de escrita:
--   um orçamento aprovado poderia voltar a rascunho, um recusado poderia virar aprovado, um rascunho poderia
--   pular para aprovado sem nunca ter sido enviado. A regra tem de morar onde ninguém contorna.
--
-- TABELA DAS TRANSIÇÕES PERMITIDAS (status igual ao de antes sempre passa, é regravação sem mudança)
--   rascunho  para enviado                      envio confirmado
--   enviado   para aprovado, rejeitado, expirado
--   expirado  para enviado                      renovar
--   aprovado  para convertido                   conversão em OS
--   Não existe função de reabrir no banco vivo (lido em 17/11/2026), então nenhuma volta além da renovação.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. orcamento_transicao_permitida(text, text): a tabela acima, num lugar só. IMMUTABLE, só service_role.
--   2. tg_orcamento_transicao_de_status(): gatilho BEFORE UPDATE OF status em orcamentos. Fora da tabela
--      levanta erro com ERRCODE OR001 e DETAIL transicao_invalida. SECURITY DEFINER com search_path fixo,
--      como os gatilhos vizinhos; REVOKE de PUBLIC, anon e authenticated (gatilho não precisa de EXECUTE).
--   3. sync_orcamento_3d_para_funil (md5 do corpo vivo conferido antes, 45167125eda9df1a95c9ab0cefa8e28a):
--      única escritora de status do banco vivo que fazia transição fora da tabela. Ela copiava o status do
--      orçamento 3D por cima do orçamento do funil, em qualquer direção (um 3D em rascunho puxava um
--      orçamento enviado ou aprovado de volta a rascunho). Sem esta troca, editar o título de um 3D que não
--      é embutido passaria a dar erro. Agora ela só grava o status quando a transição é permitida e, se não
--      for, mantém o status do funil. O resto do corpo é idêntico.
--
-- CAMINHOS LEGÍTIMOS CONFERIDOS NO BANCO VIVO (nenhum é barrado)
--   aprovar_orcamento, responder_orcamento_publico (aprovar e recusar), renovar_orcamento_vencido,
--   api_executar renovar_orcamento (UPDATE direto, só de expirado ou enviado vencido), confirmar_envio_documento,
--   registrar_envio_documento (só de rascunho), contingência em documento-whatsapp.functions.ts (só de rascunho),
--   AcoesDoStatus rejeitar e expirar (UPDATE guardado por status enviado). Detalhes no doc do ensaio.
--
-- FICA DE FORA
--   Nenhum UPDATE, nenhuma carga retroativa: linhas já gravadas ficam como estão.
--   Nenhum caminho grava convertido hoje (converter_orcamento_em_os grava só os_id): a tabela já aceita
--   aprovado para convertido para quando houver.
--
-- COMO DESFAZER
--   DROP TRIGGER tg_orcamento_transicao_de_status ON public.orcamentos;
--   DROP FUNCTION public.tg_orcamento_transicao_de_status();
--   DROP FUNCTION public.orcamento_transicao_permitida(text, text);
--   e recolocar o corpo antigo de sync_orcamento_3d_para_funil (a linha status = v_status, sem o CASE).
--   Correção manual de status por quem administra o banco: ALTER TABLE public.orcamentos DISABLE TRIGGER
--   tg_orcamento_transicao_de_status; corrigir; ENABLE de novo, na mesma sessão.
-- =====================================================================================================
BEGIN;

DO $guarda$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.sync_orcamento_3d_para_funil()'::regprocedure)
       IS DISTINCT FROM '45167125eda9df1a95c9ab0cefa8e28a' THEN
    RAISE EXCEPTION 'sync_orcamento_3d_para_funil mudou desde o ensaio: reler o corpo vivo antes de trocar.' USING ERRCODE = '55000';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.orcamento_transicao_permitida(p_de text, p_para text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $f$
  SELECT p_de IS NOT DISTINCT FROM p_para
      OR (p_de, p_para) IN (
           ('rascunho', 'enviado'),
           ('enviado',  'aprovado'),
           ('enviado',  'rejeitado'),
           ('enviado',  'expirado'),
           ('expirado', 'enviado'),
           ('aprovado', 'convertido')
         );
$f$;

REVOKE ALL ON FUNCTION public.orcamento_transicao_permitida(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orcamento_transicao_permitida(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_orcamento_transicao_de_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.orcamento_transicao_permitida(OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'Este orçamento não pode mudar de % para %.', OLD.status::text, NEW.status::text
      USING ERRCODE = 'OR001',
            DETAIL = 'transicao_invalida',
            HINT = 'Rascunho vai para enviado. Enviado vai para aprovado, rejeitado ou expirado. Expirado volta para enviado ao renovar. Aprovado vai para convertido.';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_orcamento_transicao_de_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_orcamento_transicao_de_status() TO service_role;

DROP TRIGGER IF EXISTS tg_orcamento_transicao_de_status ON public.orcamentos;
CREATE TRIGGER tg_orcamento_transicao_de_status
  BEFORE UPDATE OF status ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_transicao_de_status();

CREATE OR REPLACE FUNCTION public.sync_orcamento_3d_para_funil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_orc_id uuid; v_status public.status_orcamento;
BEGIN
  IF COALESCE(NEW.embutido, false) THEN RETURN NULL; END IF;

  v_status := CASE lower(coalesce(NEW.status,'rascunho'))
    WHEN 'enviado' THEN 'enviado'::public.status_orcamento
    WHEN 'aprovado' THEN 'aprovado'::public.status_orcamento
    WHEN 'rejeitado' THEN 'rejeitado'::public.status_orcamento
    WHEN 'convertido' THEN 'convertido'::public.status_orcamento
    WHEN 'expirado' THEN 'expirado'::public.status_orcamento
    ELSE 'rascunho'::public.status_orcamento END;

  IF NEW.orcamento_id IS NULL THEN
    INSERT INTO public.orcamentos (cliente_id, titulo, descricao, status, valor_subtotal, valor_total,
                                   contato_nome, contato_telefone, contato_email, created_by, os_id, prazo)
    VALUES (NEW.cliente_id, NEW.titulo, coalesce(NEW.descricao,'Orçamento de impressão 3D'), v_status,
            coalesce(NEW.preco_comercial,0), coalesce(NEW.preco_comercial,0),
            NEW.contato_nome, NEW.contato_telefone, NEW.contato_email, NEW.created_by, NEW.os_id, NEW.prazo)
    RETURNING id INTO v_orc_id;
    UPDATE public.orcamentos_3d SET orcamento_id = v_orc_id WHERE id = NEW.id;
  ELSE
    UPDATE public.orcamentos
       SET cliente_id = NEW.cliente_id,
           titulo = NEW.titulo,
           status = CASE WHEN public.orcamento_transicao_permitida(status::text, v_status::text) THEN v_status ELSE status END,
           valor_subtotal = coalesce(NEW.preco_comercial,0),
           valor_total = coalesce(NEW.preco_comercial,0),
           contato_nome = NEW.contato_nome,
           contato_telefone = NEW.contato_telefone,
           contato_email = NEW.contato_email,
           os_id = coalesce(NEW.os_id, os_id),
           updated_at = now()
     WHERE id = NEW.orcamento_id;
  END IF;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.sync_orcamento_3d_para_funil() FROM PUBLIC, anon, authenticated;

COMMIT;
