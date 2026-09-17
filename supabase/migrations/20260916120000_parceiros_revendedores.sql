-- =============================================================================
-- CLUBE DE PARCEIROS — quem compra da Bex Print para revender
-- =============================================================================
--
-- O parceiro não é funcionário nem tem gráfica: compra da Bex em tabela
-- especial e revende com a marca dele. Este módulo dá a ele um painel próprio
-- (orçamento simples com PDF da marca dele, pedido à gráfica, níveis, metas,
-- ofertas) e dá à Bex a leitura de quanto trabalho ele está fazendo.
--
-- TRÊS DECISÕES QUE O DESENHO CARREGA
--
-- 1. O CLIENTE DO PARCEIRO É DO PARCEIRO. As tabelas de orçamento do parceiro
--    não têm leitura para a equipe da Bex. A Bex enxerga volume (quantos
--    orçamentos, quantos m², quanto virou pedido) por função agregada — nunca o
--    nome e o telefone do cliente final. Um programa de revenda vive da
--    confiança de que a gráfica não vai atender direto o cliente do revendedor;
--    se a tela de gestão mostrasse a carteira dele, essa confiança não existiria.
--
-- 2. META É PRÊMIO CERTO, NÃO SORTEIO. Pela regra da Secretaria de Prêmios e
--    Apostas (SPA/MF), sorteio, vale-brinde e concurso ligados a compra exigem
--    autorização prévia. Campanha em que TODO MUNDO que bate a meta ganha, sem
--    estoque limitado de prêmios, não exige — e cashback também não. Por isso
--    `parceiro_campanhas` NÃO TEM coluna de quantidade de prêmios: limitar
--    ("os 10 primeiros") transformaria a meta em promoção comercial regulada.
--    Sorteio de celular/tablet fica fora deste módulo até existir a autorização.
--
-- 3. SEM CUSTO CADASTRADO, SEM DESCONTO AUTOMÁTICO EM CIMA DA FAIXA. Os produtos
--    de campanha (preço por faixa de quantidade) têm custo médio zero: o sistema
--    não tem como saber se 25% de desconto em cima da faixa ainda dá lucro. O
--    desconto de nível para esses produtos é uma coluna separada
--    (`desconto_faixa_pct`), que nasce pequena. Onde o custo existe, o preço do
--    parceiro nunca desce abaixo do piso custo ÷ (1 − margem mínima).

-- ─── Papel ──────────────────────────────────────────────────────────────────
-- (aplicado em transação própria: valor novo de enum não pode ser usado na
-- mesma transação em que foi criado)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'parceiro';

-- ─── Permissões ─────────────────────────────────────────────────────────────
INSERT INTO public.permissoes (chave, dominio, descricao) VALUES
  ('parceiros.read', 'parceiros', 'Ver parceiros revendedores e os indicadores deles'),
  ('parceiros.manage', 'parceiros', 'Cadastrar parceiros, níveis, metas e ofertas; entregar recompensas'),
  ('parceiro.painel', 'parceiros', 'Usar o painel do parceiro revendedor')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.perfil_permissoes (perfil, permissao) VALUES
  ('admin', 'parceiros.read'), ('admin', 'parceiros.manage'),
  ('gestor', 'parceiros.read'), ('gestor', 'parceiros.manage'),
  ('vendedor', 'parceiros.read'),
  ('parceiro', 'parceiro.painel')
ON CONFLICT DO NOTHING;

-- ─── Níveis ─────────────────────────────────────────────────────────────────
CREATE TABLE public.parceiro_niveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  ordem integer NOT NULL UNIQUE,
  -- compras (OS não canceladas) nos últimos 90 dias para estar no nível
  compra_minima_90d numeric(12,2) NOT NULL DEFAULT 0 CHECK (compra_minima_90d >= 0),
  -- desconto sobre o preço de tabela (preço base por unidade de venda)
  desconto_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_pct >= 0 AND desconto_pct < 90),
  -- desconto sobre produtos com preço por faixa (catálogo de campanha)
  desconto_faixa_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_faixa_pct >= 0 AND desconto_faixa_pct < 90),
  -- crédito devolvido quando uma OS do parceiro é paga
  cashback_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (cashback_pct >= 0 AND cashback_pct <= 30),
  cor text NOT NULL DEFAULT '#8b94a7' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  beneficios text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.parceiro_niveis IS
  'Níveis do clube de parceiros. Valores iniciais são PONTO DE PARTIDA para revisão da gestão, não decisão comercial.';

INSERT INTO public.parceiro_niveis (nome, ordem, compra_minima_90d, desconto_pct, desconto_faixa_pct, cashback_pct, cor, beneficios) VALUES
  ('Bronze',   1,     0, 10, 0, 0, '#b07a4a', ARRAY['Tabela de parceiro', 'Orçamento com a sua marca']),
  ('Prata',    2,  1500, 15, 3, 1, '#9aa4b2', ARRAY['Tabela de parceiro', 'Orçamento com a sua marca', '1% de volta em crédito']),
  ('Ouro',     3,  5000, 20, 5, 2, '#d4a72c', ARRAY['Tabela de parceiro', 'Orçamento com a sua marca', '2% de volta em crédito', 'Prioridade na fila de produção']),
  ('Diamante', 4, 12000, 25, 8, 3, '#35c9ec', ARRAY['Tabela de parceiro', 'Orçamento com a sua marca', '3% de volta em crédito', 'Prioridade na fila de produção', 'Atendimento dedicado']);

-- ─── Parceiros ──────────────────────────────────────────────────────────────
CREATE TABLE public.parceiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- o parceiro é cliente B2B da Bex: é por este cliente que as compras dele contam
  cliente_id uuid NOT NULL UNIQUE REFERENCES public.clientes(id) ON DELETE RESTRICT,
  usuario_id uuid UNIQUE REFERENCES public.usuarios(id) ON DELETE SET NULL,
  -- quem atende este parceiro na Bex; vira o vendedor dos pedidos dele
  responsavel_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'encerrado')),
  -- piso de nível escolhido pela gestão (ex.: começar como Prata)
  nivel_fixo_id uuid REFERENCES public.parceiro_niveis(id) ON DELETE SET NULL,
  marca_nome text,
  marca_documento text,
  marca_telefone text,
  marca_email text,
  marca_endereco text,
  marca_cidade text,
  marca_estado text,
  marca_cor text NOT NULL DEFAULT '#0f766e' CHECK (marca_cor ~ '^#[0-9a-fA-F]{6}$'),
  marca_logo_path text,
  marca_rodape text,
  ultimo_acesso_em timestamptz,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parceiros_usuario_idx ON public.parceiros (usuario_id);

-- ─── Orçamentos do parceiro para o cliente DELE ─────────────────────────────
-- Não são orçamentos da Bex: o preço é o do parceiro, a marca é a do parceiro.
-- Só viram negócio da Bex quando o parceiro faz o pedido.
CREATE TABLE public.parceiro_orcamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id uuid NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  titulo text NOT NULL CHECK (length(btrim(titulo)) > 0),
  cliente_nome text NOT NULL CHECK (length(btrim(cliente_nome)) > 0),
  cliente_telefone text,
  cliente_email text,
  cliente_documento text,
  observacoes text,
  validade_dias integer NOT NULL DEFAULT 7 CHECK (validade_dias BETWEEN 1 AND 90),
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'perdido', 'pedido_feito')),
  pedido_orcamento_id uuid UNIQUE REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  credito_usado numeric(12,2) NOT NULL DEFAULT 0 CHECK (credito_usado >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parceiro_id, numero)
);

