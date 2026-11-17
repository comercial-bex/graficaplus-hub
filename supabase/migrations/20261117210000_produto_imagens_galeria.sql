-- =====================================================================================================
-- GALERIA DE FOTOS DO PRODUTO: tabela produto_imagens (17/11/2026)
--
-- APLICADA no banco vivo em 17/11/2026. Escrita para o dono do fluxo ensaiar (docs/ensaio-produto-imagens-galeria.md, termina em
-- RAISE EXCEPTION) e aplicar. Aditiva: nada existente muda de forma, e o front antigo segue funcionando.
--
-- O QUE ESTAVA FALTANDO (lido no código e no banco em 17/11/2026)
--   O produto tinha UMA foto, em produtos.imagem_url (70 produtos, 34 ativos, 18 com foto, as 18 geradas pela
--   IA na pasta ia/ do bucket produtos-fotos). Trocar a foto apagava a anterior do cadastro, e não havia
--   onde guardar uma segunda imagem nem escolher qual é a capa.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   A. Tabela produto_imagens (produto_id, url, legenda, ordem, capa, origem manual|ia, created_by).
--      Uma capa por produto (índice único parcial) e a mesma url não entra duas vezes no mesmo produto.
--   B. RLS: leitura = quem lê o produto (a policy consulta public.produtos, que já tem a sua RLS: mesma
--      regra de "produtos", sem repetir a lista de papéis); escrita só admin e gestor. GRANTs explícitos
--      e REVOKE de anon e PUBLIC (REVOKE de PUBLIC sozinho não fecha o anon).
--   C. Backfill: as fotos que já estão em produtos.imagem_url entram como CAPA (origem ia se estão na pasta
--      ia/, manual no resto). Feito ANTES dos gatilhos, para o backfill não disparar nada.
--   D. Gatilho produto_imagens -> produtos.imagem_url: a coluna fica SEMPRE igual à capa. O contrato antigo
--      não quebra: parceiro (parceiro_catalogo_extras), orçamento, tabela de preços e lista de produtos
--      continuam lendo produtos.imagem_url sem saber que a galeria existe.
--        - a primeira foto de um produto vira capa sozinha; as seguintes nunca tiram a capa de ninguém;
--        - marcar uma capa desmarca a anterior (na mesma gravação, sem janela sem capa);
--        - apagar a capa passa a capa para a próxima da fila (menor ordem); apagar a última zera a coluna.
--   E. Gatilho produtos.imagem_url -> galeria: quem ainda grava a coluna direto (Edição rápida, ficha da
--      tabela de preços, a geração por IA) continua valendo, e a galeria acompanha: a url nova vira a capa
--      (reaproveita a linha se a url já está na galeria). Limpar a coluna só tira a marca de capa: as fotos
--      da galeria ficam, e a tela da galeria mostra "sem capa" para escolher outra.
--      Os dois gatilhos se avisam por uma marca de transação (bex.sincronizando_foto) para não girar em
--      círculo.
--
-- DECISÕES (e por quê)
--   - created_by é uuid SEM chave estrangeira: a geração por IA grava com a chave de serviço, em que
--     auth.uid() é nulo, e a pessoa pode sair da equipe sem apagar a foto.
--   - ON DELETE CASCADE do produto: foto sem produto não tem sentido. O ARQUIVO no bucket não é apagado por
--     gatilho (SQL não fala com o storage): quem remove foto pela tela apaga o arquivo se ninguém mais usa.
--   - ordem nasce 0 e a tela calcula a próxima (max + 1). Empate é resolvido por id, na tela.
--   - A policy de leitura usa EXISTS em public.produtos (RLS herdada da subconsulta). Precisa de SELECT na
--     coluna id de produtos para o papel authenticated; produtos_operacional já lê id com esse papel.
--
-- ENSAIO: docs/ensaio-produto-imagens-galeria.md (BEGIN, migração, cenários por perfil, RAISE EXCEPTION).
--
-- COMO DESFAZER (nesta ordem; produtos.imagem_url já está igual à capa, então nada se perde):
--   DROP TRIGGER IF EXISTS tg_produtos_foto_para_galeria ON public.produtos;
--   DROP TRIGGER IF EXISTS tg_produto_imagens_capa_antes ON public.produto_imagens;
--   DROP TRIGGER IF EXISTS tg_produto_imagens_sincroniza_depois ON public.produto_imagens;
--   DROP FUNCTION IF EXISTS public.tg_produtos_foto_para_galeria();
--   DROP FUNCTION IF EXISTS public.tg_produto_imagens_capa_antes();
--   DROP FUNCTION IF EXISTS public.tg_produto_imagens_sincroniza_depois();
--   DROP TABLE IF EXISTS public.produto_imagens;
-- As fotos extras (não capa) ficam só nos arquivos do bucket; a capa continua em produtos.imagem_url.
-- =====================================================================================================
BEGIN;

