-- =============================================================================
-- Catálogo como mini e-commerce para orçar: categorias, carrinho e pedido de
-- cotação (06/10/2026)
--
-- O DONO (áudio de 06/10/2026): "o catálogo tem de ser estruturado como um
-- mini e-commerce, só para orçamento. É o que a gente mostra no iPad, no
-- computador ou no celular. Para cada produto que eu selecionar, escolho a
-- quantidade; vai para o orçamento; dá para fazer orçamento prévio a partir do
-- catálogo. Tem de trazer alternativas e sugestões, como o e-commerce faz.
-- Dividir os produtos por categorias: canetas, copos, brindes…"
--
-- O QUE ESTE ARQUIVO FAZ
--   1. `fornecedor_secoes.categoria`: cada uma das 50 seções da tabela da LUGA
--      aponta para uma das 11 prateleiras da loja (lista fechada no CHECK; a
--      mesma de src/domain/catalogo/categorias.ts). Seção nova sem apontar
--      cai em "Outros" na tela — nunca some.
--   2. A vitrine do cliente (`catalogo_link_abrir`) passa a dizer a categoria
--      de cada item. Lista fechada de chaves, como antes: +1 chave, "categoria".
--   3. `catalogo_cotacoes`: o pedido de cotação que o CLIENTE faz pelo link —
--      nome, telefone, itens com quantidade e opção. Gravado por função
--      DEFINER só do servidor (`catalogo_link_pedir_cotacao`), com freio por
--      origem (o mesmo desenho do PIN da TV) e por link. A equipe lê em
--      `catalogo_cotacoes()`; nada é mandado AO cliente por aqui.
--   4. `catalogo_gerar_orcamento`: o carrinho da EQUIPE vira UM orçamento em
--      rascunho, com todos os itens, pelo MESMO caminho de
--      `catalogo_adicionar_ao_orcamento` (preço de venda, custo e gatilhos
--      iguais aos de hoje). Aceita "sem cliente ainda": `orcamentos.cliente_id`
--      é nulo por desenho (2 orçamentos já estão assim), é o orçamento prévio.
--
-- ORDEM DE APLICAÇÃO: este arquivo ANTES de publicar o front. A tela nova lê
-- `fornecedor_secoes.categoria`; nesta base, select com coluna inexistente
-- derruba a consulta inteira.
--
-- REGRAS DE ACESSO (as mesmas de 20261005200000)
--   - Tabela nova: RLS ligada, REVOKE ALL de PUBLIC, anon e authenticated, sem
--     policy — só função chega nela.
--   - Função nova nasce fechada (REVOKE de PUBLIC, anon, authenticated e
--     service_role) e abre só para quem deve: a do cliente, para service_role
--     (a rota de servidor); as da equipe, para authenticated — cada uma confere
--     a permissão por dentro.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A categoria de cada seção
-- -----------------------------------------------------------------------------

ALTER TABLE public.fornecedor_secoes
  ADD COLUMN IF NOT EXISTS categoria text;

ALTER TABLE public.fornecedor_secoes DROP CONSTRAINT IF EXISTS fornecedor_secoes_categoria;
ALTER TABLE public.fornecedor_secoes ADD CONSTRAINT fornecedor_secoes_categoria CHECK (
  categoria IS NULL OR categoria IN (
    'canetas', 'copos', 'chaveiros', 'cadernos', 'agendas', 'calendarios',
    'sacolas', 'utilidades', 'sublimacao', 'encadernacao', 'outros'));

COMMENT ON COLUMN public.fornecedor_secoes.categoria IS
  'A prateleira da loja (canetas, copos, chaveiros…). Lista fechada; nulo = a tela deduz do título.';

