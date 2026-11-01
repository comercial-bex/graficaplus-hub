-- O lead do WhatsApp nasce "temporário" e nunca deixava de ser (31/10/2026).
--
-- O webhook abre o lead sozinho, pelo telefone, com temporario = true. A marca
-- existe para o funil não contar quem só mandou "oi". Só que NADA no sistema a
-- tirava: nem gatilho, nem tela, nem função. Resultado medido em 31/10/2026:
-- 27 de 27 leads marcados, inclusive 3 já GANHOS com cliente e 12 em
-- atendimento, e o funil comercial (funil_comercial exclui temporario) mostrava
-- zero. Número de painel que mente por omissão.
--
-- Aqui a marca passa a sair pelos fatos, sem pedir hábito novo (o trabalho é na
-- conversa, não no registro; ver o lead que acompanha o atendimento, #297):
--   1. o lead ganha cliente (cliente_id);
--   2. o lead sai de "novo" para em_atendimento, orcamento ou ganho (a primeira
--      resposta humana já faz isso, por _wa_mensagem_antes_inserir);
--   3. nasce orçamento ligado ao lead.
-- "perdido" sozinho NÃO qualifica: é como a equipe descarta o contato que nunca
-- foi oportunidade (a própria tela diz "qualifique ou feche como perdido").
--
-- Efeito na caixa do WhatsApp: whatsapp_registrar_mensagem procura primeiro o
-- lead temporário do telefone e, se não houver, o ÚNICO lead aberto sem cliente
-- (cliente_id nulo, status fora de ganho/perdido). Quem foi qualificado continua
-- sendo achado pela segunda busca, então nova mensagem dele não abre lead
-- duplicado.
--
-- Os dados antigos são corrigidos pelo mesmo critério, sem apagar nada. O gatilho
-- de updated_at fica desligado só durante a correção: ele rejuvenesceria o lead e
-- o "dias parado" do funil mentiria de novo (dois cronômetros no mesmo campo).

CREATE OR REPLACE FUNCTION public.tg_lead_deixa_de_ser_temporario()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.temporario IS TRUE
     AND (NEW.cliente_id IS NOT NULL
          OR NEW.status IN ('em_atendimento', 'orcamento', 'ganho')) THEN
    NEW.temporario := false;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_leads_deixa_de_ser_temporario ON public.leads;
CREATE TRIGGER tg_leads_deixa_de_ser_temporario
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_deixa_de_ser_temporario();

-- Orçamento ligado ao lead também qualifica. SECURITY DEFINER porque quem faz o
-- orçamento nem sempre pode editar lead (RLS).
CREATE OR REPLACE FUNCTION public.tg_orcamento_qualifica_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET temporario = false
     WHERE id = NEW.lead_id
       AND temporario IS TRUE;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_orcamentos_qualifica_lead ON public.orcamentos;
CREATE TRIGGER tg_orcamentos_qualifica_lead
  AFTER INSERT OR UPDATE OF lead_id ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_qualifica_lead();

-- Funções de gatilho não são para ninguém chamar.
REVOKE ALL ON FUNCTION public.tg_lead_deixa_de_ser_temporario() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_orcamento_qualifica_lead() FROM PUBLIC, anon, authenticated;

-- Dados antigos, pelo mesmo critério e sem mexer em updated_at.
ALTER TABLE public.leads DISABLE TRIGGER tg_leads_updated;

UPDATE public.leads l
   SET temporario = false
 WHERE l.temporario IS TRUE
   AND (l.cliente_id IS NOT NULL
        OR l.status IN ('em_atendimento', 'orcamento', 'ganho')
        OR EXISTS (SELECT 1 FROM public.orcamentos o WHERE o.lead_id = l.id));

ALTER TABLE public.leads ENABLE TRIGGER tg_leads_updated;