-- A. Tabela ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produto_imagens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id  uuid        NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  url         text        NOT NULL CHECK (length(btrim(url)) > 0),
  legenda     text,
  ordem       integer     NOT NULL DEFAULT 0,
  capa        boolean     NOT NULL DEFAULT false,
  origem      text        NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'ia')),
  created_by  uuid        DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.produto_imagens IS
  'Galeria de fotos do produto. Uma linha por foto; no máximo uma é a capa, e produtos.imagem_url é mantida igual à capa por gatilho.';

CREATE UNIQUE INDEX IF NOT EXISTS produto_imagens_uma_capa ON public.produto_imagens (produto_id) WHERE capa;
CREATE UNIQUE INDEX IF NOT EXISTS produto_imagens_url_unica ON public.produto_imagens (produto_id, url);
CREATE INDEX IF NOT EXISTS produto_imagens_fila ON public.produto_imagens (produto_id, ordem, id);
-- Para a conferência "algum outro registro usa este arquivo?" antes de apagar do bucket.
CREATE INDEX IF NOT EXISTS produto_imagens_por_url ON public.produto_imagens (url);

-- B. Acesso ---------------------------------------------------------------------------------------
ALTER TABLE public.produto_imagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "produto_imagens leitura" ON public.produto_imagens;
CREATE POLICY "produto_imagens leitura" ON public.produto_imagens FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = produto_imagens.produto_id));

DROP POLICY IF EXISTS "produto_imagens escrita gestao" ON public.produto_imagens;
CREATE POLICY "produto_imagens escrita gestao" ON public.produto_imagens FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin') OR public.has_role((SELECT auth.uid()), 'gestor'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin') OR public.has_role((SELECT auth.uid()), 'gestor'));

REVOKE ALL ON public.produto_imagens FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_imagens TO authenticated;
GRANT ALL ON public.produto_imagens TO service_role;

-- C. Backfill (antes dos gatilhos) -----------------------------------------------------------------
INSERT INTO public.produto_imagens (produto_id, url, ordem, capa, origem, created_by)
SELECT p.id,
       btrim(p.imagem_url),
       0,
       true,
       CASE WHEN p.imagem_url LIKE '%/produtos-fotos/ia/%' THEN 'ia' ELSE 'manual' END,
       NULL
FROM public.produtos p
WHERE p.imagem_url IS NOT NULL AND btrim(p.imagem_url) <> ''
ON CONFLICT DO NOTHING;

-- D. galeria -> produtos.imagem_url -----------------------------------------------------------------
-- ANTES: regras de capa. A primeira foto vira capa; marcar capa desmarca a outra; produto_id não muda.
CREATE OR REPLACE FUNCTION public.tg_produto_imagens_capa_antes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.produto_id IS DISTINCT FROM OLD.produto_id THEN
    RAISE EXCEPTION 'A foto não pode mudar de produto.' USING ERRCODE = 'P0001';
  END IF;
  NEW.url := btrim(NEW.url);

  IF TG_OP = 'INSERT' AND NOT NEW.capa
     AND NOT EXISTS (SELECT 1 FROM public.produto_imagens WHERE produto_id = NEW.produto_id AND capa) THEN
    NEW.capa := true;  -- a primeira foto (ou a primeira depois de a capa ser tirada) é a capa
  END IF;

  IF NEW.capa AND (TG_OP = 'INSERT' OR NOT OLD.capa) THEN
    UPDATE public.produto_imagens SET capa = false
     WHERE produto_id = NEW.produto_id AND capa AND id <> NEW.id;
  END IF;
  RETURN NEW;
