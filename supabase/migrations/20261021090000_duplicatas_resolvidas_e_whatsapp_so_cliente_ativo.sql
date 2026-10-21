-- Cadastros repetidos resolvidos e o WhatsApp ligando só a cliente ATIVO (21/10/2026).
--
-- Decisão do dono em 21/10 ("resolver todas as pendências"), sobre a lista de
-- 20/10 (os únicos grupos repetidos do banco):
--   * YRLEN ×5 (96991562194): fica a primeira (19/10, 8a82c1a7); as quatro de
--     20/10 10:39 — cliques repetidos num botão que não travava — são
--     INATIVADAS. Nenhuma tinha nada ligado (26 tabelas com FK para clientes
--     conferidas).
--   * Cibele Oliveira ×2 (9681176844, 13/10 14:38, meio segundo de diferença):
--     fica a mais antiga (28a00daf, com o orçamento #81 e 2 arquivos); o
--     orçamento #80 e o orçamento 3D da outra (a3d3b3f7) passam para ela, que
--     é INATIVADA.
-- Nada é apagado: inativo volta com um clique na ficha.
--
-- E o motivo de não bastar inativar: `whatsapp_registrar_mensagem` liga a
-- conversa sozinho só quando o telefone bate com UM cliente — e contava os
-- inativos. Com as quatro YRLEN desligadas, continuariam cinco. Agora conta só
-- os ativos; se só houver inativo, ele ainda é o cliente (quem volta a escrever
-- depois de desligado continua conhecido). `vincular_cliente_do_contato`
-- (contato avulso do orçamento vira cliente) passa a preferir o ativo.
--
-- As duas funções são editadas por substituição ancorada no corpo VIVO, como em
-- 20261014120000: a âncora tem de aparecer o número exato de vezes, senão a
-- migração para sem mudar nada.

-- 1. O WhatsApp conta só cliente ativo ------------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.whatsapp_registrar_mensagem'::regproc);
  v_de text := E'  SELECT array_agg(DISTINCT c.id) INTO v_clientes\n  FROM (\n    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel\n    UNION\n    SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel\n    UNION\n    SELECT cliente_id FROM public.cliente_contatos\n    WHERE public.normalize_whatsapp_phone(telefone) = v_tel\n  ) c;\n';
  v_para text := E'  -- Só cliente ATIVO conta (21/10/2026): cadastro repetido e desligado não\n  -- pode impedir a ligação automática. Se só houver inativo, ele ainda é o\n  -- cliente — quem volta a escrever depois de desligado continua conhecido.\n  SELECT array_agg(DISTINCT c.id) INTO v_clientes\n  FROM (\n    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel AND ativo IS NOT FALSE\n    UNION\n    SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel AND ativo IS NOT FALSE\n    UNION\n    SELECT cc.cliente_id FROM public.cliente_contatos cc\n      JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE\n    WHERE public.normalize_whatsapp_phone(cc.telefone) = v_tel\n  ) c;\n  IF v_clientes IS NULL THEN\n    SELECT array_agg(DISTINCT c.id) INTO v_clientes\n    FROM (\n      SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel\n      UNION\n      SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel\n      UNION\n      SELECT cliente_id FROM public.cliente_contatos\n      WHERE public.normalize_whatsapp_phone(telefone) = v_tel\n    ) c;\n  END IF;\n';
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'whatsapp_registrar_mensagem: âncora apareceu % vezes (esperado 1) — o corpo vivo mudou, conferir antes', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 2. Contato avulso vira cliente: prefere o ativo ----------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.vincular_cliente_do_contato'::regproc);
  v_de text := 'ORDER BY created_at LIMIT 1';
  v_para text := 'ORDER BY ativo IS NOT FALSE DESC, created_at LIMIT 1';
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 2 THEN
    RAISE EXCEPTION 'vincular_cliente_do_contato: âncora apareceu % vezes (esperado 2)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 3. YRLEN: fica a primeira; as quatro repetidas saem de cena ----------------------
UPDATE public.clientes SET ativo = false
 WHERE id IN ('61b42546-fa83-436a-8de0-072bb382edd5', '74a99cef-3ce9-4153-9f02-7f829cab5a70',
              '5ee82f0b-8bff-42ad-9ff3-5a6a781057e1', 'c9cbf70e-f811-4c4c-9011-829152bfcd25')
   AND ativo;

-- 4. Cibele Oliveira: o que era da repetida passa para a mais antiga ---------------
UPDATE public.orcamentos SET cliente_id = '28a00daf-7ab3-4790-b4c5-3e27e0b52464'
 WHERE cliente_id = 'a3d3b3f7-5caf-44a8-ad05-23b3c4823a65';
UPDATE public.orcamentos_3d SET cliente_id = '28a00daf-7ab3-4790-b4c5-3e27e0b52464'
 WHERE cliente_id = 'a3d3b3f7-5caf-44a8-ad05-23b3c4823a65';
UPDATE public.clientes SET ativo = false
 WHERE id = 'a3d3b3f7-5caf-44a8-ad05-23b3c4823a65' AND ativo;

-- 5. Acrílico Virgem Recortado 3mm: a chapa certa e a ficha -------------------------
-- Apontava para "Acrilico esp dourado 2mm" (o espelhado) e não tinha ficha.
-- Decisão do dono em 21/10: chapa cristal virgem 3 mm, 1 m² por m² vendido.
-- O "Acrílico Virgem Recortado 2mm" continua com o Yvens: não há chapa virgem de
-- 2 mm cadastrada.
UPDATE public.produtos SET material_principal_id = 'd4f62f64-1647-49a6-9827-30ca6547ab6c'
 WHERE id = '328251b9-2360-4b62-8db0-1da77641a60d';
INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, observacao)
SELECT '328251b9-2360-4b62-8db0-1da77641a60d', 'd4f62f64-1647-49a6-9827-30ca6547ab6c', 1,
       'Chapa cristal virgem 3 mm, 1 m² por m² vendido (decisão do dono, 21/10/2026)'
 WHERE NOT EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = '328251b9-2360-4b62-8db0-1da77641a60d');
