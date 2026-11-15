-- =====================================================================================================
-- PREÇOS PENDENTES DE APROVAÇÃO E ALERTA PERMANENTE DE INTEGRIDADE DOS ORÇAMENTOS (15/11/2026)
-- ENSAIADA no banco vivo com RAISE EXCEPTION final (docs/ensaio-precos-pendentes-e-alertas.md). APLICADA no banco vivo em 15/11/2026 (preços de produto inalterados, propostas pendentes).
-- Não rodar sem autorização do dono. O preço de NENHUM produto muda aqui: as propostas nascem 'pendente'.
--
-- A regra do dono: preço de produto não se baixa a margem mínima, CONSERTA-SE o preço para a margem
-- mínima caber. Por isso a tela de propostas mostra preço atual, piso e proposta, e só gestor ou admin
-- (que veem custo) decidem.
--
-- A) precos_propostas: o que o sistema sugere consertar, com piso e margens pela MESMA conta do piso de
--    parceiro_precos: round(custo_medio / (1 - margem_minima / 100), 2), custo só de material.
-- B) preco_proposta_aprovar / preco_proposta_recusar: só admin ou gestor que vê custo. Aprovar grava
--    produtos.preco_base (o espelho produto_precos segue pelo gatilho que já existe), com WHERE, depois
--    de conferir contra o piso vivo. Nunca toca em orçamento.
-- C) alerta_integridade_orcamentos(p_enfileirar): detecta 6 tipos de problema e avisa o grupo interno
--    pela fila que já existe (enfileirar_notificacao + aviso_grupo_equipe). Sem EXCEPTION que engole:
--    envio recusado vira linha 'aviso_nao_enviado', fila que falha volta a ser reenviada.
-- D) A mesma função devolve o resumo em jsonb para a tela. Chamada por uma pessoa, só olha (modo seco).
--
-- Mensagem ao CLIENTE nunca: o destino é só grupo_equipe_destino(). O texto leva só o PERCENTUAL de
-- margem pedido pelo dono, nunca custo em reais.
--
-- Fila: notificacoes_fila.entidade só aceita 'orcamento','ordem_servico','parceiro','usuario',
-- 'whatsapp_atendimento','lead' e entidade_id é NOT NULL. Aviso de orçamento usa o id do orçamento;
-- aviso de produto e aviso-resumo usam 'orcamento' com o id da linha de alerta (nada lê isso como
-- orçamento: os consumidores filtram pelo evento).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Contas pequenas, as mesmas do piso de parceiro_precos. Ninguém de fora chama.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._preco_piso(p_custo numeric, p_margem_minima numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT CASE WHEN COALESCE(p_custo, 0) > 0 AND COALESCE(p_margem_minima, 0) < 100
              THEN round(p_custo / (1 - COALESCE(p_margem_minima, 0) / 100), 2) END
$f$;

CREATE OR REPLACE FUNCTION public._preco_margem(p_preco numeric, p_custo numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT CASE WHEN COALESCE(p_preco, 0) > 0 AND p_custo IS NOT NULL
              THEN round((p_preco - p_custo) / p_preco * 100, 2) END
$f$;

CREATE OR REPLACE FUNCTION public._integridade_brl(p_valor numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT replace(to_char(round(p_valor, 2), 'FM999999999990.00'), '.', ',')
$f$;

REVOKE ALL ON FUNCTION public._preco_piso(numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._preco_margem(numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._integridade_brl(numeric) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- A) Propostas de preço
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.precos_propostas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id      uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_atual     numeric(12,4) NOT NULL CHECK (preco_atual >= 0),
  preco_proposto  numeric(12,4) NOT NULL CHECK (preco_proposto > 0),
  custo           numeric(12,4),
  piso            numeric(12,4),
  margem_minima   numeric(6,2),
  margem_atual    numeric(8,2),
  margem_proposta numeric(8,2),
  motivo          text NOT NULL CHECK (btrim(motivo) <> ''),
  origem          text NOT NULL CHECK (origem IN ('abaixo_do_piso', 'referencia_m2')),
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'recusada')),
  decidido_por    uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  decidido_em     timestamptz,
  nota            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pendente') = (decidido_em IS NULL))
);

-- Uma proposta pendente por produto.
CREATE UNIQUE INDEX IF NOT EXISTS precos_propostas_uma_pendente_por_produto
  ON public.precos_propostas (produto_id) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS precos_propostas_produto_idx ON public.precos_propostas (produto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS precos_propostas_decidido_por_idx ON public.precos_propostas (decidido_por) WHERE decidido_por IS NOT NULL;

ALTER TABLE public.precos_propostas ENABLE ROW LEVEL SECURITY;

-- Leitura só de quem vê custo e margem (o mesmo critério de custos_tabela e custos_mao_de_obra).
-- Escrita direta: nenhuma policy. Quem decide é a função SECURITY DEFINER da seção B.
DROP POLICY IF EXISTS "precos_propostas leitura de quem ve custo" ON public.precos_propostas;
CREATE POLICY "precos_propostas leitura de quem ve custo" ON public.precos_propostas
  FOR SELECT TO authenticated
  USING (public.pode_ver_custo((SELECT auth.uid())));

REVOKE ALL ON TABLE public.precos_propostas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.precos_propostas TO authenticated;
GRANT SELECT ON TABLE public.precos_propostas TO service_role;

-- Tela: a proposta com o nome do produto. security_invoker: vale a RLS de quem pergunta.
CREATE OR REPLACE VIEW public.vw_precos_propostas WITH (security_invoker = true) AS
SELECT pr.id, pr.produto_id, p.nome AS produto_nome, p.unidade, p.ativo AS produto_ativo,
       pr.preco_atual, pr.preco_proposto, pr.custo, pr.piso, pr.margem_minima, pr.margem_atual,
       pr.margem_proposta, pr.motivo, pr.origem, pr.status, pr.decidido_por, pr.decidido_em, pr.nota,
       pr.created_at
FROM public.precos_propostas pr
JOIN public.produtos p ON p.id = pr.produto_id;

REVOKE ALL ON TABLE public.vw_precos_propostas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vw_precos_propostas TO authenticated;
GRANT SELECT ON TABLE public.vw_precos_propostas TO service_role;

-- Semente: 7 produtos abaixo do piso e 5 de metro quadrado a ajustar para perto de 70. Tudo 'pendente'.
-- Custo, margem mínima e preço atual saem do banco vivo; a margem sai da mesma conta do piso.
INSERT INTO public.precos_propostas
  (produto_id, preco_atual, preco_proposto, custo, piso, margem_minima, margem_atual, margem_proposta, motivo, origem)
SELECT p.id, p.preco_base, v.novo, p.custo_medio, public._preco_piso(p.custo_medio, p.margem_minima),
       p.margem_minima, public._preco_margem(p.preco_base, p.custo_medio), public._preco_margem(v.novo, p.custo_medio),
       CASE WHEN v.motivo IS NOT NULL THEN v.motivo
            ELSE format('Preço abaixo do piso de %s. A margem hoje é de %s por cento e o mínimo é %s por cento.',
                        public._integridade_brl(public._preco_piso(p.custo_medio, p.margem_minima)),
                        replace(public._preco_margem(p.preco_base, p.custo_medio)::text, '.', ','),
                        replace(p.margem_minima::text, '.', ',')) END,
       v.origem
FROM (VALUES
  ('c07299b0-a140-4a1f-860b-dfcb2be8d998'::uuid, 113.90::numeric, NULL::text, 'abaixo_do_piso'),
  ('fb5b6cd1-3998-41a0-90d3-50f219c909a8', 50.90, NULL, 'abaixo_do_piso'),
  ('1a646e6f-1988-4fda-9a3f-c0284112f9d8', 49.90, NULL, 'abaixo_do_piso'),
  ('02084c59-cc5e-49c3-b3b5-55d18b2581d0', 67.90, NULL, 'abaixo_do_piso'),
  ('ea107d14-1ccf-4c36-b946-4ca6768ab4ea', 40.90, NULL, 'abaixo_do_piso'),
  ('f7e2dc28-9f0f-49f9-ba05-62f8cdedb1da', 2.10, NULL, 'abaixo_do_piso'),
  ('923148dd-1675-4fc8-9a35-1778418d6e85', 55.90, NULL, 'abaixo_do_piso'),
  ('71d065ab-a984-4e7f-a132-69f218fa1daf', 59.90,
     'Mesma lona e mesmo custo da lona 280g. O preço de 45 fica muito abaixo da referência de 70 por metro quadrado.', 'referencia_m2'),
  ('2fcb2825-56b8-4e8b-a4f7-386cf3612e2c', 59.90,
     'Lona impressa abaixo da referência de 70 por metro quadrado. Fica abaixo de 70 porque o material custa metade da lona 440g. O preço fixo de parceiro precisa de decisão.', 'referencia_m2'),
  ('89f0f92c-91f1-46ef-a960-7c1615497e2e', 59.90,
     'Mesma lona 280g e mesmo custo. Sobe junto com as irmãs para não ter três preços da mesma lona.', 'referencia_m2'),
  ('aef1d1c9-5dbb-4860-bb80-818d64729464', 69.90,
     'Adesivo impresso principal, abaixo da média de 70 por metro quadrado. O preço de parceiro não muda.', 'referencia_m2'),
  ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', 69.90,
     'O custo é mais que o dobro do vinil branco. Depois do ajuste não pode ficar abaixo do branco.', 'referencia_m2')
) AS v(produto_id, novo, motivo, origem)
JOIN public.produtos p ON p.id = v.produto_id
ON CONFLICT (produto_id) WHERE status = 'pendente' DO NOTHING;

-- ---------------------------------------------------------------------------------------------------
-- B) Decidir proposta: só admin ou gestor que vê custo. Funções novas, ACL só authenticated.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preco_proposta_aprovar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_prop public.precos_propostas;
  v_prod public.produtos;
  v_piso numeric;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gestor'::public.app_role))
     OR NOT public.pode_ver_custo(v_uid) THEN
    RAISE EXCEPTION 'Só admin ou gestor que vê custo aprova preço.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.precos_propostas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_prop.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta proposta já foi %.', v_prop.status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = v_prop.produto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto da proposta não encontrado.' USING ERRCODE = 'P0002'; END IF;

  IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN
    RAISE EXCEPTION 'O preço do produto mudou depois da proposta. Recuse esta e gere outra.' USING ERRCODE = '22023';
  END IF;

  -- Piso vivo, com o custo e a margem de hoje: nunca aprova um preço que já nasce abaixo do piso.
  v_piso := public._preco_piso(v_prod.custo_medio, v_prod.margem_minima);
  IF v_piso IS NOT NULL AND v_prop.preco_proposto < v_piso THEN
    RAISE EXCEPTION 'O preço proposto fica abaixo do piso de %. Recuse e gere outra proposta.', public._integridade_brl(v_piso)
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.produtos SET preco_base = v_prop.preco_proposto WHERE id = v_prod.id;

  UPDATE public.precos_propostas
     SET status = 'aprovada', decidido_por = v_uid, decidido_em = now(),
         custo = v_prod.custo_medio, piso = v_piso, margem_minima = v_prod.margem_minima,
         margem_atual = public._preco_margem(v_prop.preco_atual, v_prod.custo_medio),
         margem_proposta = public._preco_margem(v_prop.preco_proposto, v_prod.custo_medio)
   WHERE id = p_id;

  -- Rastro com preço, nunca com custo.
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'produtos', v_prod.id, 'preco_proposta_aprovada',
          jsonb_build_object('proposta_id', p_id, 'preco_de', v_prop.preco_atual, 'preco_para', v_prop.preco_proposto));

  RETURN jsonb_build_object('ok', true, 'proposta_id', p_id, 'produto_id', v_prod.id, 'produto', v_prod.nome,
                            'preco_de', v_prop.preco_atual, 'preco_para', v_prop.preco_proposto);