CREATE TABLE public.parceiro_orcamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id uuid NOT NULL REFERENCES public.parceiro_orcamentos(id) ON DELETE CASCADE,
  -- nulo = item livre do parceiro (serviço dele); entra no PDF, não vira pedido
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  descricao text NOT NULL CHECK (length(btrim(descricao)) > 0),
  unidade text NOT NULL DEFAULT 'un',
  largura numeric(10,3) CHECK (largura IS NULL OR largura > 0),
  altura numeric(10,3) CHECK (altura IS NULL OR altura > 0),
  quantidade numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  -- preço DO PARCEIRO para o cliente dele, por unidade de venda (m² ou un)
  preco_venda_unidade numeric(14,4) NOT NULL DEFAULT 0 CHECK (preco_venda_unidade >= 0),
  acabamento text,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parceiro_orcamento_itens_orc_idx ON public.parceiro_orcamento_itens (orcamento_id);

-- ─── Campanhas de meta (prêmio certo) ───────────────────────────────────────
CREATE TABLE public.parceiro_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) > 0),
  descricao text,
  metrica text NOT NULL CHECK (metrica IN ('valor_compras', 'metragem_compras', 'quantidade_pedidos')),
  meta numeric(12,2) NOT NULL CHECK (meta > 0),
  inicio date NOT NULL,
  fim date NOT NULL,
  recompensa_tipo text NOT NULL CHECK (recompensa_tipo IN ('credito', 'produto', 'brinde')),
  -- crédito: valor em R$ creditado na hora; produto/brinde: entregue pela equipe
  recompensa_valor numeric(12,2) CHECK (recompensa_valor IS NULL OR recompensa_valor > 0),
  recompensa_descricao text NOT NULL CHECK (length(btrim(recompensa_descricao)) > 0),
  nivel_minimo_id uuid REFERENCES public.parceiro_niveis(id) ON DELETE SET NULL,
  ativa boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fim >= inicio),
  CHECK (recompensa_tipo <> 'credito' OR recompensa_valor IS NOT NULL)
);

COMMENT ON TABLE public.parceiro_campanhas IS
  'Metas com prêmio CERTO: todo parceiro que bate ganha. Não adicione limite de quantidade de prêmios — isso vira promoção comercial que exige autorização da SPA/MF.';

CREATE TABLE public.parceiro_conquistas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.parceiro_campanhas(id) ON DELETE RESTRICT,
  parceiro_id uuid NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  alcancado_em timestamptz NOT NULL DEFAULT now(),
  valor_apurado numeric(14,3) NOT NULL,
  status text NOT NULL DEFAULT 'a_entregar' CHECK (status IN ('a_entregar', 'entregue', 'cancelada')),
  entregue_em timestamptz,
  entregue_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  observacao text,
  UNIQUE (campanha_id, parceiro_id)
);

-- ─── Ofertas relâmpago (aparecem como aviso no painel) ──────────────────────
CREATE TABLE public.parceiro_ofertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) > 0),
  mensagem text NOT NULL CHECK (length(btrim(mensagem)) > 0),
  produto_id uuid REFERENCES public.produtos(id) ON DELETE CASCADE,
  -- preço por unidade de venda do produto; nulo = oferta só informativa
  preco_oferta numeric(14,4) CHECK (preco_oferta IS NULL OR preco_oferta > 0),
  inicio timestamptz NOT NULL DEFAULT now(),
  fim timestamptz NOT NULL,
  exibir_popup boolean NOT NULL DEFAULT true,
  nivel_minimo_id uuid REFERENCES public.parceiro_niveis(id) ON DELETE SET NULL,
  ativa boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  CHECK (preco_oferta IS NULL OR produto_id IS NOT NULL)
);

CREATE TABLE public.parceiro_ofertas_vistas (
  oferta_id uuid NOT NULL REFERENCES public.parceiro_ofertas(id) ON DELETE CASCADE,
  parceiro_id uuid NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  vista_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oferta_id, parceiro_id)
);

-- ─── Créditos (extrato) ─────────────────────────────────────────────────────
-- Saldo = soma. Só funções e gatilhos escrevem aqui.
CREATE TABLE public.parceiro_creditos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id uuid NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('cashback', 'recompensa', 'uso', 'estorno_uso', 'ajuste')),
  valor numeric(12,2) NOT NULL CHECK (valor <> 0),
  os_id uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  conquista_id uuid REFERENCES public.parceiro_conquistas(id) ON DELETE SET NULL,
  parceiro_orcamento_id uuid REFERENCES public.parceiro_orcamentos(id) ON DELETE SET NULL,
  descricao text NOT NULL,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo NOT IN ('cashback', 'recompensa', 'estorno_uso') OR valor > 0),
  CHECK (tipo <> 'uso' OR valor < 0)
);

CREATE INDEX parceiro_creditos_parceiro_idx ON public.parceiro_creditos (parceiro_id);
-- cashback: uma vez por OS; recompensa: uma vez por conquista
CREATE UNIQUE INDEX parceiro_creditos_cashback_os_uq ON public.parceiro_creditos (os_id) WHERE tipo = 'cashback';
CREATE UNIQUE INDEX parceiro_creditos_recompensa_uq ON public.parceiro_creditos (conquista_id) WHERE tipo = 'recompensa';

-- =============================================================================
-- FUNÇÕES
-- =============================================================================

-- O parceiro ATIVO do usuário logado. Usada pelas políticas de acesso.
CREATE OR REPLACE FUNCTION public.parceiro_do_usuario()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id FROM public.parceiros p
  WHERE p.usuario_id = auth.uid()
    AND p.status = 'ativo'
    AND NOT public.usuario_desativado(auth.uid())
$function$;

-- Compras do parceiro na Bex num intervalo: OS não canceladas do cliente dele.
CREATE OR REPLACE FUNCTION public.parceiro_compras(p_parceiro_id uuid, p_inicio date, p_fim date)
RETURNS TABLE(valor numeric, metragem numeric, pedidos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(o.valor_total), 0)::numeric(14,2),
         COALESCE(sum(it.area), 0)::numeric(14,3),
         count(o.id)::integer
  FROM public.parceiros p
  JOIN public.ordens_servico o ON o.cliente_id = p.cliente_id
  LEFT JOIN LATERAL (
    SELECT sum(i.area_total) AS area FROM public.itens_os i WHERE i.os_id = o.id
  ) it ON true
  WHERE p.id = p_parceiro_id
    AND o.status::text <> 'cancelado'
    AND o.created_at::date BETWEEN p_inicio AND p_fim
$function$;

