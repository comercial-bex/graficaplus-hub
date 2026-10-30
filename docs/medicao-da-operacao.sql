-- As 20 verificações da camada "Operação" do diagnóstico final (uma linha por verificação: quantos cumprem, de quantos).
-- Repetir antes de dizer que algo fechou: o diagnóstico envelhece (ver docs/diagnostico-final-30-10-2026.md, seção 8).
-- Somente leitura. Rode como admin no editor SQL do banco.
-- Quem fecha cada uma: equipe (hábito ou cadastro). O sistema só mostra e avisa.
SELECT * FROM (

-- 1.1 Contato novo do WhatsApp foi atendido (últimos 30 dias, fora telefone da equipe e fora quem chegou há menos de 4 h).
SELECT '1.1' AS id, 'Contatos novos atendidos (resposta humana ou lead já andando)' AS verificacao,
       count(*) FILTER (WHERE l.status <> 'novo' OR EXISTS (
         SELECT 1 FROM public.whatsapp_conversas cv JOIN public.whatsapp_mensagens m ON m.conversa_id = cv.id
          WHERE (cv.lead_id = l.id OR cv.telefone_normalizado = l.telefone_normalizado)
            AND m.direcao = 'saida' AND coalesce(m.origem, 'humano') IN ('humano', 'celular'))) AS feitos,
       count(*) AS total
  FROM public.leads l
 WHERE l.created_at > now() - interval '30 days' AND l.created_at < now() - interval '4 hours'
   AND NOT public._wa_telefone_da_equipe(l.telefone_normalizado)

UNION ALL
-- 1.2 Conversa de quem já é cliente cadastrado está ligada ao cliente.
SELECT '1.2', 'Conversas de cliente cadastrado ligadas ao cliente',
       count(*) FILTER (WHERE cv.cliente_id IS NOT NULL), count(*)
  FROM public.whatsapp_conversas cv
 WHERE EXISTS (SELECT 1 FROM public.clientes c WHERE c.ativo IS NOT FALSE
                AND (c.telefone_normalizado = cv.telefone_normalizado
                     OR public.normalize_whatsapp_phone(c.whatsapp_principal) = cv.telefone_normalizado))

UNION ALL
-- 1.3 Cliente ativo tem telefone ou e-mail.
SELECT '1.3', 'Clientes ativos com contato',
       count(*) FILTER (WHERE telefone_normalizado IS NOT NULL OR coalesce(btrim(email), '') <> ''), count(*)
  FROM public.clientes WHERE ativo IS NOT FALSE

UNION ALL
-- 2.1 Orçamento criado depois da regra (29/10) e já enviado ou aprovado traz forma e modelo de pagamento (o que a conversão exige).
SELECT '2.1', 'Orçamentos novos com condição de pagamento completa',
       count(*) FILTER (WHERE nullif(btrim(coalesce(condicao_pagamento->>'forma', '')), '') IS NOT NULL
                          AND coalesce(condicao_pagamento->>'modelo', '') IN ('a_vista', 'metade_metade', 'entrada', 'parcelado')),
       count(*)
  FROM public.orcamentos
 WHERE created_at >= '2026-10-29' AND status::text IN ('enviado', 'aprovado', 'convertido')

UNION ALL
-- 2.2 Rascunho não fica esquecido (mais de 14 dias).
SELECT '2.2', 'Rascunhos com menos de 14 dias',
       count(*) FILTER (WHERE created_at >= now() - interval '14 days'), count(*)
  FROM public.orcamentos WHERE status::text = 'rascunho'

UNION ALL
-- 3.1 Orçamento aprovado virou OS (fora os que o dono deixou como histórico).
SELECT '3.1', 'Aprovados que viraram OS',
       count(*) FILTER (WHERE os_id IS NOT NULL), count(*)
  FROM public.orcamentos WHERE status::text IN ('aprovado', 'convertido') AND sem_os_motivo IS NULL

UNION ALL
-- 3.2 Orçamento enviado é seguido (resposta em até 7 dias).
SELECT '3.2', 'Enviados com menos de 7 dias ou já respondidos',
       count(*) FILTER (WHERE coalesce(enviado_em, updated_at) >= now() - interval '7 days'), count(*)
  FROM public.orcamentos WHERE status::text = 'enviado'

UNION ALL
-- 3.3 Conversão em Pix só depois do Pix marcado como recebido (desde a regra, 26/10).
SELECT '3.3', 'Conversões em Pix com o Pix marcado',
       count(*) FILTER (WHERE (condicao_pagamento->'pix_recebido') IS NOT NULL), count(*)
  FROM public.orcamentos
 WHERE os_id IS NOT NULL AND lower(coalesce(condicao_pagamento->>'forma', '')) = 'pix' AND created_at >= '2026-10-26'

UNION ALL
-- 4.1 Pagamento cai na parcela (desde 22/10).
SELECT '4.1', 'Pagamentos ligados a uma parcela',
       count(*) FILTER (WHERE parcela_id IS NOT NULL), count(*)
  FROM public.pagamentos WHERE status::text = 'pago' AND valor > 0 AND created_at >= '2026-10-22'

UNION ALL
-- 4.2 Parcela vencida é cobrada: nenhuma com mais de 3 dias de atraso sem baixa.
SELECT '4.2', 'Parcelas vencidas há mais de 3 dias que já foram pagas',
       count(*) FILTER (WHERE status::text = 'paga'), count(*)
  FROM public.parcelas_receber WHERE vencimento < public.hoje_br() - 3

UNION ALL
-- 5.1 Produto que a casa produz tem máquina padrão e tempo (fora serviço e terceirizado).
SELECT '5.1', 'Produtos ativos com máquina padrão e tempo de produção',
       count(*) FILTER (WHERE maquina_padrao_id IS NOT NULL AND coalesce(tempo_producao_min, 0) > 0), count(*)
  FROM public.produtos WHERE ativo AND tipo::text <> 'servico' AND nome !~* 'terceiriz'

UNION ALL
-- 5.2 A OS anda: aberta, com movimento nos últimos 5 dias, e não paga parada em "entrada".
SELECT '5.2', 'OS abertas andando',
       count(*) FILTER (WHERE updated_at >= now() - interval '5 days' AND NOT (status_financeiro::text = 'pago' AND status::text = 'entrada')), count(*)
  FROM public.ordens_servico WHERE finalidade::text = 'venda' AND status::text NOT IN ('concluido', 'faturado', 'cancelado')

UNION ALL
-- 5.3 Material previsto e com estoque para reservar.
SELECT '5.3', 'OS abertas com material previsto e estoque',
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.os_materiais_previstos mp WHERE mp.os_id = o.id)
                          AND public.materiais_faltantes_da_os(o.id) IS NULL), count(*)
  FROM public.ordens_servico o WHERE o.finalidade::text = 'venda' AND o.status::text NOT IN ('concluido', 'faturado', 'cancelado')

