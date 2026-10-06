-- =============================================================================
-- Catálogos de fornecedores — a prateleira do fornecedor dentro do Bex Print
-- (05/10/2026)
--
-- O QUE É
--   O catálogo de brindes da LUGA (e de qualquer fornecedor que vier depois)
--   dentro do sistema: a equipe vê foto, nome, especificação e o código Bex
--   Print (BX-0001…); quem vê preço vê o preço de venda já pronto; quem vê o
--   financeiro vê também o CUSTO (o preço de fábrica da tabela do fornecedor)
--   e a margem. O cliente recebe um link com a vitrine, sem o nome e sem o
--   código do fornecedor — para não comprar direto da fábrica.
--
-- AS TRÊS DECISÕES DO DONO (05/10/2026) QUE ESTE ARQUIVO SEGURA
--   1. Preço de venda = regra por catálogo (margem sobre o custo, frete por
--      peça, arredondamento para cima), com exceção por seção e por item
--      (margem ou preço fixo). Sem regra, o item é "sob consulta": o cálculo
--      devolve NULL — nunca R$ 0,00 e nunca o custo.
--   2. O cliente vê foto, nome, especificação, código BX e preço de venda.
--      `catalogo_link_abrir` monta a resposta com lista FECHADA de chaves e
--      passa todo texto por `fornecedor_texto_para_cliente`.
--   3. O preço da tabela do fornecedor é CUSTO. Ele mora numa tabela própria
--      (`fornecedor_item_custos`) que a RLS só abre para quem vê financeiro —
--      o molde de `produtos` × `produto_precos`. Margem é custo disfarçado
--      (preço ÷ (1 + margem) devolve o custo), então sai junto com o custo:
--      quem só vê preço recebe preço, nunca margem.
--
-- OPÇÃO C DO ESTUDO DE ENCAIXE
--   Prateleira própria; o item só entra no orçamento quando vendido, pelo
--   mesmo INSERT em `orcamento_itens` que a tela faz (os gatilhos de preço e
--   de total valem igual). `converter_orcamento_em_os` não muda: o retrato do
--   item (`produto_snapshot`) já viaja para a OS e leva o código BX junto.
--
-- REGRAS DE ACESSO
--   - Toda tabela nasce com RLS e com `REVOKE ALL ... FROM PUBLIC, anon,
--     authenticated`; o GRANT volta só para o que a tela lê. Nada para anon.
--   - Escrita de item, custo, regra, foto e link só por função DEFINER, que
--     confere a permissão (`catalogo.manage`) e grava o rastro.
--   - Toda função nasce fechada (REVOKE de PUBLIC, anon, authenticated e
--     service_role) e abre só para quem deve. As internas não abrem.
--   - Quem mexe em regra de venda e em sincronização precisa também ver o
--     financeiro: a tela mostra custo, e a regra É margem sobre custo.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Permissões
-- -----------------------------------------------------------------------------

INSERT INTO public.permissoes (chave, dominio, descricao) VALUES
  ('catalogo.read', 'catalogo',
   'Ver o catálogo de fornecedores: foto, nome, especificação e código BX (preço e custo seguem os níveis de dinheiro)'),
  ('catalogo.manage', 'catalogo',
   'Importar e sincronizar catálogo de fornecedor, apontar fotos, definir a regra de venda e gerar link para cliente')
ON CONFLICT (chave) DO UPDATE SET dominio = EXCLUDED.dominio, descricao = EXCLUDED.descricao;

INSERT INTO public.perfil_permissoes (perfil, permissao) VALUES
  ('admin', 'catalogo.read'), ('gestor', 'catalogo.read'),
  ('financeiro', 'catalogo.read'), ('vendedor', 'catalogo.read'),
  ('admin', 'catalogo.manage'), ('gestor', 'catalogo.manage')
ON CONFLICT (perfil, permissao) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. Tabelas
-- -----------------------------------------------------------------------------

-- O código BX é da Bex Print, estável e único entre todos os fornecedores.
CREATE SEQUENCE IF NOT EXISTS public.fornecedor_itens_codigo_bex_seq START 1;

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  razao_social text,
  cnpj text,
  site text,
  telefone text,
  endereco text,
  -- Contato e observação comercial. Dado bancário do fornecedor NÃO entra aqui.
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fornecedores_nome_unico ON public.fornecedores (lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.fornecedor_catalogos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE RESTRICT,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  -- A edição da tabela de preços em vigor ("Tabela de setembro/2026 nº 10").
  edicao text,
  vigencia_inicio date,
  vigencia_fim date,
  arquivo_origem text,
  arquivo_fotos text,
  importado_em timestamptz,
  sincronizado_em timestamptz,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedor_catalogos_vigencia CHECK (
    vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS fornecedor_catalogos_fornecedor ON public.fornecedor_catalogos (fornecedor_id);

CREATE TABLE IF NOT EXISTS public.fornecedor_secoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  ordem integer NOT NULL,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 300),
  especificacao text,
  pagina_inicial integer,
  pagina_final integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedor_secoes_id_catalogo UNIQUE (id, catalogo_id)
);
CREATE INDEX IF NOT EXISTS fornecedor_secoes_catalogo ON public.fornecedor_secoes (catalogo_id, ordem);

-- O acervo de fotos do catálogo. O caminho é OPACO: o nome do arquivo não traz
-- código nem nome do fornecedor, porque o cliente vê a URL da imagem.
CREATE TABLE IF NOT EXISTS public.fornecedor_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  codigo_fornecedor text,
  legenda text,
  origem text NOT NULL DEFAULT 'repositorio' CHECK (origem IN ('repositorio', 'storage')),
  caminho text NOT NULL,
  largura integer,
  altura integer,
  bytes integer,
  pagina integer,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedor_fotos_id_catalogo UNIQUE (id, catalogo_id),
  CONSTRAINT fornecedor_fotos_caminho_unico UNIQUE (origem, caminho),
  CONSTRAINT fornecedor_fotos_caminho_opaco CHECK (
    (origem = 'repositorio' AND caminho ~ '^/catalogo/[0-9a-f]{16,32}\.(webp|jpg|jpeg|png)$')
    OR (origem = 'storage'
        AND caminho ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg|png)$'))
);
CREATE INDEX IF NOT EXISTS fornecedor_fotos_codigo ON public.fornecedor_fotos (catalogo_id, codigo_fornecedor);

CREATE TABLE IF NOT EXISTS public.fornecedor_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  secao_id uuid,
  codigo_bex text NOT NULL
    DEFAULT ('BX-' || lpad(nextval('public.fornecedor_itens_codigo_bex_seq')::text, 4, '0')),
  codigo_fornecedor text NOT NULL CHECK (length(btrim(codigo_fornecedor)) BETWEEN 1 AND 60),
  -- Como o fornecedor imprimiu (para a equipe e para a sincronização).
  descricao text NOT NULL,
  -- Como o cliente lê (a legenda do catálogo de fotos, ou a descrição limpa).
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 300),
  especificacao text,
  dimensoes text,
  embalagem text,
  unidade_preco text NOT NULL DEFAULT 'unidade'
    CHECK (unidade_preco IN ('unidade', 'cento', 'milheiro', 'caixa', 'rolo', 'folha', 'pacote')),
  quantidade_minima numeric(12,2) CHECK (quantidade_minima IS NULL OR quantidade_minima > 0),
  multiplo numeric(12,2) CHECK (multiplo IS NULL OR multiplo > 0),
  quantidade_minima_gravada numeric(12,2)
    CHECK (quantidade_minima_gravada IS NULL OR quantidade_minima_gravada > 0),
  e_embalagem boolean NOT NULL DEFAULT false,
  foto_id uuid,
  tem_foto boolean GENERATED ALWAYS AS (foto_id IS NOT NULL) STORED,
  -- Foto a apontar: o código tem fotos de várias cores e nenhuma casou com esta.
  foto_conferir boolean NOT NULL DEFAULT false,
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'fora_da_tabela')),
  fora_desde timestamptz,
  -- Unidade do preço em dúvida (pacote × peça): sob consulta até confirmar.
  em_duvida boolean NOT NULL DEFAULT false,
  duvida text,
  observacao text,
  pagina integer,
  linha integer,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedor_itens_id_catalogo UNIQUE (id, catalogo_id),
  CONSTRAINT fornecedor_itens_codigo_bex_unico UNIQUE (codigo_bex),
  CONSTRAINT fornecedor_itens_codigo_bex_formato CHECK (codigo_bex ~ '^BX-[0-9]{4,7}$'),
  -- A seção e a foto são do MESMO catálogo do item.
  CONSTRAINT fornecedor_itens_secao_fk FOREIGN KEY (secao_id, catalogo_id)
    REFERENCES public.fornecedor_secoes (id, catalogo_id) ON DELETE SET NULL (secao_id),
  CONSTRAINT fornecedor_itens_foto_fk FOREIGN KEY (foto_id, catalogo_id)
    REFERENCES public.fornecedor_fotos (id, catalogo_id) ON DELETE SET NULL (foto_id)
);
CREATE INDEX IF NOT EXISTS fornecedor_itens_catalogo ON public.fornecedor_itens (catalogo_id, ordem);
CREATE INDEX IF NOT EXISTS fornecedor_itens_secao ON public.fornecedor_itens (secao_id);
CREATE INDEX IF NOT EXISTS fornecedor_itens_codigo ON public.fornecedor_itens (catalogo_id, codigo_fornecedor);
CREATE INDEX IF NOT EXISTS fornecedor_itens_foto ON public.fornecedor_itens (foto_id);

-- As modalidades que o fornecedor oferece para cada item (sem gravação, silk
-- 1 cor, laser...), com mínimo, múltiplo e faixa de quantidade. Sem dinheiro.
CREATE TABLE IF NOT EXISTS public.fornecedor_item_modalidades (
  item_id uuid NOT NULL REFERENCES public.fornecedor_itens(id) ON DELETE CASCADE,
  modalidade text NOT NULL CHECK (modalidade IN (
    'sem_gravacao', 'valor_unico', 'gravada_1_cor', 'gravada_mais_pagina', 'gravacao_laser',
    'baixo_relevo', 'gravada_100_199', 'gravada_acima_1000', 'com_gravacao', 'transfer_giro')),
  posicao smallint NOT NULL DEFAULT 1,
  quantidade_minima numeric(12,2) CHECK (quantidade_minima IS NULL OR quantidade_minima > 0),
  multiplo numeric(12,2) CHECK (multiplo IS NULL OR multiplo > 0),
  faixa text,
  faixa_max numeric(12,2) CHECK (faixa_max IS NULL OR faixa_max > 0),
  -- A tabela não rotulou a coluna; o rótulo foi deduzido (confirmar com o fornecedor).
  rotulo_inferido boolean NOT NULL DEFAULT false,
  PRIMARY KEY (item_id, modalidade)
);

-- O CUSTO por modalidade: o preço de fábrica da tabela do fornecedor.
-- Só quem vê financeiro lê esta tabela.
CREATE TABLE IF NOT EXISTS public.fornecedor_item_custos (
  item_id uuid NOT NULL,
  modalidade text NOT NULL,
  custo numeric(12,4) NOT NULL CHECK (custo >= 0 AND custo < 1000000),
  adicional_por_cor numeric(12,4) CHECK (adicional_por_cor IS NULL OR adicional_por_cor >= 0),
  edicao text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, modalidade),
  CONSTRAINT fornecedor_item_custos_modalidade_fk FOREIGN KEY (item_id, modalidade)
    REFERENCES public.fornecedor_item_modalidades (item_id, modalidade) ON DELETE CASCADE
);