-- Nível atual: pelo volume dos últimos 90 dias, nunca abaixo do nível fixado.
CREATE OR REPLACE FUNCTION public.parceiro_nivel(p_parceiro_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_compras numeric;
  v_nivel public.parceiro_niveis%ROWTYPE;
  v_fixo public.parceiro_niveis%ROWTYPE;
  v_prox public.parceiro_niveis%ROWTYPE;
  v_fixo_id uuid;
  v_fixado boolean := false;
BEGIN
  SELECT c.valor INTO v_compras FROM public.parceiro_compras(p_parceiro_id, current_date - 89, current_date) c;
  v_compras := COALESCE(v_compras, 0);

  SELECT * INTO v_nivel FROM public.parceiro_niveis
   WHERE compra_minima_90d <= v_compras ORDER BY ordem DESC LIMIT 1;

  SELECT nivel_fixo_id INTO v_fixo_id FROM public.parceiros WHERE id = p_parceiro_id;
  IF v_fixo_id IS NOT NULL THEN
    SELECT * INTO v_fixo FROM public.parceiro_niveis WHERE id = v_fixo_id;
    IF v_fixo.id IS NOT NULL AND (v_nivel.id IS NULL OR v_fixo.ordem > v_nivel.ordem) THEN
      v_nivel := v_fixo;
      v_fixado := true;
    END IF;
  END IF;

  SELECT * INTO v_prox FROM public.parceiro_niveis
   WHERE ordem > COALESCE(v_nivel.ordem, 0) ORDER BY ordem LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_nivel.id,
    'nome', v_nivel.nome,
    'ordem', COALESCE(v_nivel.ordem, 0),
    'cor', v_nivel.cor,
    'desconto_pct', COALESCE(v_nivel.desconto_pct, 0),
    'desconto_faixa_pct', COALESCE(v_nivel.desconto_faixa_pct, 0),
    'cashback_pct', COALESCE(v_nivel.cashback_pct, 0),
    'beneficios', COALESCE(to_jsonb(v_nivel.beneficios), '[]'::jsonb),
    'fixado', v_fixado,
    'compras_90d', v_compras,
    'proximo', CASE WHEN v_prox.id IS NULL THEN NULL ELSE jsonb_build_object(
      'nome', v_prox.nome,
      'compra_minima_90d', v_prox.compra_minima_90d,
      'falta', GREATEST(v_prox.compra_minima_90d - v_compras, 0),
      'desconto_pct', v_prox.desconto_pct
    ) END
  );
END
$function$;

-- A tabela de preços de um parceiro: preço base com desconto de nível, faixas
-- com o desconto de faixa, oferta ativa quando for menor, e piso de margem
-- quando o custo é conhecido.
CREATE OR REPLACE FUNCTION public.parceiro_precos(p_parceiro_id uuid)
RETURNS TABLE(
  produto_id uuid, nome text, categoria text, unidade text, por_area boolean, area_minima numeric,
  preco_referencia numeric, preco_parceiro numeric, origem text,
  oferta_id uuid, oferta_titulo text, faixas jsonb, tamanhos jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_nivel jsonb := public.parceiro_nivel(p_parceiro_id);
  v_desc numeric := COALESCE((v_nivel->>'desconto_pct')::numeric, 0);
  v_desc_faixa numeric := COALESCE((v_nivel->>'desconto_faixa_pct')::numeric, 0);
  v_ordem integer := COALESCE((v_nivel->>'ordem')::integer, 0);
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT p.id, p.nome, p.categoria::text AS categoria, p.unidade,
           lower(p.unidade) IN ('m2', 'm²') AS por_area,
           p.area_minima_cobrada AS area_minima,
           COALESCE(pp.preco_base, p.preco_base) AS preco_base,
           CASE WHEN COALESCE(p.custo_medio, 0) > 0 AND COALESCE(p.margem_minima, 0) < 100
                THEN round(p.custo_medio / (1 - COALESCE(p.margem_minima, 0) / 100), 2) END AS piso
    FROM public.produtos p
    LEFT JOIN public.produto_precos pp ON pp.produto_id = p.id
    WHERE p.ativo
  ),
  oferta AS (
    SELECT DISTINCT ON (o.produto_id) o.produto_id, o.id, o.titulo, o.preco_oferta
    FROM public.parceiro_ofertas o
    LEFT JOIN public.parceiro_niveis n ON n.id = o.nivel_minimo_id
    WHERE o.ativa AND o.produto_id IS NOT NULL AND o.preco_oferta IS NOT NULL
      AND now() >= o.inicio AND now() < o.fim
      AND (n.id IS NULL OR v_ordem >= n.ordem)
    ORDER BY o.produto_id, o.preco_oferta
  ),
  faixa AS (
    SELECT f.produto_id,
           jsonb_agg(jsonb_build_object(
             'quantidade_minima', f.quantidade_minima,
             'preco_referencia', round(f.preco_unitario, 4),
             'preco_parceiro', round(CASE
               WHEN ofe.preco_oferta IS NOT NULL THEN LEAST(
                 GREATEST(round(f.preco_unitario * (1 - v_desc_faixa / 100), 4), COALESCE(b.piso, 0)),
                 ofe.preco_oferta)
               ELSE GREATEST(round(f.preco_unitario * (1 - v_desc_faixa / 100), 4), COALESCE(b.piso, 0))
             END, 4)
           ) ORDER BY f.quantidade_minima) AS lista
    FROM public.produto_faixas_preco f
    JOIN base b ON b.id = f.produto_id
    LEFT JOIN oferta ofe ON ofe.produto_id = f.produto_id
    WHERE (f.vigencia_inicio IS NULL OR f.vigencia_inicio <= current_date)
      AND (f.vigencia_fim IS NULL OR f.vigencia_fim >= current_date)
    GROUP BY f.produto_id
  ),
  tam AS (
    SELECT t.produto_id,
           jsonb_agg(jsonb_build_object('nome', t.nome, 'largura', t.largura, 'altura', t.altura, 'padrao', t.padrao)
                     ORDER BY t.ordem, t.nome) AS lista
    FROM public.produto_tamanhos t
    GROUP BY t.produto_id
  )
  SELECT b.id, b.nome, b.categoria, b.unidade, b.por_area, b.area_minima,
         CASE WHEN fx.lista IS NULL THEN b.preco_base END,
         CASE WHEN fx.lista IS NULL THEN
           CASE WHEN ofe.preco_oferta IS NOT NULL
                     AND ofe.preco_oferta < GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0))
                THEN round(ofe.preco_oferta, 4)
                ELSE GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0)) END
         END,
         CASE
           WHEN fx.lista IS NOT NULL THEN 'faixa'
           WHEN ofe.preco_oferta IS NOT NULL
                AND ofe.preco_oferta < GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0)) THEN 'oferta'
           WHEN b.piso IS NOT NULL AND b.piso > round(b.preco_base * (1 - v_desc / 100), 2) THEN 'piso'
           ELSE 'nivel'
         END,
         ofe.id, ofe.titulo,
         fx.lista,
         COALESCE(tm.lista, '[]'::jsonb)
  FROM base b
  LEFT JOIN faixa fx ON fx.produto_id = b.id
  LEFT JOIN oferta ofe ON ofe.produto_id = b.id
  LEFT JOIN tam tm ON tm.produto_id = b.id
  -- sem preço base e sem faixa vigente, não há o que vender
  WHERE fx.lista IS NOT NULL OR b.preco_base IS NOT NULL
  ORDER BY b.categoria, b.nome;
END
$function$;