-- As 50 seções da tabela da LUGA (setembro/2026), pelo título que a planilha
-- imprime. Seção que não casar fica nula e a tela a põe em "Outros".
UPDATE public.fornecedor_secoes s
   SET categoria = CASE upper(btrim(s.titulo))
     WHEN 'AGENDA DIÁRIA CAPA COSTURADA' THEN 'agendas'
     WHEN 'AGENDA DIÁRIA EM WIRE-O' THEN 'agendas'
     WHEN 'PLANNER FEMININO PERMANENTE' THEN 'agendas'
     WHEN 'AGENDA ESCOLAR' THEN 'agendas'
     WHEN 'AGENDA COMPACTA PERMANENTE COSTURADA' THEN 'agendas'
     WHEN 'AGENDA COMPACTA PERMANENTE EM WIRE-O' THEN 'agendas'
     WHEN 'AGENDA DE BOLSO PERMANENTE' THEN 'agendas'
     WHEN 'AGENDA SEMANAL SUPER' THEN 'agendas'
     WHEN 'CADERNETA TIPO MOLESKINE "PEQUENA"' THEN 'cadernos'
     WHEN 'CADERNETA TIPO MOLESKINE "GRANDE"' THEN 'cadernos'
     WHEN 'CADERNETA TIPO MOLESKINE "GRANDE" PERSONALIZADO E CAPA FANTASIA' THEN 'cadernos'
     WHEN 'CADERNETA E CADERNOS DE NEGÓCIOS' THEN 'cadernos'
     WHEN 'CANETAS PLÁSTICAS - SEMI METAL E METAL' THEN 'canetas'
     WHEN 'CHAVEIROS DE METAL IMPORTADOS' THEN 'chaveiros'
     WHEN 'CHAVEIROS DE METAL / RESINAS (ABRIDOR, GIRATORIO E MOSQUETÃO PORTA BOLSA)' THEN 'chaveiros'
     WHEN 'CHAVEIROS CATAFORÉTICOS - OURO' THEN 'chaveiros'
     WHEN 'CHAVEIROS CROMADO A VÁCUO' THEN 'chaveiros'
     WHEN 'CHAVEIROS - CHAPINHAS DE METAL / EMBORRACHADOS IMÃ GELADEIRA ABRIDOR' THEN 'chaveiros'
     WHEN 'SQUEEZES E GARRAFAS PLÁSTICAS' THEN 'copos'
     WHEN 'COPO DE CAFÉ' THEN 'copos'
     WHEN 'PORTA LITRINHO TÉRMICO 1ªLINHA' THEN 'copos'
     WHEN 'CANECA LIVE AAA' THEN 'copos'
     WHEN 'CANECA / TAÇA DE VIDRO' THEN 'copos'
     WHEN 'CANECAS / LONG DRINK / TAÇAS / CANECA GEL / CANECAS FOTO' THEN 'copos'
     WHEN 'FOLHINHA COMERCIAL' THEN 'calendarios'
     WHEN 'CALENDÁRIOS DE PVC - COURO ECOLÓGICO COM REFIL' THEN 'calendarios'
     WHEN 'PVC / COURO ECOLÓGICO' THEN 'calendarios'
     WHEN 'SÓ BASE DE PVC - COURO ECOLÓGICO' THEN 'calendarios'
     WHEN 'REFIL' THEN 'calendarios'
     WHEN 'MANTA MAGNÉTICA' THEN 'calendarios'
     WHEN 'PASTAS / SACOLAS' THEN 'sacolas'
     WHEN 'ECOBAGS E SUBLIMÁTICAS' THEN 'sacolas'
     WHEN 'ESCOVA COM ESPELHO' THEN 'utilidades'
     WHEN 'TRENAS' THEN 'utilidades'
     WHEN 'RÉGUA PLÁSTICA' THEN 'utilidades'
     WHEN 'KIT CHURRASCO E CANTIL PARA WHISKY' THEN 'utilidades'
     WHEN 'PET SUBLIMÁTICO' THEN 'sublimacao'
     WHEN 'MDF SUBLIMÁTICO ULTRA BRILHO 3MM' THEN 'sublimacao'
     WHEN 'PET SUBLIMÁTICO PREMIUM ULTRA BRILHO' THEN 'sublimacao'
     WHEN 'PAPÉIS E ADESIVOS ESPECIAIS' THEN 'sublimacao'
     WHEN 'FILME DE RECORTE FLEX FILME' THEN 'sublimacao'
     WHEN 'PROMOTOR DE ADERÊNCIA' THEN 'sublimacao'
     WHEN 'MÁQUINAS' THEN 'sublimacao'
     WHEN 'TINTAS SUBLIMÁTICAS' THEN 'sublimacao'
     WHEN 'PRODUTOS DIVERSOS PARA SUBLIMAÇÃO' THEN 'sublimacao'
     WHEN 'WIRE-O PARA ENCADERNAÇÃO' THEN 'encadernacao'
     WHEN 'MIOLO' THEN 'encadernacao'
     WHEN 'COURO ECOLÓGICO - COURO SINTÉTICO' THEN 'encadernacao'
     WHEN 'PRODUTOS DIVERSOS' THEN 'outros'
   END
 WHERE s.categoria IS NULL;