-- Cada carga e cada sincronização, com as contagens e as notas da tabela
-- (regras comerciais e dúvidas, que trazem valores — por isso é financeiro).
CREATE TABLE IF NOT EXISTS public.fornecedor_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('carga_inicial', 'sincronizacao')),
  edicao text,
  arquivo text,
  novos integer NOT NULL DEFAULT 0,
  subiram integer NOT NULL DEFAULT 0,
  desceram integer NOT NULL DEFAULT 0,
  outras_mudancas integer NOT NULL DEFAULT 0,
  sairam integer NOT NULL DEFAULT 0,
  voltaram integer NOT NULL DEFAULT 0,
  iguais integer NOT NULL DEFAULT 0,
  notas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notas) = 'array'),
  feito_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  feito_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fornecedor_importacoes_catalogo ON public.fornecedor_importacoes (catalogo_id, feito_em DESC);

-- Custo antigo → novo, com a edição de origem. Nunca se apaga custo sem rastro.
CREATE TABLE IF NOT EXISTS public.fornecedor_item_custos_historico (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.fornecedor_itens(id) ON DELETE CASCADE,
  modalidade text NOT NULL,
  custo_anterior numeric(12,4),
  custo_novo numeric(12,4),
  edicao text,
  importacao_id uuid REFERENCES public.fornecedor_importacoes(id) ON DELETE SET NULL,
  alterado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  alterado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedor_custos_historico_mudou CHECK (custo_anterior IS DISTINCT FROM custo_novo)
);
CREATE INDEX IF NOT EXISTS fornecedor_custos_historico_item
  ON public.fornecedor_item_custos_historico (item_id, alterado_em DESC);

-- A regra de venda: uma linha do catálogo (margem, frete por peça,
-- arredondamento), e exceções por seção (margem, frete) e por item (margem,
-- frete, preço fixo por modalidade). Só quem vê financeiro lê.
CREATE TABLE IF NOT EXISTS public.fornecedor_regras_venda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  secao_id uuid,
  item_id uuid,
  margem_pct numeric(7,2) CHECK (margem_pct IS NULL OR (margem_pct >= 0 AND margem_pct <= 1000)),
  frete_por_peca numeric(12,4) CHECK (frete_por_peca IS NULL OR (frete_por_peca >= 0 AND frete_por_peca < 10000)),
  arredondamento numeric(8,2) CHECK (arredondamento IS NULL OR arredondamento IN (0, 0.05, 0.10, 0.50, 1.00)),
  precos_fixos jsonb,
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedor_regras_um_alvo CHECK (secao_id IS NULL OR item_id IS NULL),
  CONSTRAINT fornecedor_regras_arredondamento_do_catalogo CHECK (
    arredondamento IS NULL OR (secao_id IS NULL AND item_id IS NULL)),
  CONSTRAINT fornecedor_regras_preco_fixo_do_item CHECK (
    precos_fixos IS NULL OR (item_id IS NOT NULL AND jsonb_typeof(precos_fixos) = 'object')),
  CONSTRAINT fornecedor_regras_algo_definido CHECK (
    margem_pct IS NOT NULL OR frete_por_peca IS NOT NULL OR arredondamento IS NOT NULL
    OR precos_fixos IS NOT NULL),
  CONSTRAINT fornecedor_regras_secao_fk FOREIGN KEY (secao_id, catalogo_id)
    REFERENCES public.fornecedor_secoes (id, catalogo_id) ON DELETE CASCADE,
  CONSTRAINT fornecedor_regras_item_fk FOREIGN KEY (item_id, catalogo_id)
    REFERENCES public.fornecedor_itens (id, catalogo_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS fornecedor_regras_venda_do_catalogo
  ON public.fornecedor_regras_venda (catalogo_id) WHERE secao_id IS NULL AND item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fornecedor_regras_venda_da_secao
  ON public.fornecedor_regras_venda (secao_id) WHERE secao_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fornecedor_regras_venda_do_item
  ON public.fornecedor_regras_venda (item_id) WHERE item_id IS NOT NULL;

-- O link da vitrine para o cliente: o banco guarda só o SHA-256 do token, com
-- validade e cancelamento (o molde de `portal_cliente_links`).
CREATE TABLE IF NOT EXISTS public.catalogo_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz NOT NULL,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  revogado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultimo_acesso_em timestamptz,
  acessos integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS catalogo_links_catalogo ON public.catalogo_links (catalogo_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.catalogo_link_itens (
  link_id uuid NOT NULL REFERENCES public.catalogo_links(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.fornecedor_itens(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, item_id)
);
CREATE INDEX IF NOT EXISTS catalogo_link_itens_item ON public.catalogo_link_itens (item_id);


-- -----------------------------------------------------------------------------
-- 3. Gatilhos
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tg_fornecedores_updated ON public.fornecedores;
CREATE TRIGGER tg_fornecedores_updated BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_fornecedor_catalogos_updated ON public.fornecedor_catalogos;
CREATE TRIGGER tg_fornecedor_catalogos_updated BEFORE UPDATE ON public.fornecedor_catalogos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_fornecedor_secoes_updated ON public.fornecedor_secoes;
CREATE TRIGGER tg_fornecedor_secoes_updated BEFORE UPDATE ON public.fornecedor_secoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_fornecedor_itens_updated ON public.fornecedor_itens;
CREATE TRIGGER tg_fornecedor_itens_updated BEFORE UPDATE ON public.fornecedor_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Quem cadastrou o fornecedor ou o catálogo: o banco carimba, a tela não manda.
CREATE OR REPLACE FUNCTION public.tg_fornecedor_criado_por()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  NEW.criado_por := auth.uid();
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS tg_fornecedores_criado_por ON public.fornecedores;
CREATE TRIGGER tg_fornecedores_criado_por BEFORE INSERT ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.tg_fornecedor_criado_por();
DROP TRIGGER IF EXISTS tg_fornecedor_catalogos_criado_por ON public.fornecedor_catalogos;
CREATE TRIGGER tg_fornecedor_catalogos_criado_por BEFORE INSERT ON public.fornecedor_catalogos
  FOR EACH ROW EXECUTE FUNCTION public.tg_fornecedor_criado_por();

-- O código BX é estável: é o que o cliente cita no WhatsApp e o que fica no
-- orçamento. Sincronização nenhuma troca o código de um item.
CREATE OR REPLACE FUNCTION public.tg_fornecedor_item_codigo_estavel()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.codigo_bex IS DISTINCT FROM OLD.codigo_bex THEN
    RAISE EXCEPTION 'O código % é fixo: não se troca código BX de item.', OLD.codigo_bex;
  END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS tg_fornecedor_itens_codigo_estavel ON public.fornecedor_itens;
CREATE TRIGGER tg_fornecedor_itens_codigo_estavel BEFORE UPDATE OF codigo_bex ON public.fornecedor_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_fornecedor_item_codigo_estavel();


-- -----------------------------------------------------------------------------
-- 4. RLS e GRANT
-- -----------------------------------------------------------------------------

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_catalogos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_secoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_item_modalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_item_custos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_item_custos_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_regras_venda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_link_itens ENABLE ROW LEVEL SECURITY;

-- O projeto dá GRANT total a anon e authenticated por padrão: fecha tudo e
-- devolve só o que a tela usa.
REVOKE ALL ON TABLE public.fornecedores FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_catalogos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_secoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_fotos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_itens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_item_modalidades FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_item_custos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_importacoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_item_custos_historico FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fornecedor_regras_venda FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogo_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogo_link_itens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.fornecedor_itens_codigo_bex_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.fornecedor_item_custos_historico_id_seq FROM PUBLIC, anon, authenticated;

-- Equipe com catalogo.read: o que não é dinheiro.
GRANT SELECT ON public.fornecedores, public.fornecedor_catalogos, public.fornecedor_secoes,
  public.fornecedor_fotos, public.fornecedor_itens, public.fornecedor_item_modalidades TO authenticated;
-- Quem vê financeiro (e o catálogo): custo, histórico, regra e importações.
GRANT SELECT ON public.fornecedor_item_custos, public.fornecedor_item_custos_historico,
  public.fornecedor_regras_venda, public.fornecedor_importacoes TO authenticated;
-- Cadastro de fornecedor e de catálogo (catalogo.manage), coluna a coluna.
GRANT INSERT (nome, razao_social, cnpj, site, telefone, endereco, observacoes)
  ON public.fornecedores TO authenticated;
GRANT UPDATE (nome, razao_social, cnpj, site, telefone, endereco, observacoes, ativo)
  ON public.fornecedores TO authenticated;
GRANT INSERT (fornecedor_id, titulo, edicao, vigencia_inicio, vigencia_fim, arquivo_origem, arquivo_fotos)
  ON public.fornecedor_catalogos TO authenticated;
GRANT UPDATE (titulo, edicao, vigencia_inicio, vigencia_fim, arquivo_fotos, ativo)
  ON public.fornecedor_catalogos TO authenticated;
-- catalogo_links e catalogo_link_itens: nenhum GRANT. Só por função (o hash
-- do token não sai do banco).

DROP POLICY IF EXISTS "catalogo le fornecedores" ON public.fornecedores;
CREATE POLICY "catalogo le fornecedores" ON public.fornecedores FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')));
DROP POLICY IF EXISTS "catalogo cadastra fornecedor" ON public.fornecedores;
CREATE POLICY "catalogo cadastra fornecedor" ON public.fornecedores FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));
DROP POLICY IF EXISTS "catalogo edita fornecedor" ON public.fornecedores;
CREATE POLICY "catalogo edita fornecedor" ON public.fornecedores FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')))
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));

DROP POLICY IF EXISTS "catalogo le catalogos" ON public.fornecedor_catalogos;
CREATE POLICY "catalogo le catalogos" ON public.fornecedor_catalogos FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')));
DROP POLICY IF EXISTS "catalogo cadastra catalogo" ON public.fornecedor_catalogos;
CREATE POLICY "catalogo cadastra catalogo" ON public.fornecedor_catalogos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));
DROP POLICY IF EXISTS "catalogo edita catalogo" ON public.fornecedor_catalogos;
CREATE POLICY "catalogo edita catalogo" ON public.fornecedor_catalogos FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')))
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));

DROP POLICY IF EXISTS "catalogo le secoes" ON public.fornecedor_secoes;
CREATE POLICY "catalogo le secoes" ON public.fornecedor_secoes FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')));
DROP POLICY IF EXISTS "catalogo le fotos" ON public.fornecedor_fotos;
CREATE POLICY "catalogo le fotos" ON public.fornecedor_fotos FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')));
DROP POLICY IF EXISTS "catalogo le itens" ON public.fornecedor_itens;
CREATE POLICY "catalogo le itens" ON public.fornecedor_itens FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')));
DROP POLICY IF EXISTS "catalogo le modalidades" ON public.fornecedor_item_modalidades;
CREATE POLICY "catalogo le modalidades" ON public.fornecedor_item_modalidades FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')));

DROP POLICY IF EXISTS "custo do fornecedor so financeiro" ON public.fornecedor_item_custos;
CREATE POLICY "custo do fornecedor so financeiro" ON public.fornecedor_item_custos FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')
              AND public.can_see_financials((SELECT auth.uid()))));
DROP POLICY IF EXISTS "historico de custo so financeiro" ON public.fornecedor_item_custos_historico;
CREATE POLICY "historico de custo so financeiro" ON public.fornecedor_item_custos_historico FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')
              AND public.can_see_financials((SELECT auth.uid()))));
DROP POLICY IF EXISTS "regra de venda so financeiro" ON public.fornecedor_regras_venda;
CREATE POLICY "regra de venda so financeiro" ON public.fornecedor_regras_venda FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')
              AND public.can_see_financials((SELECT auth.uid()))));
