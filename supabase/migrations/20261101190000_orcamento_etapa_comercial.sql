-- Funil de negociação do orçamento, como o Painel de Negociação do Holdprint (01/11/2026).
--
-- O Holdprint tem, entre "Enviados" e a aprovação, duas etapas que numa gráfica existem de
-- verdade: "Em Negociação" (o cliente respondeu e estão acertando preço, prazo ou arte) e
-- "Aceite Verbal" (o cliente disse sim, mas ainda não aprovou nem pagou o sinal). Aqui o
-- orçamento ia de "enviado" direto para "aprovado", e quem acompanha a venda não tinha onde
-- dizer em que pé a conversa está.
--
-- Não mexi no status. O status manda em muita coisa (aprovação, conversão em OS, portal,
-- vencimento por validade, dashboards), e uma etapa nova nele teria de ser tratada em cada um.
-- A etapa comercial é uma marca à parte, que só vale enquanto o orçamento está "enviado":
--   NULL           enviado, ainda sem resposta
--   em_negociacao  o cliente respondeu e estão ajustando
--   aceite_verbal  o cliente disse sim, falta a aprovação formal
-- Quando o status sai de "enviado" (aprovado, rejeitado, expirado, convertido) a marca é
-- limpa sozinha, para um orçamento aprovado não carregar "em negociação" para sempre.

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS etapa_comercial text;

ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_etapa_comercial_check;
ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_etapa_comercial_check
  CHECK (etapa_comercial IS NULL OR etapa_comercial IN ('em_negociacao', 'aceite_verbal'));

CREATE OR REPLACE FUNCTION public.tg_orcamento_etapa_so_enquanto_enviado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text <> 'enviado' THEN
    NEW.etapa_comercial := NULL;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_orcamentos_etapa_so_enquanto_enviado ON public.orcamentos;
CREATE TRIGGER tg_orcamentos_etapa_so_enquanto_enviado
  BEFORE INSERT OR UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_etapa_so_enquanto_enviado();

-- Função de gatilho não é para ninguém chamar.
REVOKE ALL ON FUNCTION public.tg_orcamento_etapa_so_enquanto_enviado() FROM PUBLIC, anon, authenticated;
