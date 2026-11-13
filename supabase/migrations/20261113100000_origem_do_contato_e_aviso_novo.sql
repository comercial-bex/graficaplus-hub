-- AINDA NÃO APLICADA. O dono ensaia (docs/ensaio-origem-do-contato.md) e aplica; depois troca esta
-- linha por "APLICADA em <data>". ORDEM: aplicar ESTA migração ANTES de publicar o front.
--
-- ORIGEM DO CONTATO E AVISO NOVO NO GRUPO (12/11/2026)
--
-- O QUE FAZ
--  1. Guarda de onde veio cada contato do WhatsApp: o anúncio (id, título do criativo, produto), o
--     canal, o primeiro texto, e o TIPO do contato, que só tem duas modalidades: 'cliente_final' e
--     'parceiro' (parceiro e terceirizado são a mesma coisa). Não existe revendedor aqui.
--  2. Liga anúncio a tipo por TABELA editável numa tela, nunca por código: o tipo e o produto padrão
--     vivem no CONJUNTO de anúncios (conjuntos_anuncio) e cada anúncio herda do conjunto dele
--     (anuncios_origem.conjunto_id). O dono troca o criativo mantendo o mesmo anúncio (mesmo id):
--     a troca só atualiza o título guardado, sem código novo e sem cadastro novo.
--  3. Palavras da primeira mensagem que marcam o contato como parceiro (palavras_de_origem).
--  4. whatsapp_registrar_mensagem passa a classificar o contato na primeira mensagem de uma conversa
--     que abre atendimento. O corpo é a versão VIVA (pg_get_functiondef em 12/11/2026), com UM bloco
--     acrescentado e uma linha de limpeza. Mesma assinatura de 12 parâmetros: tudo novo entra por
--     p_payload (plano, sem chave aninhada).
--  5. tg_atendimento_avisa_grupo passa a dizer o QUE é o contato (lead novo, cliente voltou, parceiro,
--     quer ser parceiro, voltou a conversar), de qual anúncio veio, a primeira mensagem, o preço que
--     a equipe deve esperar e o protocolo na última linha.
--
-- POR QUE
--  O aviso do grupo dizia só "Novo atendimento" e a equipe não sabia se era cliente final, parceiro
--  ou quem veio de qual anúncio. O título, o corpo e o ctwaClid do anúncio eram descartados no
--  webhook. leads.tipo não existia no banco (o selo Parceiro do front estava inerte). Medido em
--  12/11/2026: só 6 de 1.464 mensagens de entrada em 30 dias carregavam anuncio_id.
--
-- REGRAS DO DONO QUE ESTA MIGRAÇÃO NÃO PODE QUEBRAR
--  a) O sistema NUNCA pergunta nada ao contato. Nenhuma linha daqui manda mensagem ao contato. O
--     único destino do aviso é o grupo da equipe (grupo_equipe_destino()).
--  b) O tipo é uma etiqueta INTERNA. Preço de parceiro só existe para quem está CADASTRADO como
--     parceiro (tabela parceiros). Nenhuma função de preço lê leads.tipo ou whatsapp_atendimentos.
--     Esta migração não toca em parceiros, orcamentos, tabelas de preço nem em clientes.revendedor.
--
-- COMO O AVISO ENXERGA O ANÚNCIO (a armadilha da tarefa)
--  O aviso dispara em AFTER INSERT de whatsapp_atendimentos, que o gatilho BEFORE INSERT de
--  whatsapp_mensagens abre ANTES de a linha da mensagem existir. Ler a mensagem dentro do gatilho
--  volta vazio. Então a RPC, antes de inserir a mensagem, classifica o contato e deixa o contexto
--  numa variável de transação (bex.contato_ctx). Um gatilho BEFORE INSERT em whatsapp_atendimentos
--  copia o contexto para as colunas novas (só se o conversa_id bater), e o aviso lê só o NEW.
--  A RPC zera a variável logo depois de inserir a mensagem. Se a classificação falhar, o bloco de
--  EXCEPTION da RPC avisa com RAISE WARNING, desfaz só a classificação, a mensagem entra normalmente
--  e o aviso sai como "tipo a confirmar".
--
-- LIÇÕES DO REPOSITÓRIO APLICADAS
--  * Funções lidas VIVAS (pg_get_functiondef), não da migração: a versão viva de
--    whatsapp_registrar_mensagem não está na main (tem o CASE de canal_origem e 'Anúncio <id>').
--  * Mapa de ACL de coluna conferido em 12/11 em leads, whatsapp_atendimentos, whatsapp_conversas e
--    whatsapp_conversa_eventos: VAZIO. Têm GRANT de tabela inteira, então coluna nova herda o GRANT e
--    nenhuma view quebra por coluna sem permissão. Nenhuma visão lê leads nem whatsapp_atendimentos. Os
--    únicos gatilhos de leads (tg_lead_avisa_grupo, tg_leads_deixa_de_ser_temporario, tg_leads_updated) e
--    de whatsapp_atendimentos (tg_atendimento_avisa_grupo) não são de auditoria nem de hash, então
--    coluna nova não acusa "mudou".
--  * REVOKE de PUBLIC não fecha o anon: cada função e cada tabela nova revoga de PUBLIC, anon e
--    authenticated pelo NOME, e só depois concede o que precisa.
--  * Policy herda RLS da subconsulta: as policies novas usam só is_staff e has_permission, que são
--    SECURITY DEFINER, e nenhuma subconsulta em tabela com RLS.
--  * CREATE OR REPLACE mantém dono, ACL e search_path, mas o REVOKE e o GRANT são repetidos aqui e o
--    bloco final confere tudo (e desfaz a migração inteira se algo estiver fora do esperado).
--  * leads tem GRANT de tabela inteira também para anon, mas a policy de INSERT exige leads.create:
--    anon não insere. Mesmo assim um gatilho impede que quem chama pela API (anon ou authenticated)
--    grave uma origem que não seja 'manual'.
--  * whatsapp_conversa_eventos tem CHECK de tipo: o valor novo 'tipo_contato' entra na lista.
--
-- NÃO HÁ SINCRONIZAÇÃO COM A META. Ficam só as colunas de encaixe (meta_sincronizado_em, meta_situacao,
-- conjunto_definido_por) para a sincronização futura. Ninguém escreve nelas hoje.
--
-- SEED (conta de anúncios "CA - Bex Print", conferida na Meta em 12/11/2026): 2 conjuntos e 8 anúncios.
-- O conjunto de parceiro otimiza para Cadastro (pixel): pode nunca chegar WhatsApp dele. A linha existe
-- mesmo assim.
-- Medido em whatsapp_webhook_eventos: o título do criativo que chega NÃO coincide com o nome do anúncio
-- no Gerenciador. O anúncio 120252258241600481 (nome "Card Modo Expresso (D)") traz "Lona e adesivo em
-- até 4h" e o 120252258241750481 (nome "Card Lona 4h (A)") traz "Modo Expresso: pronto em até 4h". O
-- criativo muda e o id fica, então o produto dos dois NÃO é semeado: o aviso usa o título que chegou.
--
-- Reprocessamento retroativo: nenhum. Contatos antigos ficam sem tipo.

BEGIN;