DROP POLICY IF EXISTS "importacoes so financeiro" ON public.fornecedor_importacoes;
CREATE POLICY "importacoes so financeiro" ON public.fornecedor_importacoes FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'catalogo.read')
              AND public.can_see_financials((SELECT auth.uid()))));
-- catalogo_links e catalogo_link_itens: RLS ligada e NENHUMA policy.


-- -----------------------------------------------------------------------------
-- 5. Peças internas (nenhuma abre para a API)
-- -----------------------------------------------------------------------------

-- O rótulo de cada modalidade, para a equipe e para o cliente. É o mesmo de
-- ROTULO_DA_MODALIDADE em src/domain/catalogo/modalidades.ts — um teste confere.
CREATE OR REPLACE FUNCTION public.fornecedor_rotulo_modalidade(p_modalidade text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT CASE p_modalidade
    WHEN 'sem_gravacao' THEN 'Sem gravação'
    WHEN 'valor_unico' THEN 'Preço'
    WHEN 'gravada_1_cor' THEN 'Gravada em silk 1 cor'
    WHEN 'gravada_mais_pagina' THEN 'Silk 1 cor + 1ª página em 4 cores'
    WHEN 'gravacao_laser' THEN 'Gravação a laser'
    WHEN 'baixo_relevo' THEN 'Baixo relevo'
    WHEN 'gravada_100_199' THEN 'Com gravação'
    WHEN 'gravada_acima_1000' THEN 'Com gravação'
    WHEN 'com_gravacao' THEN 'Com gravação'
    WHEN 'transfer_giro' THEN 'Personalizada (transfer, 4 cores)'
    ELSE p_modalidade
  END
$f$;

-- Quantas peças cabem na unidade do preço: o frete por PEÇA vira frete por
-- cento ou por milheiro, e o orçamento divide o preço do cento por 100.
CREATE OR REPLACE FUNCTION public.fornecedor_fator_unidade(p_unidade text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT CASE p_unidade WHEN 'cento' THEN 100 WHEN 'milheiro' THEN 1000 ELSE 1 END::numeric
$f$;

-- A conta do preço de venda, num lugar só. Espelho em
-- src/domain/catalogo/preco-de-venda.ts (a prévia ao vivo da tela).
--   preço fixo     → ele mesmo
--   sem custo      → NULL (sob consulta)
--   sem margem     → NULL (sob consulta) — nunca R$ 0,00, nunca o custo
--   senão          → (custo + frete por peça × peças da unidade) × (1 + margem)
--                    arredondado PARA CIMA no passo do catálogo (ou no centavo)
CREATE OR REPLACE FUNCTION public.fornecedor_preco_venda(
  p_custo numeric, p_margem_pct numeric, p_frete_por_peca numeric, p_fator numeric,
  p_arredondamento numeric, p_preco_fixo numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
DECLARE v_base numeric; v_passo numeric;
BEGIN
  IF p_preco_fixo IS NOT NULL THEN RETURN round(p_preco_fixo, 2); END IF;
  IF p_custo IS NULL OR p_margem_pct IS NULL THEN RETURN NULL; END IF;
  v_base := (p_custo + coalesce(p_frete_por_peca, 0) * coalesce(p_fator, 1)) * (1 + p_margem_pct / 100);
  v_passo := coalesce(nullif(p_arredondamento, 0), 0.01);
  -- round(…, 6) antes do ceil: 31,20 não pode virar 31,30 por resto de conta.
  RETURN round(ceil(round(v_base / v_passo, 6)) * v_passo, 2);
END $f$;

-- Texto que vai para o cliente: sem o nome do fornecedor, sem a primeira
-- palavra dele (a marca, "LUGA") e sem o código do item. Rede de segurança:
-- o nome do item já nasce limpo, mas texto de fornecedor novo não passa por
-- revisão antes de chegar ao link.
-- Além do código inteiro, sai cada pedaço dele que tem algarismo: o código
-- "12411 AZUL" aparece no texto como "clique.12411", e o código inteiro nunca
-- casava (medido na carga da LUGA: 3 itens).
CREATE OR REPLACE FUNCTION public.fornecedor_texto_para_cliente(p_texto text, p_fornecedor text, p_codigo text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
DECLARE v text := coalesce(p_texto, ''); v_termo text; v_termos text[];
BEGIN
  v_termos := ARRAY[p_fornecedor, split_part(btrim(coalesce(p_fornecedor, '')), ' ', 1), p_codigo]
           || ARRAY(SELECT t FROM regexp_split_to_table(coalesce(p_codigo, ''), '[^[:alnum:]]+') AS t
                     WHERE length(t) >= 3 AND t ~ '[0-9]');
  FOREACH v_termo IN ARRAY v_termos LOOP
    IF v_termo IS NOT NULL AND length(btrim(v_termo)) >= 3 THEN
      v := regexp_replace(v, '\m' || regexp_replace(btrim(v_termo), '([^[:alnum:][:space:]])', '\\\1', 'g') || '\M',
                          '', 'gi');
    END IF;
  END LOOP;
  v := regexp_replace(v, '\s{2,}', ' ', 'g');
  v := regexp_replace(v, '^[[:space:]\-–—·|,;:]+|[[:space:]\-–—·|,;:]+$', '', 'g');
  RETURN nullif(v, '');
END $f$;

-- Valor em reais no meio de texto que a equipe toda lê ("JOGO SAI R$ 6,55")
-- é custo: sai do texto, fica na tabela de custos.
CREATE OR REPLACE FUNCTION public.fornecedor_sem_valores(p_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT regexp_replace(p_texto, 'R\$\s*[0-9][0-9.,]*', '(valor na tabela)', 'gi')
$f$;

-- O código como a planilha e o nome do arquivo de foto o escrevem varia
-- ("05049" × "5049", "LG C14" × "LGC14"): para casar, só letras e números,
-- em maiúscula e sem zero à esquerda. Igual a normalizarCodigo() no front.
CREATE OR REPLACE FUNCTION public.fornecedor_codigo_normalizado(p_codigo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT nullif(ltrim(upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g')), '0'), '')
$f$;

-- Número de regra ou de planilha: JSON number (ou nulo) dentro da faixa.
CREATE OR REPLACE FUNCTION public.fornecedor_ler_numero(p_valor jsonb, p_minimo numeric, p_maximo numeric, p_campo text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
DECLARE v numeric;
BEGIN
  IF p_valor IS NULL OR jsonb_typeof(p_valor) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_valor) <> 'number' THEN
    RAISE EXCEPTION '% precisa ser um número.', p_campo;
  END IF;
  v := (p_valor #>> '{}')::numeric;
  IF v < p_minimo OR v > p_maximo THEN
    RAISE EXCEPTION '% fora do limite (de % a %).', p_campo, p_minimo, p_maximo;
  END IF;
  RETURN v;
END $f$;

-- A regra que a tela mandou, conferida e normalizada:
--   {catalogo:{margem_pct, frete_por_peca, arredondamento},
--    secoes:{<secao_id>:{margem_pct, frete_por_peca}},
--    itens:{<item_id>:{margem_pct, frete_por_peca, precos_fixos:{<modalidade>: valor}}}}
-- Seção e item têm de ser do catálogo; preço fixo só em modalidade que o item tem.
CREATE OR REPLACE FUNCTION public.fornecedor_normalizar_regras(p_catalogo_id uuid, p_regras jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_cat jsonb := '{}'::jsonb; v_secoes jsonb := '{}'::jsonb; v_itens jsonb := '{}'::jsonb;
  v_chave text; v_valor jsonb; v_mod text; v_preco jsonb;
  v_m numeric; v_f numeric; v_a numeric; v_fixos jsonb; v_n numeric;
BEGIN
  IF p_regras IS NULL OR jsonb_typeof(p_regras) <> 'object' THEN
    RAISE EXCEPTION 'Regra de venda inválida.';
  END IF;

  IF jsonb_typeof(p_regras -> 'catalogo') = 'object' THEN
    v_m := public.fornecedor_ler_numero(p_regras -> 'catalogo' -> 'margem_pct', 0, 1000, 'A margem do catálogo');
    v_f := public.fornecedor_ler_numero(p_regras -> 'catalogo' -> 'frete_por_peca', 0, 9999, 'O frete por peça');
    v_a := public.fornecedor_ler_numero(p_regras -> 'catalogo' -> 'arredondamento', 0, 1, 'O arredondamento');
    IF v_a IS NOT NULL AND v_a NOT IN (0, 0.05, 0.10, 0.50, 1.00) THEN
      RAISE EXCEPTION 'Arredondamento aceita: centavo, R$ 0,05, R$ 0,10, R$ 0,50 ou R$ 1,00.';
    END IF;
    v_cat := jsonb_strip_nulls(jsonb_build_object('margem_pct', v_m, 'frete_por_peca', v_f, 'arredondamento', v_a));
  END IF;

  IF jsonb_typeof(p_regras -> 'secoes') = 'object' THEN
    FOR v_chave, v_valor IN SELECT * FROM jsonb_each(p_regras -> 'secoes') LOOP
      IF v_chave !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.fornecedor_secoes s
                         WHERE s.id = v_chave::uuid AND s.catalogo_id = p_catalogo_id) THEN
        RAISE EXCEPTION 'Seção da regra não é deste catálogo.';
      END IF;
      IF jsonb_typeof(v_valor) <> 'object' THEN RAISE EXCEPTION 'Regra de seção inválida.'; END IF;
      v_m := public.fornecedor_ler_numero(v_valor -> 'margem_pct', 0, 1000, 'A margem da seção');
      v_f := public.fornecedor_ler_numero(v_valor -> 'frete_por_peca', 0, 9999, 'O frete da seção');
      IF v_m IS NOT NULL OR v_f IS NOT NULL THEN
        v_secoes := v_secoes || jsonb_build_object(v_chave,
          jsonb_strip_nulls(jsonb_build_object('margem_pct', v_m, 'frete_por_peca', v_f)));
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(p_regras -> 'itens') = 'object' THEN
    FOR v_chave, v_valor IN SELECT * FROM jsonb_each(p_regras -> 'itens') LOOP
      IF v_chave !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.fornecedor_itens i
                         WHERE i.id = v_chave::uuid AND i.catalogo_id = p_catalogo_id) THEN
        RAISE EXCEPTION 'Item da regra não é deste catálogo.';
      END IF;
      IF jsonb_typeof(v_valor) <> 'object' THEN RAISE EXCEPTION 'Regra de item inválida.'; END IF;
      v_m := public.fornecedor_ler_numero(v_valor -> 'margem_pct', 0, 1000, 'A margem do item');
      v_f := public.fornecedor_ler_numero(v_valor -> 'frete_por_peca', 0, 9999, 'O frete do item');
      v_fixos := '{}'::jsonb;
      IF jsonb_typeof(v_valor -> 'precos_fixos') = 'object' THEN
        FOR v_mod, v_preco IN SELECT * FROM jsonb_each(v_valor -> 'precos_fixos') LOOP
          v_n := public.fornecedor_ler_numero(v_preco, 0, 999999, 'O preço fixo');
          IF v_n IS NULL THEN CONTINUE; END IF;
          IF v_n <= 0 THEN RAISE EXCEPTION 'Preço fixo tem de ser maior que zero.'; END IF;
          IF NOT EXISTS (SELECT 1 FROM public.fornecedor_item_modalidades m
                          WHERE m.item_id = v_chave::uuid AND m.modalidade = v_mod) THEN
            RAISE EXCEPTION 'Preço fixo para uma opção que o item não tem.';
          END IF;
          v_fixos := v_fixos || jsonb_build_object(v_mod, round(v_n, 2));
        END LOOP;
      END IF;
      IF v_m IS NOT NULL OR v_f IS NOT NULL OR v_fixos <> '{}'::jsonb THEN
        v_itens := v_itens || jsonb_build_object(v_chave, jsonb_strip_nulls(jsonb_build_object(
          'margem_pct', v_m, 'frete_por_peca', v_f,
          'precos_fixos', CASE WHEN v_fixos = '{}'::jsonb THEN NULL ELSE v_fixos END)));
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('catalogo', v_cat, 'secoes', v_secoes, 'itens', v_itens);
END $f$;


-- -----------------------------------------------------------------------------
-- 6. O preço de venda de cada item × modalidade — um cálculo só
-- -----------------------------------------------------------------------------
--
-- Precedência: preço fixo do item > margem do item > da seção > do catálogo.
-- Frete: item > seção > catálogo > zero. Arredondamento: o do catálogo.
-- Sob consulta (preço NULL, com o motivo): item fora da tabela, item com a
-- unidade do preço em dúvida, modalidade sem custo, ou nenhuma margem.
-- Com `p_regras` (normalizada), calcula a regra PROPOSTA — é a prévia.
--
-- INTERNA: devolve custo. Quem chama de fora passa por `catalogo_precos`, que
-- entrega as colunas do nível de quem pediu.
CREATE OR REPLACE FUNCTION public.fornecedor_precos_interno(p_catalogo_id uuid, p_regras jsonb DEFAULT NULL)
RETURNS TABLE (
  item_id uuid, modalidade text, posicao smallint, custo numeric, adicional_por_cor numeric,
  margem_pct numeric, frete_por_peca numeric, arredondamento numeric, preco_fixo numeric,
  preco_venda numeric, motivo text, regra text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH regra_catalogo AS (
    SELECT r.margem_pct, r.frete_por_peca, r.arredondamento
      FROM public.fornecedor_regras_venda r
     WHERE p_regras IS NULL AND r.catalogo_id = p_catalogo_id AND r.secao_id IS NULL AND r.item_id IS NULL
    UNION ALL
    SELECT (p_regras #>> '{catalogo,margem_pct}')::numeric,
           (p_regras #>> '{catalogo,frete_por_peca}')::numeric,
           (p_regras #>> '{catalogo,arredondamento}')::numeric
     WHERE p_regras IS NOT NULL
  ),
  regras_secao AS (
    SELECT r.secao_id, r.margem_pct, r.frete_por_peca
      FROM public.fornecedor_regras_venda r
     WHERE p_regras IS NULL AND r.catalogo_id = p_catalogo_id AND r.secao_id IS NOT NULL
    UNION ALL
    SELECT s.chave::uuid, (s.valor ->> 'margem_pct')::numeric, (s.valor ->> 'frete_por_peca')::numeric
      FROM jsonb_each(CASE WHEN p_regras IS NOT NULL THEN coalesce(p_regras -> 'secoes', '{}'::jsonb)
                           ELSE '{}'::jsonb END) AS s(chave, valor)
  ),
  regras_item AS (
    SELECT r.item_id, r.margem_pct, r.frete_por_peca, r.precos_fixos
      FROM public.fornecedor_regras_venda r
     WHERE p_regras IS NULL AND r.catalogo_id = p_catalogo_id AND r.item_id IS NOT NULL
    UNION ALL
    SELECT s.chave::uuid, (s.valor ->> 'margem_pct')::numeric, (s.valor ->> 'frete_por_peca')::numeric,
           s.valor -> 'precos_fixos'
      FROM jsonb_each(CASE WHEN p_regras IS NOT NULL THEN coalesce(p_regras -> 'itens', '{}'::jsonb)
                           ELSE '{}'::jsonb END) AS s(chave, valor)
  ),
  base AS (
    SELECT i.id AS item_id, m.modalidade, m.posicao, c.custo, c.adicional_por_cor,
           i.situacao, i.em_duvida, public.fornecedor_fator_unidade(i.unidade_preco) AS fator,
           (ri.precos_fixos ->> m.modalidade)::numeric AS fixo,
           coalesce(ri.margem_pct, rs.margem_pct, rc.margem_pct) AS margem,
           coalesce(ri.frete_por_peca, rs.frete_por_peca, rc.frete_por_peca, 0) AS frete,
           rc.arredondamento,
           CASE WHEN ri.margem_pct IS NOT NULL THEN 'item'
                WHEN rs.margem_pct IS NOT NULL THEN 'secao'
                WHEN rc.margem_pct IS NOT NULL THEN 'catalogo' END AS origem_margem
      FROM public.fornecedor_itens i
      JOIN public.fornecedor_item_modalidades m ON m.item_id = i.id
      LEFT JOIN public.fornecedor_item_custos c ON c.item_id = m.item_id AND c.modalidade = m.modalidade
      LEFT JOIN regra_catalogo rc ON true
      LEFT JOIN regras_secao rs ON rs.secao_id = i.secao_id
      LEFT JOIN regras_item ri ON ri.item_id = i.id
     WHERE i.catalogo_id = p_catalogo_id
  ),
  com_motivo AS (
    SELECT b.*,
           CASE WHEN b.situacao = 'fora_da_tabela' THEN 'fora_da_tabela'
                WHEN b.em_duvida THEN 'em_duvida'
                WHEN b.fixo IS NOT NULL THEN NULL
                WHEN b.custo IS NULL THEN 'sem_custo'
                WHEN b.margem IS NULL THEN 'sem_regra'
           END AS motivo
      FROM base b
  )
  SELECT x.item_id, x.modalidade, x.posicao, x.custo, x.adicional_por_cor,
         x.margem, x.frete, x.arredondamento, x.fixo,
         CASE WHEN x.motivo IS NULL
              THEN public.fornecedor_preco_venda(x.custo, x.margem, x.frete, x.fator, x.arredondamento, x.fixo)
         END,
         x.motivo,
         CASE WHEN x.motivo IS NOT NULL THEN NULL
              WHEN x.fixo IS NOT NULL THEN 'preco_fixo'
              ELSE x.origem_margem END
    FROM com_motivo x
$f$;


-- -----------------------------------------------------------------------------
-- 7. Funções da tela (authenticated, cada uma confere a própria permissão)
-- -----------------------------------------------------------------------------

-- /catalogos: fornecedores e catálogos, com as contagens. "Sem preço de venda"
-- conta item que não tem NENHUMA modalidade com preço (é contagem, não valor).
CREATE OR REPLACE FUNCTION public.catalogo_resumo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_precos boolean; v_res jsonb;
BEGIN
  v_uid := public.require_permission('catalogo.read');
  v_precos := public.can_see_prices(v_uid);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'nome', f.nome, 'site', f.site, 'telefone', f.telefone, 'ativo', f.ativo,
           'catalogos', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', c.id, 'titulo', c.titulo, 'edicao', c.edicao, 'ativo', c.ativo,
                      'importado_em', c.importado_em, 'sincronizado_em', c.sincronizado_em,
                      'itens', k.itens, 'na_tabela', k.na_tabela, 'fora_da_tabela', k.fora,
                      'com_foto', k.com_foto, 'sem_foto', k.itens - k.com_foto,
                      'foto_a_apontar', k.apontar, 'em_duvida', k.duvida,
                      'sem_preco_de_venda', CASE WHEN v_precos THEN k.itens - (
                          SELECT count(DISTINCT p.item_id) FROM public.fornecedor_precos_interno(c.id) p
                           WHERE p.preco_venda IS NOT NULL) END)
                    ORDER BY c.created_at)
               FROM public.fornecedor_catalogos c
               CROSS JOIN LATERAL (
                 SELECT count(*) AS itens,
                        count(*) FILTER (WHERE i.situacao = 'ativo') AS na_tabela,
                        count(*) FILTER (WHERE i.situacao = 'fora_da_tabela') AS fora,
                        count(*) FILTER (WHERE i.tem_foto) AS com_foto,
                        count(*) FILTER (WHERE i.foto_conferir AND NOT i.tem_foto) AS apontar,
                        count(*) FILTER (WHERE i.em_duvida) AS duvida
                   FROM public.fornecedor_itens i WHERE i.catalogo_id = c.id) k
              WHERE c.fornecedor_id = f.id), '[]'::jsonb))
         ORDER BY f.nome), '[]'::jsonb)
    INTO v_res
    FROM public.fornecedores f;
  RETURN jsonb_build_object('ve_preco', v_precos, 'fornecedores', v_res);
END $f$;

-- Os preços de um catálogo, no nível de quem pediu:
--   comercial  {modalidade, preco, motivo, regra}
--   financeiro + custo, adicional_por_cor, margem_pct, frete_por_peca, preco_fixo
-- Um objeto só (item_id → lista), para não esbarrar no corte de 1.000 linhas.
CREATE OR REPLACE FUNCTION public.catalogo_precos(p_catalogo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_fin boolean; v_res jsonb;
BEGIN
  v_uid := public.require_permission('catalogo.read');
  IF NOT public.can_see_prices(v_uid) THEN
    RAISE EXCEPTION 'Preço de venda é de quem vê preço.';
  END IF;
  v_fin := public.can_see_financials(v_uid);
  SELECT coalesce(jsonb_object_agg(x.item_id, x.lista), '{}'::jsonb) INTO v_res
    FROM (SELECT p.item_id,
                 jsonb_agg(CASE WHEN v_fin THEN
                     jsonb_build_object('modalidade', p.modalidade, 'preco', p.preco_venda,
                                        'motivo', p.motivo, 'regra', p.regra, 'custo', p.custo,
                                        'adicional_por_cor', p.adicional_por_cor,
                                        'margem_pct', p.margem_pct, 'frete_por_peca', p.frete_por_peca,
                                        'preco_fixo', p.preco_fixo)
                   ELSE
                     jsonb_build_object('modalidade', p.modalidade, 'preco', p.preco_venda,
                                        'motivo', p.motivo, 'regra', p.regra)
                   END ORDER BY p.posicao) AS lista
            FROM public.fornecedor_precos_interno(p_catalogo_id) p
           GROUP BY p.item_id) x;
  RETURN jsonb_build_object('nivel', CASE WHEN v_fin THEN 'financeiro' ELSE 'comercial' END,
                            'precos', v_res);
END $f$;

-- Prévia da regra: o que muda se gravar, com exemplos antes/depois. Não grava.
CREATE OR REPLACE FUNCTION public.catalogo_previa_regras(p_catalogo_id uuid, p_regras jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_regras jsonb; v_res jsonb;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT public.can_see_financials(v_uid) THEN
    RAISE EXCEPTION 'A regra de venda é margem sobre o custo: é de quem vê o financeiro.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fornecedor_catalogos WHERE id = p_catalogo_id) THEN
    RAISE EXCEPTION 'Catálogo não encontrado.';
  END IF;
  v_regras := public.fornecedor_normalizar_regras(p_catalogo_id, p_regras);

  WITH antes AS (SELECT * FROM public.fornecedor_precos_interno(p_catalogo_id, NULL)),
       depois AS (SELECT * FROM public.fornecedor_precos_interno(p_catalogo_id, v_regras)),
       par AS (
         SELECT d.item_id, d.modalidade, d.custo, a.preco_venda AS antes, d.preco_venda AS depois
           FROM depois d JOIN antes a ON a.item_id = d.item_id AND a.modalidade = d.modalidade),
       mudou AS (SELECT * FROM par WHERE antes IS DISTINCT FROM depois)
  SELECT jsonb_build_object(
           'modalidades', (SELECT count(*) FROM par),
           'com_preco_antes', (SELECT count(*) FROM par WHERE antes IS NOT NULL),
           'com_preco_depois', (SELECT count(*) FROM par WHERE depois IS NOT NULL),
           'itens_com_preco_antes', (SELECT count(DISTINCT item_id) FROM par WHERE antes IS NOT NULL),
           'itens_com_preco_depois', (SELECT count(DISTINCT item_id) FROM par WHERE depois IS NOT NULL),
           'mudam', (SELECT count(*) FROM mudou),
           'itens_que_mudam', (SELECT count(DISTINCT item_id) FROM mudou),
           'sobem', (SELECT count(*) FROM mudou WHERE antes IS NOT NULL AND depois > antes),
           'descem', (SELECT count(*) FROM mudou WHERE antes IS NOT NULL AND depois < antes),
           'passam_a_ter_preco', (SELECT count(*) FROM mudou WHERE antes IS NULL),
           'ficam_sob_consulta', (SELECT count(*) FROM mudou WHERE depois IS NULL),
           'exemplos', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'item_id', e.item_id, 'codigo_bex', i.codigo_bex, 'nome', i.nome,
                      'modalidade', e.modalidade, 'unidade_preco', i.unidade_preco,
                      'custo', e.custo, 'antes', e.antes, 'depois', e.depois)
                    ORDER BY e.ordem_exemplo)
               FROM (SELECT m.*, row_number() OVER (
                              ORDER BY (m.antes IS NULL) DESC,
                                       abs(coalesce(m.depois, 0) - coalesce(m.antes, 0)) DESC,
                                       m.item_id, m.modalidade) AS ordem_exemplo
                       FROM mudou m) e
               JOIN public.fornecedor_itens i ON i.id = e.item_id
              WHERE e.ordem_exemplo <= 12), '[]'::jsonb))
    INTO v_res;
  RETURN v_res;
END $f$;

-- Grava a regra (troca a do catálogo inteira pela que veio da tela).
CREATE OR REPLACE FUNCTION public.catalogo_salvar_regras(p_catalogo_id uuid, p_regras jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_regras jsonb; v_com_preco integer; v_secoes integer; v_itens integer;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT public.can_see_financials(v_uid) THEN
    RAISE EXCEPTION 'A regra de venda é margem sobre o custo: é de quem vê o financeiro.';
  END IF;
  PERFORM 1 FROM public.fornecedor_catalogos WHERE id = p_catalogo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catálogo não encontrado.'; END IF;
  v_regras := public.fornecedor_normalizar_regras(p_catalogo_id, p_regras);

  DELETE FROM public.fornecedor_regras_venda WHERE catalogo_id = p_catalogo_id;
  IF v_regras -> 'catalogo' <> '{}'::jsonb THEN
    INSERT INTO public.fornecedor_regras_venda (catalogo_id, margem_pct, frete_por_peca, arredondamento, atualizado_por)
    VALUES (p_catalogo_id, (v_regras #>> '{catalogo,margem_pct}')::numeric,
            (v_regras #>> '{catalogo,frete_por_peca}')::numeric,
            (v_regras #>> '{catalogo,arredondamento}')::numeric, v_uid);
  END IF;
  INSERT INTO public.fornecedor_regras_venda (catalogo_id, secao_id, margem_pct, frete_por_peca, atualizado_por)
  SELECT p_catalogo_id, s.chave::uuid, (s.valor ->> 'margem_pct')::numeric,
         (s.valor ->> 'frete_por_peca')::numeric, v_uid
    FROM jsonb_each(v_regras -> 'secoes') AS s(chave, valor);
  GET DIAGNOSTICS v_secoes = ROW_COUNT;
  INSERT INTO public.fornecedor_regras_venda (catalogo_id, item_id, margem_pct, frete_por_peca, precos_fixos, atualizado_por)
  SELECT p_catalogo_id, s.chave::uuid, (s.valor ->> 'margem_pct')::numeric,
         (s.valor ->> 'frete_por_peca')::numeric, s.valor -> 'precos_fixos', v_uid
    FROM jsonb_each(v_regras -> 'itens') AS s(chave, valor);
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  SELECT count(DISTINCT p.item_id) INTO v_com_preco
    FROM public.fornecedor_precos_interno(p_catalogo_id) p WHERE p.preco_venda IS NOT NULL;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'fornecedor_regras_venda', p_catalogo_id, 'salvar_regra_de_venda',
          jsonb_build_object('catalogo_id', p_catalogo_id, 'tem_regra_do_catalogo', v_regras -> 'catalogo' <> '{}'::jsonb,
                             'excecoes_de_secao', v_secoes, 'excecoes_de_item', v_itens,
                             'itens_com_preco', v_com_preco));

  RETURN jsonb_build_object('ok', true, 'excecoes_de_secao', v_secoes, 'excecoes_de_item', v_itens,
                            'itens_com_preco', v_com_preco);
END $f$;

-- Sincronização: aplica o plano que a tela montou a partir da planilha (o
-- casamento linha × item é da tela, testado em src/domain/catalogo/importacao.ts;
-- aqui se confere e se grava). Item que sumiu da planilha vira "fora da
-- tabela" — nunca é apagado. Toda mudança de custo deixa histórico.
CREATE OR REPLACE FUNCTION public.catalogo_importar(p_catalogo_id uuid, p_plano jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_uid uuid; v_secoes jsonb; v_itens jsonb; v_s jsonb; v_i jsonb; v_m jsonb;
  v_mapa jsonb := '{}'::jsonb; v_secao_id uuid; v_item_id uuid; v_import uuid;
  v_edicao text; v_arquivo text; v_notas jsonb;
  v_novos integer := 0; v_subiram integer := 0; v_desceram integer := 0; v_outras integer := 0;
  v_iguais integer := 0; v_voltaram integer := 0; v_sairam integer := 0;
  v_vistos uuid[] := '{}'; v_antes text; v_sobe boolean; v_desce boolean; v_outra boolean;
  v_mods text[]; v_mod text; v_custo_antigo numeric; v_custo_novo numeric; v_ordem integer := 0;
  v_unidade text; v_codigo text; v_descricao text; v_posicao integer;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT public.can_see_financials(v_uid) THEN
    RAISE EXCEPTION 'A planilha do fornecedor é custo: sincronizar é de quem vê o financeiro.';
  END IF;
  PERFORM 1 FROM public.fornecedor_catalogos WHERE id = p_catalogo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catálogo não encontrado.'; END IF;
  IF p_plano IS NULL OR jsonb_typeof(p_plano) <> 'object' THEN RAISE EXCEPTION 'Planilha inválida.'; END IF;
  v_secoes := coalesce(p_plano -> 'secoes', '[]'::jsonb);
  v_itens := coalesce(p_plano -> 'itens', '[]'::jsonb);
  IF jsonb_typeof(v_secoes) <> 'array' OR jsonb_typeof(v_itens) <> 'array' THEN
    RAISE EXCEPTION 'Planilha inválida.';
  END IF;
  IF jsonb_array_length(v_itens) = 0 THEN RAISE EXCEPTION 'A planilha não tem nenhum item.'; END IF;
  IF jsonb_array_length(v_itens) > 5000 OR jsonb_array_length(v_secoes) > 500 THEN
    RAISE EXCEPTION 'Planilha grande demais: até 5.000 itens e 500 seções por vez.';
  END IF;
  v_edicao := left(nullif(btrim(p_plano ->> 'edicao'), ''), 200);
  v_arquivo := left(nullif(btrim(p_plano ->> 'arquivo'), ''), 200);
  v_notas := CASE WHEN jsonb_typeof(p_plano -> 'notas') = 'array' THEN p_plano -> 'notas' ELSE '[]'::jsonb END;
  IF jsonb_array_length(v_notas) > 200 THEN v_notas := '[]'::jsonb; END IF;

  INSERT INTO public.fornecedor_importacoes (catalogo_id, tipo, edicao, arquivo, notas, feito_por)
  VALUES (p_catalogo_id, 'sincronizacao', v_edicao, v_arquivo, v_notas, v_uid)
  RETURNING id INTO v_import;

  FOR v_s IN SELECT * FROM jsonb_array_elements(v_secoes) LOOP
    IF length(btrim(coalesce(v_s ->> 'titulo', ''))) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'Seção sem título na planilha.';
    END IF;
    IF coalesce(v_s ->> 'secao_id', '') <> '' THEN
      UPDATE public.fornecedor_secoes
         SET ordem = coalesce((v_s ->> 'ordem')::integer, ordem),
             titulo = btrim(v_s ->> 'titulo'),
             especificacao = left(public.fornecedor_sem_valores(nullif(btrim(v_s ->> 'especificacao'), '')), 4000)
       WHERE id = (v_s ->> 'secao_id')::uuid AND catalogo_id = p_catalogo_id
      RETURNING id INTO v_secao_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Uma seção da planilha não é deste catálogo.'; END IF;
    ELSE
      INSERT INTO public.fornecedor_secoes (catalogo_id, ordem, titulo, especificacao)
      VALUES (p_catalogo_id, coalesce((v_s ->> 'ordem')::integer, 0), btrim(v_s ->> 'titulo'),
              left(public.fornecedor_sem_valores(nullif(btrim(v_s ->> 'especificacao'), '')), 4000))
      RETURNING id INTO v_secao_id;
    END IF;
    v_mapa := v_mapa || jsonb_build_object(coalesce(v_s ->> 'ref', ''), v_secao_id);
  END LOOP;

  FOR v_i IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_ordem := v_ordem + 1;
    v_codigo := btrim(coalesce(v_i ->> 'codigo_fornecedor', ''));
    v_descricao := left(public.fornecedor_sem_valores(btrim(coalesce(v_i ->> 'descricao', ''))), 1000);
    IF length(v_codigo) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Linha % da planilha sem código do fornecedor.', v_ordem;
    END IF;
    IF v_descricao = '' THEN RAISE EXCEPTION 'Linha % da planilha sem descrição.', v_ordem; END IF;
    v_unidade := coalesce(nullif(v_i ->> 'unidade_preco', ''), 'unidade');
    IF v_unidade NOT IN ('unidade', 'cento', 'milheiro', 'caixa', 'rolo', 'folha', 'pacote') THEN
      RAISE EXCEPTION 'Linha %: unidade de preço "%" não existe.', v_ordem, v_unidade;
    END IF;
    v_secao_id := nullif(v_mapa ->> coalesce(v_i ->> 'secao_ref', '-'), '')::uuid;

    IF coalesce(v_i ->> 'item_id', '') <> '' THEN
      v_item_id := (v_i ->> 'item_id')::uuid;
      IF v_item_id = ANY (v_vistos) THEN
        RAISE EXCEPTION 'Linha %: o mesmo item do catálogo casou com duas linhas.', v_ordem;
      END IF;
      SELECT situacao INTO v_antes FROM public.fornecedor_itens
       WHERE id = v_item_id AND catalogo_id = p_catalogo_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Linha %: item que não é deste catálogo.', v_ordem; END IF;
      -- Nome, especificação e foto são da equipe: a planilha não mexe.
      UPDATE public.fornecedor_itens
         SET secao_id = v_secao_id, codigo_fornecedor = v_codigo, descricao = v_descricao,
             dimensoes = left(nullif(btrim(v_i ->> 'dimensoes'), ''), 200),
             embalagem = left(nullif(btrim(v_i ->> 'embalagem'), ''), 200),
             unidade_preco = v_unidade,
             quantidade_minima = public.fornecedor_ler_numero(v_i -> 'quantidade_minima', 0.01, 1000000, 'Quantidade mínima'),
             multiplo = public.fornecedor_ler_numero(v_i -> 'multiplo', 0.01, 1000000, 'Múltiplo'),
             quantidade_minima_gravada = public.fornecedor_ler_numero(v_i -> 'quantidade_minima_gravada', 0.01, 1000000, 'Mínimo gravado'),
             e_embalagem = coalesce((v_i ->> 'e_embalagem')::boolean, false),
             observacao = left(public.fornecedor_sem_valores(nullif(btrim(v_i ->> 'observacao'), '')), 1000),
             pagina = (v_i ->> 'pagina')::integer, linha = (v_i ->> 'linha')::integer,
             ordem = v_ordem, situacao = 'ativo', fora_desde = NULL
       WHERE id = v_item_id;
    ELSE
      v_antes := NULL;
      -- Plano velho (prévia aberta antes de outra sincronização, clique duplo
      -- em "Aplicar"): a linha "nova" já existe no catálogo. Recusa em vez de
      -- criar o item em dobro.
      IF EXISTS (SELECT 1 FROM public.fornecedor_itens x
                  WHERE x.catalogo_id = p_catalogo_id
                    AND public.fornecedor_codigo_normalizado(x.codigo_fornecedor)
                        = public.fornecedor_codigo_normalizado(v_codigo)
                    AND lower(btrim(x.descricao)) = lower(v_descricao)
                    AND NOT (x.id = ANY (v_vistos))) THEN
        RAISE EXCEPTION 'Linha %: o item % já existe neste catálogo e a prévia ficou velha. Abra a planilha de novo.',
          v_ordem, v_codigo;
      END IF;
      INSERT INTO public.fornecedor_itens (
        catalogo_id, secao_id, codigo_fornecedor, descricao, nome, dimensoes, embalagem, unidade_preco,
        quantidade_minima, multiplo, quantidade_minima_gravada, e_embalagem, observacao, pagina, linha, ordem)
      VALUES (
        p_catalogo_id, v_secao_id, v_codigo, v_descricao,
        left(coalesce(nullif(btrim(v_i ->> 'nome'), ''), initcap(lower(v_descricao))), 300),
        left(nullif(btrim(v_i ->> 'dimensoes'), ''), 200), left(nullif(btrim(v_i ->> 'embalagem'), ''), 200),
        v_unidade,
        public.fornecedor_ler_numero(v_i -> 'quantidade_minima', 0.01, 1000000, 'Quantidade mínima'),
        public.fornecedor_ler_numero(v_i -> 'multiplo', 0.01, 1000000, 'Múltiplo'),
        public.fornecedor_ler_numero(v_i -> 'quantidade_minima_gravada', 0.01, 1000000, 'Mínimo gravado'),
        coalesce((v_i ->> 'e_embalagem')::boolean, false),
        left(public.fornecedor_sem_valores(nullif(btrim(v_i ->> 'observacao'), '')), 1000),
        (v_i ->> 'pagina')::integer, (v_i ->> 'linha')::integer, v_ordem)
      RETURNING id INTO v_item_id;
      v_novos := v_novos + 1;
    END IF;
    v_vistos := v_vistos || v_item_id;

    v_sobe := false; v_desce := false; v_outra := false; v_mods := '{}'; v_posicao := 0;
    FOR v_m IN SELECT * FROM jsonb_array_elements(coalesce(v_i -> 'modalidades', '[]'::jsonb)) LOOP
      v_mod := v_m ->> 'modalidade';
      IF v_mod IS NULL OR v_mod NOT IN ('sem_gravacao', 'valor_unico', 'gravada_1_cor', 'gravada_mais_pagina',
           'gravacao_laser', 'baixo_relevo', 'gravada_100_199', 'gravada_acima_1000', 'com_gravacao', 'transfer_giro') THEN
        RAISE EXCEPTION 'Linha %: opção de preço desconhecida.', v_ordem;
      END IF;
      IF v_mod = ANY (v_mods) THEN RAISE EXCEPTION 'Linha %: a mesma opção de preço duas vezes.', v_ordem; END IF;
      v_mods := v_mods || v_mod;
      v_posicao := v_posicao + 1;
      v_custo_novo := public.fornecedor_ler_numero(v_m -> 'custo', 0, 999999, format('Linha %s: o custo', v_ordem));
      INSERT INTO public.fornecedor_item_modalidades (item_id, modalidade, posicao, quantidade_minima, multiplo, faixa, faixa_max, rotulo_inferido)
      VALUES (v_item_id, v_mod, v_posicao,
              public.fornecedor_ler_numero(v_m -> 'quantidade_minima', 0.01, 1000000, 'Quantidade mínima da opção'),
              public.fornecedor_ler_numero(v_m -> 'multiplo', 0.01, 1000000, 'Múltiplo da opção'),
              left(nullif(btrim(v_m ->> 'faixa'), ''), 120),
              public.fornecedor_ler_numero(v_m -> 'faixa_max', 0.01, 100000000, 'Fim da faixa'),
              coalesce((v_m ->> 'rotulo_inferido')::boolean, false))
      ON CONFLICT (item_id, modalidade) DO UPDATE
        SET posicao = EXCLUDED.posicao, quantidade_minima = EXCLUDED.quantidade_minima,
            multiplo = EXCLUDED.multiplo, faixa = EXCLUDED.faixa, faixa_max = EXCLUDED.faixa_max,
            rotulo_inferido = EXCLUDED.rotulo_inferido;

      SELECT c.custo INTO v_custo_antigo FROM public.fornecedor_item_custos c
       WHERE c.item_id = v_item_id AND c.modalidade = v_mod;
      IF NOT FOUND THEN v_custo_antigo := NULL; END IF;
      IF v_custo_novo IS NULL THEN
        DELETE FROM public.fornecedor_item_custos WHERE item_id = v_item_id AND modalidade = v_mod;
      ELSE
        INSERT INTO public.fornecedor_item_custos (item_id, modalidade, custo, adicional_por_cor, edicao, atualizado_em)
        VALUES (v_item_id, v_mod, round(v_custo_novo, 4),
                public.fornecedor_ler_numero(v_m -> 'adicional_por_cor', 0, 999999, 'Adicional por cor'),
                v_edicao, now())
        ON CONFLICT (item_id, modalidade) DO UPDATE
          SET custo = EXCLUDED.custo, adicional_por_cor = EXCLUDED.adicional_por_cor,
              edicao = CASE WHEN public.fornecedor_item_custos.custo IS DISTINCT FROM EXCLUDED.custo
                            THEN EXCLUDED.edicao ELSE public.fornecedor_item_custos.edicao END,
              atualizado_em = CASE WHEN public.fornecedor_item_custos.custo IS DISTINCT FROM EXCLUDED.custo
                                   THEN now() ELSE public.fornecedor_item_custos.atualizado_em END;
      END IF;
      v_custo_novo := round(v_custo_novo, 4);
      IF v_custo_antigo IS DISTINCT FROM v_custo_novo THEN
        INSERT INTO public.fornecedor_item_custos_historico (item_id, modalidade, custo_anterior, custo_novo, edicao, importacao_id, alterado_por)
        VALUES (v_item_id, v_mod, v_custo_antigo, v_custo_novo, v_edicao, v_import, v_uid);
        IF v_antes IS NOT NULL THEN
          IF v_custo_antigo IS NULL OR v_custo_novo IS NULL THEN v_outra := true;
          ELSIF v_custo_novo > v_custo_antigo THEN v_sobe := true;
          ELSE v_desce := true; END IF;
        END IF;
      END IF;
    END LOOP;

    -- Opção que saiu da planilha: o custo dela vai para o histórico antes de sair.
    INSERT INTO public.fornecedor_item_custos_historico (item_id, modalidade, custo_anterior, custo_novo, edicao, importacao_id, alterado_por)
    SELECT v_item_id, c.modalidade, c.custo, NULL, v_edicao, v_import, v_uid
      FROM public.fornecedor_item_custos c
     WHERE c.item_id = v_item_id AND NOT (c.modalidade = ANY (v_mods));
    IF FOUND AND v_antes IS NOT NULL THEN v_outra := true; END IF;
    DELETE FROM public.fornecedor_item_modalidades WHERE item_id = v_item_id AND NOT (modalidade = ANY (v_mods));

    IF v_antes IS NULL THEN NULL;  -- novo, já contado
    ELSIF v_antes = 'fora_da_tabela' THEN v_voltaram := v_voltaram + 1;
    ELSIF v_sobe THEN v_subiram := v_subiram + 1;
    ELSIF v_desce THEN v_desceram := v_desceram + 1;
    ELSIF v_outra THEN v_outras := v_outras + 1;
    ELSE v_iguais := v_iguais + 1;
    END IF;
  END LOOP;

  UPDATE public.fornecedor_itens
     SET situacao = 'fora_da_tabela', fora_desde = now()
   WHERE catalogo_id = p_catalogo_id AND situacao = 'ativo' AND NOT (id = ANY (v_vistos));
  GET DIAGNOSTICS v_sairam = ROW_COUNT;

  UPDATE public.fornecedor_importacoes
     SET novos = v_novos, subiram = v_subiram, desceram = v_desceram, outras_mudancas = v_outras,
         sairam = v_sairam, voltaram = v_voltaram, iguais = v_iguais
   WHERE id = v_import;
  UPDATE public.fornecedor_catalogos
     SET edicao = coalesce(v_edicao, edicao), arquivo_origem = coalesce(v_arquivo, arquivo_origem),
         sincronizado_em = now()
   WHERE id = p_catalogo_id;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'fornecedor_catalogos', p_catalogo_id, 'sincronizar_catalogo',
          jsonb_build_object('importacao_id', v_import, 'edicao', v_edicao, 'arquivo', v_arquivo,
                             'novos', v_novos, 'subiram', v_subiram, 'desceram', v_desceram,
                             'outras_mudancas', v_outras, 'sairam', v_sairam, 'voltaram', v_voltaram,
                             'iguais', v_iguais));

  RETURN jsonb_build_object('ok', true, 'importacao_id', v_import, 'novos', v_novos, 'subiram', v_subiram,
                            'desceram', v_desceram, 'outras_mudancas', v_outras, 'sairam', v_sairam,
                            'voltaram', v_voltaram, 'iguais', v_iguais);
END $f$;

-- Fotos enviadas em lote para o bucket `catalogo-fotos` (nome do arquivo =
-- código do fornecedor, na tela): o banco confere que cada arquivo chegou,
-- guarda no acervo e aponta nos itens do código — só nos que estão sem foto,
-- ou em todos quando `p_substituir`.
CREATE OR REPLACE FUNCTION public.catalogo_registrar_fotos(p_catalogo_id uuid, p_fotos jsonb, p_substituir boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_uid uuid; v_f jsonb; v_caminho text; v_codigo text; v_meta jsonb; v_foto uuid;
  v_fotos integer := 0; v_apontados integer := 0; v_n integer; v_sem_item text[] := '{}';
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT EXISTS (SELECT 1 FROM public.fornecedor_catalogos WHERE id = p_catalogo_id) THEN
    RAISE EXCEPTION 'Catálogo não encontrado.';
  END IF;
  IF p_fotos IS NULL OR jsonb_typeof(p_fotos) <> 'array' OR jsonb_array_length(p_fotos) = 0 THEN
    RAISE EXCEPTION 'Nenhuma foto para registrar.';
  END IF;
  IF jsonb_array_length(p_fotos) > 300 THEN RAISE EXCEPTION 'Até 300 fotos por vez.'; END IF;

  FOR v_f IN SELECT * FROM jsonb_array_elements(p_fotos) LOOP
    v_caminho := v_f ->> 'caminho';
    v_codigo := left(btrim(coalesce(v_f ->> 'codigo_fornecedor', '')), 60);
    IF v_caminho IS NULL OR left(v_caminho, 37) <> p_catalogo_id::text || '/'
       OR v_caminho !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg|png)$' THEN
      RAISE EXCEPTION 'Caminho de foto inválido.';
    END IF;
    IF v_codigo = '' THEN RAISE EXCEPTION 'Foto sem o código do fornecedor.'; END IF;
    SELECT o.metadata INTO v_meta FROM storage.objects o
     WHERE o.bucket_id = 'catalogo-fotos' AND o.name = v_caminho;
    IF NOT FOUND THEN RAISE EXCEPTION 'A foto % não chegou ao armazenamento. Envie de novo.', v_codigo; END IF;

    INSERT INTO public.fornecedor_fotos (catalogo_id, codigo_fornecedor, legenda, origem, caminho, bytes, criado_por)
    VALUES (p_catalogo_id, v_codigo, NULL, 'storage', v_caminho, nullif(v_meta ->> 'size', '')::integer, v_uid)
    RETURNING id INTO v_foto;
    v_fotos := v_fotos + 1;

    UPDATE public.fornecedor_itens i
       SET foto_id = v_foto, foto_conferir = false
     WHERE i.catalogo_id = p_catalogo_id
       AND public.fornecedor_codigo_normalizado(i.codigo_fornecedor) = public.fornecedor_codigo_normalizado(v_codigo)
       AND (p_substituir OR i.foto_id IS NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_apontados := v_apontados + v_n;
    IF NOT EXISTS (SELECT 1 FROM public.fornecedor_itens i
                    WHERE i.catalogo_id = p_catalogo_id
                      AND public.fornecedor_codigo_normalizado(i.codigo_fornecedor)
                          = public.fornecedor_codigo_normalizado(v_codigo)) THEN
      v_sem_item := v_sem_item || v_codigo;
    END IF;
  END LOOP;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'fornecedor_fotos', p_catalogo_id, 'registrar_fotos',
          jsonb_build_object('fotos', v_fotos, 'itens_apontados', v_apontados, 'substituir', p_substituir));

  RETURN jsonb_build_object('ok', true, 'fotos', v_fotos, 'itens_apontados', v_apontados,
                            'codigos_sem_item', to_jsonb(v_sem_item));
END $f$;

-- Apontar a foto de um item (uma do acervo do mesmo catálogo), ou tirar.
CREATE OR REPLACE FUNCTION public.catalogo_apontar_foto(p_item_id uuid, p_foto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_catalogo uuid;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  SELECT catalogo_id INTO v_catalogo FROM public.fornecedor_itens WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do catálogo não encontrado.'; END IF;
  IF p_foto_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.fornecedor_fotos WHERE id = p_foto_id AND catalogo_id = v_catalogo) THEN
    RAISE EXCEPTION 'Essa foto não é deste catálogo.';
  END IF;
  UPDATE public.fornecedor_itens SET foto_id = p_foto_id, foto_conferir = false WHERE id = p_item_id;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'fornecedor_itens', p_item_id, 'apontar_foto', jsonb_build_object('foto_id', p_foto_id));
  RETURN jsonb_build_object('ok', true, 'tem_foto', p_foto_id IS NOT NULL);
END $f$;

-- A dúvida da unidade do preço (pacote × peça) foi confirmada com o fornecedor.
CREATE OR REPLACE FUNCTION public.catalogo_resolver_duvida(p_item_id uuid, p_unidade_preco text, p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 500);
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT public.can_see_financials(v_uid) THEN
    RAISE EXCEPTION 'A unidade do preço mexe no custo: é de quem vê o financeiro.';
  END IF;
  IF p_unidade_preco IS NOT NULL
     AND p_unidade_preco NOT IN ('unidade', 'cento', 'milheiro', 'caixa', 'rolo', 'folha', 'pacote') THEN
    RAISE EXCEPTION 'Unidade de preço inválida.';
  END IF;
  IF v_nota IS NULL THEN RAISE EXCEPTION 'Diga o que o fornecedor confirmou.'; END IF;
  UPDATE public.fornecedor_itens
     SET em_duvida = false, unidade_preco = coalesce(p_unidade_preco, unidade_preco),
         duvida = left(coalesce(duvida || ' — ', '') || 'Resolvida: ' || v_nota, 1500)
   WHERE id = p_item_id AND em_duvida;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado ou sem dúvida em aberto.'; END IF;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'fornecedor_itens', p_item_id, 'resolver_duvida',
          jsonb_build_object('unidade_preco', p_unidade_preco, 'nota', v_nota));
  RETURN jsonb_build_object('ok', true);
END $f$;

-- "Adicionar ao orçamento": o item entra no orçamento em RASCUNHO (um que já
-- existe ou um novo para o cliente) pelo mesmo INSERT em `orcamento_itens` da
-- tela — os gatilhos de preço e de total valem igual. O CUSTO é gravado aqui,
-- no servidor: o vendedor não vê custo, e o defeito conhecido era justamente
-- custo zero em todo item de orçamento (15 de 15).
CREATE OR REPLACE FUNCTION public.catalogo_adicionar_ao_orcamento(
  p_item_id uuid, p_modalidade text, p_quantidade numeric,
  p_orcamento_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL, p_titulo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_uid uuid; v_item record; v_mod record; v_preco record; v_status text;
  v_fator numeric; v_qtd numeric := p_quantidade; v_unit numeric; v_custo_unit numeric; v_unidade text;
  v_rotulo text; v_descricao text; v_ordem integer; v_novo uuid; v_orc uuid; v_numero integer;
  v_avisos text[] := '{}'; v_total numeric;
BEGIN
  v_uid := public.require_permission('catalogo.read');
  IF NOT public.has_permission(v_uid, 'orcamentos.update') THEN
    RAISE EXCEPTION 'Permissão necessária: orcamentos.update';
  END IF;
  IF NOT public.can_see_prices(v_uid) THEN
    RAISE EXCEPTION 'Para pôr item no orçamento é preciso ver o preço de venda.';
  END IF;
  IF v_qtd IS NULL OR v_qtd <= 0 OR v_qtd > 1000000 OR v_qtd <> trunc(v_qtd) THEN
    RAISE EXCEPTION 'Informe a quantidade em peças inteiras (maior que zero).';
  END IF;

  SELECT i.*, f.nome AS fornecedor_nome INTO v_item
    FROM public.fornecedor_itens i
    JOIN public.fornecedor_catalogos c ON c.id = i.catalogo_id
    JOIN public.fornecedores f ON f.id = c.fornecedor_id
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do catálogo não encontrado.'; END IF;
  SELECT * INTO v_mod FROM public.fornecedor_item_modalidades m
   WHERE m.item_id = p_item_id AND m.modalidade = p_modalidade;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este item não tem essa opção de preço.'; END IF;
  v_rotulo := public.fornecedor_rotulo_modalidade(p_modalidade);

  SELECT * INTO v_preco FROM public.fornecedor_precos_interno(v_item.catalogo_id) p
   WHERE p.item_id = p_item_id AND p.modalidade = p_modalidade;
  IF v_preco.preco_venda IS NULL THEN
    RAISE EXCEPTION '%', CASE v_preco.motivo
      WHEN 'fora_da_tabela' THEN 'Este item saiu da tabela do fornecedor: está sob consulta.'
      WHEN 'em_duvida' THEN 'A unidade do preço deste item está em dúvida com o fornecedor: sob consulta até alguém confirmar.'
      WHEN 'sem_custo' THEN 'Esta opção não tem custo na tabela do fornecedor: está sob consulta.'
      ELSE 'Este catálogo ainda não tem regra de venda: o item está sob consulta. Peça à gestão para definir a margem.'
    END;
  END IF;
  IF v_mod.quantidade_minima IS NOT NULL AND v_qtd < v_mod.quantidade_minima THEN
    RAISE EXCEPTION 'A quantidade mínima de "%" é % peças.', v_rotulo, trunc(v_mod.quantidade_minima);
  END IF;
  IF v_mod.multiplo IS NOT NULL AND mod(v_qtd, v_mod.multiplo) <> 0 THEN
    RAISE EXCEPTION '"%" é vendido de % em %: use %.', v_rotulo, trunc(v_mod.multiplo), trunc(v_mod.multiplo),
      trunc(ceil(v_qtd / v_mod.multiplo) * v_mod.multiplo);
  END IF;
  IF v_mod.faixa_max IS NOT NULL AND v_qtd > v_mod.faixa_max THEN
    v_avisos := v_avisos || format('A tabela do fornecedor só traz preço para %s; acima disso, confirme o custo antes de enviar.',
                                   coalesce(v_mod.faixa, 'a faixa informada'));
  END IF;

  v_fator := public.fornecedor_fator_unidade(v_item.unidade_preco);
  v_unit := v_preco.preco_venda / v_fator;
  v_custo_unit := v_preco.custo / v_fator;
  v_unidade := CASE v_item.unidade_preco WHEN 'caixa' THEN 'cx' WHEN 'rolo' THEN 'rolo'
                 WHEN 'folha' THEN 'folha' WHEN 'pacote' THEN 'pct' ELSE 'un' END;

  IF p_orcamento_id IS NULL THEN
    IF NOT public.has_permission(v_uid, 'orcamentos.create') THEN
      RAISE EXCEPTION 'Permissão necessária: orcamentos.create';
    END IF;
    IF p_cliente_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
      RAISE EXCEPTION 'Escolha o cliente do novo orçamento.';
    END IF;
    INSERT INTO public.orcamentos (cliente_id, titulo, status)
    VALUES (p_cliente_id, left(coalesce(nullif(btrim(p_titulo), ''), 'Brindes do catálogo'), 200), 'rascunho')
    RETURNING id, numero INTO v_orc, v_numero;
  ELSE
    SELECT o.id, o.numero, o.status::text INTO v_orc, v_numero, v_status
      FROM public.orcamentos o WHERE o.id = p_orcamento_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
    IF v_status <> 'rascunho' THEN
      RAISE EXCEPTION 'O orçamento nº % já saiu do rascunho (%): item novo só em orçamento em rascunho.', v_numero, v_status;
    END IF;
  END IF;

  -- A descrição vai para o PDF do cliente: nome limpo, opção e código BX.
  v_descricao := left(
    coalesce(public.fornecedor_texto_para_cliente(v_item.nome, v_item.fornecedor_nome, v_item.codigo_fornecedor),
             'Item do catálogo')
    || CASE WHEN p_modalidade = 'valor_unico' THEN '' ELSE ' — ' || v_rotulo END
    || coalesce(' (' || v_mod.faixa || ')', '')
    || ' · ' || v_item.codigo_bex, 500);

  SELECT coalesce(max(ordem) + 1, 0) INTO v_ordem FROM public.orcamento_itens WHERE orcamento_id = v_orc;

  INSERT INTO public.orcamento_itens (
    orcamento_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, ordem,
    origem_calculo, custo_previsto, parametros, produto_snapshot)
  VALUES (
    v_orc, v_descricao, v_qtd, v_unidade, v_unit, v_custo_unit, v_ordem,
    'catalogo_fornecedor', round(v_custo_unit * v_qtd, 2), '{}'::jsonb,
    jsonb_build_object('origem', 'catalogo_fornecedor', 'catalogo_item_id', v_item.id,
                       'catalogo_id', v_item.catalogo_id, 'codigo_bex', v_item.codigo_bex,
                       'codigo_fornecedor', v_item.codigo_fornecedor, 'fornecedor', v_item.fornecedor_nome,
                       'modalidade', p_modalidade, 'unidade_preco', v_item.unidade_preco,
                       'regra', v_preco.regra))
  RETURNING id INTO v_novo;

  -- Os totais pelo mesmo cálculo de `recalcular()` da tela (orcamentos.$id.tsx):
  -- subtotal = total = soma dos itens; custo estimado = Σ custo unitário × quantidade.
  UPDATE public.orcamentos o
     SET valor_subtotal = s.total, valor_total = s.total, custo_estimado = s.custo
    FROM (SELECT coalesce(sum(i.valor_total), 0) AS total,
                 coalesce(sum(i.custo_unitario * i.quantidade), 0) AS custo
            FROM public.orcamento_itens i WHERE i.orcamento_id = v_orc) s
   WHERE o.id = v_orc;

  SELECT valor_total INTO v_total FROM public.orcamento_itens WHERE id = v_novo;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'orcamento_itens', v_novo, 'adicionar_do_catalogo',
          jsonb_build_object('orcamento_id', v_orc, 'catalogo_item_id', p_item_id,
                             'modalidade', p_modalidade, 'quantidade', v_qtd,
                             'orcamento_novo', p_orcamento_id IS NULL));

  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc, 'orcamento_numero', v_numero,
                            'orcamento_novo', p_orcamento_id IS NULL, 'item_id', v_novo,
                            'valor_unitario', round(v_unit, 4), 'valor_total', v_total,
                            'avisos', to_jsonb(v_avisos));
END $f$;

-- Link da vitrine para o cliente. Token: 32 bytes aleatórios em base64url,
-- sorteados AQUI, em claro só nesta resposta; o banco guarda o SHA-256.
-- Item sem foto não entra (o cliente não veria nada dele).
CREATE OR REPLACE FUNCTION public.catalogo_gerar_link(
  p_catalogo_id uuid, p_itens uuid[], p_titulo text, p_cliente_id uuid DEFAULT NULL, p_dias integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_uid uuid; v_dias integer := greatest(1, least(coalesce(p_dias, 30), 90));
  v_titulo text := btrim(coalesce(p_titulo, '')); v_token text; v_id uuid; v_expira timestamptz;
  v_validos integer; v_pedidos integer;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT EXISTS (SELECT 1 FROM public.fornecedor_catalogos WHERE id = p_catalogo_id) THEN
    RAISE EXCEPTION 'Catálogo não encontrado.';
  END IF;
  IF length(v_titulo) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Dê um título ao link (até 120 caracteres): é o que o cliente lê no alto da página.';
  END IF;
  v_pedidos := coalesce(cardinality(p_itens), 0);
  IF v_pedidos = 0 THEN RAISE EXCEPTION 'Escolha pelo menos um item.'; END IF;
  IF v_pedidos > 500 THEN RAISE EXCEPTION 'Até 500 itens por link.'; END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expira := now() + make_interval(days => v_dias);
  INSERT INTO public.catalogo_links (catalogo_id, titulo, cliente_id, token_hash, expira_em, criado_por)
  VALUES (p_catalogo_id, v_titulo, p_cliente_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expira, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.catalogo_link_itens (link_id, item_id, ordem)
  SELECT v_id, u.item_id, min(u.posicao)
    FROM unnest(p_itens) WITH ORDINALITY AS u(item_id, posicao)
    JOIN public.fornecedor_itens i ON i.id = u.item_id
   WHERE i.catalogo_id = p_catalogo_id AND i.tem_foto
   GROUP BY u.item_id;
  GET DIAGNOSTICS v_validos = ROW_COUNT;
  IF v_validos = 0 THEN
    RAISE EXCEPTION 'Nenhum dos itens escolhidos tem foto: o cliente não veria nada.';
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'catalogo_links', v_id, 'gerar_link',
          jsonb_build_object('catalogo_id', p_catalogo_id, 'cliente_id', p_cliente_id, 'dias', v_dias,
                             'itens', v_validos));

  RETURN jsonb_build_object('link_id', v_id, 'token', v_token, 'expira_em', v_expira,
                            'itens', v_validos, 'ignorados', v_pedidos - v_validos);
END $f$;

-- Os links de um catálogo, sem hash e sem token.
CREATE OR REPLACE FUNCTION public.catalogo_links(p_catalogo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_links jsonb;
BEGIN
  PERFORM public.require_permission('catalogo.manage');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'titulo', l.titulo, 'cliente_id', l.cliente_id, 'cliente', c.nome,
           'criado_em', l.criado_em, 'criado_por', u.nome, 'expira_em', l.expira_em,
           'revogado_em', l.revogado_em, 'ultimo_acesso_em', l.ultimo_acesso_em, 'acessos', l.acessos,
           'itens', (SELECT count(*) FROM public.catalogo_link_itens li WHERE li.link_id = l.id))
           ORDER BY l.criado_em DESC), '[]'::jsonb)
    INTO v_links
    FROM (SELECT * FROM public.catalogo_links WHERE catalogo_id = p_catalogo_id
           ORDER BY criado_em DESC LIMIT 50) l
    LEFT JOIN public.clientes c ON c.id = l.cliente_id
    LEFT JOIN public.usuarios u ON u.id = l.criado_por;
  RETURN jsonb_build_object('agora', now(), 'links', v_links);
END $f$;

CREATE OR REPLACE FUNCTION public.catalogo_revogar_link(p_link_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_quando timestamptz;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  UPDATE public.catalogo_links SET revogado_em = now(), revogado_por = v_uid
   WHERE id = p_link_id AND revogado_em IS NULL
  RETURNING revogado_em INTO v_quando;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.catalogo_links WHERE id = p_link_id) THEN
      RAISE EXCEPTION 'Este link já estava cancelado.';
    END IF;
    RAISE EXCEPTION 'Link não encontrado.';
  END IF;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'catalogo_links', p_link_id, 'revogar_link', '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'revogado_em', v_quando);
END $f$;


-- -----------------------------------------------------------------------------
-- 8. A vitrine do cliente (só service_role, pela rota /api/catalogo/vitrine)
-- -----------------------------------------------------------------------------
--
-- Lista FECHADA de chaves. Não sai: nome nem código do fornecedor, descrição
-- impressa pelo fornecedor, custo, margem, regra, motivo do "sob consulta".
-- Todo texto passa por `fornecedor_texto_para_cliente`.
CREATE OR REPLACE FUNCTION public.catalogo_link_abrir(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l public.catalogo_links%ROWTYPE; v_fornecedor text; v_itens jsonb; v_empresa jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('situacao', 'invalido');
  END IF;
  SELECT * INTO l FROM public.catalogo_links WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('situacao', 'invalido'); END IF;
  IF l.revogado_em IS NOT NULL THEN RETURN jsonb_build_object('situacao', 'revogado'); END IF;
  IF l.expira_em <= now() THEN RETURN jsonb_build_object('situacao', 'vencido'); END IF;

  SELECT f.nome INTO v_fornecedor
    FROM public.fornecedor_catalogos c JOIN public.fornecedores f ON f.id = c.fornecedor_id
   WHERE c.id = l.catalogo_id;

  WITH precos AS (
    SELECT p.item_id, p.modalidade, p.posicao, p.preco_venda
      FROM public.fornecedor_precos_interno(l.catalogo_id) p
     WHERE p.item_id IN (SELECT li.item_id FROM public.catalogo_link_itens li WHERE li.link_id = l.id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'codigo', i.codigo_bex,
           'nome', coalesce(public.fornecedor_texto_para_cliente(i.nome, v_fornecedor, i.codigo_fornecedor), i.codigo_bex),
           'especificacao', public.fornecedor_texto_para_cliente(coalesce(i.especificacao, s.especificacao),
                                                                 v_fornecedor, i.codigo_fornecedor),
           'dimensoes', public.fornecedor_texto_para_cliente(i.dimensoes, v_fornecedor, i.codigo_fornecedor),
           'secao', public.fornecedor_texto_para_cliente(s.titulo, v_fornecedor, NULL),
           'unidade_preco', i.unidade_preco,
           'foto', jsonb_build_object('origem', fo.origem, 'caminho', fo.caminho),
           'opcoes', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'modalidade', m.modalidade, 'rotulo', public.fornecedor_rotulo_modalidade(m.modalidade),
                      'preco', pr.preco_venda, 'quantidade_minima', m.quantidade_minima,
                      'multiplo', m.multiplo, 'faixa', m.faixa)
                    ORDER BY m.posicao)
               FROM public.fornecedor_item_modalidades m
               LEFT JOIN precos pr ON pr.item_id = m.item_id AND pr.modalidade = m.modalidade
              WHERE m.item_id = i.id), '[]'::jsonb))
           ORDER BY li.ordem), '[]'::jsonb)
    INTO v_itens
    FROM public.catalogo_link_itens li
    JOIN public.fornecedor_itens i ON i.id = li.item_id
    JOIN public.fornecedor_fotos fo ON fo.id = i.foto_id
    LEFT JOIN public.fornecedor_secoes s ON s.id = i.secao_id
   WHERE li.link_id = l.id;

  SELECT jsonb_build_object('nome', e.nome, 'slogan', e.slogan, 'cidade', e.cidade, 'estado', e.estado,
                            'telefones', e.telefones)
    INTO v_empresa
    FROM public.empresa_config e LIMIT 1;

  -- Último acesso no máximo uma vez por minuto (o mesmo cuidado do portal).
  UPDATE public.catalogo_links SET ultimo_acesso_em = now(), acessos = acessos + 1
   WHERE id = l.id AND (ultimo_acesso_em IS NULL OR ultimo_acesso_em < now() - interval '1 minute');

  RETURN jsonb_build_object('situacao', 'aberto', 'vence_em', l.expira_em,
                            'titulo', coalesce(public.fornecedor_texto_para_cliente(l.titulo, v_fornecedor, NULL), 'Catálogo'),
                            'empresa', coalesce(v_empresa, '{}'::jsonb), 'itens', v_itens);
