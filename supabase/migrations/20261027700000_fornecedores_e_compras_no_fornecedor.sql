-- Fornecedores no Financeiro e o registro do que foi comprado em cada um
-- (26/10/2026, pedido do dono).
--
-- APLICADA no banco vivo em 26/10/2026 pelo MCP, a pedido do dono, depois de
-- ensaio com rollback; conferida com as contas reais logo em seguida.
--
-- O sistema não sabia de quem a gráfica compra. `fornecedores` tinha uma linha
-- (a LUGA, do catálogo de brindes) e só abria para quem tem catalogo.read; o
-- fornecedor de compra, de conta a pagar e de lote é texto solto. As compras de
-- tinta, vinil e lona na Camaleão Tintas (jul–set/2026, prints do ControlShop
-- deles) não estavam em lugar nenhum: contas a pagar só tinha parcelas de
-- equipamento e o caixa, 2 lançamentos.
--
-- 1. `fornecedores` ganha categorias (o que se compra ali) e e-mail, e passa a
--    abrir para o Financeiro e para quem cuida de compras. Cadastrar/editar é
--    por `salvar_fornecedor`, que confere a permissão (o authenticated só tem
--    SELECT na tabela).
-- 2. `compras_fornecedor` + `compras_fornecedor_itens`: o documento do
--    fornecedor como ele emitiu (venda, reserva, devolução), com os itens, o
--    preço pago e quem comprou (a Agência Bex ou a Bex Print). É REGISTRO: não
--    mexe em estoque nem em caixa — compra antiga já foi consumida, e quem
--    pagou a maior parte foi a Agência Bex, não a conta da gráfica. O item pode
--    apontar para o material do estoque, com quanto do material uma unidade
--    comprada rende (rolo 1,06 × 50 = 53 m²; litro = 1.000 ml), para comparar o
--    preço pago com o custo do cadastro.
--    Leitura: financeiro.read ou compras.read (preço de compra é custo). Sem
--    escrita pela API nesta versão.

-- 1. Fornecedores -------------------------------------------------------------
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS categorias text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_categorias_validas;
ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_categorias_validas
  CHECK (categorias <@ ARRAY['tintas', 'materia_prima', 'insumos', 'ferramentas', 'equipamentos',
                             'brindes', 'servicos', 'outros']::text[]);

DROP POLICY IF EXISTS "financeiro e compras leem fornecedores" ON public.fornecedores;
CREATE POLICY "financeiro e compras leem fornecedores" ON public.fornecedores
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'financeiro.read'))
      OR (SELECT public.has_permission((SELECT auth.uid()), 'compras.read')));

