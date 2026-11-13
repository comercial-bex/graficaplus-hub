-- AINDA NÃO APLICADA. O dono ensaia e aplica; depois troca esta linha por "APLICADA em <data>".
-- ORDEM: aplicar ESTA migração ANTES de publicar o front (a tela passa a mandar p_tipo).
--
-- PALAVRAS COM INTENÇÃO (Bex Print, onda A2 da origem do contato)
--
-- O QUE FAZ
--  1. palavras_de_origem passa a aceitar dois tipos: 'cliente_final' e 'parceiro' (antes só 'parceiro').
--  2. origem_salvar_palavra ganha p_tipo (padrão 'parceiro'). A lista de parâmetros mudou, então a
--     assinatura antiga (text, boolean) é APAGADA: deixar as duas criaria sobrecarga no PostgREST
--     ("Could not choose the best candidate function") e a tela pararia de salvar.
--  3. _wa_classificar_contato passa a classificar cliente_final por palavra, com esta prioridade:
--       etiqueta manual
--       > anúncio
--       > palavra de PARCEIRO
--       > telefone de parceiro cadastrado
--       > palavra de CLIENTE FINAL
--       > sem sinal (tipo nulo, "tipo a confirmar").
--     Palavra de parceiro vence palavra de cliente final se as duas aparecerem na mesma mensagem.
--     A fronteira continua só à esquerda: "parceria" casa "parcerias", "meu parceiro indicou" não casa
--     "ser parceiro".
--  4. Semeia as quatro palavras de cliente final dadas pelo dono: quero comprar agora, quero fazer um
--     orcamento, quero saber mais, gostei do outro.
--
-- REGRAS DO DONO QUE ESTA MIGRAÇÃO NÃO PODE QUEBRAR
--  a) Só duas modalidades: parceiro e cliente_final. Nunca perguntar o tipo ao contato. Nenhuma linha
--     daqui manda mensagem ao contato.
--  b) O tipo é uma etiqueta INTERNA e não muda preço. Esta migração não toca em parceiros, orçamentos,
--     tabelas de preço nem em clientes.
--
-- O AVISO DO GRUPO NÃO MUDA
--  tg_atendimento_avisa_grupo já trata tipo_contato = 'cliente_final' como "cliente final, tabela cheia".
--  Lido em 13/11/2026 na migração 20261113100000 (seção do preço). Por isso não é recriado aqui.
--
-- LIÇÕES APLICADAS
--  * A função de classificação foi copiada da definição que a migração 20261113100000 aplicou (seção 5.2).
--    Antes de aplicar, confira com pg_get_functiondef que o banco vivo ainda é essa versão.
--  * CREATE OR REPLACE mantém o ACL, mas o REVOKE e o GRANT são repetidos pelo NOME e o bloco final confere.
--  * REVOKE de PUBLIC não fecha o anon: revoga de PUBLIC, anon e authenticated e só depois concede.

BEGIN;

-- 1. Tipo da palavra: dois valores --------------------------------------------------------------
ALTER TABLE public.palavras_de_origem DROP CONSTRAINT IF EXISTS palavras_de_origem_tipo_check;
ALTER TABLE public.palavras_de_origem
  ADD CONSTRAINT palavras_de_origem_tipo_check CHECK (tipo IN ('cliente_final', 'parceiro'));

-- 2. Salvar palavra com tipo (assinatura nova, a antiga some) -----------------------------------
DROP FUNCTION IF EXISTS public.origem_salvar_palavra(text, boolean);

