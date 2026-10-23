-- A fila de produção ganha etapa própria (23/10/2026).
--
-- O quadro de produção e a TV da oficina falavam da mesma OS em lugares
-- diferentes: `aguardando_producao` ("Fila de produção") ficava na coluna
-- Pré-impressão do quadro e no bloco Oficina da TV. O dono pediu o caminho
-- entrada → arte → fila de impressão → produção → acabamento → saída e que o
-- quadro e a TV batam. Aqui a fila vira etapa `fila_producao`, e o quadro passa a
-- ter seis colunas; a TV continua agrupando a fila na Oficina.
--
-- `etapa_da_os` ganha a etapa nova, e `bloco_da_tv` troca a exceção por status
-- (`aguardando_producao → oficina`) por uma regra da etapa (`fila_producao →
-- oficina`): o bloco de cada um dos 26 status é exatamente o de antes. Nenhuma
-- view, coluna gerada, índice ou política depende de `etapa_da_os` (conferido no
-- banco); `tv_painel_maquinas` e `marco_notificavel_os` só comparam com
-- 'producao', que segue igual.

CREATE OR REPLACE FUNCTION public.etapa_da_os(p_status status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status IN ('entrada', 'aguardando_briefing', 'briefing_ok') THEN 'entrada'
    WHEN p_status IN ('design', 'aguardando_aprovacao_arte', 'arte_aprovada', 'arte_rejeitada') THEN 'pre_impressao'
    WHEN p_status IN ('aguardando_producao') THEN 'fila_producao'
    WHEN p_status IN ('em_impressao', 'em_corte', 'em_laser_cnc', 'em_3d', 'em_uv', 'em_producao', 'producao') THEN 'producao'
    WHEN p_status IN ('em_acabamento', 'controle_qualidade', 'retrabalho') THEN 'acabamento'
    WHEN p_status IN ('aguardando_retirada', 'aguardando_entrega', 'em_entrega', 'em_instalacao', 'concluido', 'faturado') THEN 'saida'
    WHEN p_status IN ('pausado', 'cancelado') THEN 'fora_do_fluxo'
  END
$function$;

CREATE OR REPLACE FUNCTION public.bloco_da_tv(p_status status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status = 'pausado' THEN 'pausada'
    WHEN public.os_esta_encerrada(p_status) THEN 'fora'
    ELSE CASE public.etapa_da_os(p_status)
      WHEN 'entrada' THEN 'entrada_arte'
      WHEN 'pre_impressao' THEN 'entrada_arte'
      WHEN 'fila_producao' THEN 'oficina'
      WHEN 'producao' THEN 'oficina'
      WHEN 'acabamento' THEN 'acabamento'
      WHEN 'saida' THEN 'saida'
    END
  END
$function$;