CREATE OR REPLACE FUNCTION public.salvar_fornecedor(
  p_id uuid,
  p_nome text,
  p_razao_social text,
  p_cnpj text,
  p_telefone text,
  p_email text,
  p_site text,
  p_endereco text,
  p_categorias text[],
  p_observacoes text,
  p_ativo boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_doc text;
  v_id uuid;
BEGIN
  IF NOT (public.has_permission(v_uid, 'catalogo.manage')
          OR public.has_permission(v_uid, 'pagamentos.create')
          OR public.has_permission(v_uid, 'compras.create')) THEN
    RAISE EXCEPTION 'Você não pode cadastrar fornecedor.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do fornecedor.' USING ERRCODE = '22023';
  END IF;
  -- Fornecedor pode ser empresa (CNPJ, 14) ou autônomo (CPF, 11).
  IF v_cnpj IS NOT NULL AND length(v_cnpj) NOT IN (11, 14) THEN
    RAISE EXCEPTION 'Documento com % dígitos: CNPJ tem 14 e CPF, 11.', length(v_cnpj) USING ERRCODE = '22023';
  END IF;
  IF v_cnpj IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fornecedores f
     WHERE regexp_replace(coalesce(f.cnpj, ''), '\D', '', 'g') = v_cnpj
       AND f.id IS DISTINCT FROM p_id
  ) THEN
    RAISE EXCEPTION 'Já existe um fornecedor com este documento.' USING ERRCODE = '23505';
  END IF;
  -- Guardado com máscara, como o da LUGA: 00.000.000/0000-00 ou 000.000.000-00.
  v_doc := CASE length(v_cnpj)
    WHEN 14 THEN substr(v_cnpj, 1, 2) || '.' || substr(v_cnpj, 3, 3) || '.' || substr(v_cnpj, 6, 3)
                 || '/' || substr(v_cnpj, 9, 4) || '-' || substr(v_cnpj, 13, 2)
    WHEN 11 THEN substr(v_cnpj, 1, 3) || '.' || substr(v_cnpj, 4, 3) || '.' || substr(v_cnpj, 7, 3)
                 || '-' || substr(v_cnpj, 10, 2)
  END;

  IF p_id IS NULL THEN
    INSERT INTO public.fornecedores (nome, razao_social, cnpj, telefone, email, site, endereco,
                                     categorias, observacoes, ativo)
    VALUES (btrim(p_nome), nullif(btrim(coalesce(p_razao_social, '')), ''),
            v_doc,
            nullif(btrim(coalesce(p_telefone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
            nullif(btrim(coalesce(p_site, '')), ''), nullif(btrim(coalesce(p_endereco, '')), ''),
            coalesce(p_categorias, '{}'), nullif(btrim(coalesce(p_observacoes, '')), ''),
            coalesce(p_ativo, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.fornecedores
       SET nome = btrim(p_nome),
           razao_social = nullif(btrim(coalesce(p_razao_social, '')), ''),
           cnpj = v_doc,
           telefone = nullif(btrim(coalesce(p_telefone, '')), ''),
           email = nullif(btrim(coalesce(p_email, '')), ''),
           site = nullif(btrim(coalesce(p_site, '')), ''),
           endereco = nullif(btrim(coalesce(p_endereco, '')), ''),
           categorias = coalesce(p_categorias, '{}'),
           observacoes = nullif(btrim(coalesce(p_observacoes, '')), ''),
           ativo = coalesce(p_ativo, true)
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Fornecedor não encontrado.' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_id;
END
$function$;

COMMENT ON FUNCTION public.salvar_fornecedor(uuid, text, text, text, text, text, text, text, text[], text, boolean) IS
  'Cadastra (p_id nulo) ou edita um fornecedor. Exige catalogo.manage, pagamentos.create ou compras.create. CNPJ (ou CPF de autônomo) guardado com máscara e sem repetir.';
REVOKE ALL ON FUNCTION public.salvar_fornecedor(uuid, text, text, text, text, text, text, text, text[], text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_fornecedor(uuid, text, text, text, text, text, text, text, text[], text, boolean)
  TO authenticated;

-- 2. O que foi comprado em cada fornecedor ------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_fornecedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE RESTRICT,
  -- Como o fornecedor numera: "VENDA 21512", "RESERVA 22426".
  documento text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('venda', 'reserva', 'devolucao')),
  data_operacao timestamptz NOT NULL,
  -- Quem comprou: a razão social e o CNPJ do comprador, e o código dele no fornecedor.
  comprador_nome text NOT NULL,
  comprador_cnpj text,
  codigo_cliente text,
  forma_pagamento text,
  condicao_pagamento text,
  pago boolean NOT NULL DEFAULT false,
  total_bruto numeric(12, 2) NOT NULL,
  desconto numeric(12, 2) NOT NULL DEFAULT 0,
  -- Devolução vem negativa, como no documento do fornecedor.
  total numeric(12, 2) NOT NULL,
  devolve_compra_id uuid REFERENCES public.compras_fornecedor(id) ON DELETE RESTRICT,
  observacoes text,
  fonte text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compras_fornecedor_documento_unico UNIQUE (fornecedor_id, documento),
  -- Devolução aponta para a compra que desfaz; venda e reserva não apontam.
  CONSTRAINT compras_fornecedor_devolucao_aponta CHECK ((tipo = 'devolucao') = (devolve_compra_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.compras_fornecedor_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES public.compras_fornecedor(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  codigo text,
  descricao text NOT NULL,
  unidade text,
  quantidade numeric(12, 3) NOT NULL,
  preco_lista numeric(12, 2),
  desconto_pct numeric(8, 4),
  preco_unitario numeric(12, 2) NOT NULL,
  total numeric(12, 2) NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN ('materia_prima', 'tinta', 'ferramenta', 'consumo', 'outro')),
  material_id uuid REFERENCES public.materiais(id) ON DELETE SET NULL,
  -- Quanto do material do estoque UMA unidade comprada rende, na unidade do
  -- material: rolo 1,06 × 50 m = 53 (m²); litro = 1000 (ml).
  rende_do_material numeric(12, 3) CHECK (rende_do_material IS NULL OR rende_do_material > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compras_fornecedor_fornecedor_idx ON public.compras_fornecedor (fornecedor_id, data_operacao DESC);
CREATE INDEX IF NOT EXISTS compras_fornecedor_devolve_idx ON public.compras_fornecedor (devolve_compra_id);
CREATE INDEX IF NOT EXISTS compras_fornecedor_itens_compra_idx ON public.compras_fornecedor_itens (compra_id, ordem);
CREATE INDEX IF NOT EXISTS compras_fornecedor_itens_material_idx ON public.compras_fornecedor_itens (material_id);

COMMENT ON TABLE public.compras_fornecedor IS
  'Documento do fornecedor como ele emitiu (venda, reserva, devolução). Registro de compra: não mexe em estoque nem em caixa.';
COMMENT ON COLUMN public.compras_fornecedor_itens.rende_do_material IS
  'Quanto do material do estoque uma unidade comprada rende, na unidade do material (rolo 1,06 x 50 = 53 m²; litro = 1000 ml).';

ALTER TABLE public.compras_fornecedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras_fornecedor_itens ENABLE ROW LEVEL SECURITY;

-- Tabela nova nasce com tudo para anon e authenticated no Supabase.
REVOKE ALL ON public.compras_fornecedor, public.compras_fornecedor_itens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.compras_fornecedor, public.compras_fornecedor_itens TO authenticated;
GRANT ALL ON public.compras_fornecedor, public.compras_fornecedor_itens TO service_role;

DROP POLICY IF EXISTS "compras no fornecedor: le quem ve financeiro ou compras" ON public.compras_fornecedor;
CREATE POLICY "compras no fornecedor: le quem ve financeiro ou compras" ON public.compras_fornecedor
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'financeiro.read'))
      OR (SELECT public.has_permission((SELECT auth.uid()), 'compras.read')));

DROP POLICY IF EXISTS "itens da compra no fornecedor: le quem ve financeiro ou compras" ON public.compras_fornecedor_itens;
CREATE POLICY "itens da compra no fornecedor: le quem ve financeiro ou compras" ON public.compras_fornecedor_itens
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'financeiro.read'))
      OR (SELECT public.has_permission((SELECT auth.uid()), 'compras.read')));

DROP TRIGGER IF EXISTS tg_auditar_compras_fornecedor ON public.compras_fornecedor;
CREATE TRIGGER tg_auditar_compras_fornecedor
  AFTER INSERT OR DELETE OR UPDATE ON public.compras_fornecedor
  FOR EACH ROW EXECUTE FUNCTION public.tg_auditar();
