-- ============================================================================
-- Layout do orçamento: quem faz orçamento consegue anexar e ver a arte dele
-- ============================================================================
--
-- POR QUÊ (05/10/2026): o dono pediu "o campo pra subir layouts de cada item
-- do orçamento" e perguntou se já dava. A tela existia, mas o anexo exigia
-- `arquivos.upload` (no Storage e na tabela `arquivos`) e a miniatura exigia
-- `arquivos.read` — e o papel VENDEDOR não tem nenhuma chave `arquivos.*`.
-- Quem mais faz orçamento recebia "violates row-level security policy" ao
-- anexar a arte que o cliente mandou pelo WhatsApp. Só admin, gestor e
-- designer conseguiam; `orcamento_item_arquivos` tinha 0 linhas.
--
-- O QUE ABRE, E SÓ ISSO
--   Não se deu `arquivos.*` ao vendedor (isso abriria TODOS os arquivos dos
--   clientes). Abre-se a pasta dos layouts de orçamento, `orcamento/…`, para
--   quem já mexe em orçamento:
--     enviar  (Storage INSERT e linha em `arquivos` do tipo 'arte'):
--             `orcamentos.update` — a mesma chave que edita o orçamento;
--     ver     (Storage SELECT e linha em `arquivos`): `orcamentos.read`.
--   As policies são PERMISSIVE: somam às que já existem; quem tinha acesso por
--   `arquivos.*` continua igual. Apagar continua como estava (tirar a arte do
--   item apaga só o vínculo em `orcamento_item_arquivos`).

-- ------------------------------------------------------------ 1. Storage
CREATE POLICY "layout de orcamento: quem edita orcamento envia"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'arquivos-clientes'
    AND name LIKE 'orcamento/%'
    AND public.has_permission((SELECT auth.uid()), 'orcamentos.update')
  );

CREATE POLICY "layout de orcamento: quem le orcamento ve"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'arquivos-clientes'
    AND name LIKE 'orcamento/%'
    AND public.has_permission((SELECT auth.uid()), 'orcamentos.read')
  );

-- ------------------------------------------------- 2. a linha em `arquivos`
CREATE POLICY "layout de orcamento: quem edita orcamento registra"
  ON public.arquivos FOR INSERT TO authenticated
  WITH CHECK (
    tipo = 'arte'
    AND caminho LIKE 'orcamento/%'
    AND public.has_permission((SELECT auth.uid()), 'orcamentos.update')
  );

CREATE POLICY "layout de orcamento: quem le orcamento ve"
  ON public.arquivos FOR SELECT TO authenticated
  USING (
    caminho LIKE 'orcamento/%'
    AND public.has_permission((SELECT auth.uid()), 'orcamentos.read')
  );