UNION ALL
-- 5.4 Aceite da arte registrado (link do cliente ou aceite da equipe); impressão 3D não passa por arte.
SELECT '5.4', 'OS abertas com o aceite da arte registrado',
       count(*) FILTER (WHERE public.arte_aprovada_da_os(o.id)), count(*)
  FROM public.ordens_servico o
 WHERE o.finalidade::text = 'venda' AND o.status::text NOT IN ('concluido', 'faturado', 'cancelado')
   AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d t3 WHERE t3.os_id = o.id)

UNION ALL
-- 6.1 Hora de máquina apontada contra o que a Flexi imprimiu.
SELECT '6.1', 'Apontamentos de hora contra impressões da Flexi',
       least((SELECT count(*) FROM public.apontamentos_producao), (SELECT count(*) FROM public.rip_jobs)),
       (SELECT count(*) FROM public.rip_jobs)

UNION ALL
-- 6.2 Vínculos da Flexi decididos por alguém (nenhum fica só "sugerido" ou "revisar").
SELECT '6.2', 'Vínculos da Flexi decididos',
       count(*) FILTER (WHERE estado NOT IN ('sugerido', 'revisar')), count(*)
  FROM public.rip_job_vinculos

UNION ALL
-- 7.1 Material com entrada lançada no estoque (sem entrada, o saldo nunca foi contado).
SELECT '7.1', 'Materiais com alguma entrada de estoque',
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.material_lotes ml WHERE ml.material_id = m.id)), count(*)
  FROM public.materiais m WHERE m.status = 'ativo'

UNION ALL
-- 7.2 Inventário feito (pelo menos um registrado).
SELECT '7.2', 'Inventários registrados (basta um)', least(count(*), 1), 1 FROM public.estoque_inventarios

UNION ALL
-- 8.1 A OS que já saiu da oficina está fechada.
SELECT '8.1', 'OS que já saíram (retirada ou entrega) e estão fechadas',
       count(*) FILTER (WHERE status::text IN ('concluido', 'faturado')), count(*)
  FROM public.ordens_servico
 WHERE finalidade::text = 'venda' AND status::text <> 'cancelado'
   AND (status::text IN ('concluido', 'faturado', 'aguardando_retirada', 'aguardando_entrega', 'em_entrega', 'em_instalacao')
        OR public.os_saiu_fisicamente(id))

UNION ALL
-- 9.1 Aviso ao cliente sai: fila da última semana sem falha.
SELECT '9.1', 'Avisos ao cliente enviados (última semana)',
       count(*) FILTER (WHERE status = 'enviado'), count(*)
  FROM public.notificacoes_fila WHERE created_at > now() - interval '7 days'

) m ORDER BY id;
