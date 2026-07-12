-- Aposentadoria de tabelas legadas + repontamento de views/FK para as canônicas
-- Contexto e justificativa: docs/achados-inconsistencia-frontend-backend.md
--
-- Todas as tabelas legadas abaixo foram verificadas VAZIAS (0 linhas) no banco
-- real (Supabase xzllbjbcdhkjrsiiytvn) em 2026-07-12 — não há migração de dados.
-- Nenhuma função depende delas; as únicas dependências são as 3 views e a FK
-- de public.arquivos, tratadas antes do DROP.
--
-- Pares legada -> canônica:
--   custos_os          -> custos_operacionais_os
--   tarefas            -> os_tarefas
--   comentarios_tarefa -> (comentários agora vivem em os_tarefas.comentarios JSONB)
--   conversas_whatsapp -> whatsapp_conversas
--   mensagens_whatsapp -> whatsapp_mensagens

BEGIN;

-- 1) Relatório de lucro por OS: ler custos_operacionais_os.total (canônica)
CREATE OR REPLACE VIEW public.rel_lucro_por_os AS
 SELECT os.id AS os_id,
    os.numero,
    os.titulo,
    c.nome AS cliente,
    os.created_at::date AS criada_em,
    os.status,
    COALESCE(pg.receita, os.valor_total, 0::numeric)::numeric(12,2) AS receita,
    COALESCE(NULLIF(co.custos_lancados, 0::numeric), os.custo_real, os.custo_previsto, 0::numeric)::numeric(12,2) AS custo,
    (COALESCE(pg.receita, os.valor_total, 0::numeric) - COALESCE(NULLIF(co.custos_lancados, 0::numeric), os.custo_real, os.custo_previsto, 0::numeric))::numeric(12,2) AS lucro,
        CASE
            WHEN COALESCE(pg.receita, os.valor_total, 0::numeric) > 0::numeric THEN round((COALESCE(pg.receita, os.valor_total, 0::numeric) - COALESCE(NULLIF(co.custos_lancados, 0::numeric), os.custo_real, os.custo_previsto, 0::numeric)) / COALESCE(pg.receita, os.valor_total, 0::numeric) * 100::numeric, 2)
            ELSE NULL::numeric
        END AS margem_percentual
   FROM ordens_servico os
     JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN LATERAL ( SELECT sum(p.valor) AS receita
           FROM pagamentos p
          WHERE p.os_id = os.id AND p.status = 'pago'::status_pagamento) pg ON true
     LEFT JOIN LATERAL ( SELECT sum(co1.total) AS custos_lancados
           FROM custos_operacionais_os co1
          WHERE co1.os_id = os.id) co ON true;

-- 2) Relatórios de WhatsApp: ler whatsapp_conversas / whatsapp_mensagens (canônicas)
--    Mapa de colunas: contato_nome->nome_contato, atendente->responsavel_id,
--    aberta_em->created_at, ultima_mensagem_em->ultima_mensagem_at,
--    enviada_em->created_at, etiqueta(text)->array_to_string(etiquetas).
--    Enums confirmados: direcao {entrada,saida}; status {aberta,pendente,resolvida,arquivada}.
CREATE OR REPLACE VIEW public.rel_whatsapp_conversas_abertas AS
 SELECT cw.id AS conversa_id,
    cw.nome_contato AS contato_nome,
    cw.telefone,
    array_to_string(cw.etiquetas, ', ') AS etiqueta,
    u.nome AS atendente,
    cw.created_at AS aberta_em,
    COALESCE(cw.ultima_mensagem_at, max(mw.created_at), cw.created_at) AS ultima_mensagem_em,
    count(mw.id) FILTER (WHERE mw.direcao = 'entrada'::whatsapp_mensagem_direcao) AS mensagens_entrada,
    count(mw.id) FILTER (WHERE mw.direcao = 'saida'::whatsapp_mensagem_direcao) AS mensagens_saida
   FROM whatsapp_conversas cw
     LEFT JOIN usuarios u ON u.id = cw.responsavel_id
     LEFT JOIN whatsapp_mensagens mw ON mw.conversa_id = cw.id
  WHERE cw.status = ANY (ARRAY['aberta'::whatsapp_conversa_status, 'pendente'::whatsapp_conversa_status])
  GROUP BY cw.id, cw.nome_contato, cw.telefone, cw.etiquetas, u.nome, cw.created_at, cw.ultima_mensagem_at;

CREATE OR REPLACE VIEW public.rel_whatsapp_tempo_medio_resposta AS
 WITH respostas AS (
         SELECT entrada.conversa_id,
            entrada.created_at AS recebida_em,
            ( SELECT min(saida.created_at) AS min
                   FROM whatsapp_mensagens saida
                  WHERE saida.conversa_id = entrada.conversa_id AND saida.direcao = 'saida'::whatsapp_mensagem_direcao AND saida.created_at > entrada.created_at) AS respondida_em
           FROM whatsapp_mensagens entrada
          WHERE entrada.direcao = 'entrada'::whatsapp_mensagem_direcao
        )
 SELECT cw.id AS conversa_id,
    cw.nome_contato AS contato_nome,
    u.nome AS atendente,
    count(*) FILTER (WHERE r.respondida_em IS NOT NULL) AS respostas,
    round(avg(EXTRACT(epoch FROM r.respondida_em - r.recebida_em)) FILTER (WHERE r.respondida_em IS NOT NULL) / 60::numeric, 2) AS minutos_media_resposta
   FROM whatsapp_conversas cw
     LEFT JOIN usuarios u ON u.id = cw.responsavel_id
     JOIN respostas r ON r.conversa_id = cw.id
  GROUP BY cw.id, cw.nome_contato, u.nome;

-- 3) Repontar FK de public.arquivos.tarefa_id para a canônica os_tarefas
--    (antes apontava para a legada 'tarefas', que a UI não usa mais).
ALTER TABLE public.arquivos DROP CONSTRAINT IF EXISTS arquivos_tarefa_id_fkey;
ALTER TABLE public.arquivos
  ADD CONSTRAINT arquivos_tarefa_id_fkey FOREIGN KEY (tarefa_id)
  REFERENCES public.os_tarefas(id) ON DELETE SET NULL;

-- 4) Aposentar as tabelas legadas (vazias). CASCADE remove policies/grants/triggers/FKs internas.
DROP TABLE IF EXISTS public.mensagens_whatsapp CASCADE;
DROP TABLE IF EXISTS public.conversas_whatsapp CASCADE;
DROP TABLE IF EXISTS public.comentarios_tarefa CASCADE;
DROP TABLE IF EXISTS public.custos_os CASCADE;
DROP TABLE IF EXISTS public.tarefas CASCADE;

COMMIT;

-- Pendências deixadas fora desta migração (revisar em separado):
--   whatsapp_respostas_rapidas, whatsapp_automacoes  -> UI usa respostas_rapidas/automacoes;
--     confirmar que a edge function e o fluxo Z-API não dependem delas antes do DROP.
--   os_tarefa_comentarios -> citada em rotina de limpeza (FOREACH TRUNCATE); ajustar a
--     função antes de aposentar.