-- Metas: registra quem bateu. Crédito entra na hora; produto/brinde a equipe entrega.
CREATE OR REPLACE FUNCTION public.parceiro_apurar_campanhas(p_parceiro_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_comp record;
  v_valor numeric;
  v_ordem integer;
  v_conq uuid;
  v_novas integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.parceiros WHERE id = p_parceiro_id AND status = 'ativo') THEN
    RETURN 0;
  END IF;
  v_ordem := COALESCE((public.parceiro_nivel(p_parceiro_id)->>'ordem')::integer, 0);

  FOR c IN
    SELECT pc.* FROM public.parceiro_campanhas pc
    LEFT JOIN public.parceiro_niveis n ON n.id = pc.nivel_minimo_id
    WHERE pc.ativa AND pc.inicio <= current_date
      AND (n.id IS NULL OR v_ordem >= n.ordem)
      AND NOT EXISTS (SELECT 1 FROM public.parceiro_conquistas x
                      WHERE x.campanha_id = pc.id AND x.parceiro_id = p_parceiro_id)
  LOOP
    SELECT * INTO v_comp FROM public.parceiro_compras(p_parceiro_id, c.inicio, LEAST(c.fim, current_date));
    v_valor := CASE c.metrica
                 WHEN 'valor_compras' THEN v_comp.valor
                 WHEN 'metragem_compras' THEN v_comp.metragem
                 ELSE v_comp.pedidos END;
    CONTINUE WHEN COALESCE(v_valor, 0) < c.meta;

    v_conq := NULL;
    INSERT INTO public.parceiro_conquistas (campanha_id, parceiro_id, valor_apurado, status, entregue_em)
    VALUES (c.id, p_parceiro_id, v_valor,
            CASE WHEN c.recompensa_tipo = 'credito' THEN 'entregue' ELSE 'a_entregar' END,
            CASE WHEN c.recompensa_tipo = 'credito' THEN now() END)
    ON CONFLICT (campanha_id, parceiro_id) DO NOTHING
    RETURNING id INTO v_conq;

    IF v_conq IS NOT NULL THEN
      v_novas := v_novas + 1;
      IF c.recompensa_tipo = 'credito' THEN
        INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, conquista_id, descricao)
        VALUES (p_parceiro_id, 'recompensa', c.recompensa_valor, v_conq, 'Meta batida: ' || c.titulo)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN v_novas;
END
$function$;

-- Tudo que o painel do parceiro mostra, numa chamada.
CREATE OR REPLACE FUNCTION public.parceiro_painel()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := public.parceiro_do_usuario();
  v_p public.parceiros%ROWTYPE;
  v_c public.clientes%ROWTYPE;
  v_nivel jsonb;
  v_ordem integer;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;

  PERFORM public.parceiro_apurar_campanhas(v_id);
  UPDATE public.parceiros SET ultimo_acesso_em = now() WHERE id = v_id RETURNING * INTO v_p;
  SELECT * INTO v_c FROM public.clientes WHERE id = v_p.cliente_id;
  v_nivel := public.parceiro_nivel(v_id);
  v_ordem := COALESCE((v_nivel->>'ordem')::integer, 0);

  RETURN jsonb_build_object(
    'parceiro', jsonb_build_object(
      'id', v_p.id,
      'nome', COALESCE(NULLIF(btrim(v_p.marca_nome), ''), v_c.nome_fantasia, v_c.nome),
      'desde', v_p.created_at,
      'tem_atendente', v_p.responsavel_id IS NOT NULL
    ),
    -- Para onde mandar a arte depois do pedido. Só o primeiro nome do atendente:
    -- o telefone que aparece é o da gráfica, nunca o pessoal de quem atende.
    'contato', (SELECT jsonb_build_object(
                  'atendente', NULLIF(split_part(btrim(COALESCE(u.nome, '')), ' ', 1), ''),
                  'grafica', e.nome, 'telefones', e.telefones, 'email', e.email)
                FROM (SELECT 1) um
                LEFT JOIN public.usuarios u ON u.id = v_p.responsavel_id
                LEFT JOIN public.empresa_config e ON e.id = true),
    'marca', jsonb_build_object(
      'nome', v_p.marca_nome, 'documento', v_p.marca_documento, 'telefone', v_p.marca_telefone,
      'email', v_p.marca_email, 'endereco', v_p.marca_endereco, 'cidade', v_p.marca_cidade,
      'estado', v_p.marca_estado, 'cor', v_p.marca_cor, 'logo_path', v_p.marca_logo_path,
      'rodape', v_p.marca_rodape
    ),
    'nivel', v_nivel,
    'niveis', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', n.id, 'nome', n.nome, 'ordem', n.ordem, 'compra_minima_90d', n.compra_minima_90d,
                 'desconto_pct', n.desconto_pct, 'cashback_pct', n.cashback_pct, 'cor', n.cor,
                 'beneficios', to_jsonb(n.beneficios)) ORDER BY n.ordem), '[]'::jsonb)
               FROM public.parceiro_niveis n),
    'saldo_credito', (SELECT COALESCE(sum(valor), 0) FROM public.parceiro_creditos WHERE parceiro_id = v_id),
    'extrato', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
                  SELECT tipo, valor, descricao, created_at FROM public.parceiro_creditos
                  WHERE parceiro_id = v_id ORDER BY created_at DESC LIMIT 20) x),
    'campanhas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', pc.id, 'titulo', pc.titulo, 'descricao', pc.descricao, 'metrica', pc.metrica,
                    'meta', pc.meta, 'inicio', pc.inicio, 'fim', pc.fim,
                    'recompensa_tipo', pc.recompensa_tipo, 'recompensa_valor', pc.recompensa_valor,
                    'recompensa_descricao', pc.recompensa_descricao,
                    'atual', CASE pc.metrica WHEN 'valor_compras' THEN comp.valor
                                             WHEN 'metragem_compras' THEN comp.metragem
                                             ELSE comp.pedidos END,
                    'conquistada', EXISTS (SELECT 1 FROM public.parceiro_conquistas x
                                           WHERE x.campanha_id = pc.id AND x.parceiro_id = v_id)
                  ) ORDER BY pc.fim), '[]'::jsonb)
                  FROM public.parceiro_campanhas pc
                  LEFT JOIN public.parceiro_niveis n ON n.id = pc.nivel_minimo_id
                  LEFT JOIN LATERAL public.parceiro_compras(v_id, pc.inicio, LEAST(pc.fim, current_date)) comp ON true
                  WHERE pc.ativa AND pc.inicio <= current_date AND pc.fim >= current_date
                    AND (n.id IS NULL OR v_ordem >= n.ordem)),
    'conquistas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'id', x.id, 'campanha', pc.titulo, 'recompensa', pc.recompensa_descricao,
                     'recompensa_tipo', pc.recompensa_tipo, 'status', x.status, 'alcancado_em', x.alcancado_em,
                     'entregue_em', x.entregue_em) ORDER BY x.alcancado_em DESC), '[]'::jsonb)
                   FROM public.parceiro_conquistas x
                   JOIN public.parceiro_campanhas pc ON pc.id = x.campanha_id
                   WHERE x.parceiro_id = v_id AND x.status <> 'cancelada'),
    'ofertas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'titulo', o.titulo, 'mensagem', o.mensagem, 'produto_id', o.produto_id,
                  'produto_nome', pr.nome, 'produto_unidade', pr.unidade, 'preco_oferta', o.preco_oferta,
                  'fim', o.fim, 'exibir_popup', o.exibir_popup,
                  'vista', EXISTS (SELECT 1 FROM public.parceiro_ofertas_vistas v
                                   WHERE v.oferta_id = o.id AND v.parceiro_id = v_id)
                ) ORDER BY o.fim), '[]'::jsonb)
                FROM public.parceiro_ofertas o
                LEFT JOIN public.produtos pr ON pr.id = o.produto_id
                LEFT JOIN public.parceiro_niveis n ON n.id = o.nivel_minimo_id
                WHERE o.ativa AND now() >= o.inicio AND now() < o.fim
                  AND (n.id IS NULL OR v_ordem >= n.ordem)),
    'orcamentos', (SELECT jsonb_build_object(
                     'total', count(*),
                     'mes', count(*) FILTER (WHERE q.created_at >= date_trunc('month', now())),
                     'abertos', count(*) FILTER (WHERE q.status IN ('rascunho', 'enviado', 'aprovado')),
                     'pedidos', count(*) FILTER (WHERE q.status = 'pedido_feito'))
                   FROM public.parceiro_orcamentos q WHERE q.parceiro_id = v_id),
    'pedidos', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'orcamento_parceiro_id', q.id, 'orcamento_parceiro_numero', q.numero, 'titulo', q.titulo,
                  'pedido_numero', o.numero, 'pedido_status', o.status, 'valor', o.valor_total,
                  'os_numero', os.numero, 'os_status', os.status, 'enviado_em', o.created_at
                ) ORDER BY o.created_at DESC), '[]'::jsonb)
                FROM (SELECT * FROM public.parceiro_orcamentos
                      WHERE parceiro_id = v_id AND pedido_orcamento_id IS NOT NULL
                      ORDER BY updated_at DESC LIMIT 10) q
                JOIN public.orcamentos o ON o.id = q.pedido_orcamento_id
                LEFT JOIN public.ordens_servico os ON os.id = o.os_id)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_catalogo()