-- -----------------------------------------------------------------------------
-- 2. A vitrine do cliente diz a categoria (a mesma função, +1 chave)
-- -----------------------------------------------------------------------------

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
           'categoria', s.categoria,
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

  UPDATE public.catalogo_links SET ultimo_acesso_em = now(), acessos = acessos + 1
   WHERE id = l.id AND (ultimo_acesso_em IS NULL OR ultimo_acesso_em < now() - interval '1 minute');

  RETURN jsonb_build_object('situacao', 'aberto', 'vence_em', l.expira_em,
                            'titulo', coalesce(public.fornecedor_texto_para_cliente(l.titulo, v_fornecedor, NULL), 'Catálogo'),
                            'empresa', coalesce(v_empresa, '{}'::jsonb), 'itens', v_itens);
END $f$;


-- -----------------------------------------------------------------------------
-- 3. O pedido de cotação do cliente
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_cotacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.catalogo_links(id) ON DELETE CASCADE,
  catalogo_id uuid NOT NULL REFERENCES public.fornecedor_catalogos(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 120),
  -- Só dígitos, com DDD (10 a 13: com ou sem o 55 na frente).
  telefone text NOT NULL CHECK (telefone ~ '^[0-9]{10,13}$'),
  -- [{codigo, nome, modalidade, rotulo, quantidade}], montado pela função campo a campo.
  itens jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 50),
  -- SHA-256 do endereço de quem pediu: só para o freio contar por origem.
  origem_hash text CHECK (origem_hash IS NULL OR origem_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atendido_em timestamptz,
  atendido_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS catalogo_cotacoes_catalogo ON public.catalogo_cotacoes (catalogo_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS catalogo_cotacoes_link ON public.catalogo_cotacoes (link_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS catalogo_cotacoes_origem ON public.catalogo_cotacoes (origem_hash, criado_em DESC);

COMMENT ON TABLE public.catalogo_cotacoes IS
  'Pedido de cotação que o cliente fez pelo link da vitrine. Só função chega aqui: RLS ligada e nenhuma policy.';

ALTER TABLE public.catalogo_cotacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_cotacoes FROM PUBLIC, anon, authenticated;
-- catalogo_cotacoes: nenhum GRANT e nenhuma policy. Só por função.

-- O cliente pede cotação pelo link. Só service_role (rota /api/catalogo/cotacao).
--   {estado:'registrado'}                 gravado
--   {estado:'bloqueado', libera_s}        5 pedidos desta origem em 15 min, ou
--                                         60 pedidos deste link em 1 dia
--   {estado:'pedido_invalido', mensagem}  campo fora do combinado, item que não
--                                         é deste link
--   {estado:'invalido'|'vencido'|'revogado'}  o link não abre
-- O jsonb de itens é RECONSTRUÍDO aqui, campo a campo, com o nome que o banco
-- tem (não o que o navegador mandou). Nada do pedido volta ao cliente.
CREATE OR REPLACE FUNCTION public.catalogo_link_pedir_cotacao(
  p_token_hash text, p_nome text, p_telefone text, p_itens jsonb, p_origem_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  l public.catalogo_links%ROWTYPE; v_nome text; v_tel text; v_item jsonb; v_codigo text; v_mod text;
  v_qtd numeric; v_nome_item text; v_itens jsonb := '[]'::jsonb; v_da_origem integer;
  v_primeira timestamptz; v_do_link integer; v_id uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('estado', 'invalido');
  END IF;
  IF p_origem_hash IS NOT NULL AND p_origem_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'catalogo: origem mal formada' USING errcode = '22023';
  END IF;
  SELECT * INTO l FROM public.catalogo_links WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('estado', 'invalido'); END IF;
  IF l.revogado_em IS NOT NULL THEN RETURN jsonb_build_object('estado', 'revogado'); END IF;
  IF l.expira_em <= now() THEN RETURN jsonb_build_object('estado', 'vencido'); END IF;

  v_nome := left(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 120);
  IF length(v_nome) < 2 THEN
    RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Diga seu nome.');
  END IF;
  v_tel := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
  IF v_tel !~ '^[0-9]{10,13}$' THEN
    RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Informe um WhatsApp com DDD.');
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 50 THEN
    RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Escolha de 1 a 50 itens.');
  END IF;

  -- Um pedido por vez: dois ao mesmo tempo não passam juntos pela contagem do freio.
  PERFORM pg_advisory_xact_lock(hashtext('catalogo_link_pedir_cotacao'));

  SELECT count(*), min(c.criado_em) INTO v_da_origem, v_primeira
    FROM public.catalogo_cotacoes c
   WHERE c.criado_em > now() - interval '15 minutes'
     AND c.origem_hash IS NOT DISTINCT FROM p_origem_hash;
  IF v_da_origem >= 5 THEN
    RETURN jsonb_build_object('estado', 'bloqueado',
      'libera_s', greatest(1, ceil(extract(epoch from (v_primeira + interval '15 minutes' - now()))))::integer);
  END IF;
  SELECT count(*), min(c.criado_em) INTO v_do_link, v_primeira
    FROM public.catalogo_cotacoes c
   WHERE c.link_id = l.id AND c.criado_em > now() - interval '1 day';
  IF v_do_link >= 60 THEN
    RETURN jsonb_build_object('estado', 'bloqueado',
      'libera_s', greatest(1, ceil(extract(epoch from (v_primeira + interval '1 day' - now()))))::integer);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Item fora do formato.');
    END IF;
    v_codigo := upper(btrim(coalesce(v_item ->> 'codigo', '')));
    v_mod := nullif(v_item ->> 'modalidade', '');
    v_qtd := CASE WHEN jsonb_typeof(v_item -> 'quantidade') = 'number' THEN (v_item ->> 'quantidade')::numeric END;
    IF v_codigo !~ '^BX-[0-9]{4,7}$' OR v_qtd IS NULL OR v_qtd < 1 OR v_qtd > 1000000 OR v_qtd <> trunc(v_qtd) THEN
      RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Item ou quantidade fora do formato.');
    END IF;
    IF v_mod IS NOT NULL AND v_mod NOT IN ('sem_gravacao', 'valor_unico', 'gravada_1_cor', 'gravada_mais_pagina',
         'gravacao_laser', 'baixo_relevo', 'gravada_100_199', 'gravada_acima_1000', 'com_gravacao', 'transfer_giro') THEN
      RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Opção de gravação desconhecida.');
    END IF;
    -- Só item DESTE link: o pedido não vira porta para enumerar o catálogo.
    SELECT i.nome INTO v_nome_item
      FROM public.catalogo_link_itens li JOIN public.fornecedor_itens i ON i.id = li.item_id
     WHERE li.link_id = l.id AND i.codigo_bex = v_codigo;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado', 'pedido_invalido', 'mensagem', 'Um dos itens não é deste catálogo.');
    END IF;
    v_itens := v_itens || jsonb_build_object(
      'codigo', v_codigo, 'nome', left(v_nome_item, 300), 'modalidade', v_mod,
      'rotulo', CASE WHEN v_mod IS NULL THEN NULL ELSE public.fornecedor_rotulo_modalidade(v_mod) END,
      'quantidade', trunc(v_qtd));
  END LOOP;

  INSERT INTO public.catalogo_cotacoes (link_id, catalogo_id, nome, telefone, itens, origem_hash)
  VALUES (l.id, l.catalogo_id, v_nome, v_tel, v_itens, p_origem_hash)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('estado', 'registrado');
END $f$;

-- Os pedidos de cotação, para a equipe (catalogo.read): quem pediu, quando, o
-- quê, por qual link. Sem o hash da origem. Os 200 mais recentes.
CREATE OR REPLACE FUNCTION public.catalogo_cotacoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_lista jsonb;
BEGIN
  PERFORM public.require_permission('catalogo.read');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'criado_em', c.criado_em, 'nome', c.nome, 'telefone', c.telefone, 'itens', c.itens,
           'atendido_em', c.atendido_em, 'atendido_por', u.nome,
           'link_id', c.link_id, 'link_titulo', l.titulo, 'cliente', cl.nome,
           'catalogo_id', c.catalogo_id, 'catalogo_titulo', fc.titulo)
           ORDER BY c.criado_em DESC), '[]'::jsonb)
    INTO v_lista
    FROM (SELECT * FROM public.catalogo_cotacoes ORDER BY criado_em DESC LIMIT 200) c
    JOIN public.catalogo_links l ON l.id = c.link_id
    JOIN public.fornecedor_catalogos fc ON fc.id = c.catalogo_id
    LEFT JOIN public.clientes cl ON cl.id = l.cliente_id
    LEFT JOIN public.usuarios u ON u.id = c.atendido_por;
  RETURN jsonb_build_object('agora', now(), 'pedidos', v_lista,
                            'abertos', (SELECT count(*) FROM public.catalogo_cotacoes WHERE atendido_em IS NULL));
END $f$;

-- Marca o pedido como atendido (ou desmarca). Quem atende é quem vê o catálogo.
CREATE OR REPLACE FUNCTION public.catalogo_cotacao_atender(p_id uuid, p_atendida boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid; v_quando timestamptz;
BEGIN
  v_uid := public.require_permission('catalogo.read');
  UPDATE public.catalogo_cotacoes
     SET atendido_em = CASE WHEN coalesce(p_atendida, true) THEN now() END,
         atendido_por = CASE WHEN coalesce(p_atendida, true) THEN v_uid END
   WHERE id = p_id
  RETURNING atendido_em INTO v_quando;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de cotação não encontrado.'; END IF;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'catalogo_cotacoes', p_id, 'atender_cotacao', jsonb_build_object('atendida', coalesce(p_atendida, true)));
  RETURN jsonb_build_object('ok', true, 'atendido_em', v_quando);
END $f$;


-- -----------------------------------------------------------------------------
-- 4. O carrinho da equipe vira UM orçamento
-- -----------------------------------------------------------------------------
--
-- p_itens: [{item_id, modalidade, quantidade}], até 100. Cada item entra por
-- `catalogo_adicionar_ao_orcamento` — o mesmo INSERT em `orcamento_itens`, o
-- mesmo custo gravado pelo servidor, os mesmos gatilhos de total. Um item
-- recusado (sob consulta, quantidade fora do múltiplo) desfaz o orçamento
-- inteiro: ou entra tudo, ou nada — o carrinho fica como estava.
-- p_cliente_id nulo = orçamento prévio, "sem cliente ainda" (o vendedor
-- vincula o cliente na tela do orçamento).
CREATE OR REPLACE FUNCTION public.catalogo_gerar_orcamento(
  p_itens jsonb, p_cliente_id uuid DEFAULT NULL, p_titulo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_uid uuid; v_item jsonb; v_r jsonb; v_orc uuid; v_numero integer; v_n integer := 0;
  v_avisos jsonb := '[]'::jsonb; v_total numeric; v_custo numeric; v_titulo text;
BEGIN
  v_uid := public.require_permission('catalogo.read');
  IF NOT public.has_permission(v_uid, 'orcamentos.create') THEN
    RAISE EXCEPTION 'Permissão necessária: orcamentos.create';
  END IF;
  IF NOT public.can_see_prices(v_uid) THEN
    RAISE EXCEPTION 'Para gerar orçamento é preciso ver o preço de venda.';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio.';
  END IF;
  IF jsonb_array_length(p_itens) > 100 THEN RAISE EXCEPTION 'Até 100 itens por orçamento.'; END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;
  v_titulo := left(coalesce(nullif(btrim(p_titulo), ''), 'Brindes do catálogo'), 200);

  INSERT INTO public.orcamentos (cliente_id, titulo, status)
  VALUES (p_cliente_id, v_titulo, 'rascunho')
  RETURNING id, numero INTO v_orc, v_numero;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR coalesce(v_item ->> 'item_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_item -> 'quantidade') <> 'number' THEN
      RAISE EXCEPTION 'Item do carrinho fora do formato.';
    END IF;
    v_r := public.catalogo_adicionar_ao_orcamento(
      (v_item ->> 'item_id')::uuid, v_item ->> 'modalidade', (v_item ->> 'quantidade')::numeric,
      v_orc, NULL, NULL);
    v_n := v_n + 1;
    v_avisos := v_avisos || coalesce(v_r -> 'avisos', '[]'::jsonb);
  END LOOP;

  SELECT o.valor_total, o.custo_estimado INTO v_total, v_custo FROM public.orcamentos o WHERE o.id = v_orc;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'orcamentos', v_orc, 'gerar_orcamento_do_carrinho',
          jsonb_build_object('itens', v_n, 'cliente_id', p_cliente_id, 'sem_cliente', p_cliente_id IS NULL));

  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc, 'orcamento_numero', v_numero,
                            'itens', v_n, 'valor_total', v_total, 'sem_cliente', p_cliente_id IS NULL,
                            'avisos', v_avisos);
END $f$;


-- -----------------------------------------------------------------------------
-- 5. Quem executa o quê
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.catalogo_link_abrir(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_link_pedir_cotacao(text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_cotacoes() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_cotacao_atender(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogo_gerar_orcamento(jsonb, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.catalogo_link_abrir(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_link_pedir_cotacao(text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_cotacoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_cotacao_atender(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_gerar_orcamento(jsonb, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.catalogo_link_pedir_cotacao(text, text, text, jsonb, text) IS
  'Pedido de cotação do cliente pelo link. Só service_role (rota /api/catalogo/cotacao). Freio: 5 por origem em 15 min, 60 por link por dia.';
COMMENT ON FUNCTION public.catalogo_gerar_orcamento(jsonb, uuid, text) IS
  'O carrinho da loja vira um orçamento em rascunho, item a item por catalogo_adicionar_ao_orcamento. Cliente opcional (orçamento prévio).';
