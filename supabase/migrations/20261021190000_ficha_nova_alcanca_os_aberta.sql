-- Ficha nova alcança a OS que já está aberta (21/10/2026).
--
-- O material previsto da OS só nasce quando o item é incluído
-- (`tg_prever_materiais` em itens_os) ou na conversão do orçamento. Produto que
-- ganha ficha DEPOIS deixa a OS aberta sem material previsto para sempre: não
-- reserva estoque, não dá baixa, custo real zero — e a pendência "Ordens em
-- produção sem material previsto" nunca sai, mesmo com a ficha feita. Achado na
-- OS #165 (Acrílico Virgem Recortado 3mm, ficha de 21/10, OS de 13/10); o mesmo
-- esperava #161 e #162 (chaveiro) e #167 (brindes) quando o Yvens fizer as
-- fichas que faltam.
--
-- Agora cada linha nova de ficha roda `gerar_materiais_previstos_os` nas OS
-- ainda abertas (o mesmo corte da pendência: fora concluido/faturado/cancelado)
-- que têm item desse produto. A função só insere o que falta (NOT EXISTS por
-- item e material) — rodar de novo não duplica. OS fechada não muda: o que já
-- saiu do estoque já foi baixado. Mudar a quantidade de uma linha da ficha não
-- reescreve o previsto das OS abertas (o previsto é o retrato de quando entrou).

CREATE OR REPLACE FUNCTION public.tg_ficha_nova_alcanca_os_aberta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_os uuid;
BEGIN
  FOR v_os IN
    SELECT DISTINCT i.os_id
      FROM public.itens_os i
      JOIN public.ordens_servico os ON os.id = i.os_id
     WHERE i.produto_id = NEW.produto_id
       AND os.status NOT IN ('concluido', 'faturado', 'cancelado')
  LOOP
    PERFORM public.gerar_materiais_previstos_os(v_os);
  END LOOP;
  RETURN NULL;
END $function$;
COMMENT ON FUNCTION public.tg_ficha_nova_alcanca_os_aberta() IS
  'Linha nova de ficha técnica gera o material previsto que falta nas OS abertas daquele produto.';
REVOKE ALL ON FUNCTION public.tg_ficha_nova_alcanca_os_aberta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_ficha_nova_alcanca_os_aberta ON public.produto_materiais;
CREATE TRIGGER tg_ficha_nova_alcanca_os_aberta
  AFTER INSERT ON public.produto_materiais
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_nova_alcanca_os_aberta();
