-- ============================================================================
-- O total segue os itens — no orçamento e na OS
-- ============================================================================
--
-- Encontrado rodando o ciclo inteiro numa transação e conferindo o que cada
-- passo grava: orçamento → conversão → arte → entrada → produção.
--
-- `orcamentos.valor_total` e `ordens_servico.valor_total` são somados **só
-- pela tela**, em JavaScript. Enquanto uma pessoa usa a tela, bate — conferido
-- nos três orçamentos vivos com item (609 = 609, 28 = 28, 45 = 45). Mas não há
-- nenhum gatilho que role a soma para o cabeçalho, e quem grava item por outro
-- caminho — importação, editor do parceiro, conversão de outro módulo, uma
-- chamada de API — deixa o cabeçalho parado.
--
-- E o cabeçalho é o que o resto do sistema lê:
--
--   `converter_orcamento_em_os` copia `orcamentos.valor_total` para a OS
--   `fechar_os` usa `ordens_servico.valor_total − desconto` para saber se o
--     cliente já pagou (a trava `pagamentos_pendentes`)
--   `vw_resultado_os` calcula a margem realizada em cima dele
--   a comissão sai de uma porcentagem dele
--
-- Ou seja: o cabeçalho parado não fica só errado na tela — ele vira OS com
-- valor errado, conta a receber errada, margem errada e comissão errada, sem
-- nada acusar.
--
-- O orçamento 1 está assim hoje: **R$ 121,15 no cabeçalho e ZERO itens**. Não
-- é zerado por esta migração de propósito — ele está `convertido`, virou uma OS
-- real com pagamento em cima, e reescrever o cabeçalho apagaria o registro de
-- uma venda que aconteceu. Reconstruir não é decidir.
--
-- Retrato do banco vivo: aplicado e ensaiado com reversão.

-- ------------------------------------------------------------- 1. orçamento
CREATE OR REPLACE FUNCTION public.tg_orcamento_soma_os_itens()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_orc uuid;
BEGIN
  v_orc := COALESCE(NEW.orcamento_id, OLD.orcamento_id);
  IF v_orc IS NULL THEN RETURN NULL; END IF;

  UPDATE public.orcamentos o
     SET valor_total = COALESCE((SELECT sum(i.valor_total) FROM public.orcamento_itens i
                                  WHERE i.orcamento_id = v_orc), 0),
         updated_at = now()
   WHERE o.id = v_orc
     AND o.valor_total IS DISTINCT FROM COALESCE((SELECT sum(i.valor_total)
           FROM public.orcamento_itens i WHERE i.orcamento_id = v_orc), 0);
  RETURN NULL;
END $f$;

REVOKE ALL ON FUNCTION public.tg_orcamento_soma_os_itens() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_orcamento_soma_os_itens ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_soma_os_itens
  AFTER INSERT OR UPDATE OF valor_total, quantidade, valor_unitario, desconto OR DELETE
  ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_soma_os_itens();


-- -------------------------------------------------------------------- 2. OS
-- O `desconto` fica como está: quem dá desconto é uma pessoa, não a soma dos
-- itens. É por isso que o gatilho escreve `valor_total` e não mexe no resto.
CREATE OR REPLACE FUNCTION public.tg_os_soma_os_itens()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_os uuid; v_soma numeric;
BEGIN
  v_os := COALESCE(NEW.os_id, OLD.os_id);
  IF v_os IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(i.valor_total), 0) INTO v_soma FROM public.itens_os i WHERE i.os_id = v_os;
  UPDATE public.ordens_servico o SET valor_total = v_soma, updated_at = now()
   WHERE o.id = v_os AND o.valor_total IS DISTINCT FROM v_soma;
  RETURN NULL;
END $f$;

REVOKE ALL ON FUNCTION public.tg_os_soma_os_itens() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_os_soma_os_itens ON public.itens_os;
CREATE TRIGGER zz_os_soma_os_itens
  AFTER INSERT OR UPDATE OR DELETE ON public.itens_os
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_soma_os_itens();

-- ENSAIADO, com reversão:
--   orçamento vazio 0,00 -> 2 itens 150,00 -> muda p/ 5 un 375,00 -> apaga 0,00
--   OS vazia     0,00 -> 3 itens 225,00 -> apaga 0,00
--
-- E o ciclo inteiro, de ponta a ponta, depois destes gatilhos:
--   conversão  -> 1 item, 1 material previsto, 1 conta a receber, 1 hora de
--                 máquina reservada
--   arte       -> OS em `arte_aprovada`, produção liberada
--   entrada    -> recebimento parcial registrado sem quitar a parcela
--   produção   -> entra em `em_impressao`