RETURNS TABLE(
  produto_id uuid, nome text, categoria text, unidade text, por_area boolean, area_minima numeric,
  preco_referencia numeric, preco_parceiro numeric, origem text,
  oferta_id uuid, oferta_titulo text, faixas jsonb, tamanhos jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := public.parceiro_do_usuario();
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.parceiro_precos(v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_marcar_oferta_vista(p_oferta_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := public.parceiro_do_usuario();
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.parceiro_ofertas_vistas (oferta_id, parceiro_id) VALUES (p_oferta_id, v_id)
  ON CONFLICT DO NOTHING;
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_salvar_marca(p_dados jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := public.parceiro_do_usuario();
  v_cor text := NULLIF(btrim(p_dados->>'cor'), '');
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  IF v_cor IS NOT NULL AND v_cor !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Cor inválida. Use o formato #RRGGBB.';
  END IF;
  UPDATE public.parceiros SET
    marca_nome      = left(NULLIF(btrim(p_dados->>'nome'), ''), 120),
    marca_documento = left(NULLIF(btrim(p_dados->>'documento'), ''), 30),
    marca_telefone  = left(NULLIF(btrim(p_dados->>'telefone'), ''), 40),
    marca_email     = left(NULLIF(btrim(p_dados->>'email'), ''), 120),
    marca_endereco  = left(NULLIF(btrim(p_dados->>'endereco'), ''), 200),
    marca_cidade    = left(NULLIF(btrim(p_dados->>'cidade'), ''), 80),
    marca_estado    = left(upper(NULLIF(btrim(p_dados->>'estado'), '')), 2),
    marca_cor       = COALESCE(v_cor, marca_cor),
    marca_rodape    = left(NULLIF(btrim(p_dados->>'rodape'), ''), 600),
    -- o caminho do logo só pode apontar para a pasta do próprio parceiro
    marca_logo_path = CASE
      WHEN p_dados ? 'logo_path' AND NULLIF(btrim(p_dados->>'logo_path'), '') IS NULL THEN NULL
      WHEN p_dados ? 'logo_path' AND (p_dados->>'logo_path') LIKE v_id::text || '/%' THEN p_dados->>'logo_path'
      WHEN p_dados ? 'logo_path' THEN marca_logo_path
      ELSE marca_logo_path END,
    updated_at = now()
  WHERE id = v_id;
END
$function$;

-- Transforma o orçamento do parceiro num pedido de verdade para a Bex. Os preços
-- são recalculados AQUI, pelo banco: o preço que a tela mostrou não é confiado.
CREATE OR REPLACE FUNCTION public.parceiro_enviar_pedido(p_orcamento_id uuid, p_usar_credito numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_parceiro uuid := public.parceiro_do_usuario();
  v_p public.parceiros%ROWTYPE;
  v_q public.parceiro_orcamentos%ROWTYPE;
  v_nivel jsonb;
  v_orc uuid;
  v_numero integer;
  v_item record;
  v_preco record;
  v_faixa jsonb;
  v_preco_un numeric;
  v_custo_un numeric;
  v_area_peca numeric;
  v_n_itens integer := 0;
  v_livres integer := 0;
  v_subtotal numeric;
  v_saldo numeric;
  v_credito numeric := 0;
BEGIN
  IF v_parceiro IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.parceiros WHERE id = v_parceiro;
  SELECT * INTO v_q FROM public.parceiro_orcamentos
   WHERE id = p_orcamento_id AND parceiro_id = v_parceiro FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF v_q.pedido_orcamento_id IS NOT NULL OR v_q.status = 'pedido_feito' THEN
    RAISE EXCEPTION 'Este orçamento já virou pedido.';
  END IF;
  IF v_q.status = 'perdido' THEN
    RAISE EXCEPTION 'Orçamento marcado como perdido não vira pedido. Reabra antes.';
  END IF;
  IF v_p.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Seu cadastro ainda não tem um atendente na gráfica. Fale com a equipe antes do primeiro pedido.';
  END IF;

  v_nivel := public.parceiro_nivel(v_parceiro);

  INSERT INTO public.orcamentos (
    cliente_id, vendedor_id, created_by, status, titulo, descricao, observacao_interna,
    aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento
  ) VALUES (
    v_p.cliente_id, v_p.responsavel_id, auth.uid(), 'aprovado',
    left('Pedido de parceiro · ' || v_q.titulo, 200),
    'Pedido feito pelo painel do parceiro revendedor.',
    format('Parceiro nível %s (desconto %s%%). Preços da tabela de parceiro, recalculados pelo sistema no envio. Orçamento nº %s do parceiro.',
           v_nivel->>'nome', v_nivel->>'desconto_pct', v_q.numero),
    now(), left(COALESCE(NULLIF(btrim(v_p.marca_nome), ''), 'Parceiro') || ' (painel do parceiro)', 120),
    7, '{"parcelas": 1}'::jsonb
  ) RETURNING id, numero INTO v_orc, v_numero;

  FOR v_item IN
    SELECT * FROM public.parceiro_orcamento_itens WHERE orcamento_id = v_q.id ORDER BY ordem, created_at
  LOOP
    IF v_item.produto_id IS NULL THEN
      v_livres := v_livres + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_preco FROM public.parceiro_precos(v_parceiro) pr WHERE pr.produto_id = v_item.produto_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '"%" não está disponível na tabela de parceiro.', v_item.descricao;
    END IF;
    IF v_preco.por_area AND (COALESCE(v_item.largura, 0) <= 0 OR COALESCE(v_item.altura, 0) <= 0) THEN
      RAISE EXCEPTION '"%" é vendido por m² e precisa de largura e altura.', v_item.descricao;
    END IF;

    IF v_preco.faixas IS NOT NULL THEN
      v_faixa := NULL;
      SELECT f INTO v_faixa FROM jsonb_array_elements(v_preco.faixas) f
       WHERE (f->>'quantidade_minima')::integer <= ceil(v_item.quantidade)
       ORDER BY (f->>'quantidade_minima')::integer DESC LIMIT 1;
      IF v_faixa IS NULL THEN
        RAISE EXCEPTION '"%" tem pedido mínimo de % unidades.', v_item.descricao, v_preco.faixas->0->>'quantidade_minima';
      END IF;
      v_preco_un := (v_faixa->>'preco_parceiro')::numeric;
    ELSE
      v_preco_un := v_preco.preco_parceiro;
    END IF;

    v_area_peca := CASE WHEN v_preco.por_area
                        THEN GREATEST(round(v_item.largura * v_item.altura, 3), COALESCE(v_preco.area_minima, 0)) END;
    SELECT CASE WHEN v_preco.por_area THEN round(COALESCE(p.custo_medio, 0) * v_area_peca, 2)
                ELSE COALESCE(p.custo_medio, 0) END
      INTO v_custo_un FROM public.produtos p WHERE p.id = v_item.produto_id;

    INSERT INTO public.orcamento_itens (
      orcamento_id, produto_id, descricao, unidade, quantidade, largura, altura, acabamento,
      preco_m2, valor_unitario, custo_unitario, ordem, origem_calculo, produto_snapshot
    ) VALUES (
      v_orc, v_item.produto_id, v_item.descricao, v_preco.unidade, v_item.quantidade,
      v_item.largura, v_item.altura, v_item.acabamento,
      -- por m²: o gatilho de preço calcula a peça a partir do preço do m²
      CASE WHEN v_preco.por_area THEN v_preco_un END,
      CASE WHEN v_preco.por_area THEN 0 ELSE v_preco_un END,
      COALESCE(v_custo_un, 0), v_n_itens, 'tabela_parceiro',
      jsonb_build_object('origem', 'parceiro', 'nivel', v_nivel->>'nome',
                         'desconto_pct', v_nivel->'desconto_pct', 'preco_referencia', v_preco.preco_referencia,
                         'preco_parceiro_unidade', v_preco_un, 'origem_preco', v_preco.origem)
    );
    v_n_itens := v_n_itens + 1;
  END LOOP;

  IF v_n_itens = 0 THEN
    RAISE EXCEPTION 'Nenhum item deste orçamento é produto da gráfica. Itens livres entram só no seu PDF.';
  END IF;

  SELECT COALESCE(sum(valor_total), 0) INTO v_subtotal FROM public.orcamento_itens WHERE orcamento_id = v_orc;
  UPDATE public.orcamentos SET valor_subtotal = v_subtotal, valor_total = v_subtotal WHERE id = v_orc;

  IF COALESCE(p_usar_credito, 0) > 0 THEN
    SELECT COALESCE(sum(valor), 0) INTO v_saldo FROM public.parceiro_creditos WHERE parceiro_id = v_parceiro;
    v_credito := round(LEAST(p_usar_credito, v_saldo, v_subtotal), 2);
    IF v_credito > 0 THEN
      INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, parceiro_orcamento_id, descricao, criado_por)
      VALUES (v_parceiro, 'uso', -v_credito, v_q.id, format('Reservado para o pedido nº %s', v_numero), auth.uid());
      UPDATE public.orcamentos SET
        condicao_pagamento = jsonb_build_object('parcelas', 1, 'credito_parceiro', v_credito),
        observacao_interna = observacao_interna ||
          format(' · Abater R$ %s de crédito do parceiro no pagamento.', replace(to_char(v_credito, 'FM999999990.00'), '.', ','))
      WHERE id = v_orc;
    ELSE
      v_credito := 0;
    END IF;
  END IF;

  UPDATE public.parceiro_orcamentos
     SET status = 'pedido_feito', pedido_orcamento_id = v_orc, credito_usado = v_credito, updated_at = now()
   WHERE id = v_q.id;

  RETURN jsonb_build_object(
    'orcamento_id', v_orc, 'numero', v_numero, 'itens', v_n_itens,
    'itens_livres_fora_do_pedido', v_livres, 'total', v_subtotal, 'credito_usado', v_credito
  );
END
$function$;

-- ─── Gestão (equipe da Bex) ─────────────────────────────────────────────────

-- Indicadores por parceiro. Só números: a carteira de clientes dele não sai daqui.
-- Valor comprado é faturamento da gráfica: sai só para quem vê financeiro, como no
-- resto do sistema (orcamentos_operacional não tem valor_total). Quem só tem
-- parceiros.read continua vendo o trabalho do parceiro — orçamentos, m², pedidos.
CREATE OR REPLACE FUNCTION public.parceiros_resumo()
RETURNS TABLE(
  id uuid, cliente_id uuid, nome text, cliente_nome text, usuario_email text, responsavel_nome text,
  status text, nivel jsonb, compras_30d numeric, ultima_compra date, dias_sem_comprar integer,
  orcamentos_30d integer, metragem_orcada_30d numeric, pedidos_30d integer, saldo_credito numeric,
  conquistas_a_entregar integer, ultimo_acesso_em timestamptz, criado_em timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_fin boolean;
BEGIN
  PERFORM public.require_permission('parceiros.read');
  v_fin := public.can_see_financials(auth.uid());
  FOR r IN SELECT p.id FROM public.parceiros p WHERE p.status = 'ativo' LOOP
    PERFORM public.parceiro_apurar_campanhas(r.id);
  END LOOP;

  RETURN QUERY
  SELECT p.id, p.cliente_id,
         COALESCE(NULLIF(btrim(p.marca_nome), ''), c.nome_fantasia, c.nome),
         c.nome, u.email, resp.nome, p.status,
         CASE WHEN v_fin THEN public.parceiro_nivel(p.id)
              ELSE public.parceiro_nivel(p.id) - 'compras_90d' - 'proximo' END,
         CASE WHEN v_fin THEN
           (SELECT cm.valor FROM public.parceiro_compras(p.id, current_date - 29, current_date) cm)
         END,
         (SELECT max(o.created_at)::date FROM public.ordens_servico o
           WHERE o.cliente_id = p.cliente_id AND o.status::text <> 'cancelado'),
         (SELECT (current_date - max(o.created_at)::date)::integer FROM public.ordens_servico o
           WHERE o.cliente_id = p.cliente_id AND o.status::text <> 'cancelado'),
         (SELECT count(*)::integer FROM public.parceiro_orcamentos q
           WHERE q.parceiro_id = p.id AND q.created_at >= now() - interval '30 days'),
         (SELECT COALESCE(sum(
                   CASE WHEN i.largura IS NOT NULL AND i.altura IS NOT NULL
                        THEN round(i.largura * i.altura * i.quantidade, 3) ELSE 0 END), 0)
            FROM public.parceiro_orcamento_itens i
            JOIN public.parceiro_orcamentos q ON q.id = i.orcamento_id
           WHERE q.parceiro_id = p.id AND q.created_at >= now() - interval '30 days'),
         (SELECT count(*)::integer FROM public.parceiro_orcamentos q
           WHERE q.parceiro_id = p.id AND q.pedido_orcamento_id IS NOT NULL
             AND q.updated_at >= now() - interval '30 days'),
         (SELECT COALESCE(sum(cr.valor), 0) FROM public.parceiro_creditos cr WHERE cr.parceiro_id = p.id),
         (SELECT count(*)::integer FROM public.parceiro_conquistas x
           WHERE x.parceiro_id = p.id AND x.status = 'a_entregar'),
         p.ultimo_acesso_em, p.created_at
  FROM public.parceiros p
  JOIN public.clientes c ON c.id = p.cliente_id
  LEFT JOIN public.usuarios u ON u.id = p.usuario_id
  LEFT JOIN public.usuarios resp ON resp.id = p.responsavel_id
  ORDER BY p.status, 9 DESC NULLS LAST;
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_criar(p_cliente_id uuid, p_responsavel_id uuid, p_nivel_fixo_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := public.require_permission('parceiros.manage');
  v_c public.clientes%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_c FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
  IF EXISTS (SELECT 1 FROM public.parceiros WHERE cliente_id = p_cliente_id) THEN
    RAISE EXCEPTION 'Este cliente já é parceiro.';
  END IF;
  IF p_responsavel_id IS NOT NULL AND NOT public.is_staff(p_responsavel_id) THEN
    RAISE EXCEPTION 'O atendente precisa ser da equipe.';
  END IF;

  INSERT INTO public.parceiros (
    cliente_id, responsavel_id, nivel_fixo_id, created_by,
    marca_nome, marca_documento, marca_telefone, marca_email, marca_endereco, marca_cidade, marca_estado
  ) VALUES (
    p_cliente_id, COALESCE(p_responsavel_id, v_uid), p_nivel_fixo_id, v_uid,
    COALESCE(v_c.nome_fantasia, v_c.nome), COALESCE(v_c.cpf_cnpj, v_c.documento),
    COALESCE(v_c.whatsapp_principal, v_c.telefone), v_c.email, v_c.endereco, v_c.cidade, v_c.estado
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_vincular_usuario(p_parceiro_id uuid, p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_email text;
BEGIN
  PERFORM public.require_permission('parceiros.manage');
  SELECT email INTO v_email FROM public.usuarios WHERE id = p_usuario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado. O parceiro precisa criar o login antes de ser vinculado.';
  END IF;
  IF public.is_staff(p_usuario_id) THEN
    RAISE EXCEPTION 'Este usuário é da equipe. O painel do parceiro é para quem compra para revender.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id AND id <> p_parceiro_id) THEN
    RAISE EXCEPTION 'Este usuário já está vinculado a outro parceiro.';
  END IF;
  UPDATE public.parceiros SET usuario_id = p_usuario_id, updated_at = now() WHERE id = p_parceiro_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parceiro não encontrado.'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('parceiro_id', p_parceiro_id, 'usuario_id', p_usuario_id, 'email', v_email);
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_ajustar_credito(p_parceiro_id uuid, p_valor numeric, p_descricao text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := public.require_permission('parceiros.manage'); v_saldo numeric;
BEGIN
  IF COALESCE(p_valor, 0) = 0 THEN RAISE EXCEPTION 'Informe um valor diferente de zero.'; END IF;
  IF NULLIF(btrim(p_descricao), '') IS NULL THEN RAISE EXCEPTION 'Diga o motivo do ajuste.'; END IF;
  SELECT COALESCE(sum(valor), 0) INTO v_saldo FROM public.parceiro_creditos WHERE parceiro_id = p_parceiro_id;
  IF v_saldo + p_valor < 0 THEN
    RAISE EXCEPTION 'O ajuste deixaria o saldo negativo (saldo atual R$ %).', v_saldo;
  END IF;
  INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, descricao, criado_por)
  VALUES (p_parceiro_id, 'ajuste', round(p_valor, 2), btrim(p_descricao), v_uid);
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_entregar_conquista(p_conquista_id uuid, p_observacao text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := public.require_permission('parceiros.manage');
BEGIN
  UPDATE public.parceiro_conquistas
     SET status = 'entregue', entregue_em = now(), entregue_por = v_uid,
         observacao = NULLIF(btrim(p_observacao), '')
   WHERE id = p_conquista_id AND status = 'a_entregar';
  IF NOT FOUND THEN RAISE EXCEPTION 'Recompensa não encontrada ou já entregue.'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_conquistas_pendentes()
RETURNS TABLE(id uuid, parceiro_nome text, campanha text, recompensa text, alcancado_em timestamptz, valor_apurado numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN QUERY
  SELECT x.id, COALESCE(NULLIF(btrim(p.marca_nome), ''), c.nome), pc.titulo, pc.recompensa_descricao,
         x.alcancado_em, x.valor_apurado
  FROM public.parceiro_conquistas x
  JOIN public.parceiros p ON p.id = x.parceiro_id
  JOIN public.clientes c ON c.id = p.cliente_id
  JOIN public.parceiro_campanhas pc ON pc.id = x.campanha_id
  WHERE x.status = 'a_entregar'
  ORDER BY x.alcancado_em;
END
$function$;

-- =============================================================================
-- GATILHOS
-- =============================================================================

-- Número sequencial por parceiro e campos que só o sistema escreve.
CREATE OR REPLACE FUNCTION public.tg_parceiro_orcamento_guarda()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.pedido_orcamento_id := NULL;
    NEW.credito_usado := 0;
    IF NEW.status = 'pedido_feito' THEN NEW.status := 'rascunho'; END IF;
    SELECT COALESCE(max(numero), 0) + 1 INTO NEW.numero
      FROM public.parceiro_orcamentos WHERE parceiro_id = NEW.parceiro_id;
    RETURN NEW;
  END IF;

  -- Dentro das funções do sistema (SECURITY DEFINER) o usuário corrente é o
  -- dono; pela API é `authenticated`. Só a API é barrada.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.pedido_orcamento_id IS DISTINCT FROM OLD.pedido_orcamento_id
       OR NEW.credito_usado IS DISTINCT FROM OLD.credito_usado
       OR NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.parceiro_id IS DISTINCT FROM OLD.parceiro_id THEN
      RAISE EXCEPTION 'Estes campos são controlados pelo sistema.';
    END IF;
    IF OLD.status = 'pedido_feito' THEN
      RAISE EXCEPTION 'Este orçamento já virou pedido e não pode mais ser alterado.';
    END IF;
    IF NEW.status = 'pedido_feito' THEN
      RAISE EXCEPTION 'Use "Fazer pedido" para enviar à gráfica.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

CREATE TRIGGER tg_parceiro_orcamento_guarda
  BEFORE INSERT OR UPDATE ON public.parceiro_orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_orcamento_guarda();

CREATE OR REPLACE FUNCTION public.tg_parceiro_item_guarda()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_orc uuid := COALESCE(NEW.orcamento_id, OLD.orcamento_id);
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    SELECT status INTO v_status FROM public.parceiro_orcamentos WHERE id = v_orc;
    IF v_status = 'pedido_feito' THEN
      RAISE EXCEPTION 'Este orçamento já virou pedido e não pode mais ser alterado.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.orcamento_id IS DISTINCT FROM OLD.orcamento_id THEN
      RAISE EXCEPTION 'O item não pode mudar de orçamento.';
    END IF;
  END IF;
  -- Na exclusão não toca o orçamento: quando o próprio orçamento está sendo
  -- apagado, a cascata chega aqui e atualizar a linha em exclusão é recusado.
  IF TG_OP <> 'DELETE' THEN
    UPDATE public.parceiro_orcamentos SET updated_at = now() WHERE id = v_orc;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE TRIGGER tg_parceiro_item_guarda
  BEFORE INSERT OR UPDATE OR DELETE ON public.parceiro_orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_item_guarda();

-- Orçamento que virou pedido não some: o pedido na gráfica aponta para ele.
CREATE OR REPLACE FUNCTION public.tg_parceiro_orcamento_exclusao()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND OLD.status = 'pedido_feito' THEN
    RAISE EXCEPTION 'Este orçamento virou pedido na gráfica e não pode ser apagado.';
  END IF;
  RETURN OLD;
END
$function$;

CREATE TRIGGER tg_parceiro_orcamento_exclusao
  BEFORE DELETE ON public.parceiro_orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_orcamento_exclusao();

-- Cashback quando a OS do parceiro fica paga.
CREATE OR REPLACE FUNCTION public.tg_parceiro_cashback()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_parceiro uuid; v_nivel jsonb; v_pct numeric; v_valor numeric;
BEGIN
  IF NEW.status_financeiro::text <> 'pago' OR OLD.status_financeiro::text = 'pago' THEN RETURN NEW; END IF;
  SELECT id INTO v_parceiro FROM public.parceiros WHERE cliente_id = NEW.cliente_id AND status = 'ativo';
  IF v_parceiro IS NULL THEN RETURN NEW; END IF;
  v_nivel := public.parceiro_nivel(v_parceiro);
  v_pct := COALESCE((v_nivel->>'cashback_pct')::numeric, 0);
  v_valor := round(COALESCE(NEW.valor_total, 0) * v_pct / 100, 2);
  IF v_valor <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, os_id, descricao)
  VALUES (v_parceiro, 'cashback', v_valor, NEW.id,
          format('Cashback de %s%% (nível %s) sobre a OS nº %s', v_pct, v_nivel->>'nome', NEW.numero))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$function$;

CREATE TRIGGER tg_parceiro_cashback
  AFTER UPDATE OF status_financeiro ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_cashback();

-- Pedido recusado ou expirado na Bex: devolve o crédito reservado e libera o
-- orçamento do parceiro para ser reenviado.
CREATE OR REPLACE FUNCTION public.tg_parceiro_pedido_recusado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_q public.parceiro_orcamentos%ROWTYPE;
BEGIN
  IF NEW.status::text NOT IN ('rejeitado', 'expirado') OR OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_q FROM public.parceiro_orcamentos WHERE pedido_orcamento_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_q.credito_usado > 0 THEN
    INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, parceiro_orcamento_id, descricao)
    VALUES (v_q.parceiro_id, 'estorno_uso', v_q.credito_usado, v_q.id,
            format('Devolvido: pedido nº %s %s pela gráfica', NEW.numero,
                   CASE NEW.status::text WHEN 'rejeitado' THEN 'recusado' ELSE 'expirado' END));
  END IF;
  UPDATE public.parceiro_orcamentos
     SET status = 'aprovado', pedido_orcamento_id = NULL, credito_usado = 0, updated_at = now()
   WHERE id = v_q.id;
  RETURN NEW;
END
$function$;

CREATE TRIGGER tg_parceiro_pedido_recusado
  AFTER UPDATE OF status ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_pedido_recusado();

CREATE TRIGGER tg_parceiros_updated BEFORE UPDATE ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_parceiro_niveis_updated BEFORE UPDATE ON public.parceiro_niveis
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_parceiro_campanhas_updated BEFORE UPDATE ON public.parceiro_campanhas
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_parceiro_ofertas_updated BEFORE UPDATE ON public.parceiro_ofertas
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =============================================================================
-- ACESSO
-- =============================================================================

ALTER TABLE public.parceiro_niveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_orcamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_orcamento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_conquistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_ofertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_ofertas_vistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_creditos ENABLE ROW LEVEL SECURITY;

-- Níveis: a equipe que cuida de parceiros e os próprios parceiros leem; gestão escreve.
-- Não `USING (true)`: a tela pública de cadastro cria conta sem papel, e ela não
-- tem por que ver a régua de descontos.
CREATE POLICY parceiro_niveis_le ON public.parceiro_niveis FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR public.parceiro_do_usuario() IS NOT NULL);
CREATE POLICY parceiro_niveis_gestao ON public.parceiro_niveis FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'parceiros.manage'));

-- Parceiros: a equipe com permissão lê; o próprio parceiro lê a própria linha.
CREATE POLICY parceiros_equipe_le ON public.parceiros FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read'));
CREATE POLICY parceiros_proprio_le ON public.parceiros FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());
CREATE POLICY parceiros_gestao_altera ON public.parceiros FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'parceiros.manage'));

-- Orçamentos do parceiro: SÓ o dono. Sem política de leitura para a equipe.
CREATE POLICY parceiro_orcamentos_dono ON public.parceiro_orcamentos FOR ALL TO authenticated
  USING (parceiro_id = public.parceiro_do_usuario())
  WITH CHECK (parceiro_id = public.parceiro_do_usuario());
CREATE POLICY parceiro_itens_dono ON public.parceiro_orcamento_itens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.parceiro_orcamentos q
                 WHERE q.id = orcamento_id AND q.parceiro_id = public.parceiro_do_usuario()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.parceiro_orcamentos q
                      WHERE q.id = orcamento_id AND q.parceiro_id = public.parceiro_do_usuario()));