CREATE OR REPLACE FUNCTION public.origem_salvar_palavra(p_palavra text, p_ativo boolean, p_tipo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_palavra text := public.bex_normalizar_texto(p_palavra);
  v_tipo text;
  v_tipo_antes text;
BEGIN
  PERFORM public.require_permission('configuracoes.manage');
  IF v_palavra = '' THEN
    RAISE EXCEPTION 'Escreva a palavra.';
  END IF;
  IF char_length(replace(v_palavra, ' ', '')) < 4 THEN
    RAISE EXCEPTION 'A palavra precisa ter pelo menos 4 letras, senão marca contato errado.';
  END IF;
  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('cliente_final', 'parceiro') THEN
    RAISE EXCEPTION 'O tipo da palavra é cliente final ou parceiro.';
  END IF;

  -- Sem tipo na chamada (tela antiga: só ligar e desligar) o tipo que a palavra já tem é preservado;
  -- palavra nova sem tipo nasce como parceiro, como era antes.
  SELECT w.tipo INTO v_tipo_antes FROM public.palavras_de_origem w WHERE w.palavra = v_palavra;
  v_tipo := coalesce(p_tipo, v_tipo_antes, 'parceiro');

  INSERT INTO public.palavras_de_origem (palavra, tipo, ativo)
  VALUES (v_palavra, v_tipo, coalesce(p_ativo, true))
  ON CONFLICT (palavra) DO UPDATE
    SET ativo = coalesce(p_ativo, palavras_de_origem.ativo),
        tipo = v_tipo;

  RETURN jsonb_build_object('palavra', v_palavra, 'tipo', v_tipo, 'tipo_antes', v_tipo_antes,
                            'tipo_mudou', v_tipo_antes IS NOT NULL AND v_tipo_antes <> v_tipo);
END $function$;

REVOKE ALL ON FUNCTION public.origem_salvar_palavra(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.origem_salvar_palavra(text, boolean, text) TO authenticated, service_role;

-- 3. Quem é o contato, agora com palavra de cliente final ---------------------------------------
CREATE OR REPLACE FUNCTION public._wa_classificar_contato(p_anuncio text, p_texto text, p_cliente uuid, p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo_anuncio text;
  v_produto text;
  v_nome text;
  v_conjunto text;
  v_lead_tipo text;
  v_lead_origem text;
  v_lead_tel text;
  v_texto text := public.bex_normalizar_texto(p_texto);
  v_tipo text;
  v_origem text;
BEGIN
  IF nullif(btrim(p_anuncio), '') IS NOT NULL THEN
    SELECT c.tipo,
           coalesce(nullif(btrim(a.produto), ''), nullif(btrim(c.produto_padrao), '')),
           coalesce(nullif(btrim(a.titulo_criativo), ''), nullif(btrim(a.nome_interno), '')),
           c.conjunto_id
      INTO v_tipo_anuncio, v_produto, v_nome, v_conjunto
      FROM public.anuncios_origem a
      LEFT JOIN public.conjuntos_anuncio c ON c.conjunto_id = a.conjunto_id AND c.ativo
     WHERE a.anuncio_id = btrim(p_anuncio);
  END IF;

  IF p_lead IS NOT NULL THEN
    SELECT l.tipo, l.tipo_origem, l.telefone_normalizado
      INTO v_lead_tipo, v_lead_origem, v_lead_tel
      FROM public.leads l WHERE l.id = p_lead;
  END IF;

  IF v_lead_tipo IS NOT NULL AND v_lead_origem = 'manual' THEN
    -- O que a equipe marcou na mão nunca é desfeito por regra automática.
    v_tipo := v_lead_tipo;
    v_origem := 'manual';
  ELSIF v_tipo_anuncio IS NOT NULL THEN
    v_tipo := v_tipo_anuncio;
    v_origem := 'anuncio';
  ELSIF v_texto <> '' AND EXISTS (
          SELECT 1 FROM public.palavras_de_origem w
           WHERE w.ativo AND w.tipo = 'parceiro' AND position(' ' || w.palavra IN ' ' || v_texto) > 0) THEN
    -- Fronteira só à esquerda: "parceria" casa "parcerias", mas "meu parceiro indicou" não casa "ser parceiro".
    v_tipo := 'parceiro';
    v_origem := 'palavra';
  ELSIF (p_cliente IS NOT NULL AND public.parceiro_ativo_do_cliente(p_cliente) IS NOT NULL)
        OR (v_lead_tel IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.parceiros pa
               WHERE pa.status = 'ativo' AND pa.marca_telefone IS NOT NULL
                 AND public.normalize_whatsapp_phone(pa.marca_telefone) = v_lead_tel)) THEN
    v_tipo := 'parceiro';
    v_origem := 'telefone';
  ELSIF v_texto <> '' AND EXISTS (
          SELECT 1 FROM public.palavras_de_origem w
           WHERE w.ativo AND w.tipo = 'cliente_final' AND position(' ' || w.palavra IN ' ' || v_texto) > 0) THEN
    -- Só chega aqui sem anúncio, sem palavra de parceiro e sem cadastro de parceiro.
    v_tipo := 'cliente_final';
    v_origem := 'palavra';
  END IF;

  RETURN jsonb_build_object('tipo', v_tipo, 'origem', v_origem, 'produto', v_produto,
                            'anuncio_nome', v_nome, 'conjunto_id', v_conjunto);
END $function$;

REVOKE ALL ON FUNCTION public._wa_classificar_contato(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_classificar_contato(text, text, uuid, uuid) TO service_role;

-- 4. Palavras de cliente final do dono (já normalizadas: sem acento, minúsculas) -----------------
INSERT INTO public.palavras_de_origem (palavra, tipo, ativo) VALUES
  ('quero comprar agora', 'cliente_final', true),
  ('quero fazer um orcamento', 'cliente_final', true),
  ('quero saber mais', 'cliente_final', true),
  ('gostei do outro', 'cliente_final', true)
ON CONFLICT (palavra) DO UPDATE SET tipo = EXCLUDED.tipo, ativo = true;

-- 5. Conferência: se algo fugir, a migração inteira é desfeita -----------------------------------
DO $conferencia$
DECLARE
  v_n integer;
  v_def text;
  v_r jsonb;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.palavras_de_origem'::regclass AND conname = 'palavras_de_origem_tipo_check';
  IF v_def IS NULL OR v_def NOT LIKE '%cliente_final%' OR v_def NOT LIKE '%parceiro%' THEN
    RAISE EXCEPTION 'palavras_de_origem_tipo_check fora do esperado: %', v_def;
  END IF;

  -- Uma assinatura só, a nova (senão o PostgREST cai em sobrecarga).
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'origem_salvar_palavra';
  IF v_n <> 1 THEN RAISE EXCEPTION 'origem_salvar_palavra tem % versões, deveria ter 1', v_n; END IF;
  IF to_regprocedure('public.origem_salvar_palavra(text, boolean, text)') IS NULL THEN
    RAISE EXCEPTION 'origem_salvar_palavra(text, boolean, text) não existe';
  END IF;

  IF has_function_privilege('anon', 'public.origem_salvar_palavra(text, boolean, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.origem_salvar_palavra(text, boolean, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.origem_salvar_palavra(text, boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL de origem_salvar_palavra fora do esperado';
  END IF;
  IF has_function_privilege('anon', 'public._wa_classificar_contato(text, text, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._wa_classificar_contato(text, text, uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._wa_classificar_contato(text, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL de _wa_classificar_contato fora do esperado';
  END IF;

  SELECT count(*) INTO v_n FROM public.palavras_de_origem
   WHERE tipo = 'cliente_final'
     AND palavra IN ('quero comprar agora', 'quero fazer um orcamento', 'quero saber mais', 'gostei do outro');
  IF v_n <> 4 THEN RAISE EXCEPTION 'seed: % de 4 palavras de cliente final', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.palavras_de_origem WHERE tipo = 'parceiro' AND palavra = 'quero ser parceiro';
  IF v_n <> 1 THEN RAISE EXCEPTION 'a palavra quero ser parceiro sumiu'; END IF;

  -- Comportamento: prioridade e fronteira (sem anúncio, cliente nem lead).
  v_r := public._wa_classificar_contato(NULL, 'Oi, quero comprar agora!', NULL, NULL);
  IF v_r->>'tipo' IS DISTINCT FROM 'cliente_final' OR v_r->>'origem' IS DISTINCT FROM 'palavra' THEN
    RAISE EXCEPTION 'palavra de cliente final não classificou: %', v_r;
  END IF;
  -- Os dois casos abaixo dependem de palavras que o dono pode ter desligado: só valem com elas ativas.
  IF EXISTS (SELECT 1 FROM public.palavras_de_origem WHERE ativo AND tipo = 'parceiro' AND palavra = 'quero ser parceiro') THEN
    v_r := public._wa_classificar_contato(NULL, 'quero saber mais, quero ser parceiro', NULL, NULL);
    IF v_r->>'tipo' IS DISTINCT FROM 'parceiro' OR v_r->>'origem' IS DISTINCT FROM 'palavra' THEN
      RAISE EXCEPTION 'palavra de parceiro deveria vencer a de cliente final: %', v_r;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.palavras_de_origem WHERE ativo AND palavra IN ('parceiro', 'meu parceiro', 'meu parceiro indicou')) THEN
    v_r := public._wa_classificar_contato(NULL, 'meu parceiro indicou', NULL, NULL);
    IF v_r->>'tipo' IS NOT NULL THEN
      RAISE EXCEPTION 'meu parceiro indicou não deveria marcar ninguém: %', v_r;
    END IF;
  END IF;
  v_r := public._wa_classificar_contato(NULL, 'bom dia', NULL, NULL);
  IF v_r->>'tipo' IS NOT NULL THEN
    RAISE EXCEPTION 'sem sinal deveria ficar sem tipo: %', v_r;
  END IF;

  -- O aviso continua existindo (esta migração não o recria).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_atendimentos'::regclass
                  AND tgname = 'tg_atendimento_avisa_grupo' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'gatilho tg_atendimento_avisa_grupo sumiu';
  END IF;
END
$conferencia$;

COMMIT;
