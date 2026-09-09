-- Estas duas views existem justamente para ler tabelas em que o usuário logado
-- não tem SELECT direto. Com security_invoker elas param de funcionar.
ALTER VIEW public.produtos_operacional SET (security_invoker = off);
ALTER VIEW public.materiais_operacional SET (security_invoker = off);

DROP VIEW IF EXISTS public.vw_metragem_cliente;
DROP VIEW IF EXISTS public.vw_aprovacoes_orcamento;

CREATE VIEW public.vw_metragem_cliente AS
WITH orc AS (
  SELECT o.cliente_id,
         SUM(COALESCE(i.area_cobrada, i.area_total, 0)) AS m2_orcado,
         SUM(CASE WHEN o.status::text IN ('aprovado','convertido')
                  THEN COALESCE(i.area_cobrada, i.area_total, 0) ELSE 0 END) AS m2_aprovado,
         SUM(i.quantidade * i.valor_unitario) AS valor_orcado
    FROM public.orcamentos o
    JOIN public.orcamento_itens i ON i.orcamento_id = o.id
   WHERE o.cliente_id IS NOT NULL
     AND o.status::text NOT IN ('rejeitado','expirado')
   GROUP BY o.cliente_id
), os AS (
  SELECT s.cliente_id,
         SUM(COALESCE(i.area_cobrada, i.area_total, 0)) AS m2_em_os,
         SUM(CASE WHEN s.status::text IN ('concluido','faturado')
                  THEN COALESCE(i.area_cobrada, i.area_total, 0) ELSE 0 END) AS m2_produzido,
         SUM(i.valor_total) AS valor_os
    FROM public.ordens_servico s
    JOIN public.itens_os i ON i.os_id = s.id
   WHERE s.cliente_id IS NOT NULL
     AND s.status::text <> 'cancelado'
   GROUP BY s.cliente_id
)
SELECT c.id AS cliente_id,
       c.nome AS cliente_nome,
       ROUND(COALESCE(orc.m2_orcado, 0), 2)   AS m2_orcado,
       ROUND(COALESCE(orc.m2_aprovado, 0), 2) AS m2_aprovado,
       ROUND(COALESCE(os.m2_em_os, 0), 2)     AS m2_em_os,
       ROUND(COALESCE(os.m2_produzido, 0), 2) AS m2_produzido,
       ROUND(GREATEST(COALESCE(os.m2_em_os, 0) - COALESCE(os.m2_produzido, 0), 0), 2) AS m2_em_aberto,
       ROUND(GREATEST(COALESCE(orc.m2_aprovado, 0) - COALESCE(os.m2_em_os, 0), 0), 2) AS m2_aprovado_sem_os,
       CASE WHEN public.can_see_financials(auth.uid()) THEN COALESCE(orc.valor_orcado, 0) END AS valor_orcado,
       CASE WHEN public.can_see_financials(auth.uid()) THEN COALESCE(os.valor_os, 0) END AS valor_os
  FROM public.clientes c
  LEFT JOIN orc ON orc.cliente_id = c.id
  LEFT JOIN os  ON os.cliente_id = c.id
 WHERE public.is_staff(auth.uid())
   AND (COALESCE(orc.m2_orcado, 0) > 0 OR COALESCE(os.m2_em_os, 0) > 0);

GRANT SELECT ON public.vw_metragem_cliente TO authenticated;

CREATE VIEW public.vw_aprovacoes_orcamento AS
WITH artes AS (
  SELECT oi.orcamento_id,
         a.id AS arquivo_id,
         (SELECT ap.decisao FROM public.arquivo_aprovacoes ap
           WHERE ap.arquivo_id = a.id ORDER BY ap.created_at DESC LIMIT 1) AS decisao
    FROM public.orcamento_item_arquivos oia
    JOIN public.orcamento_itens oi ON oi.id = oia.item_id
    JOIN public.arquivos a ON a.id = oia.arquivo_id
), artes_datas AS (
  SELECT oi.orcamento_id, MAX(ap.created_at) AS ultima_decisao_em
    FROM public.orcamento_item_arquivos oia
    JOIN public.orcamento_itens oi ON oi.id = oia.item_id
    JOIN public.arquivo_aprovacoes ap ON ap.arquivo_id = oia.arquivo_id
   GROUP BY oi.orcamento_id
), artes_agg AS (
  SELECT orcamento_id,
         COUNT(*) AS artes_total,
         COUNT(*) FILTER (WHERE decisao = 'aprovado') AS artes_aprovadas,
         COUNT(*) FILTER (WHERE decisao = 'ajuste')   AS artes_ajuste,
         COUNT(*) FILTER (WHERE decisao IS NULL)      AS artes_sem_resposta
    FROM artes GROUP BY orcamento_id
), pedidos AS (
  SELECT orcamento_id,
         COUNT(*) FILTER (WHERE status = 'aberta') AS ajustes_abertos,
         COUNT(*) AS ajustes_total,
         MAX(created_at) AS ultimo_pedido_em
    FROM public.portal_cliente_solicitacoes
   WHERE orcamento_id IS NOT NULL
   GROUP BY orcamento_id
)
SELECT o.id,
       o.numero,
       o.titulo,
       o.status::text AS status,
       CASE WHEN public.can_see_financials(auth.uid()) THEN o.valor_total END AS valor_total,
       o.enviado_em,
       o.aprovado_em,
       o.aprovado_por_nome,
       o.created_at,
       o.cliente_id,
       COALESCE(c.nome, o.contato_nome) AS cliente_nome,
       o.os_id,
       s.numero AS os_numero,
       s.status::text AS os_status,
       (s.status::text IN ('concluido','faturado')) AS finalizado,
       COALESCE(ag.artes_total, 0)        AS artes_total,
       COALESCE(ag.artes_aprovadas, 0)    AS artes_aprovadas,
       COALESCE(ag.artes_ajuste, 0)       AS artes_ajuste,
       COALESCE(ag.artes_sem_resposta, 0) AS artes_sem_resposta,
       ad.ultima_decisao_em,
       COALESCE(p.ajustes_abertos, 0) AS ajustes_abertos,
       COALESCE(p.ajustes_total, 0)   AS ajustes_total,
       p.ultimo_pedido_em
  FROM public.orcamentos o
  LEFT JOIN public.clientes c ON c.id = o.cliente_id
  LEFT JOIN public.ordens_servico s ON s.id = o.os_id
  LEFT JOIN artes_agg ag ON ag.orcamento_id = o.id
  LEFT JOIN artes_datas ad ON ad.orcamento_id = o.id
  LEFT JOIN pedidos p ON p.orcamento_id = o.id
 WHERE public.is_staff(auth.uid());

GRANT SELECT ON public.vw_aprovacoes_orcamento TO authenticated;