END $f$;

CREATE OR REPLACE FUNCTION public.preco_proposta_recusar(p_id uuid, p_nota text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_prop public.precos_propostas;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gestor'::public.app_role))
     OR NOT public.pode_ver_custo(v_uid) THEN
    RAISE EXCEPTION 'Só admin ou gestor que vê custo recusa preço.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_nota, ''))) < 3 THEN
    RAISE EXCEPTION 'Explique em uma frase por que a proposta foi recusada.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prop FROM public.precos_propostas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_prop.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta proposta já foi %.', v_prop.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.precos_propostas
     SET status = 'recusada', decidido_por = v_uid, decidido_em = now(), nota = left(btrim(p_nota), 500)
   WHERE id = p_id;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'produtos', v_prop.produto_id, 'preco_proposta_recusada',
          jsonb_build_object('proposta_id', p_id, 'preco_proposto', v_prop.preco_proposto));

  RETURN jsonb_build_object('ok', true, 'proposta_id', p_id, 'produto_id', v_prop.produto_id, 'status', 'recusada');
END $f$;

REVOKE ALL ON FUNCTION public.preco_proposta_aprovar(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preco_proposta_recusar(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preco_proposta_aprovar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preco_proposta_recusar(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- C) Alerta de integridade
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alertas_integridade (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo           text NOT NULL CHECK (tipo IN ('valor_enviado_mudou', 'orcamento_duplicado', 'margem_negativa', 'margem_baixa',
                                               'custo_fantasma', 'item_aprovado_sem_custo', 'produto_sem_preco')),
  chave          text NOT NULL,
  orcamento_id   uuid REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  produto_id     uuid REFERENCES public.produtos(id) ON DELETE CASCADE,
  urgente        boolean NOT NULL DEFAULT false,
  estado_hash    text NOT NULL,
  texto          text NOT NULL,
  detalhes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'novo'
                 CHECK (status IN ('novo', 'enfileirado', 'confirmado', 'aviso_nao_enviado', 'resolvido')),
  fila_id        uuid,
  em_resumo      boolean NOT NULL DEFAULT false,
  reenvios       integer NOT NULL DEFAULT 0,
  ultimo_erro    text,
  avisado_em     timestamptz,
  confirmado_em  timestamptz,
  primeiro_visto_em timestamptz NOT NULL DEFAULT now(),
  ultimo_visto_em   timestamptz NOT NULL DEFAULT now(),
  resolvido_em   timestamptz
);

-- Uma linha aberta por achado: a chave é tipo + orçamento (ou produto).
CREATE UNIQUE INDEX IF NOT EXISTS alertas_integridade_uma_aberta_por_chave
  ON public.alertas_integridade (chave) WHERE resolvido_em IS NULL;
CREATE INDEX IF NOT EXISTS alertas_integridade_orcamento_idx ON public.alertas_integridade (orcamento_id) WHERE orcamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alertas_integridade_produto_idx ON public.alertas_integridade (produto_id) WHERE produto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alertas_integridade_fila_idx ON public.alertas_integridade (fila_id) WHERE fila_id IS NOT NULL;

ALTER TABLE public.alertas_integridade ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alertas_integridade leitura de quem ve custo" ON public.alertas_integridade;
CREATE POLICY "alertas_integridade leitura de quem ve custo" ON public.alertas_integridade
  FOR SELECT TO authenticated
  USING (public.pode_ver_custo((SELECT auth.uid())));

REVOKE ALL ON TABLE public.alertas_integridade FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.alertas_integridade TO authenticated;
GRANT SELECT ON TABLE public.alertas_integridade TO service_role;

-- A detecção. Só lê. Orçamento em rascunho, enviado ou aprovado; convertido, rejeitado e expirado ficam de fora.
CREATE OR REPLACE FUNCTION public._integridade_achados()
RETURNS TABLE (tipo text, chave text, orcamento_id uuid, produto_id uuid, numero integer, cliente text,
               urgente boolean, linha text, estado jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
WITH o AS (
  SELECT o.id, o.numero, o.status::text AS status, o.valor_total, o.cliente_id, o.lead_id, o.versao_aprovada_id,
         COALESCE(NULLIF(btrim(c.nome_fantasia), ''), NULLIF(btrim(c.nome), ''), NULLIF(btrim(c.razao_social), ''),
                  NULLIF(btrim(l.nome), ''), NULLIF(btrim(o.contato_nome), ''), 'cliente sem nome') AS cliente
  FROM public.orcamentos o
  LEFT JOIN public.clientes c ON c.id = o.cliente_id
  LEFT JOIN public.leads l ON l.id = o.lead_id
  WHERE o.status::text IN ('rascunho', 'enviado', 'aprovado')
),
it AS (
  SELECT i.orcamento_id, i.id AS item_id, i.descricao, COALESCE(i.valor_total, 0) AS venda,
         COALESCE(i.custo_unitario, 0) AS custo_un,
         COALESCE(i.custo_unitario, 0) * COALESCE(i.quantidade, 0) AS custo,
         p.margem_minima AS mm,
         -- Custo cadastrado por peça: por área quando o item é vendido por m², como faz o gatilho do item.
         CASE WHEN p.id IS NOT NULL AND COALESCE(p.custo_medio, 0) > 0 THEN
           CASE WHEN i.preco_m2 IS NOT NULL AND COALESCE(NULLIF(i.area_unitaria, 0), i.largura * i.altura, 0) > 0
                THEN round(p.custo_medio * GREATEST(COALESCE(NULLIF(i.area_unitaria, 0), i.largura * i.altura),
                                                    COALESCE(i.area_minima, p.area_minima_cobrada, 0)), 2)
                ELSE p.custo_medio END
         END AS esperado,
         COALESCE(i.quantidade, 0) AS qtd
  FROM public.orcamento_itens i
  JOIN o ON o.id = i.orcamento_id
  LEFT JOIN public.produtos p ON p.id = i.produto_id
),
-- 1. Valor enviado x valor de hoje
a1 AS (
  SELECT 'valor_enviado_mudou'::text AS tipo, 'valor_enviado_mudou:' || o.id AS chave, o.id AS orcamento_id,
         NULL::uuid AS produto_id, o.numero, o.cliente, (o.status = 'enviado') AS urgente,
         format('O valor mudou depois do envio: foi enviado por R$ %s e hoje está em R$ %s.',
                public._integridade_brl(v.valor_total), public._integridade_brl(o.valor_total)) AS linha,
         jsonb_build_object('enviado', v.valor_total, 'atual', o.valor_total, 'versao', v.numero_versao) AS estado
  FROM o
  JOIN LATERAL (
    SELECT vv.numero_versao, vv.valor_total
    FROM public.orcamento_versoes vv
    WHERE vv.orcamento_id = o.id
      AND CASE WHEN o.status = 'aprovado' AND o.versao_aprovada_id IS NOT NULL THEN vv.id = o.versao_aprovada_id
               ELSE vv.enviada_em IS NOT NULL END
    ORDER BY vv.numero_versao DESC LIMIT 1
  ) v ON true
  WHERE o.status IN ('enviado', 'aprovado') AND abs(o.valor_total - v.valor_total) >= 0.01
),
-- 2. Duplicados em aberto: mesmo cliente, mesmos itens e preços. O aviso fica no mais novo e cita os outros.
d0 AS (
  SELECT o.id, o.numero, o.cliente, COALESCE(o.cliente_id::text, o.lead_id::text) AS k,
         (SELECT md5(string_agg(COALESCE(i.produto_id::text, i.descricao) || ':' || i.quantidade || ':' || i.valor_unitario,
                                '|' ORDER BY COALESCE(i.produto_id::text, i.descricao), i.quantidade, i.valor_unitario))
            FROM public.orcamento_itens i WHERE i.orcamento_id = o.id) AS sig
  FROM o
  WHERE o.status IN ('rascunho', 'enviado') AND COALESCE(o.cliente_id::text, o.lead_id::text) IS NOT NULL
),
d1 AS (
  SELECT g.k, g.sig, count(*) AS n, max(g.numero) AS maior, string_agg(g.numero::text, ', ' ORDER BY g.numero) AS todos
  FROM d0 g WHERE g.sig IS NOT NULL GROUP BY g.k, g.sig HAVING count(*) > 1
),
a2 AS (
  SELECT 'orcamento_duplicado'::text, 'orcamento_duplicado:' || d0.id, d0.id, NULL::uuid, d0.numero, d0.cliente, true,
         format('Orçamento duplicado: os orçamentos %s têm os mesmos itens e os mesmos preços para o mesmo cliente. Manter um só.', d1.todos),
         jsonb_build_object('orcamentos', d1.todos)
  FROM d1 JOIN d0 ON d0.k = d1.k AND d0.sig = d1.sig AND d0.numero = d1.maior
),
-- 3. Margem do orçamento pelo custo gravado, contra a margem mínima dos produtos (ponderada pela venda)
m AS (
  SELECT o.id, o.numero, o.cliente, o.status, o.valor_total, sum(it.custo) AS custo,
         sum(it.mm * it.venda) / NULLIF(sum(it.venda) FILTER (WHERE it.mm IS NOT NULL), 0) AS minima,
         sum(CASE WHEN it.esperado IS NOT NULL THEN it.esperado * it.qtd ELSE it.custo END) AS custo_cadastrado
  FROM o JOIN it ON it.orcamento_id = o.id
  GROUP BY o.id, o.numero, o.cliente, o.status, o.valor_total
  HAVING sum(it.custo) > 0 AND o.valor_total > 0
),
a3 AS (
  SELECT CASE WHEN m.valor_total - m.custo < 0 THEN 'margem_negativa' ELSE 'margem_baixa' END,
         CASE WHEN m.valor_total - m.custo < 0 THEN 'margem_negativa:' ELSE 'margem_baixa:' END || m.id,
         m.id, NULL::uuid, m.numero, m.cliente,
         (m.valor_total - m.custo < 0 OR m.status IN ('enviado', 'aprovado')),
         CASE WHEN m.valor_total - m.custo < 0
              THEN format('Margem negativa: o orçamento está com margem de %s por cento. O preço vendido não cobre o custo.',
                          replace(round((m.valor_total - m.custo) / m.valor_total * 100, 0)::text, '.', ','))
              ELSE format('Margem abaixo do mínimo: o orçamento está com %s por cento e o mínimo dos produtos é %s por cento.',
                          round((m.valor_total - m.custo) / m.valor_total * 100, 0)::text, round(m.minima, 0)::text) END,
         -- Só o que é estável entra no estado: a margem oscila a cada edição do rascunho e não pode gerar aviso novo toda hora.
         -- O número atual vai no texto e o lembrete diário traz o valor de hoje.
         jsonb_build_object('minima', round(COALESCE(m.minima, 0), 0))
  FROM m
  WHERE (m.valor_total - m.custo) / m.valor_total * 100 < GREATEST(COALESCE(m.minima, 0), 0.0001)
),
-- 4. Custo fantasma: custo do item mais de 3 vezes o cadastrado ou menos de um terço
f AS (
  SELECT it.orcamento_id, count(*) AS n,
         (array_agg(it.descricao ORDER BY greatest(it.custo_un / it.esperado, it.esperado / it.custo_un) DESC))[1] AS pior,
         max(greatest(it.custo_un / it.esperado, it.esperado / it.custo_un)) AS razao,
         (array_agg(it.custo_un > it.esperado ORDER BY greatest(it.custo_un / it.esperado, it.esperado / it.custo_un) DESC))[1] AS maior
  FROM it
  WHERE it.custo_un > 0 AND it.esperado > 0 AND (it.custo_un > 3 * it.esperado OR it.custo_un < it.esperado / 3.0)
  GROUP BY it.orcamento_id
),
a4 AS (
  SELECT 'custo_fantasma'::text, 'custo_fantasma:' || o.id, o.id, NULL::uuid, o.numero, o.cliente,
         (o.status IN ('enviado', 'aprovado')),
         format('Custo fora do cadastro em %s. O pior caso é "%s", com custo cerca de %s vezes %s que o cadastrado. Margem na tela %s por cento, com o custo cadastrado %s por cento.',
                CASE WHEN f.n = 1 THEN '1 item' ELSE f.n || ' itens' END, left(f.pior, 60), round(f.razao, 0)::text, CASE WHEN f.maior THEN 'maior' ELSE 'menor' END,
                CASE WHEN o.valor_total > 0 THEN round((o.valor_total - m.custo) / o.valor_total * 100, 0)::text ELSE '0' END,
                CASE WHEN o.valor_total > 0 THEN round((o.valor_total - m.custo_cadastrado) / o.valor_total * 100, 0)::text ELSE '0' END),
         jsonb_build_object('itens', f.n)
  FROM f JOIN o ON o.id = f.orcamento_id JOIN m ON m.id = o.id
),
-- 5. Orçamento aprovado com item sem custo
a5 AS (
  SELECT 'item_aprovado_sem_custo'::text, 'item_aprovado_sem_custo:' || o.id, o.id, NULL::uuid, o.numero, o.cliente, false,
         format('Orçamento aprovado com %s sem custo. A margem real não dá para conferir.', CASE WHEN count(*) = 1 THEN '1 item' ELSE count(*) || ' itens' END),
         jsonb_build_object('itens', count(*))
  FROM o JOIN it ON it.orcamento_id = o.id
  WHERE o.status = 'aprovado' AND it.custo_un = 0 AND it.venda > 0
  GROUP BY o.id, o.numero, o.cliente
),
-- 6. Produto ativo sem preço válido (e sem faixa de preço)
a6 AS (
  SELECT 'produto_sem_preco'::text, 'produto_sem_preco:' || p.id, NULL::uuid, p.id, NULL::integer, 'produto'::text, false,
         format('O produto "%s" está ativo e sem preço de venda válido.', left(p.nome, 80)),
         jsonb_build_object('produto', p.nome)
  FROM public.produtos p
  WHERE p.ativo AND COALESCE(p.preco_base, 0) <= 0
    AND NOT EXISTS (SELECT 1 FROM public.produto_faixas_preco fx WHERE fx.produto_id = p.id)
)
SELECT * FROM a1 UNION ALL SELECT * FROM a2 UNION ALL SELECT * FROM a3
UNION ALL SELECT * FROM a4 UNION ALL SELECT * FROM a5 UNION ALL SELECT * FROM a6
$f$;

REVOKE ALL ON FUNCTION public._integridade_achados() FROM PUBLIC, anon, authenticated, service_role;

-- O aviso. p_enfileirar = false: modo seco, não grava nada e não enfileira. Só o agendamento (sem
-- pessoa logada) enfileira; uma pessoa só olha, e só se vê custo.
CREATE OR REPLACE FUNCTION public.alerta_integridade_orcamentos(p_enfileirar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_grupo text := public.grupo_equipe_destino();
  v_limite constant integer := 15;
  v_tel text[];
  v_mencao text := '';
  r record;
  v_novos integer;
  v_dobrar boolean;
  v_alerta uuid;
  v_fila uuid;
  v_chave text;
  v_texto text;
  v_cab text;
  v_acao text;
  v_resumo_ids uuid[] := ARRAY[]::uuid[];
  v_resumo_linhas text[] := ARRAY[]::text[];
  v_individuais integer := 0;
  v_no_resumo_agora boolean;
  v_no_resumo integer := 0;
  v_quietos integer := 0;
  v_nao_enviados integer := 0;
  v_lista jsonb := '[]'::jsonb;
  v_por_tipo jsonb;
  v_total integer;
  v_urgentes integer;
  v_resumo_fila uuid;
  v_n integer;
  v_plano jsonb;
  v_chaves text[];
  v_resumo_hashes text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT public.pode_ver_custo(v_uid) THEN
      RAISE EXCEPTION 'Só quem vê custo e margem consulta este alerta.' USING ERRCODE = '42501';
    END IF;
    IF p_enfileirar THEN
      RAISE EXCEPTION 'Só o agendamento envia o aviso. Pela tela, a consulta é só leitura.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Telefones do gestor para citar no grupo (55 + 10 ou 11 dígitos).
  SELECT COALESCE(array_agg(DISTINCT n), ARRAY[]::text[]) INTO v_tel
  FROM (
    SELECT CASE WHEN length(d) IN (10, 11) THEN '55' || d ELSE d END AS n
    FROM (SELECT regexp_replace(u.telefone, '\D', '', 'g') AS d
            FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
           WHERE ur.role = 'gestor'::public.app_role AND u.ativo IS NOT FALSE AND NULLIF(btrim(u.telefone), '') IS NOT NULL) x
    WHERE length(d) IN (10, 11, 12, 13)
  ) y;
  IF cardinality(v_tel) > 0 THEN
    SELECT string_agg('@' || t, ' ') INTO v_mencao FROM unnest(v_tel) t;
  END IF;
  v_cab := 'ATENCAO GERENTE' || CASE WHEN v_mencao <> '' THEN ' ' || v_mencao ELSE '' END;

  IF p_enfileirar THEN
    -- O que foi enfileirado e saiu: confirma. O que a fila deu por falho ou cancelado: volta a ser aviso a enviar.
    UPDATE public.alertas_integridade a
       SET status = 'confirmado', confirmado_em = now()
      FROM public.notificacoes_fila f
     WHERE f.id = a.fila_id AND a.status = 'enfileirado' AND f.status = 'enviado';
    UPDATE public.alertas_integridade a
       SET status = 'aviso_nao_enviado', reenvios = a.reenvios + 1,
           ultimo_erro = 'a fila marcou o aviso como ' || f.status
      FROM public.notificacoes_fila f
     WHERE f.id = a.fila_id AND a.status = 'enfileirado' AND f.status IN ('falhou', 'cancelado');
  END IF;

  -- Plano da rodada, em memória (nada de tabela temporária: serve também a consulta em transação de leitura).
  -- Novo, mudou (inclui virar urgente: rascunho que foi enviado), reenviar e lembrete pedem aviso; o resto fica quieto.
  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_plano
  FROM (
    SELECT a.tipo, a.chave, a.orcamento_id, a.produto_id, a.numero, a.cliente, a.urgente, a.linha, a.estado,
           md5(a.estado::text) || CASE WHEN a.urgente THEN 'u' ELSE '' END AS h, al.id AS alerta_id,
           CASE WHEN al.id IS NULL THEN 'novo'
                WHEN al.estado_hash <> md5(a.estado::text) || CASE WHEN a.urgente THEN 'u' ELSE '' END THEN 'mudou'
                WHEN al.status = 'aviso_nao_enviado' THEN 'reenviar'
                WHEN al.avisado_em IS NULL
                     OR al.avisado_em < now() - CASE WHEN a.urgente THEN interval '24 hours' ELSE interval '7 days' END THEN 'lembrete'
                ELSE 'quieto' END AS acao,
           COALESCE(al.reenvios, 0) AS reenvios
    FROM public._integridade_achados() a
    LEFT JOIN public.alertas_integridade al ON al.chave = a.chave AND al.resolvido_em IS NULL
  ) p;

  SELECT count(*) FILTER (WHERE x.acao IN ('novo', 'mudou', 'reenviar')), count(*), count(*) FILTER (WHERE x.urgente),
         COALESCE(array_agg(x.chave), ARRAY[]::text[])
    INTO v_novos, v_total, v_urgentes, v_chaves
    FROM jsonb_to_recordset(v_plano) AS x(chave text, urgente boolean, acao text);
  -- Passou de 15 avisos novos: os que não são urgentes viram um aviso-resumo. Lembrete não urgente sempre vai no resumo.
  v_dobrar := v_novos > v_limite;

  IF p_enfileirar THEN
    -- O que sumiu dos achados está resolvido. Fica o rastro, não o aviso.
    UPDATE public.alertas_integridade a
       SET status = 'resolvido', resolvido_em = now()
     WHERE a.resolvido_em IS NULL AND a.chave <> ALL (v_chaves);
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(v_plano) AS x(tipo text, chave text, orcamento_id uuid, produto_id uuid,
                 numero integer, cliente text, urgente boolean, linha text, estado jsonb, h text, alerta_id uuid,
                 acao text, reenvios integer)
            ORDER BY x.urgente DESC, x.numero NULLS LAST, x.chave LOOP
    v_alerta := r.alerta_id;
    v_acao := r.acao;
    -- Não urgente em rodada grande ou lembrete vai no resumo. Passou do limite de avisos próprios: o resto também,
    -- para um defeito em massa (custo de produto mudou) não virar dezenas de mensagens.
    v_no_resumo_agora := v_acao <> 'quieto'
      AND ((NOT r.urgente AND (v_dobrar OR v_acao = 'lembrete')) OR v_individuais >= v_limite);
    v_texto := v_cab || E'\n' ||
      CASE WHEN r.numero IS NOT NULL THEN format('Orçamento %s · %s', r.numero, r.cliente) ELSE 'Cadastro de produto' END ||
      E'\n' || r.linha || E'\nConfira e autorize agora: ' ||
      CASE WHEN r.orcamento_id IS NOT NULL THEN 'https://bexprint.com.br/orcamentos/' || r.orcamento_id
           ELSE 'https://bexprint.com.br/produtos' END;

    IF p_enfileirar THEN
      IF v_alerta IS NULL THEN
        INSERT INTO public.alertas_integridade (tipo, chave, orcamento_id, produto_id, urgente, estado_hash, texto, detalhes)
        VALUES (r.tipo, r.chave, r.orcamento_id, r.produto_id, r.urgente, r.h, v_texto, r.estado)
        RETURNING id INTO v_alerta;
      ELSE
        UPDATE public.alertas_integridade
           SET urgente = r.urgente, estado_hash = r.h, texto = v_texto, detalhes = r.estado, ultimo_visto_em = now()
         WHERE id = v_alerta;
      END IF;
    END IF;

    IF v_acao = 'quieto' THEN
      v_quietos := v_quietos + 1;
    ELSIF v_no_resumo_agora THEN
      v_no_resumo := v_no_resumo + 1;
      IF p_enfileirar THEN
        v_resumo_ids := v_resumo_ids || v_alerta;
        v_resumo_hashes := v_resumo_hashes || (r.chave || r.h || ':' || r.reenvios);
      END IF;
      v_resumo_linhas := v_resumo_linhas ||
        (CASE WHEN r.numero IS NOT NULL THEN format('Orçamento %s · %s: ', r.numero, r.cliente) ELSE 'Produto: ' END || r.linha);
    ELSE
      v_individuais := v_individuais + 1;
      IF p_enfileirar THEN
        v_chave := 'grupo_equipe:integridade:' || v_alerta || ':' || r.h || ':' || public.hoje_br() || ':' || r.reenvios;
        v_fila := public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'orcamento',
                    COALESCE(r.orcamento_id, v_alerta), 'aviso_grupo_equipe',
                    jsonb_build_object('texto', v_texto, 'mencionar', to_jsonb(v_tel)), v_chave);
        IF v_fila IS NULL THEN
          -- NULL = grupo desligado, destino inválido, ou esta chave já foi enfileirada hoje. Separa os dois.
          SELECT f.id INTO v_fila FROM public.notificacoes_fila f WHERE f.idempotency_key = v_chave;
        END IF;
        IF v_fila IS NULL THEN
          v_nao_enviados := v_nao_enviados + 1;
          UPDATE public.alertas_integridade
             SET status = 'aviso_nao_enviado', ultimo_erro = 'grupo da equipe desligado ou destino inválido', em_resumo = false
           WHERE id = v_alerta;
        ELSE
          UPDATE public.alertas_integridade
             SET status = 'enfileirado', fila_id = v_fila, avisado_em = now(), em_resumo = false, ultimo_erro = NULL
           WHERE id = v_alerta;
        END IF;
      END IF;
    END IF;

    v_lista := v_lista || jsonb_build_object(
      'tipo', r.tipo, 'orcamento', r.numero, 'orcamento_id', r.orcamento_id, 'produto_id', r.produto_id,
      'cliente', r.cliente, 'urgente', r.urgente, 'acao', v_acao,
      'vai_em', CASE WHEN v_acao = 'quieto' THEN 'nenhum'
                     WHEN v_no_resumo_agora THEN 'resumo' ELSE 'aviso_proprio' END,
      'texto', r.linha);
  END LOOP;

  -- Um aviso só para tudo que não é urgente (ou que é lembrete). Até 25 linhas, o resto vira contagem.
  IF cardinality(v_resumo_ids) > 0 THEN
    v_texto := v_cab || E'\nResumo de ' || cardinality(v_resumo_ids) || E' pendências de conferência:\n' ||
      array_to_string(v_resumo_linhas[1:25], E'\n') ||
      CASE WHEN cardinality(v_resumo_linhas) > 25 THEN E'\ne mais ' || (cardinality(v_resumo_linhas) - 25) || ' pendências.' ELSE '' END ||
      E'\nConfira e autorize: https://bexprint.com.br/orcamentos';
    v_chave := 'grupo_equipe:integridade:resumo:' ||
      md5((SELECT string_agg(h, ',' ORDER BY h) FROM unnest(v_resumo_hashes) h)) || ':' || public.hoje_br();
    v_resumo_fila := public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'orcamento',
                       v_resumo_ids[1], 'aviso_grupo_equipe',
                       jsonb_build_object('texto', v_texto, 'mencionar', to_jsonb(v_tel)), v_chave);
    IF v_resumo_fila IS NULL THEN
      SELECT f.id INTO v_resumo_fila FROM public.notificacoes_fila f WHERE f.idempotency_key = v_chave;
    END IF;
    IF v_resumo_fila IS NULL THEN
      v_nao_enviados := v_nao_enviados + cardinality(v_resumo_ids);
      UPDATE public.alertas_integridade
         SET status = 'aviso_nao_enviado', ultimo_erro = 'grupo da equipe desligado ou destino inválido', em_resumo = true
       WHERE id = ANY (v_resumo_ids);
    ELSE
      UPDATE public.alertas_integridade
         SET status = 'enfileirado', fila_id = v_resumo_fila, avisado_em = now(), em_resumo = true, ultimo_erro = NULL
       WHERE id = ANY (v_resumo_ids);
    END IF;
  END IF;

  IF p_enfileirar AND v_nao_enviados > 0 THEN
    RAISE WARNING 'alerta de integridade: % aviso(s) não enviado(s): grupo da equipe desligado ou inválido', v_nao_enviados;
  END IF;

  SELECT COALESCE(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb) INTO v_por_tipo
    FROM (SELECT x.tipo, count(*) AS n FROM jsonb_to_recordset(v_plano) AS x(tipo text) GROUP BY x.tipo) t;
  SELECT count(*) INTO v_n FROM public.precos_propostas WHERE status = 'pendente';

  RETURN jsonb_build_object(
    'modo', CASE WHEN p_enfileirar THEN 'enviando' ELSE 'seco' END,
    'rodada_em', now(),
    'grupo_ativo', v_grupo IS NOT NULL,
    'mencionando', to_jsonb(v_tel),
    'total_achados', v_total,
    'urgentes', v_urgentes,
    'por_tipo', v_por_tipo,
    'plano', jsonb_build_object('avisos_proprios', v_individuais, 'itens_no_resumo', v_no_resumo,
                                'avisos_do_resumo', CASE WHEN v_no_resumo > 0 THEN 1 ELSE 0 END,
                                'quietos', v_quietos, 'novos_ou_mudados', v_novos, 'limite_para_resumir', v_limite,
                                'resumiu', v_dobrar),
    'nao_enviados', v_nao_enviados,
    'propostas_de_preco_pendentes', v_n,
    'achados', v_lista);
END $f$;

REVOKE ALL ON FUNCTION public.alerta_integridade_orcamentos(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.alerta_integridade_orcamentos(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.alerta_integridade_orcamentos(boolean) TO service_role;

-- Agendamento: de hora em hora, das 8h às 18h de Macapá (UTC-3), de segunda a sábado. O banco roda em UTC.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integridade-orcamentos') THEN
    PERFORM cron.unschedule('integridade-orcamentos');
  END IF;
  PERFORM cron.schedule('integridade-orcamentos', '0 11-21 * * 1-6', 'SELECT public.alerta_integridade_orcamentos(true)');
END
$cron$;

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: a migração para se algo não ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.precos_propostas WHERE status = 'pendente';
  IF v_n <> 12 THEN RAISE EXCEPTION 'esperava 12 propostas pendentes, achei %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.precos_propostas WHERE preco_proposto < COALESCE(piso, 0)) THEN
    RAISE EXCEPTION 'proposta semeada abaixo do piso';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.precos_propostas'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.alertas_integridade'::regclass) THEN
    RAISE EXCEPTION 'RLS desligada numa tabela nova';
  END IF;
  IF has_table_privilege('anon', 'public.precos_propostas', 'SELECT')
     OR has_table_privilege('anon', 'public.alertas_integridade', 'SELECT')
     OR has_table_privilege('authenticated', 'public.precos_propostas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.alertas_integridade', 'UPDATE') THEN
    RAISE EXCEPTION 'ACL das tabelas novas aberta demais';
  END IF;
  IF has_function_privilege('anon', 'public.alerta_integridade_orcamentos(boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.preco_proposta_recusar(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa função nova';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integridade-orcamentos' AND active) THEN
    RAISE EXCEPTION 'o agendamento integridade-orcamentos não ficou ativo';
  END IF;
END
$confere$;

COMMIT;
