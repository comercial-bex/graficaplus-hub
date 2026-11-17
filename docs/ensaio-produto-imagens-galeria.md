# Ensaio da migração: galeria de fotos do produto (produto_imagens)

Migração: `supabase/migrations/20261117210000_produto_imagens_galeria.sql`. Estado: **escrita e NÃO aplicada, NÃO ensaiada no banco vivo** (a regra desta tarefa era não tocar o banco). Quem aplica é o dono do fluxo, depois de rodar o ensaio abaixo. Teste de domínio: `tests/galeria-do-produto-dominio.test.ts`, e de contrato da migração: `tests/galeria-do-produto-migracao.test.ts`.

## O que o ensaio precisa provar

1. O backfill cria uma capa para cada produto que hoje tem `imagem_url` (esperado: 18, todas com origem `ia`) e nenhuma para os outros 52.
2. A primeira foto nova de um produto sem foto vira capa e `produtos.imagem_url` passa a ser essa url.
3. Uma segunda foto NÃO tira a capa; a coluna do produto não muda.
4. `capa = true` numa foto desmarca a anterior na mesma gravação e a coluna acompanha.
5. Apagar a capa passa a capa para a primeira da fila (menor `ordem`) e a coluna acompanha; apagar a última foto zera a coluna.
6. Caminho de volta: quem grava a coluna direto (como a Edição rápida e a geração por IA) cria ou promove a linha da galeria. Limpar a coluna só tira a marca de capa, e as fotos ficam.
7. Perfis: gestor escreve; financeiro, vendedor e conta sem papel leem se leem o produto, mas não escrevem; `anon` não lê nem escreve.
8. `parceiro_catalogo_extras` (contrato antigo do parceiro) devolve a mesma `imagem_url` de antes e depois.

## SQL do ensaio

Rodar no SQL editor, em uma transação só, que termina em erro de propósito (nada fica no banco). Troque `:GESTOR`, `:FINANCEIRO` e `:SEM_PAPEL` por ids reais de `auth.users` (a conta do financeiro e a sem papel, como no ensaio de 17/11 da aprovação).