-- Campanhas e ofertas: equipe lê e gestão escreve; o parceiro lê.
CREATE POLICY parceiro_campanhas_le ON public.parceiro_campanhas FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR public.parceiro_do_usuario() IS NOT NULL);
CREATE POLICY parceiro_campanhas_gestao ON public.parceiro_campanhas FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'parceiros.manage'));
CREATE POLICY parceiro_ofertas_le ON public.parceiro_ofertas FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR public.parceiro_do_usuario() IS NOT NULL);
CREATE POLICY parceiro_ofertas_gestao ON public.parceiro_ofertas FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'parceiros.manage'));

-- Conquistas, créditos e ofertas vistas: leitura própria ou da equipe; escrita só por função.
CREATE POLICY parceiro_conquistas_le ON public.parceiro_conquistas FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR parceiro_id = public.parceiro_do_usuario());
CREATE POLICY parceiro_creditos_le ON public.parceiro_creditos FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR parceiro_id = public.parceiro_do_usuario());
CREATE POLICY parceiro_ofertas_vistas_le ON public.parceiro_ofertas_vistas FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR parceiro_id = public.parceiro_do_usuario());

-- Funções internas não são chamáveis pela API.
REVOKE ALL ON FUNCTION public.parceiro_compras(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parceiro_nivel(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parceiro_precos(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parceiro_apurar_campanhas(uuid) FROM PUBLIC, anon, authenticated;

-- Funções da API: só usuário logado (cada uma confere o próprio acesso).
REVOKE ALL ON FUNCTION public.parceiro_do_usuario() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_painel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_catalogo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_marcar_oferta_vista(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_salvar_marca(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_enviar_pedido(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiros_resumo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_criar(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_vincular_usuario(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_ajustar_credito(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_entregar_conquista(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_conquistas_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_do_usuario() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_painel() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_catalogo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_marcar_oferta_vista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_salvar_marca(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_enviar_pedido(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiros_resumo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_criar(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_vincular_usuario(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_ajustar_credito(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_entregar_conquista(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_conquistas_pendentes() TO authenticated;

-- ─── Logo do parceiro ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('parceiros-marcas', 'parceiros-marcas', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "parceiro marca propria le" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'parceiros-marcas'
         AND ((storage.foldername(name))[1] = public.parceiro_do_usuario()::text
              OR public.has_permission(auth.uid(), 'parceiros.read')));
CREATE POLICY "parceiro marca propria envia" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'parceiros-marcas'
              AND (storage.foldername(name))[1] = public.parceiro_do_usuario()::text);
CREATE POLICY "parceiro marca propria troca" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'parceiros-marcas'
         AND (storage.foldername(name))[1] = public.parceiro_do_usuario()::text);
CREATE POLICY "parceiro marca propria apaga" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'parceiros-marcas'
         AND (storage.foldername(name))[1] = public.parceiro_do_usuario()::text);