-- 1. Normalização de texto (sem a extensão unaccent, que não existe aqui) ------------------------------
CREATE OR REPLACE FUNCTION public.bex_normalizar_texto(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT btrim(regexp_replace(
    lower(translate(coalesce(p_texto, ''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z0-9]+', ' ', 'g'))
$function$;

-- Função pura: o navegador logado pode chamar (a tela valida a palavra antes de enviar).
REVOKE ALL ON FUNCTION public.bex_normalizar_texto(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bex_normalizar_texto(text) TO authenticated, service_role;

-- 2. Tabelas ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conjuntos_anuncio (
  conjunto_id text PRIMARY KEY CHECK (btrim(conjunto_id) <> '' AND char_length(conjunto_id) <= 100),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  campanha_id text,
  campanha_nome text,
  tipo text NOT NULL CONSTRAINT conjuntos_anuncio_tipo_check CHECK (tipo IN ('cliente_final', 'parceiro')),
  produto_padrao text,
  ativo boolean NOT NULL DEFAULT true,
  meta_sincronizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.anuncios_origem (
  anuncio_id text PRIMARY KEY CHECK (btrim(anuncio_id) <> '' AND char_length(anuncio_id) <= 100),
  conjunto_id text REFERENCES public.conjuntos_anuncio (conjunto_id) ON DELETE SET NULL,
  nome_interno text,
  titulo_criativo text,
  corpo_criativo text,
  produto text,
  ultimo_link text,
  primeira_vez timestamptz,
  ultima_vez timestamptz,
  total_contatos integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  conjunto_definido_por text NOT NULL DEFAULT 'manual'
    CONSTRAINT anuncios_origem_definido_por_check CHECK (conjunto_definido_por IN ('manual', 'meta')),
  meta_situacao text,
  meta_sincronizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anuncios_origem_conjunto_idx ON public.anuncios_origem (conjunto_id);

CREATE TABLE IF NOT EXISTS public.palavras_de_origem (
  palavra text PRIMARY KEY
    CONSTRAINT palavras_de_origem_normalizada_check CHECK (palavra <> '' AND palavra = public.bex_normalizar_texto(palavra)),
  tipo text NOT NULL DEFAULT 'parceiro'
    CONSTRAINT palavras_de_origem_tipo_check CHECK (tipo = 'parceiro'),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_conjuntos_anuncio_updated ON public.conjuntos_anuncio;
CREATE TRIGGER tg_conjuntos_anuncio_updated BEFORE UPDATE ON public.conjuntos_anuncio
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_anuncios_origem_updated ON public.anuncios_origem;
CREATE TRIGGER tg_anuncios_origem_updated BEFORE UPDATE ON public.anuncios_origem
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. RLS e GRANTs: leitura só da equipe, escrita só pelas funções origem_* ----------------------------
ALTER TABLE public.conjuntos_anuncio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conjuntos_anuncio FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conjuntos_anuncio TO authenticated;
GRANT ALL ON public.conjuntos_anuncio TO service_role;
DROP POLICY IF EXISTS "conjuntos_anuncio leitura equipe" ON public.conjuntos_anuncio;
CREATE POLICY "conjuntos_anuncio leitura equipe" ON public.conjuntos_anuncio
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));

ALTER TABLE public.anuncios_origem ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.anuncios_origem FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.anuncios_origem TO authenticated;
GRANT ALL ON public.anuncios_origem TO service_role;
DROP POLICY IF EXISTS "anuncios_origem leitura equipe" ON public.anuncios_origem;
CREATE POLICY "anuncios_origem leitura equipe" ON public.anuncios_origem
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));

ALTER TABLE public.palavras_de_origem ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.palavras_de_origem FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.palavras_de_origem TO authenticated;
GRANT ALL ON public.palavras_de_origem TO service_role;
DROP POLICY IF EXISTS "palavras_de_origem leitura equipe" ON public.palavras_de_origem;
CREATE POLICY "palavras_de_origem leitura equipe" ON public.palavras_de_origem
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));

-- 4. Colunas novas ---------------------------------------------------------------------------------
-- leads: a etiqueta que a equipe vê e de onde ela veio. Ninguém de fora lê (RLS de leads inalterada).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS tipo text CONSTRAINT leads_tipo_check CHECK (tipo IN ('cliente_final', 'parceiro')),
  ADD COLUMN IF NOT EXISTS tipo_origem text
    CONSTRAINT leads_tipo_origem_check CHECK (tipo_origem IN ('anuncio', 'palavra', 'telefone', 'manual')),
  ADD COLUMN IF NOT EXISTS tipo_definido_em timestamptz;

-- whatsapp_atendimentos: o retrato do momento em que a pessoa chegou (cada volta é outro atendimento,
-- e quem volta por outro anúncio mostra o anúncio DAQUELE retorno). Sem FK para o anúncio, para nunca
-- bloquear a gravação.
ALTER TABLE public.whatsapp_atendimentos
  ADD COLUMN IF NOT EXISTS anuncio_id text,
  ADD COLUMN IF NOT EXISTS produto text,
  ADD COLUMN IF NOT EXISTS anuncio_titulo text,
  ADD COLUMN IF NOT EXISTS origem_canal text,
  ADD COLUMN IF NOT EXISTS origem_entrada text,
  ADD COLUMN IF NOT EXISTS ctwa_clid text,
  ADD COLUMN IF NOT EXISTS tipo_contato text
    CONSTRAINT whatsapp_atendimentos_tipo_contato_check CHECK (tipo_contato IN ('cliente_final', 'parceiro')),
  ADD COLUMN IF NOT EXISTS origem_do_tipo text
    CONSTRAINT whatsapp_atendimentos_origem_do_tipo_check CHECK (origem_do_tipo IN ('anuncio', 'palavra', 'telefone', 'manual')),
  ADD COLUMN IF NOT EXISTS primeira_mensagem text,
  ADD COLUMN IF NOT EXISTS primeira_mensagem_tipo text;

CREATE INDEX IF NOT EXISTS whatsapp_atendimentos_anuncio_idx
  ON public.whatsapp_atendimentos (anuncio_id) WHERE anuncio_id IS NOT NULL;

-- O histórico da conversa ganha o evento "tipo_contato" (CHECK lido vivo em 12/11/2026).
ALTER TABLE public.whatsapp_conversa_eventos DROP CONSTRAINT IF EXISTS whatsapp_conversa_eventos_tipo_check;
ALTER TABLE public.whatsapp_conversa_eventos ADD CONSTRAINT whatsapp_conversa_eventos_tipo_check
  CHECK (tipo = ANY (ARRAY['assumida', 'transferida', 'status', 'vinculo', 'nota', 'fila',
                           'transferida_ia', 'devolvida_ia', 'atendimento', 'tipo_contato']));

-- 4b. Ninguém pela API forja a origem da etiqueta ---------------------------------------------------
-- Roda como quem chama (sem SECURITY DEFINER), por isso enxerga current_user. As funções do banco
-- (dono postgres) e o service_role passam direto. Quem chama pela API (anon ou authenticated) pode
-- até marcar o tipo na mão, mas a origem fica sempre 'manual'.
CREATE OR REPLACE FUNCTION public.tg_lead_tipo_confiavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    IF NEW.tipo IS NULL THEN
      NEW.tipo_origem := NULL;
      NEW.tipo_definido_em := NULL;
    ELSE
      NEW.tipo_origem := 'manual';
      NEW.tipo_definido_em := now();
    END IF;
  ELSE
    NEW.tipo_origem := OLD.tipo_origem;
    NEW.tipo_definido_em := OLD.tipo_definido_em;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_lead_tipo_confiavel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_lead_tipo_confiavel() TO service_role;

DROP TRIGGER IF EXISTS tg_leads_tipo_confiavel ON public.leads;
CREATE TRIGGER tg_leads_tipo_confiavel BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_tipo_confiavel();

-- 5. Funções internas (só o servidor) -----------------------------------------------------------------

-- 5.1 Catálogo de anúncios: o mesmo id só atualiza título e corpo (o criativo muda, o id fica).
CREATE OR REPLACE FUNCTION public._wa_registrar_anuncio(p_anuncio text, p_payload jsonb, p_quando timestamptz, p_conta boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF nullif(btrim(p_anuncio), '') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.anuncios_origem (anuncio_id, titulo_criativo, corpo_criativo, ultimo_link,
                                      primeira_vez, ultima_vez, total_contatos)
  VALUES (btrim(p_anuncio),
          nullif(btrim(left(p_payload->>'anuncio_titulo', 200)), ''),
          nullif(btrim(left(p_payload->>'anuncio_corpo', 500)), ''),
          nullif(btrim(left(p_payload->>'anuncio_link', 500)), ''),
          p_quando, p_quando, CASE WHEN p_conta THEN 1 ELSE 0 END)
  ON CONFLICT (anuncio_id) DO UPDATE SET
    titulo_criativo = coalesce(EXCLUDED.titulo_criativo, anuncios_origem.titulo_criativo),
    corpo_criativo = coalesce(EXCLUDED.corpo_criativo, anuncios_origem.corpo_criativo),
    ultimo_link = coalesce(EXCLUDED.ultimo_link, anuncios_origem.ultimo_link),
    primeira_vez = least(coalesce(anuncios_origem.primeira_vez, EXCLUDED.primeira_vez), EXCLUDED.primeira_vez),
    ultima_vez = greatest(anuncios_origem.ultima_vez, EXCLUDED.ultima_vez),
    total_contatos = anuncios_origem.total_contatos + EXCLUDED.total_contatos;
END $function$;

REVOKE ALL ON FUNCTION public._wa_registrar_anuncio(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_registrar_anuncio(text, jsonb, timestamptz, boolean) TO service_role;

-- 5.2 Quem é o contato. A primeira resposta vence: etiqueta manual, anúncio, palavra, telefone de parceiro.
-- Nunca classifica cliente_final por palavra ou por telefone.
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
           WHERE w.ativo AND position(' ' || w.palavra IN ' ' || v_texto) > 0) THEN
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
  END IF;

  RETURN jsonb_build_object('tipo', v_tipo, 'origem', v_origem, 'produto', v_produto,
                            'anuncio_nome', v_nome, 'conjunto_id', v_conjunto);
END $function$;

REVOKE ALL ON FUNCTION public._wa_classificar_contato(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_classificar_contato(text, text, uuid, uuid) TO service_role;

-- 5.3 Copia o contexto da RPC para o atendimento que está nascendo (BEFORE, antes do aviso que é AFTER).
-- Só copia se a conversa for a mesma do contexto: a variável nunca vaza para outro atendimento.
-- Roda como quem chama: só lê a variável e mexe no NEW, não precisa de privilégio.
CREATE OR REPLACE FUNCTION public.tg_atendimento_traz_contexto()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bruto text := nullif(current_setting('bex.contato_ctx', true), '');
  v_ctx jsonb;
BEGIN
  IF v_bruto IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_ctx := v_bruto::jsonb;
    IF (v_ctx->>'conversa_id')::uuid = NEW.conversa_id THEN
      NEW.anuncio_id := nullif(v_ctx->>'anuncio_id', '');
      NEW.produto := nullif(v_ctx->>'produto', '');
      NEW.anuncio_titulo := nullif(v_ctx->>'anuncio_titulo', '');
      NEW.origem_canal := nullif(v_ctx->>'canal', '');
      NEW.origem_entrada := nullif(v_ctx->>'entrada', '');
      NEW.ctwa_clid := nullif(v_ctx->>'ctwa_clid', '');
      NEW.tipo_contato := nullif(v_ctx->>'tipo', '');
      NEW.origem_do_tipo := nullif(v_ctx->>'origem_do_tipo', '');
      NEW.primeira_mensagem := nullif(v_ctx->>'primeira_mensagem', '');
      NEW.primeira_mensagem_tipo := nullif(v_ctx->>'primeira_mensagem_tipo', '');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contexto do contato falhou (atendimento %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_atendimento_traz_contexto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_atendimento_traz_contexto() TO service_role;

DROP TRIGGER IF EXISTS tg_atendimento_traz_contexto ON public.whatsapp_atendimentos;
CREATE TRIGGER tg_atendimento_traz_contexto BEFORE INSERT ON public.whatsapp_atendimentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_atendimento_traz_contexto();

-- 6. Funções da tela de origem (configuracoes.manage dentro de cada uma) --------------------------------
-- Escrita só por aqui: as tabelas não têm GRANT de INSERT, UPDATE nem DELETE para ninguém de fora.
-- Nenhuma delas toca em parceiros, clientes ou orçamentos.

CREATE OR REPLACE FUNCTION public.origem_salvar_conjunto(p_conjunto_id text, p_nome text, p_tipo text, p_campanha_id text, p_campanha_nome text, p_produto_padrao text, p_ativo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id text := btrim(coalesce(p_conjunto_id, ''));
  v_tipo_antes text;
  v_ligados integer;
BEGIN
  PERFORM public.require_permission('configuracoes.manage');
  IF v_id !~ '^[0-9]{6,40}$' THEN
    RAISE EXCEPTION 'O id do conjunto tem só números. Copie a coluna Identificação do conjunto no Gerenciador de Anúncios.';
  END IF;
  IF nullif(btrim(p_nome), '') IS NULL THEN
    RAISE EXCEPTION 'Dê um nome ao conjunto.';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('cliente_final', 'parceiro') THEN
    RAISE EXCEPTION 'Escolha o tipo do conjunto: cliente final ou parceiro.';
  END IF;

  SELECT tipo INTO v_tipo_antes FROM public.conjuntos_anuncio WHERE conjunto_id = v_id FOR UPDATE;

  INSERT INTO public.conjuntos_anuncio (conjunto_id, nome, campanha_id, campanha_nome, tipo, produto_padrao, ativo)
  VALUES (v_id, btrim(p_nome), nullif(btrim(p_campanha_id), ''), nullif(btrim(p_campanha_nome), ''),
          p_tipo, nullif(btrim(p_produto_padrao), ''), coalesce(p_ativo, true))
  ON CONFLICT (conjunto_id) DO UPDATE SET
    nome = EXCLUDED.nome,
    campanha_id = EXCLUDED.campanha_id,
    campanha_nome = EXCLUDED.campanha_nome,
    tipo = EXCLUDED.tipo,
    produto_padrao = EXCLUDED.produto_padrao,
    ativo = coalesce(p_ativo, conjuntos_anuncio.ativo);

  -- Mudar o tipo vale dali em diante: atendimentos e leads antigos não são reescritos.
  SELECT count(*) INTO v_ligados FROM public.anuncios_origem WHERE conjunto_id = v_id;
  RETURN jsonb_build_object('conjunto_id', v_id, 'tipo', p_tipo, 'tipo_antes', v_tipo_antes,
                            'tipo_mudou', v_tipo_antes IS NOT NULL AND v_tipo_antes <> p_tipo,
                            'anuncios_ligados', v_ligados);
END $function$;

CREATE OR REPLACE FUNCTION public.origem_vincular_anuncio(p_anuncio_id text, p_conjunto_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anuncio text := btrim(coalesce(p_anuncio_id, ''));
  v_conjunto text := nullif(btrim(coalesce(p_conjunto_id, '')), '');
  v_tipo text;
BEGIN
  PERFORM public.require_permission('configuracoes.manage');
  IF v_anuncio !~ '^[0-9]{6,40}$' THEN
    RAISE EXCEPTION 'O id do anúncio tem só números. Copie a coluna Identificação do anúncio no Gerenciador de Anúncios.';
  END IF;
  IF v_conjunto IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conjuntos_anuncio WHERE conjunto_id = v_conjunto) THEN
    RAISE EXCEPTION 'Esse conjunto não está cadastrado. Cadastre o conjunto primeiro.';
  END IF;

  INSERT INTO public.anuncios_origem (anuncio_id, conjunto_id, conjunto_definido_por)
  VALUES (v_anuncio, v_conjunto, 'manual')
  ON CONFLICT (anuncio_id) DO UPDATE SET
    conjunto_id = EXCLUDED.conjunto_id,
    conjunto_definido_por = 'manual';

  SELECT c.tipo INTO v_tipo FROM public.conjuntos_anuncio c WHERE c.conjunto_id = v_conjunto AND c.ativo;
  RETURN jsonb_build_object('anuncio_id', v_anuncio, 'conjunto_id', v_conjunto, 'tipo', v_tipo);
END $function$;

CREATE OR REPLACE FUNCTION public.origem_salvar_anuncio(p_anuncio_id text, p_nome_interno text, p_produto text, p_ativo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anuncio text := btrim(coalesce(p_anuncio_id, ''));
BEGIN
  PERFORM public.require_permission('configuracoes.manage');
  IF v_anuncio !~ '^[0-9]{6,40}$' THEN
    RAISE EXCEPTION 'O id do anúncio tem só números. Copie a coluna Identificação do anúncio no Gerenciador de Anúncios.';
  END IF;

  INSERT INTO public.anuncios_origem (anuncio_id, nome_interno, produto, ativo)
  VALUES (v_anuncio, nullif(btrim(p_nome_interno), ''), nullif(btrim(p_produto), ''), coalesce(p_ativo, true))
  ON CONFLICT (anuncio_id) DO UPDATE SET
    nome_interno = EXCLUDED.nome_interno,
    produto = EXCLUDED.produto,
    ativo = coalesce(p_ativo, anuncios_origem.ativo);

  RETURN jsonb_build_object('anuncio_id', v_anuncio);
END $function$;

CREATE OR REPLACE FUNCTION public.origem_salvar_palavra(p_palavra text, p_ativo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_palavra text := public.bex_normalizar_texto(p_palavra);
BEGIN
  PERFORM public.require_permission('configuracoes.manage');
  IF v_palavra = '' THEN
    RAISE EXCEPTION 'Escreva a palavra.';
  END IF;
  IF char_length(replace(v_palavra, ' ', '')) < 4 THEN
    RAISE EXCEPTION 'A palavra precisa ter pelo menos 4 letras, senão marca contato errado.';
  END IF;

  INSERT INTO public.palavras_de_origem (palavra, tipo, ativo)
  VALUES (v_palavra, 'parceiro', coalesce(p_ativo, true))
  ON CONFLICT (palavra) DO UPDATE SET ativo = coalesce(p_ativo, palavras_de_origem.ativo);

  RETURN jsonb_build_object('palavra', v_palavra);
END $function$;

CREATE OR REPLACE FUNCTION public.origem_remover_palavra(p_palavra text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_palavra text := public.bex_normalizar_texto(p_palavra);
  v_apagadas integer;
BEGIN
  PERFORM public.require_permission('configuracoes.manage');
  DELETE FROM public.palavras_de_origem WHERE palavra = v_palavra;
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN jsonb_build_object('palavra', v_palavra, 'removida', v_apagadas > 0);
END $function$;

REVOKE ALL ON FUNCTION public.origem_salvar_conjunto(text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.origem_salvar_conjunto(text, text, text, text, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.origem_vincular_anuncio(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.origem_vincular_anuncio(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.origem_salvar_anuncio(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.origem_salvar_anuncio(text, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.origem_salvar_palavra(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.origem_salvar_palavra(text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.origem_remover_palavra(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.origem_remover_palavra(text) TO authenticated, service_role;

-- 7. Marcar o tipo na mão, pela caixa (só o servidor chama, depois de checar whatsapp.reply) --------------
CREATE OR REPLACE FUNCTION public.whatsapp_definir_tipo_do_contato(p_conversa_id uuid, p_usuario uuid, p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv public.whatsapp_conversas%ROWTYPE;
  v_antes text;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('cliente_final', 'parceiro') THEN
    RAISE EXCEPTION 'Tipo de contato inválido: use cliente final ou parceiro.';
  END IF;

  SELECT * INTO v_conv FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada.';
  END IF;
  IF v_conv.lead_id IS NULL THEN
    IF v_conv.cliente_id IS NOT NULL THEN
      RAISE EXCEPTION 'Este contato já é cliente cadastrado: o preço segue o cadastro.';
    END IF;
    RAISE EXCEPTION 'Esta conversa ainda não tem lead para receber a etiqueta.';
  END IF;

  SELECT tipo INTO v_antes FROM public.leads WHERE id = v_conv.lead_id FOR UPDATE;

  UPDATE public.leads
     SET tipo = p_tipo,
         tipo_origem = CASE WHEN p_tipo IS NULL THEN NULL ELSE 'manual' END,
         tipo_definido_em = CASE WHEN p_tipo IS NULL THEN NULL ELSE now() END
   WHERE id = v_conv.lead_id;

  IF v_conv.atendimento_ativo_id IS NOT NULL THEN
    UPDATE public.whatsapp_atendimentos
       SET tipo_contato = p_tipo,
           origem_do_tipo = CASE WHEN p_tipo IS NULL THEN NULL ELSE 'manual' END
     WHERE id = v_conv.atendimento_ativo_id;
  END IF;

  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (v_conv.id, 'tipo_contato', p_usuario, jsonb_build_object('de', v_antes, 'para', p_tipo));

  RETURN jsonb_build_object('conversa_id', v_conv.id, 'lead_id', v_conv.lead_id, 'tipo', p_tipo, 'tipo_antes', v_antes);
END $function$;

REVOKE ALL ON FUNCTION public.whatsapp_definir_tipo_do_contato(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_definir_tipo_do_contato(uuid, uuid, text) TO service_role;

-- 8. whatsapp_registrar_mensagem: a versão VIVA (pg_get_functiondef, 12/11/2026) + UM bloco ---------------
-- Mesma assinatura de 12 parâmetros (nada de sobrecarga, que quebraria o PostgREST).
-- Acrescentado: as variáveis v_abre, v_anuncio, v_cls, v_primeira; o bloco "origem do contato" entre a
-- ligação do lead e o ramo de saída; e a limpeza da variável de transação depois de inserir a mensagem.
-- O resto é igual ao corpo vivo, inclusive o CASE de leads.origem e o 'Anúncio <id>' de leads.campanha.
CREATE OR REPLACE FUNCTION public.whatsapp_registrar_mensagem(p_instancia_id uuid, p_zapi_message_id text, p_telefone text, p_direcao whatsapp_mensagem_direcao, p_tipo whatsapp_mensagem_tipo, p_texto text DEFAULT NULL::text, p_legenda text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_nome_contato text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_momento timestamp with time zone DEFAULT NULL::timestamp with time zone, p_origem text DEFAULT 'humano'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tel text := public.normalize_whatsapp_phone(p_telefone);
  v_quando timestamptz := COALESCE(p_momento, now());
  v_nome text := NULLIF(btrim(p_nome_contato), '');
  v_resumo text;
  v_clientes uuid[];
  v_cliente_id uuid;
  v_lead_id uuid;
  v_lead_criado boolean := false;
  v_conversa public.whatsapp_conversas%ROWTYPE;
  v_mensagem_id uuid;
  v_status_saida public.whatsapp_mensagem_status;
  v_entregue_em timestamptz;
  v_lido_em timestamptz;
  v_abre boolean;
  v_anuncio text;
  v_cls jsonb;
  v_primeira text;
BEGIN
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'Telefone vazio: %', p_telefone;
  END IF;
  IF NULLIF(btrim(p_zapi_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'Mensagem sem id do Z-API';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_instancia_id::text || ':' || p_zapi_message_id));

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_mensagens
    WHERE instancia_id = p_instancia_id AND zapi_message_id = p_zapi_message_id
  ) THEN
    RETURN jsonb_build_object('duplicada', true);
  END IF;

  -- Só cliente ATIVO conta (21/10/2026): cadastro repetido e desligado não
  -- pode impedir a ligação automática. Se só houver inativo, ele ainda é o
  -- cliente — quem volta a escrever depois de desligado continua conhecido.
  SELECT array_agg(DISTINCT c.id) INTO v_clientes
  FROM (
    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel AND ativo IS NOT FALSE
    UNION
    SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel AND ativo IS NOT FALSE
    UNION
    SELECT cc.cliente_id FROM public.cliente_contatos cc
      JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE
    WHERE public.normalize_whatsapp_phone(cc.telefone) = v_tel
  ) c;
  IF v_clientes IS NULL THEN
    SELECT array_agg(DISTINCT c.id) INTO v_clientes
    FROM (
      SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel
      UNION
      SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel
      UNION
      SELECT cliente_id FROM public.cliente_contatos
      WHERE public.normalize_whatsapp_phone(telefone) = v_tel
    ) c;
  END IF;
  IF COALESCE(array_length(v_clientes, 1), 0) = 1 THEN
    v_cliente_id := v_clientes[1];
  END IF;

  IF v_cliente_id IS NULL THEN
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE telefone_normalizado = v_tel AND temporario IS TRUE;

    IF v_lead_id IS NULL THEN
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END INTO v_lead_id
      FROM public.leads
      WHERE telefone_normalizado = v_tel AND cliente_id IS NULL AND status NOT IN ('ganho','perdido');
    END IF;

    -- (a) Só quem ESCREVE para a empresa, com mensagem de gente, vira lead.
    -- Aviso de sistema (tipo 'sistema') e mensagem de MODELO de empresa
    -- (Claro, Kwai, Renova Be — origem 'automacao') não são interesse de
    -- ninguém: em 06/10/2026 três delas tinham virado lead.
    IF v_lead_id IS NULL AND p_direcao = 'entrada'
       AND p_tipo IN ('texto','imagem','documento','audio','video','localizacao','contato')
       AND COALESCE(p_origem, 'humano') <> 'automacao'
       AND NOT public._wa_telefone_da_equipe(v_tel) THEN
      INSERT INTO public.leads (nome, telefone, telefone_original, origem, campanha, interesse, status, temporario)
      VALUES (
        COALESCE(v_nome, 'Lead WhatsApp ' || v_tel),
        p_telefone,
        p_telefone,
        -- Click-to-WhatsApp: origem real quando o contato veio do Instagram/Facebook.
        CASE p_payload->>'canal_origem'
          WHEN 'instagram' THEN 'Instagram'
          WHEN 'facebook'  THEN 'Facebook'
          ELSE 'whatsapp'
        END,
        CASE WHEN NULLIF(btrim(p_payload->>'anuncio_id'), '') IS NOT NULL
          THEN 'Anúncio ' || btrim(p_payload->>'anuncio_id')
          ELSE NULL  -- como hoje: o INSERT atual não preenche campanha
        END,
        'Atendimento iniciado via WhatsApp',
        'novo',
        true
      )
      ON CONFLICT (telefone_normalizado) WHERE (temporario IS TRUE AND telefone_normalizado IS NOT NULL)
      DO NOTHING
      RETURNING id INTO v_lead_id;

      IF v_lead_id IS NOT NULL THEN
        v_lead_criado := true;
      ELSE
        SELECT id INTO v_lead_id
        FROM public.leads
        WHERE telefone_normalizado = v_tel AND temporario IS TRUE;
      END IF;
    END IF;
  END IF;

  v_resumo := left(COALESCE(p_texto, p_legenda, '[' || p_tipo::text || ']'), 500);

  INSERT INTO public.whatsapp_conversas AS c (
    instancia_id, telefone, nome_contato, cliente_id, lead_id,
    ultima_mensagem, ultima_mensagem_at, nao_lidas, status
  )
  VALUES (
    p_instancia_id, p_telefone, v_nome, v_cliente_id, v_lead_id,
    v_resumo, v_quando, CASE WHEN p_direcao = 'entrada' THEN 1 ELSE 0 END, 'aberta'
  )
  ON CONFLICT (instancia_id, telefone_normalizado) DO UPDATE SET
    nome_contato = COALESCE(c.nome_contato, EXCLUDED.nome_contato),
    cliente_id = COALESCE(c.cliente_id, EXCLUDED.cliente_id),
    lead_id = COALESCE(c.lead_id, EXCLUDED.lead_id),
    ultima_mensagem = CASE
      WHEN c.ultima_mensagem_at IS NULL OR EXCLUDED.ultima_mensagem_at >= c.ultima_mensagem_at
      THEN EXCLUDED.ultima_mensagem ELSE c.ultima_mensagem END,
    ultima_mensagem_at = GREATEST(c.ultima_mensagem_at, EXCLUDED.ultima_mensagem_at),
    nao_lidas = COALESCE(c.nao_lidas, 0) + EXCLUDED.nao_lidas,
    status = CASE
      WHEN p_direcao = 'entrada' AND c.status IN ('resolvida', 'arquivada') THEN 'aberta'::whatsapp_conversa_status
      ELSE c.status END
  RETURNING * INTO v_conversa;

  IF v_lead_criado THEN
    UPDATE public.leads SET conversa_id = v_conversa.id WHERE id = v_lead_id AND conversa_id IS NULL;
  END IF;

  -- (c) NOVO (12/11/2026): origem do contato. Tudo dentro de um bloco que, se falhar, avisa e desfaz só
  -- a classificação: a mensagem entra do mesmo jeito e o aviso do grupo sai como "tipo a confirmar".
  -- Só conta como contato novo quando esta mensagem vai ABRIR atendimento (mesma condição do gatilho
  -- _wa_mensagem_antes_inserir): entrada de gente, fora da equipe, sem atendimento aberto.
  IF p_direcao = 'entrada' THEN
    BEGIN
      v_anuncio := nullif(left(btrim(coalesce(p_payload->>'anuncio_id', '')), 100), '');
      v_abre := v_conversa.atendimento_ativo_id IS NULL
                AND p_tipo <> 'sistema'
                AND COALESCE(p_origem, 'humano') <> 'automacao'
                AND NOT public._wa_telefone_da_equipe(v_tel);
      IF v_abre OR v_anuncio IS NOT NULL THEN
        IF v_anuncio IS NOT NULL THEN
          PERFORM public._wa_registrar_anuncio(v_anuncio, p_payload, v_quando, v_abre);
        END IF;
        IF v_abre THEN
          v_cls := public._wa_classificar_contato(v_anuncio, COALESCE(p_texto, p_legenda),
                                                  v_conversa.cliente_id, v_conversa.lead_id);
          IF v_conversa.lead_id IS NOT NULL AND v_cls->>'tipo' IS NOT NULL THEN
            UPDATE public.leads
               SET tipo = v_cls->>'tipo', tipo_origem = v_cls->>'origem', tipo_definido_em = now()
             WHERE id = v_conversa.lead_id AND tipo IS NULL;
          END IF;
          -- Uma linha só, sem quebra: o aviso põe o texto entre aspas e ninguém forja linha do aviso.
          v_primeira := btrim(regexp_replace(COALESCE(p_texto, p_legenda, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
          IF char_length(v_primeira) > 120 THEN
            v_primeira := left(v_primeira, 119) || '…';
          END IF;
          PERFORM set_config('bex.contato_ctx', jsonb_build_object(
            'conversa_id', v_conversa.id,
            'anuncio_id', v_anuncio,
            'produto', v_cls->>'produto',
            'anuncio_titulo', COALESCE(nullif(btrim(left(p_payload->>'anuncio_titulo', 200)), ''), v_cls->>'anuncio_nome'),
            'canal', p_payload->>'canal_origem',
            'entrada', p_payload->>'entry_point',
            'ctwa_clid', p_payload->>'ctwa_clid',
            'tipo', v_cls->>'tipo',
            'origem_do_tipo', v_cls->>'origem',
            'primeira_mensagem', v_primeira,
            'primeira_mensagem_tipo', p_tipo::text)::text, true);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'origem do contato falhou (conversa %, mensagem %, anuncio %): % [%]',
        v_conversa.id, p_zapi_message_id, v_anuncio, SQLERRM, SQLSTATE;
    END;
  END IF;

  -- (b) Saída: o recibo pode ter chegado antes do registro. O aviso da fila
  -- guarda o que o Z-API já disse desta mensagem.
  IF p_direcao = 'saida' THEN
    SELECT CASE n.provider_status
             WHEN 'lida' THEN 'lida'::public.whatsapp_mensagem_status
             WHEN 'entregue' THEN 'entregue'::public.whatsapp_mensagem_status
             ELSE 'enviada'::public.whatsapp_mensagem_status END,
           n.entregue_em, n.lido_em
      INTO v_status_saida, v_entregue_em, v_lido_em
    FROM public.notificacoes_fila n
    WHERE n.provider_message_id = p_zapi_message_id
    ORDER BY n.enviado_em DESC NULLS LAST
    LIMIT 1;
  END IF;

  INSERT INTO public.whatsapp_mensagens (
    conversa_id, instancia_id, zapi_message_id, direcao, tipo, status,
    texto, legenda, media_url, cliente_id, os_id, payload, recebido_em, enviado_em,
    entregue_em, lido_em, origem
  )
  VALUES (
    v_conversa.id, p_instancia_id, p_zapi_message_id, p_direcao, p_tipo,
    CASE WHEN p_direcao = 'entrada' THEN 'recebida'::public.whatsapp_mensagem_status
         ELSE COALESCE(v_status_saida, 'enviada'::public.whatsapp_mensagem_status) END,
    p_texto, p_legenda, p_media_url, v_conversa.cliente_id, v_conversa.os_id, p_payload,
    CASE WHEN p_direcao = 'entrada' THEN v_quando END,
    CASE WHEN p_direcao = 'saida' THEN v_quando END,
    CASE WHEN p_direcao = 'saida' THEN v_entregue_em END,
    CASE WHEN p_direcao = 'saida' THEN v_lido_em END,
    COALESCE(p_origem, 'humano')
  )
  ON CONFLICT (instancia_id, zapi_message_id) DO NOTHING
  RETURNING id INTO v_mensagem_id;

  -- O contexto da origem já cumpriu o papel (o gatilho do atendimento rodou dentro do INSERT acima).
  PERFORM set_config('bex.contato_ctx', '', true);

  RETURN jsonb_build_object(
    'duplicada', v_mensagem_id IS NULL,
    'mensagem_id', v_mensagem_id,
    'conversa_id', v_conversa.id,
    'cliente_id', v_conversa.cliente_id,
    'lead_id', v_conversa.lead_id,
    'os_id', v_conversa.os_id,
    'lead_criado', v_lead_criado,
    'telefone_normalizado', v_tel
  );
END;
$function$;

-- CREATE OR REPLACE mantém a ACL; repetida para o bloco final e o teste não dependerem de memória.
REVOKE ALL ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) TO service_role;

-- 9. O aviso novo no grupo da equipe -----------------------------------------------------------------------
-- Copiada da definição VIVA (idêntica à da migração 20261112120000). Mantém: grupo_equipe_destino, saída
-- para origem 'manual', saída para telefone de equipe que não seja só parceiro, o template
-- aviso_grupo_equipe, a chave de idempotência por atendimento e o EXCEPTION que vira RAISE WARNING com o id
-- do atendimento. Muda o TEXTO. O destino continua sendo SÓ o grupo da equipe: nada vai ao contato.
-- Se o texto novo falhar, sai um aviso mínimo (só link e protocolo), para a equipe nunca ficar sem saber.
CREATE OR REPLACE FUNCTION public.tg_atendimento_avisa_grupo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo text := public.grupo_equipe_destino();
  v_conv public.whatsapp_conversas%ROWTYPE;
  v_passou boolean := false;
  v_cliente text;
  v_parc uuid;
  v_nivel text;
  v_orc integer := 0;
  v_ultima timestamptz;
  v_horas numeric;
  v_quem text;
  v_titulo text;
  v_anuncio text;
  v_msg text;
  v_origem text;
  v_cliente_linha text;
  v_orc_linha text;
  v_volta text;
  v_preco text;
  v_texto text;
  v_bruto text;
BEGIN
  IF v_grupo IS NULL OR NEW.origem_abertura::text = 'manual' THEN RETURN NEW; END IF;
  BEGIN
    SELECT * INTO v_conv FROM public.whatsapp_conversas WHERE id = NEW.conversa_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- Alguém da equipe escrevendo para o número da gráfica não é cliente chegando. Parceiro
    -- cadastrado é cliente: o aviso sai.
    IF EXISTS (SELECT 1 FROM public.usuarios u
                WHERE u.ativo AND u.telefone IS NOT NULL
                  AND public.normalize_whatsapp_phone(u.telefone) = public.normalize_whatsapp_phone(v_conv.telefone)
                  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text <> 'parceiro')) THEN
      RETURN NEW;
    END IF;
    v_passou := true;

    -- Quem é: cliente ligado, parceiro cadastrado ativo e orçamentos abertos (rascunho e enviado).
    IF v_conv.cliente_id IS NOT NULL THEN
      SELECT nome INTO v_cliente FROM public.clientes WHERE id = v_conv.cliente_id;
      v_parc := public.parceiro_ativo_do_cliente(v_conv.cliente_id);
      SELECT count(*) INTO v_orc FROM public.orcamentos
       WHERE cliente_id = v_conv.cliente_id AND status IN ('rascunho', 'enviado');
    END IF;
    IF v_parc IS NOT NULL THEN
      BEGIN
        v_nivel := nullif(btrim(public.parceiro_nivel(v_parc)->>'nome'), '');
      EXCEPTION WHEN OTHERS THEN
        v_nivel := NULL;
        RAISE WARNING 'nível do parceiro não leu (atendimento %): %', NEW.id, SQLERRM;
      END;
    END IF;

    v_quem := COALESCE(NULLIF(btrim(v_conv.nome_contato), ''), 'Sem nome');

    -- Título: o QUE é este contato.
    v_titulo := CASE
      WHEN NEW.reaberto_de IS NOT NULL THEN '🔁 VOLTOU A CONVERSAR'
      WHEN v_parc IS NOT NULL OR (NEW.tipo_contato = 'parceiro' AND NEW.origem_do_tipo = 'telefone') THEN '🤝 PARCEIRO'
      WHEN NEW.tipo_contato = 'parceiro' THEN '🤝 QUER SER PARCEIRO'
      WHEN v_conv.cliente_id IS NOT NULL THEN '🔁 CLIENTE VOLTOU'
      ELSE '🆕 LEAD NOVO'
    END;

    IF NEW.anuncio_id IS NOT NULL THEN
      v_anuncio := left(COALESCE(nullif(btrim(NEW.produto), ''), nullif(btrim(NEW.anuncio_titulo), ''), 'sem nome'), 60);
    ELSIF v_titulo IN ('🆕 LEAD NOVO', '🤝 QUER SER PARCEIRO') THEN
      -- Sem contexto gravado (primeira_mensagem_tipo vazio) a classificação falhou: não afirma "sem anúncio".
      v_origem := CASE WHEN NEW.primeira_mensagem_tipo IS NULL
                       THEN '📣 Origem: não identificada'
                       ELSE '📣 Origem: contato direto, sem anúncio' END;
    END IF;

    -- Primeira mensagem entre aspas (já vem sem quebra de linha e cortada em 120). Se só veio mídia, diz o que veio.
    -- Sem contexto gravado (a classificação falhou), cai na última mensagem da conversa, que é esta.
    v_bruto := nullif(btrim(NEW.primeira_mensagem), '');
    IF v_bruto IS NULL AND NEW.primeira_mensagem_tipo IS NULL
       AND nullif(btrim(v_conv.ultima_mensagem), '') IS NOT NULL
       AND v_conv.ultima_mensagem !~ '^\[[a-z]+\]$' THEN
      v_bruto := btrim(regexp_replace(v_conv.ultima_mensagem, '[[:cntrl:][:space:]]+', ' ', 'g'));
      IF char_length(v_bruto) > 120 THEN v_bruto := left(v_bruto, 119) || '…'; END IF;
    END IF;
    v_msg := CASE
      WHEN v_bruto IS NOT NULL THEN '💬 "' || v_bruto || '"'
      WHEN NEW.primeira_mensagem_tipo = 'imagem' THEN '💬 Enviou uma foto'
      WHEN NEW.primeira_mensagem_tipo = 'audio' THEN '💬 Enviou um áudio'
      WHEN NEW.primeira_mensagem_tipo = 'video' THEN '💬 Enviou um vídeo'
      WHEN NEW.primeira_mensagem_tipo = 'documento' THEN '💬 Enviou um documento'
      WHEN NEW.primeira_mensagem_tipo = 'localizacao' THEN '💬 Enviou uma localização'
      WHEN NEW.primeira_mensagem_tipo = 'contato' THEN '💬 Enviou um contato'
      WHEN NEW.primeira_mensagem_tipo = 'sticker' THEN '💬 Enviou uma figurinha'
      ELSE NULL
    END;

    -- Cliente ligado: só mostra o nome se for diferente do nome do contato.
    IF v_cliente IS NOT NULL
       AND public.bex_normalizar_texto(v_cliente) <> public.bex_normalizar_texto(v_conv.nome_contato) THEN
      v_cliente_linha := '🏷️ Cliente: ' || v_cliente;
    END IF;
    IF v_orc > 0 THEN
      v_orc_linha := '📄 Tem ' || v_orc || CASE WHEN v_orc = 1 THEN ' orçamento aberto' ELSE ' orçamentos abertos' END;
    END IF;

    -- Atendimento reaberto: há quanto tempo foi a última conversa. A conversa já foi atualizada com a mensagem
    -- nova, então a data vem das mensagens do atendimento anterior.
    IF NEW.reaberto_de IS NOT NULL THEN
      SELECT max(COALESCE(m.recebido_em, m.enviado_em)) INTO v_ultima
        FROM public.whatsapp_mensagens m
       WHERE m.conversa_id = NEW.conversa_id AND m.atendimento_id = NEW.reaberto_de;
      IF v_ultima IS NULL THEN
        SELECT COALESCE(a.fechado_em, a.aberto_em) INTO v_ultima
          FROM public.whatsapp_atendimentos a WHERE a.id = NEW.reaberto_de;
      END IF;
      IF v_ultima IS NOT NULL THEN
        v_horas := extract(epoch FROM (now() - v_ultima)) / 3600;
        v_volta := '🕒 Última conversa ' || CASE
          WHEN v_horas < 1 THEN 'há menos de uma hora'
          WHEN v_horas < 24 THEN 'há ' || floor(v_horas)::int || CASE WHEN floor(v_horas) = 1 THEN ' hora' ELSE ' horas' END
          WHEN v_horas < 24 * 60 THEN 'há ' || floor(v_horas / 24)::int || CASE WHEN floor(v_horas / 24) = 1 THEN ' dia' ELSE ' dias' END
          ELSE 'há ' || floor(v_horas / 24 / 30)::int || CASE WHEN floor(v_horas / 24 / 30) = 1 THEN ' mês' ELSE ' meses' END
        END;
      END IF;
    END IF;

    -- Preço que a equipe deve esperar. Só informação para o grupo: nunca vai ao contato.
    v_preco := CASE
      WHEN v_parc IS NOT NULL THEN 'parceiro' || COALESCE(', nível ' || v_nivel, '')
      -- Telefone de parceiro cadastrado, mas a conversa ainda não está ligada ao cliente dele: o preço
      -- segue o cadastro, então a equipe precisa ligar o cliente antes de orçar.
      WHEN NEW.tipo_contato = 'parceiro' AND NEW.origem_do_tipo = 'telefone' THEN 'parceiro cadastrado, falta ligar o cliente à conversa'
      WHEN v_conv.cliente_id IS NOT NULL THEN 'cliente final, tabela cheia'
      WHEN NEW.tipo_contato = 'cliente_final' THEN 'cliente final, tabela cheia'
      WHEN NEW.tipo_contato = 'parceiro' THEN 'tabela cheia até o cadastro como parceiro'
      ELSE 'tipo a confirmar'
    END;

    v_texto := concat_ws(E'\n',
      v_titulo || COALESCE(' · anúncio ' || v_anuncio, ''),
      '👤 ' || v_quem || ' · ' || public.telefone_legivel(v_conv.telefone),
      v_msg,
      v_origem,
      v_cliente_linha,
      v_orc_linha,
      v_volta,
      '💰 Preço: ' || v_preco,
      '👉 Responder: https://bexprint.com.br/whatsapp?conversa=' || NEW.conversa_id,
      'Protocolo ' || NEW.numero);

    PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, v_conv.cliente_id, 'aviso_grupo_equipe',
      'whatsapp_atendimento', NEW.id, 'aviso_grupo_equipe', jsonb_build_object('texto', v_texto),
      'grupo_equipe:atendimento:' || NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (atendimento %, conversa %): % [%]',
      NEW.id, NEW.conversa_id, SQLERRM, SQLSTATE;
    IF v_passou THEN
      BEGIN
        PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe',
          'whatsapp_atendimento', NEW.id, 'aviso_grupo_equipe',
          jsonb_build_object('texto', format(E'🆕 NOVO ATENDIMENTO\n👉 Responder: https://bexprint.com.br/whatsapp?conversa=%s\nProtocolo %s',
                                             NEW.conversa_id, NEW.numero)),
          'grupo_equipe:atendimento:' || NEW.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'aviso mínimo no grupo da equipe também falhou (atendimento %): % [%]', NEW.id, SQLERRM, SQLSTATE;
      END;
    END IF;
  END;
  RETURN NEW;
END $function$;

-- O gatilho tg_atendimento_avisa_grupo (AFTER INSERT em whatsapp_atendimentos) não é recriado: o corpo
-- novo vale para ele. ACL repetida: só o servidor.
REVOKE ALL ON FUNCTION public.tg_atendimento_avisa_grupo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_atendimento_avisa_grupo() TO service_role;

-- 10. Seed: a conta "CA - Bex Print" (Meta, 12/11/2026) -----------------------------------------------------
INSERT INTO public.conjuntos_anuncio (conjunto_id, nome, campanha_id, campanha_nome, tipo, produto_padrao, ativo) VALUES
  ('120252255931120481', 'Cliente final | Macapá+Santana 30km | WhatsApp',
   '120252255926020481', 'BP | Cliente final + Expresso | WhatsApp | Nov26', 'cliente_final', NULL, true),
  ('120252255945380481', 'Terceirizado | Macapá+Santana 30km | Cadastro (pixel)',
   '120252255941840481', 'BP | Terceirizado | Cadastro parceiro | Nov26', 'parceiro', NULL, true)
ON CONFLICT (conjunto_id) DO NOTHING;

INSERT INTO public.anuncios_origem (anuncio_id, conjunto_id, nome_interno, produto, ativo) VALUES
  ('120252258241960481', '120252255931120481', 'CLIENTE FINAL | Card Brindes 3D', 'Brindes personalizados em 3D', true),
  ('120252258241750481', '120252255931120481', 'EXPRESSO | Card Lona 4h (A)', NULL, true),
  ('120252258241600481', '120252255931120481', 'EXPRESSO | Card Modo Expresso (D)', NULL, true),
  ('120252258242200481', '120252255931120481', 'CLIENTE FINAL | Card Institucional (Suas ideias)', NULL, false),
  ('120252256242340481', '120252255931120481', 'EXPRESSO | VÍDEO | PROVISÓRIO', NULL, false),
  ('120252255941070481', '120252255931120481', 'CLIENTE FINAL | VÍDEO | PROVISÓRIO', NULL, false),
  ('120252264127430481', '120252255945380481', 'TERCEIRIZADO | Card Tem cliente? (arte nova)', NULL, true),
  ('120252255959270481', '120252255945380481', 'TERCEIRIZADO | VÍDEO | PROVISÓRIO', NULL, false)
ON CONFLICT (anuncio_id) DO NOTHING;

-- Palavras (já normalizadas: sem acento, sem maiúscula). A regra casa pelo início da palavra, então o
-- feminino precisa de linha própria (parceira não começa com parceiro).
INSERT INTO public.palavras_de_origem (palavra, tipo, ativo) VALUES
  ('quero ser parceiro', 'parceiro', true),
  ('quero ser parceira', 'parceiro', true),
  ('ser parceiro', 'parceiro', true),
  ('ser parceira', 'parceiro', true),
  ('terceirizado', 'parceiro', true),
  ('terceirizada', 'parceiro', true),
  ('parceria', 'parceiro', true)
ON CONFLICT (palavra) DO NOTHING;

-- 11. Conferência final: se algo estiver fora do esperado, a migração inteira é desfeita ------------------
DO $conferencia$
DECLARE
  v_n integer;
  v_t text;
  v_f text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'whatsapp_registrar_mensagem';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'whatsapp_registrar_mensagem ficou com % versões (esperado 1): sobrecarga quebra o PostgREST', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tg_atendimento_avisa_grupo';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'tg_atendimento_avisa_grupo ficou com % versões (esperado 1)', v_n;
  END IF;
  SELECT pronargs INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'whatsapp_registrar_mensagem';
  IF v_n <> 12 THEN
    RAISE EXCEPTION 'whatsapp_registrar_mensagem tem % parâmetros (esperado 12)', v_n;
  END IF;

  FOREACH v_t IN ARRAY ARRAY['public.conjuntos_anuncio', 'public.anuncios_origem', 'public.palavras_de_origem'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass) THEN
      RAISE EXCEPTION 'RLS desligada em %', v_t;
    END IF;
    IF has_table_privilege('anon', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'anon tem privilégio em %', v_t;
    END IF;
    IF has_table_privilege('authenticated', v_t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR NOT has_table_privilege('authenticated', v_t, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated deve só ler %', v_t;
    END IF;
  END LOOP;

  -- Só o servidor executa estas.
  FOREACH v_f IN ARRAY ARRAY[
    'public._wa_registrar_anuncio(text, jsonb, timestamptz, boolean)',
    'public._wa_classificar_contato(text, text, uuid, uuid)',
    'public.tg_atendimento_traz_contexto()',
    'public.tg_lead_tipo_confiavel()',
    'public.tg_atendimento_avisa_grupo()',
    'public.whatsapp_definir_tipo_do_contato(uuid, uuid, text)',
    'public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text)'
  ] LOOP
    IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ou authenticated executa %', v_f;
    END IF;
    IF NOT has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role perdeu o EXECUTE de %', v_f;
    END IF;
  END LOOP;

  -- A tela chama estas com a sessão de quem clicou: authenticated sim, anon não.
  FOREACH v_f IN ARRAY ARRAY[
    'public.origem_salvar_conjunto(text, text, text, text, text, text, boolean)',
    'public.origem_vincular_anuncio(text, text)',
    'public.origem_salvar_anuncio(text, text, text, boolean)',
    'public.origem_salvar_palavra(text, boolean)',
    'public.origem_remover_palavra(text)',
    'public.bex_normalizar_texto(text)'
  ] LOOP
    IF has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon executa %', v_f;
    END IF;
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated não executa %', v_f;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.conjuntos_anuncio
   WHERE conjunto_id IN ('120252255931120481', '120252255945380481');
  IF v_n <> 2 THEN RAISE EXCEPTION 'seed: % de 2 conjuntos', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.anuncios_origem
   WHERE anuncio_id IN ('120252258241960481', '120252258241750481', '120252258241600481', '120252258242200481',
                        '120252256242340481', '120252255941070481', '120252264127430481', '120252255959270481');
  IF v_n <> 8 THEN RAISE EXCEPTION 'seed: % de 8 anúncios', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_atendimentos'::regclass
                  AND tgname = 'tg_atendimento_traz_contexto' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'gatilho tg_atendimento_traz_contexto não existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_atendimentos'::regclass
                  AND tgname = 'tg_atendimento_avisa_grupo' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'gatilho tg_atendimento_avisa_grupo sumiu';
  END IF;
END
$conferencia$;

COMMIT;
