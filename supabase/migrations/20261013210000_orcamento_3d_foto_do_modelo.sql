-- Orçamento 3D: a foto do modelo chega ao PDF, à tela, à listagem e à OS (13/10/2026).
--
-- O dono gerou o PDF do orçamento 3D "BRINQUEDO" e a foto do modelo não estava
-- lá. A foto tinha sido salva (orcamentos_3d.foto_modelo_path) — e nenhuma
-- tela, nenhum PDF e nenhuma função a lia. A dica do campo prometia "vira capa
-- do orçamento, PDF e listagem".
--
-- 1. Storage. A foto e o print do fatiador vão para `orcamentos-3d/…` no bucket
--    arquivos-clientes, que só aceitava quem tem `arquivos.upload` — o
--    vendedor, que cria orçamento 3D, não tem: salvar com print ou foto falhava
--    inteiro. E o financeiro, que vê custo, não conseguia abrir o print (a tela
--    dizia "Sem print anexado"). Agora: envia quem cria/edita orçamento 3D; a
--    foto (vai para o cliente) abre para quem lê o 3D; o print, para quem vê
--    custo ou cria orçamento. O caminho é o de src/domain/impressao3d/arquivos.ts.
-- 2. O material como o cliente entende ("PLA · cor Natural"), gravado no
--    orçamento: o cálculo de custo (onde estava o nome do filamento) só abre
--    para quem vê custo, e o PDF não pode mudar conforme quem o gera.
-- 3. A conversão em OS leva a foto como arquivo de referência da OS: quem
--    produz vê o que imprimir.

-- 1. Storage ----------------------------------------------------------------
DROP POLICY IF EXISTS "orcamento 3d: quem cria envia foto e print" ON storage.objects;
CREATE POLICY "orcamento 3d: quem cria envia foto e print" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'arquivos-clientes'
    AND name ~ '^orcamentos-3d/[0-9]+_(modelo|slicer)_'
    AND (public.has_permission((SELECT auth.uid()), 'impressao3d.quote.create')
         OR public.has_permission((SELECT auth.uid()), 'impressao3d.quote.update'))
  );

DROP POLICY IF EXISTS "orcamento 3d: foto do modelo para quem le o 3d" ON storage.objects;
CREATE POLICY "orcamento 3d: foto do modelo para quem le o 3d" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'arquivos-clientes'
    AND name ~ '^orcamentos-3d/[0-9]+_modelo_'
    AND public.has_permission((SELECT auth.uid()), 'impressao3d.read')
  );

DROP POLICY IF EXISTS "orcamento 3d: print do fatiador para quem ve custo ou cria" ON storage.objects;
CREATE POLICY "orcamento 3d: print do fatiador para quem ve custo ou cria" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'arquivos-clientes'
    AND name ~ '^orcamentos-3d/[0-9]+_slicer_'
    AND (public.has_permission((SELECT auth.uid()), 'impressao3d.cost.read')
         OR public.has_permission((SELECT auth.uid()), 'impressao3d.quote.create'))
  );

-- 2. Material do orçamento, para o PDF ----------------------------------------
ALTER TABLE public.orcamentos_3d ADD COLUMN IF NOT EXISTS material_descricao text;
COMMENT ON COLUMN public.orcamentos_3d.material_descricao IS
  'Material como o cliente entende ("PLA · cor Natural"): tipo e cor do filamento, sem a marca do fornecedor. Sai no PDF.';
GRANT SELECT (material_descricao), INSERT (material_descricao), UPDATE (material_descricao)
  ON public.orcamentos_3d TO authenticated;

-- Os orçamentos já salvos: tipo e cor do filamento da placa. Não dispara o
-- espelho do funil (o gatilho só olha título, cliente, status, preço, OS e contato).
UPDATE public.orcamentos_3d o
   SET material_descricao = concat_ws(' · ', nullif(btrim(f.tipo), ''), 'cor ' || nullif(btrim(f.cor), ''))
  FROM public.orcamento_3d_placas pl
  JOIN public.orcamento_3d_consumos c ON c.placa_id = pl.id
  JOIN public.materiais_3d_filamento f ON f.material_id = c.material_id
 WHERE pl.orcamento_3d_id = o.id
   AND o.material_descricao IS NULL
   AND (nullif(btrim(f.tipo), '') IS NOT NULL OR nullif(btrim(f.cor), '') IS NOT NULL);

-- 3. A conversão leva a foto para a OS -----------------------------------------
-- Edita a função viva trecho a trecho: se o trecho não estiver lá, para.
DO $foto$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_3d_em_os(uuid)'::regprocedure);
  v_de text := E'  RETURNING id INTO v_item_id;\n';
  v_para text := E'  RETURNING id INTO v_item_id;\n\n'
    || E'  -- A foto do modelo vira arquivo de referência da OS: quem produz vê o que imprimir.\n'
    || E'  IF v_orc.foto_modelo_path IS NOT NULL THEN\n'
    || E'    INSERT INTO public.arquivos (os_id, os_item_id, cliente_id, nome, caminho, bucket, tipo,\n'
    || E'                                 enviado_por, created_by, observacao)\n'
    || E'    VALUES (v_os_id, v_item_id, v_orc.cliente_id,\n'
    || E'            ''Foto do modelo — '' || btrim(v_orc.titulo), v_orc.foto_modelo_path,\n'
    || E'            ''arquivos-clientes'', ''referencia'', v_orc.created_by, v_uid,\n'
    || E'            ''Veio do orçamento 3D'');\n'
    || E'  END IF;\n';
BEGIN
  IF position('A foto do modelo vira arquivo de referência da OS' IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_3d_em_os: o trecho do item da OS não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$foto$;