```sql
BEGIN;

-- 1) aplicar a migração: colar aqui o conteúdo de 20261117210000_produto_imagens_galeria.sql
--    (sem o BEGIN e o COMMIT dele, que já estão neste ensaio)

DO $ensaio$
DECLARE
  r text := '';
  p_sem uuid;       -- produto sem foto
  p_com uuid;       -- produto com foto
  u_antes text;
  n int;
  a uuid; b uuid; c uuid;
  capa_url text;
  col text;
BEGIN
  -- [1] backfill
  SELECT count(*) INTO n FROM public.produto_imagens WHERE capa;
  r := r || format('[1] capas no backfill=%s (esperado 18) com origem ia=%s; produtos com foto sem capa=%s',
        n,
        (SELECT count(*) FROM public.produto_imagens WHERE capa AND origem = 'ia'),
        (SELECT count(*) FROM public.produtos p WHERE btrim(coalesce(p.imagem_url,'')) <> ''
           AND NOT EXISTS (SELECT 1 FROM public.produto_imagens i WHERE i.produto_id = p.id AND i.capa))) || E'\n';

  SELECT id INTO p_sem FROM public.produtos WHERE btrim(coalesce(imagem_url,'')) = '' ORDER BY id LIMIT 1;
  SELECT id, imagem_url INTO p_com, u_antes FROM public.produtos WHERE btrim(coalesce(imagem_url,'')) <> '' ORDER BY id LIMIT 1;

  -- [2] primeira foto vira capa e a coluna acompanha
  INSERT INTO public.produto_imagens (produto_id, url, origem) VALUES (p_sem, 'https://x/storage/v1/object/public/produtos-fotos/manual/t/1.jpg', 'manual') RETURNING id INTO a;
  SELECT capa INTO n FROM (SELECT capa::int FROM public.produto_imagens WHERE id = a) s;
  SELECT imagem_url INTO col FROM public.produtos WHERE id = p_sem;
  r := r || format('[2] primeira virou capa=%s coluna=%s', n = 1, col) || E'\n';

  -- [3] segunda foto não tira a capa
  INSERT INTO public.produto_imagens (produto_id, url, ordem) VALUES (p_sem, 'https://x/storage/v1/object/public/produtos-fotos/manual/t/2.jpg', 1) RETURNING id INTO b;
  SELECT imagem_url INTO col FROM public.produtos WHERE id = p_sem;
  r := r || format('[3] segunda capa=%s coluna ainda a primeira=%s', (SELECT capa FROM public.produto_imagens WHERE id = b), col LIKE '%/1.jpg') || E'\n';

  -- [4] trocar a capa
  UPDATE public.produto_imagens SET capa = true WHERE id = b;
  SELECT imagem_url INTO col FROM public.produtos WHERE id = p_sem;
  r := r || format('[4] capas=%s coluna na segunda=%s', (SELECT count(*) FROM public.produto_imagens WHERE produto_id = p_sem AND capa), col LIKE '%/2.jpg') || E'\n';

  -- [5] apagar a capa promove a próxima; apagar a última zera a coluna
  DELETE FROM public.produto_imagens WHERE id = b;
  SELECT imagem_url INTO col FROM public.produtos WHERE id = p_sem;
  r := r || format('[5a] capa passou para a primeira=%s coluna=%s', (SELECT capa FROM public.produto_imagens WHERE id = a), col LIKE '%/1.jpg') || E'\n';
  DELETE FROM public.produto_imagens WHERE id = a;
  SELECT imagem_url INTO col FROM public.produtos WHERE id = p_sem;
  r := r || format('[5b] sem fotos, coluna nula=%s', col IS NULL) || E'\n';

  -- [6] caminho de volta: gravar a coluna direto
  UPDATE public.produtos SET imagem_url = 'https://x/storage/v1/object/public/produtos-fotos/ia/t/9.png' WHERE id = p_sem;
  r := r || format('[6a] linha criada como capa ia=%s',
        EXISTS (SELECT 1 FROM public.produto_imagens WHERE produto_id = p_sem AND capa AND origem = 'ia' AND url LIKE '%/ia/t/9.png')) || E'\n';
  UPDATE public.produtos SET imagem_url = NULL WHERE id = p_sem;
  r := r || format('[6b] limpar a coluna: fotos ficam=%s capas=%s',
        (SELECT count(*) FROM public.produto_imagens WHERE produto_id = p_sem),
        (SELECT count(*) FROM public.produto_imagens WHERE produto_id = p_sem AND capa)) || E'\n';
  -- foto antiga já na galeria volta a ser capa sem duplicar
  UPDATE public.produtos SET imagem_url = 'https://x/storage/v1/object/public/produtos-fotos/ia/t/9.png' WHERE id = p_sem;
  r := r || format('[6c] sem duplicar: linhas=%s capas=%s',
        (SELECT count(*) FROM public.produto_imagens WHERE produto_id = p_sem),
        (SELECT count(*) FROM public.produto_imagens WHERE produto_id = p_sem AND capa)) || E'\n';

  -- [8] contrato do parceiro intacto para o produto com foto
  r := r || format('[8] produto com foto: coluna igual à capa=%s',
        (SELECT p.imagem_url = i.url FROM public.produtos p JOIN public.produto_imagens i ON i.produto_id = p.id AND i.capa WHERE p.id = p_com)) || E'\n';

  -- [7] perfis (ajuste os ids)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ':GESTOR', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.produto_imagens (produto_id, url) VALUES (p_sem, 'https://x/storage/v1/object/public/produtos-fotos/manual/t/gestor.jpg');
    r := r || '[7] gestor escreve: OK' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || '[7] gestor escreve: ERRO ' || SQLERRM || E'\n'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ':FINANCEIRO', 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.produto_imagens (produto_id, url) VALUES (p_sem, 'https://x/storage/v1/object/public/produtos-fotos/manual/t/fin.jpg');
    r := r || '[7] financeiro escreve: PASSOU (ERRO DO ENSAIO)' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || '[7] financeiro escreve: barrado (esperado) ' || SQLERRM || E'\n'; END;
  r := r || format('[7] financeiro lê %s linhas', (SELECT count(*) FROM public.produto_imagens)) || E'\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ':SEM_PAPEL', 'role', 'authenticated')::text, true);
  r := r || format('[7] conta sem papel lê %s linhas (esperado 0 se não lê produtos)', (SELECT count(*) FROM public.produto_imagens)) || E'\n';
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.produto_imagens LIMIT 1;
    r := r || '[7] anon lê: PASSOU (ERRO DO ENSAIO)' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || '[7] anon lê: barrado (esperado) ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  RAISE EXCEPTION E'ENSAIO OK, DESFEITO:\n%', r;
END
$ensaio$;
```

## Conferir depois do ensaio

Como a transação termina em erro, nada fica. Confirme com `SELECT to_regclass('public.produto_imagens');` (deve voltar nulo) e que `produtos.imagem_url` das 18 fotos segue igual.

## Depois de aplicar

- A tela (`GaleriaDoProduto`) já tolera a migração ausente: mostra o aviso "A galeria de fotos ainda não foi ativada no banco" e nunca grava direto em `produtos`.
- A geração por IA passa a registrar a imagem na galeria sozinha (e o gatilho E cobre o caso em que a gravação direta já criou a linha).
- Conferir uma vez: `SELECT count(*) FROM produtos p WHERE btrim(coalesce(imagem_url,'')) <> '' AND NOT EXISTS (SELECT 1 FROM produto_imagens i WHERE i.produto_id = p.id AND i.capa);` deve dar 0.