END $$;

-- DEPOIS: a coluna do produto acompanha a capa; apagar a capa passa a marca para a próxima da fila.
CREATE OR REPLACE FUNCTION public.tg_produto_imagens_sincroniza_depois()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pid uuid := COALESCE(NEW.produto_id, OLD.produto_id);
  url_da_capa text;
  tem_fotos boolean;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.capa THEN
    -- Passa a capa para a próxima da fila (se houver). O UPDATE dispara este gatilho de novo e fecha a conta.
    UPDATE public.produto_imagens SET capa = true
     WHERE id = (SELECT id FROM public.produto_imagens WHERE produto_id = pid ORDER BY ordem, id LIMIT 1);
  END IF;

  SELECT url INTO url_da_capa FROM public.produto_imagens WHERE produto_id = pid AND capa LIMIT 1;
  IF url_da_capa IS NULL THEN
    -- Sem capa e com fotos: estado de passagem (uma capa saiu e a outra ainda vai entrar na mesma gravação).
    SELECT EXISTS (SELECT 1 FROM public.produto_imagens WHERE produto_id = pid) INTO tem_fotos;
    IF tem_fotos AND TG_OP <> 'DELETE' THEN RETURN NULL; END IF;
  END IF;

  PERFORM set_config('bex.sincronizando_foto', '1', true);
  UPDATE public.produtos SET imagem_url = url_da_capa
   WHERE id = pid AND imagem_url IS DISTINCT FROM url_da_capa;
  PERFORM set_config('bex.sincronizando_foto', '', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_produto_imagens_capa_antes ON public.produto_imagens;
CREATE TRIGGER tg_produto_imagens_capa_antes
  BEFORE INSERT OR UPDATE ON public.produto_imagens
  FOR EACH ROW EXECUTE FUNCTION public.tg_produto_imagens_capa_antes();

DROP TRIGGER IF EXISTS tg_produto_imagens_sincroniza_depois ON public.produto_imagens;
CREATE TRIGGER tg_produto_imagens_sincroniza_depois
  AFTER INSERT OR UPDATE OR DELETE ON public.produto_imagens
  FOR EACH ROW EXECUTE FUNCTION public.tg_produto_imagens_sincroniza_depois();

-- E. produtos.imagem_url -> galeria ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_produtos_foto_para_galeria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nova text := NULLIF(btrim(NEW.imagem_url), '');
  existente uuid;
BEGIN
  IF current_setting('bex.sincronizando_foto', true) = '1' THEN RETURN NULL; END IF;  -- veio da galeria

  IF nova IS NULL THEN
    UPDATE public.produto_imagens SET capa = false WHERE produto_id = NEW.id AND capa;
    RETURN NULL;
  END IF;

  SELECT id INTO existente FROM public.produto_imagens WHERE produto_id = NEW.id AND url = nova;
  IF existente IS NOT NULL THEN
    UPDATE public.produto_imagens SET capa = true WHERE id = existente AND NOT capa;
  ELSE
    INSERT INTO public.produto_imagens (produto_id, url, ordem, capa, origem, created_by)
    VALUES (
      NEW.id, nova,
      COALESCE((SELECT max(ordem) + 1 FROM public.produto_imagens WHERE produto_id = NEW.id), 0),
      true,
      CASE WHEN nova LIKE '%/produtos-fotos/ia/%' THEN 'ia' ELSE 'manual' END,
      auth.uid()
    );
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_produtos_foto_para_galeria ON public.produtos;
CREATE TRIGGER tg_produtos_foto_para_galeria
  AFTER UPDATE OF imagem_url ON public.produtos
  FOR EACH ROW WHEN (OLD.imagem_url IS DISTINCT FROM NEW.imagem_url)
  EXECUTE FUNCTION public.tg_produtos_foto_para_galeria();

-- Gatilho nasce aberto para PUBLIC: fecha a execução direta (eles só rodam como gatilho).
REVOKE ALL ON FUNCTION public.tg_produto_imagens_capa_antes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_produto_imagens_sincroniza_depois() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_produtos_foto_para_galeria() FROM PUBLIC, anon, authenticated;

COMMIT;