END $f$;


-- -----------------------------------------------------------------------------
-- 9. Quem executa o quê
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.tg_fornecedor_criado_por() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_fornecedor_item_codigo_estavel() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_rotulo_modalidade(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_fator_unidade(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_preco_venda(numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_texto_para_cliente(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_sem_valores(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_codigo_normalizado(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_ler_numero(jsonb, numeric, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_normalizar_regras(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fornecedor_precos_interno(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_resumo() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_precos(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_previa_regras(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_salvar_regras(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_importar(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_registrar_fotos(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_apontar_foto(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_resolver_duvida(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_adicionar_ao_orcamento(uuid, text, numeric, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_gerar_link(uuid, uuid[], text, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_links(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_revogar_link(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_link_abrir(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.catalogo_resumo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_precos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_previa_regras(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_salvar_regras(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_importar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_fotos(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_apontar_foto(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_resolver_duvida(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_adicionar_ao_orcamento(uuid, text, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_gerar_link(uuid, uuid[], text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_revogar_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_link_abrir(text) TO service_role;

COMMENT ON FUNCTION public.catalogo_link_abrir(text) IS
  'Vitrine do link do cliente. Só service_role (rota /api/catalogo/vitrine). Lista fechada de chaves: sem fornecedor, sem custo.';
COMMENT ON FUNCTION public.fornecedor_precos_interno(uuid, jsonb) IS
  'Cálculo único do preço de venda (com custo). Interna: ninguém executa pela API; catalogo_precos entrega por nível.';


-- -----------------------------------------------------------------------------
-- 10. Fotos enviadas pela tela: bucket próprio
-- -----------------------------------------------------------------------------
--
-- Público para LEITURA por URL (a vitrine do cliente mostra a foto sem login)
-- e sem policy de SELECT para anon: dá para abrir uma foto pelo endereço, não
-- dá para listar o bucket. O nome do arquivo é opaco (<catalogo>/<uuid>.webp).
-- Escrever, listar e apagar: só catalogo.manage.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('catalogo-fotos', 'catalogo-fotos', true, 2097152, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "catalogo fotos envia" ON storage.objects;
CREATE POLICY "catalogo fotos envia" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalogo-fotos'
              AND (SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));
DROP POLICY IF EXISTS "catalogo fotos lista" ON storage.objects;
CREATE POLICY "catalogo fotos lista" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'catalogo-fotos'
         AND (SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));
DROP POLICY IF EXISTS "catalogo fotos apaga" ON storage.objects;
CREATE POLICY "catalogo fotos apaga" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'catalogo-fotos'
         AND (SELECT public.has_permission((SELECT auth.uid()), 'catalogo.manage')));
