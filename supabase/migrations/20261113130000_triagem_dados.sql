-- AINDA NÃO APLICADA. O dono ensaia (docs/ensaio-triagem-dados.md) e aplica; depois troca esta linha por "APLICADA em <data>".
-- NADA CHAMA ESTAS FUNÇÕES AINDA. A triagem de boas-vindas nasce DESLIGADA e nenhuma rota, tela ou webhook a usa:
-- aplicar esta migração não muda comportamento nenhum em produção.
--
-- TRIAGEM DE BOAS-VINDAS DO WHATSAPP, B1: DADOS EDITÁVEIS (Bex Print, Onda B)
--
-- O QUE CRIA
--  1. Seis tipos: triagem_estado, triagem_status, triagem_ramo, triagem_intencao, triagem_casamento e
--     triagem_evento_tipo (este com três valores a mais que o projeto: nome_nao_gravado, expirou e freio).
--  2. whatsapp_triagem_config: UMA linha só (id boolean = true). Estado nasce 'desligada', percentual 0, números de
--     teste vazios, vale_a_partir_de vazio (preenchido na primeira saída de 'desligada' e nunca mais muda).
--  3. whatsapp_triagem_passos: o texto de cada etapa, que o dono edita. Um gatilho recusa texto com termo proibido.
--  4. whatsapp_triagem_respostas: o quadro (frase do contato -> intenção). Só intenção da lista fechada.
--  5. whatsapp_triagem_termos_proibidos: a fonte única do que cliente final nunca lê (parceiro, revend, tabela...)
--     e do que nenhum texto fala (valor, desconto, prazo, forma de pagamento) e do estilo do dono (sem travessão,
--     seta nem parênteses). Espelha src/domain/whatsapp/triagem/verificador.ts.
--  6. Funções, TODAS só para service_role: triagem_config_salvar, triagem_passo_salvar, triagem_resposta_salvar
--     (a tela chama por função de servidor que checa a permissão; cada função confere de novo
--     configuracoes.manage de quem pediu) e as internas _triagem_*. triagem_config_salvar ainda exige whatsapp.manage
--     (só admin, como a tela antiga) para mudar estado, percentual, números de teste e também os FREIOS (freio_*,
--     max_* e intervalo_minimo_s), e só deixa o estado subir um degrau por vez na escada desligada, ensaio, teste,
--     parcial, ligada (descer é sempre permitido). A mesma regra do degrau vale também no gatilho da configuração
--     (defesa em profundidade: um UPDATE direto com a chave de serviço também não pula degrau; descer passa, e é assim
--     que triagem_desligar e o freio automático funcionam). Descer o degrau NÃO é só mudar o número: a B4 confere o
--     degrau atual a cada mensagem de cada triagem em curso (ver o cabeçalho da B4).
--  7. Sementes: 32 textos (src/domain/whatsapp/triagem/textos-sementes.ts) e 770 frases do quadro
--     (quadro-sementes.ts). Gerados por scripts/gerar-sementes-triagem-sql.ts; tests/triagem-dados-banco.test.ts
--     compara este SQL com as constantes para os dois nunca divergirem.
--
-- REGRAS DO DONO QUE ESTA MIGRAÇÃO SEGURA
--  a) Só duas modalidades, cliente e parceiro. A outra palavra do mercado não existe aqui (só o radical "revend" na
--     lista de termos proibidos para o cliente final).
--  b) O robô nunca fala preço. Texto com R$, reais, %, desconto, pix, boleto, parcelamento, juros, nota fiscal ou
--     prazo em número é recusado pelo gatilho em QUALQUER ramo.
--  c) Texto do ramo cliente nunca tem parceiro, terceirizado, revend, tabela nem preço diferenciado, e não pode usar a
--     variável {{link_parceiro}} (crítica de alta gravidade: texto de cliente final passava na validação com ela).
--  d) Sem travessão, seta nem parênteses em texto que o cliente lê.
--
-- LIÇÕES APLICADAS
--  * Coluna nova em tabela com GRANT por coluna derruba a view de todos: por isso nada vai em whatsapp_configuracoes,
--    tudo em tabelas novas.
--  * REVOKE de PUBLIC não fecha o anon: tabelas e funções revogam de PUBLIC, anon e authenticated PELO NOME e só
--    depois concedem. Os privilégios padrão do schema dão ALL ao anon e ao authenticated em tabela nova.
--  * Função que o gatilho ou o CHECK chama roda com quem escreve; quem escreve é sempre função definer, então o EXECUTE
--    só do service_role basta.
--  * A política de leitura copia o desenho vivo de palavras_de_origem (is_staff e whatsapp.read ou
--    configuracoes.manage), lido em 13/11/2026. Antes de aplicar, confira com pg_policies.
--  * Escrita sem COALESCE solto: cada função de salvar diz exatamente o que muda.

BEGIN;

-- 0. Precondições: falha alta e clara se o banco não é o que esta migração supõe -----------------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.has_permission(uuid, text)') IS NULL
     OR to_regprocedure('public.is_staff(uuid)') IS NULL
     OR to_regprocedure('public.bex_normalizar_texto(text)') IS NULL
     OR to_regprocedure('public.normalize_whatsapp_phone(text)') IS NULL THEN
    RAISE EXCEPTION 'faltam funções base (has_permission, is_staff, bex_normalizar_texto, normalize_whatsapp_phone)';
  END IF;
  IF to_regclass('public.usuarios') IS NULL THEN
    RAISE EXCEPTION 'tabela usuarios não existe';
  END IF;
  IF to_regclass('public.whatsapp_triagem_config') IS NOT NULL
     OR to_regclass('public.whatsapp_triagem_passos') IS NOT NULL
     OR to_regclass('public.whatsapp_triagem_respostas') IS NOT NULL
     OR to_regclass('public.whatsapp_triagem_termos_proibidos') IS NOT NULL THEN
    RAISE EXCEPTION 'as tabelas da triagem já existem: esta migração é a primeira, não reaplique';
  END IF;
END
$pre$;

-- 1. Tipos ----------------------------------------------------------------------------------------------------------
CREATE TYPE public.triagem_estado AS ENUM ('desligada', 'ensaio', 'teste', 'parcial', 'ligada');
CREATE TYPE public.triagem_status AS ENUM (
  'ativa', 'concluida', 'expirada', 'pausada_humano', 'pausada_desligada',
  'parada_pelo_contato', 'entregue_equipe', 'pulada', 'ensaio'
);
CREATE TYPE public.triagem_ramo AS ENUM ('cliente', 'parceiro');
CREATE TYPE public.triagem_intencao AS ENUM (
  'sim', 'nao', 'mudar', 'primeira_vez', 'ja_cliente', 'pular', 'recusar', 'parar', 'falar_com_equipe',
  'parceiro', 'pergunta_preco', 'saudacao', 'agradecimento', 'automatica', 'reclamacao', 'nao_sei'
);
CREATE TYPE public.triagem_casamento AS ENUM ('igual', 'comeca', 'contem');
CREATE TYPE public.triagem_evento_tipo AS ENUM (
  'entrada', 'interpretada', 'envio_enfileirado', 'envio_ensaio', 'pulou', 'pausa', 'texto_barrado', 'erro',
  'gate', 'aviso_grupo', 'nome_nao_gravado', 'expirou', 'freio'
);

-- 2. Funções puras de apoio -------------------------------------------------------------------------------------------
-- Texto sem acento e em minúsculas, SEM tirar pontuação: é a base das regras do verificador (cópia de semAcento).
CREATE OR REPLACE FUNCTION public._triagem_texto_plano(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT lower(translate(coalesce(p_texto, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$function$;

-- A mesma normalização do quadro no TypeScript, menos os emojis (que só entram pelas sementes):
-- minúsculas, sem acento, sem pontuação, letras repetidas três ou mais vezes viram uma, espaço único.
CREATE OR REPLACE FUNCTION public._triagem_normalizar_frase(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT btrim(regexp_replace(
    regexp_replace(public.bex_normalizar_texto(p_texto), '([a-z])\1{2,}', '\1', 'g'),
    '\s+', ' ', 'g'))
$function$;

-- Lista de números de teste: só dígitos, de 10 a 15.
CREATE OR REPLACE FUNCTION public._triagem_numeros_validos(p_numeros text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(bool_and(n ~ '^\d{10,15}$'), true) FROM unnest(coalesce(p_numeros, '{}'::text[])) AS n
$function$;

CREATE OR REPLACE FUNCTION public._triagem_toca_atualizado_em()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $function$;

-- 3. Termos proibidos: a fonte única da regra --------------------------------------------------------------------------
-- tipo 'trecho': o termo (já normalizado) aparece no texto normalizado, como pedaço de palavra ("revend", "parceir").
-- tipo 'padrao': expressão regular POSIX; 'sobre' diz se roda no texto sem acento ('plano') ou no bruto em minúsculas
--   ('bruto', para R$, %, travessão, parênteses).
-- ramo 'todos' vale nos dois ramos; 'cliente' só no texto do cliente final; 'nome' só para o nome que o contato digita.
CREATE TABLE public.whatsapp_triagem_termos_proibidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra text NOT NULL CHECK (regra ~ '^[a-z_]{2,40}$'),
  termo text NOT NULL CHECK (btrim(termo) <> ''),
  tipo text NOT NULL CHECK (tipo IN ('trecho', 'padrao')),
  sobre text NOT NULL DEFAULT 'plano' CHECK (sobre IN ('plano', 'bruto')),
  ramo text NOT NULL CHECK (ramo IN ('todos', 'cliente', 'nome')),
  motivo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (regra, termo, ramo)
);

-- 4. Configuração: uma linha só --------------------------------------------------------------------------------------
CREATE TABLE public.whatsapp_triagem_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  estado public.triagem_estado NOT NULL DEFAULT 'desligada',
  percentual integer NOT NULL DEFAULT 0 CHECK (percentual BETWEEN 0 AND 100),
  numeros_teste text[] NOT NULL DEFAULT '{}' CHECK (public._triagem_numeros_validos(numeros_teste)),
  vale_a_partir_de timestamptz,
  espera_resposta_min integer NOT NULL DEFAULT 30 CHECK (espera_resposta_min BETWEEN 5 AND 1440),
  retomar_ate_horas integer NOT NULL DEFAULT 24 CHECK (retomar_ate_horas BETWEEN 1 AND 72),
  intervalo_minimo_s integer NOT NULL DEFAULT 20 CHECK (intervalo_minimo_s BETWEEN 5 AND 300),
  max_mensagens integer NOT NULL DEFAULT 8 CHECK (max_mensagens BETWEEN 1 AND 12),
  max_tentativas_por_passo integer NOT NULL DEFAULT 2 CHECK (max_tentativas_por_passo BETWEEN 1 AND 3),
  max_novas_por_hora integer NOT NULL DEFAULT 12 CHECK (max_novas_por_hora BETWEEN 1 AND 100),
  max_novas_por_dia integer NOT NULL DEFAULT 60 CHECK (max_novas_por_dia BETWEEN 1 AND 1000),
  atraso_min_s integer NOT NULL DEFAULT 3,
  atraso_max_s integer NOT NULL DEFAULT 8,
  resposta_rapida_demais_ms integer NOT NULL DEFAULT 2500 CHECK (resposta_rapida_demais_ms BETWEEN 500 AND 10000),
  exibir_telefone text NOT NULL DEFAULT 'final' CHECK (exibir_telefone IN ('final', 'inteiro')),
  ddd_padrao text CHECK (ddd_padrao IS NULL OR ddd_padrao ~ '^\d{2}$'),
  avisar_grupo boolean NOT NULL DEFAULT true,
  agente_apos_triagem boolean NOT NULL DEFAULT false,
  link_parceiro text CHECK (link_parceiro IS NULL OR link_parceiro ~ '^https://[^[:space:]]+$'),
  freio_falhas_envio integer NOT NULL DEFAULT 3 CHECK (freio_falhas_envio BETWEEN 1 AND 20),
  freio_erros_hora integer NOT NULL DEFAULT 10 CHECK (freio_erros_hora BETWEEN 1 AND 200),
  retencao_eventos_dias integer NOT NULL DEFAULT 90 CHECK (retencao_eventos_dias BETWEEN 7 AND 730),
  desligada_por text,
  desligada_em timestamptz,
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT triagem_config_atraso_check CHECK (
    atraso_min_s BETWEEN 1 AND 15 AND atraso_max_s BETWEEN atraso_min_s AND 15)
);
COMMENT ON TABLE public.whatsapp_triagem_config IS
  'Uma linha só. estado nasce desligada. Escrita só por triagem_config_salvar e triagem_desligar.';
COMMENT ON COLUMN public.whatsapp_triagem_config.retencao_eventos_dias IS
  'Os eventos da triagem não guardam texto de mensagem; a varredura apaga os mais velhos que isto.';

CREATE OR REPLACE FUNCTION public._triagem_config_antes_gravar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'A linha de configuração da triagem não pode ser apagada.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Preenchida na primeira saída de 'desligada' e nunca mais muda (nem para trás, nem para frente).
    IF OLD.vale_a_partir_de IS NOT NULL THEN
      NEW.vale_a_partir_de := OLD.vale_a_partir_de;
    ELSIF OLD.estado = 'desligada' AND NEW.estado <> 'desligada' THEN
      NEW.vale_a_partir_de := now();
    ELSE
      NEW.vale_a_partir_de := NULL;
    END IF;
    -- Defesa em profundidade: a escada (desligada, ensaio, teste, parcial, ligada) sobe um degrau por vez também aqui, para
    -- um UPDATE direto não pular degrau. Descer (inclusive para desligada) sempre passa: triagem_desligar, o freio automático
    -- e triagem_config_salvar descendo dependem disso.
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], NEW.estado::text)
           > array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], OLD.estado::text) + 1 THEN
      RAISE EXCEPTION 'A triagem sobe um degrau por vez (desligada, ensaio, teste, parcial, ligada): de % não vai direto para %.',
        OLD.estado, NEW.estado;
    END IF;
    IF NEW.estado = 'desligada' AND OLD.estado <> 'desligada' AND NEW.desligada_em IS NOT DISTINCT FROM OLD.desligada_em THEN
      NEW.desligada_em := now();
    END IF;
    NEW.atualizado_em := now();
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER tg_triagem_config_antes_gravar BEFORE UPDATE OR DELETE ON public.whatsapp_triagem_config
  FOR EACH ROW EXECUTE FUNCTION public._triagem_config_antes_gravar();
CREATE TRIGGER tg_triagem_config_sem_truncate BEFORE TRUNCATE ON public.whatsapp_triagem_config
  FOR EACH STATEMENT EXECUTE FUNCTION public._triagem_config_antes_gravar();

-- 5. Passos: o texto que o dono edita --------------------------------------------------------------------------------
CREATE TABLE public.whatsapp_triagem_passos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z][a-z0-9_]{1,40}$'),
  ramo public.triagem_ramo NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  texto text NOT NULL,
  variantes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(variantes) <= 2),
  repeticao text,
  ajuda_para_dono text,
  ativo boolean NOT NULL DEFAULT true,
  versao integer NOT NULL DEFAULT 1,
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo, ramo),
  CONSTRAINT triagem_passo_codigo_do_ramo CHECK (NOT (ramo = 'cliente' AND codigo LIKE 'parceiro%'))
);

-- Devolve os problemas de um texto, só pelo CÓDIGO da regra (nunca o trecho: o texto pode ter nome e CEP).
-- p_modelo = true: é um texto editável com {{variáveis}}, que são conferidas e preenchidas com valores de exemplo
--   (VALORES_DE_EXEMPLO em textos.ts). p_modelo = false: é o texto já montado com os dados da pessoa e não pode ter
--   variável sobrando.
-- Lista vazia = texto limpo.
CREATE OR REPLACE FUNCTION public._triagem_problemas_de_texto(p_texto text, p_ramo public.triagem_ramo, p_modelo boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_texto text := coalesce(p_texto, '');
  v_avaliar text;
  v_problemas text[] := '{}';
  v_exemplos constant jsonb := jsonb_build_object(
    'primeiro_nome', 'Maria', 'nome_completo', 'Maria Souza', 'telefone', 'terminado em 2233',
    'cep', '68900-000', 'bairro', 'Centro', 'cidade', 'Macapá', 'abre', '8h', 'fecha', '18h',
    'dias', 'de segunda a sexta', 'link_parceiro', 'https://exemplo.com.br/convite', 'ack', 'Tudo bem, sem problema.');
  v_var text;
  v_plano text;
  v_norm text;
  t record;
  v_acho boolean;
BEGIN
  IF btrim(v_texto) = '' THEN
    RETURN ARRAY['vazio'];
  END IF;
  IF char_length(v_texto) > 600 THEN
    v_problemas := array_append(v_problemas, 'acima_de_600_caracteres'::text);
  END IF;

  v_avaliar := v_texto;
  IF p_modelo THEN
    FOR v_var IN SELECT DISTINCT m[1] FROM regexp_matches(v_texto, '\{\{\s*([a-z_]+)\s*\}\}', 'g') AS m LOOP
      IF NOT (v_exemplos ? v_var) THEN
        v_problemas := array_append(v_problemas, ('variavel_fora_da_lista:' || v_var)::text);
      ELSIF v_var = 'link_parceiro' AND p_ramo = 'cliente' THEN
        -- Cliente final nunca recebe o link de parceiro, por nenhum texto.
        v_problemas := array_append(v_problemas, 'link_parceiro_no_ramo_cliente'::text);
      END IF;
    END LOOP;
    v_avaliar := regexp_replace(v_texto, '\{\{\s*([a-z_]+)\s*\}\}', '', 'g');
    IF v_avaliar ~ '\{\{|\}\}' THEN
      v_problemas := array_append(v_problemas, 'chaves_soltas'::text);
    END IF;
    -- avalia com os valores de exemplo no lugar das variáveis
    v_avaliar := v_texto;
    FOR v_var IN SELECT k FROM jsonb_object_keys(v_exemplos) AS k LOOP
      v_avaliar := regexp_replace(v_avaliar, '\{\{\s*' || v_var || '\s*\}\}', replace(v_exemplos ->> v_var, '\', '\\'), 'g');
    END LOOP;
    v_avaliar := regexp_replace(v_avaliar, '\{\{[^}]*\}\}', '', 'g');
  ELSIF v_texto ~ '\{\{|\}\}' THEN
    v_problemas := array_append(v_problemas, 'variavel_sem_preencher'::text);
  END IF;

  v_plano := public._triagem_texto_plano(v_avaliar);
  v_norm := public.bex_normalizar_texto(v_avaliar);
  FOR t IN
    SELECT regra, termo, tipo, sobre FROM public.whatsapp_triagem_termos_proibidos
     WHERE ativo AND ramo IN ('todos', CASE WHEN p_ramo = 'cliente' THEN 'cliente' ELSE 'todos' END)
  LOOP
    IF t.tipo = 'trecho' THEN
      v_acho := position(t.termo IN v_norm) > 0;
    ELSIF t.sobre = 'bruto' THEN
      v_acho := lower(v_avaliar) ~ t.termo;
    ELSE
      v_acho := v_plano ~ t.termo;
    END IF;
    IF v_acho AND NOT (t.regra = ANY (v_problemas)) THEN
      v_problemas := array_append(v_problemas, t.regra);
    END IF;
  END LOOP;
  RETURN v_problemas;
END $function$;

CREATE OR REPLACE FUNCTION public._triagem_passo_validar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p text[];
  v_v text;
BEGIN
  v_p := public._triagem_problemas_de_texto(NEW.texto, NEW.ramo, true);
  IF cardinality(v_p) > 0 THEN
    RAISE EXCEPTION 'Texto recusado em % (%): %', NEW.codigo, NEW.ramo, array_to_string(v_p, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.repeticao IS NOT NULL THEN
    v_p := public._triagem_problemas_de_texto(NEW.repeticao, NEW.ramo, true);
    IF cardinality(v_p) > 0 THEN
      RAISE EXCEPTION 'Repetição recusada em % (%): %', NEW.codigo, NEW.ramo, array_to_string(v_p, ', ')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  FOREACH v_v IN ARRAY coalesce(NEW.variantes, '{}'::text[]) LOOP
    v_p := public._triagem_problemas_de_texto(v_v, NEW.ramo, true);
    IF cardinality(v_p) > 0 THEN
      RAISE EXCEPTION 'Variante recusada em % (%): %', NEW.codigo, NEW.ramo, array_to_string(v_p, ', ')
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND (NEW.texto IS DISTINCT FROM OLD.texto OR NEW.variantes IS DISTINCT FROM OLD.variantes
                           OR NEW.repeticao IS DISTINCT FROM OLD.repeticao OR NEW.ativo IS DISTINCT FROM OLD.ativo) THEN
    NEW.versao := OLD.versao + 1;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $function$;

CREATE TRIGGER tg_triagem_passo_validar BEFORE INSERT OR UPDATE ON public.whatsapp_triagem_passos
  FOR EACH ROW EXECUTE FUNCTION public._triagem_passo_validar();

-- 6. Quadro de respostas ---------------------------------------------------------------------------------------------
CREATE TABLE public.whatsapp_triagem_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passo text CHECK (passo IS NULL OR passo IN ('nome', 'sobrenome', 'primeira_vez', 'cep', 'telefone', 'telefone_novo',
                                                'fechamento', 'parceiro_nome', 'parceiro_link')),
  intencao public.triagem_intencao NOT NULL CHECK (intencao <> 'nao_sei'),
  frase text NOT NULL CHECK (frase ~ '^[a-z0-9]+( [a-z0-9]+)*$'),
  casamento public.triagem_casamento NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- uma letra só serve para casamento igual: "s" e "n" valem como mensagem inteira, nunca como pedaço.
  -- (as sementes têm "ok" e "no" com casamento comeca; o que o dono acrescenta pela função exige 3 letras)
  CONSTRAINT triagem_resposta_frase_curta CHECK (casamento = 'igual' OR char_length(frase) >= 2)
);
-- passo nulo vale em qualquer etapa: entra na chave como texto vazio
CREATE UNIQUE INDEX whatsapp_triagem_respostas_chave ON public.whatsapp_triagem_respostas (coalesce(passo, ''), frase, casamento);
CREATE TRIGGER tg_triagem_respostas_atualizado BEFORE UPDATE ON public.whatsapp_triagem_respostas
  FOR EACH ROW EXECUTE FUNCTION public._triagem_toca_atualizado_em();

-- 7. RLS e GRANTs: leitura da equipe, escrita só pelas funções --------------------------------------------------------
ALTER TABLE public.whatsapp_triagem_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_triagem_passos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_triagem_respostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_triagem_termos_proibidos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_triagem_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_triagem_passos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_triagem_respostas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_triagem_termos_proibidos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_triagem_config TO authenticated;
GRANT SELECT ON public.whatsapp_triagem_passos TO authenticated;
GRANT SELECT ON public.whatsapp_triagem_respostas TO authenticated;
GRANT SELECT ON public.whatsapp_triagem_termos_proibidos TO authenticated;
GRANT ALL ON public.whatsapp_triagem_config TO service_role;
GRANT ALL ON public.whatsapp_triagem_passos TO service_role;
GRANT ALL ON public.whatsapp_triagem_respostas TO service_role;
GRANT ALL ON public.whatsapp_triagem_termos_proibidos TO service_role;

CREATE POLICY "triagem_config leitura equipe" ON public.whatsapp_triagem_config
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));
CREATE POLICY "triagem_passos leitura equipe" ON public.whatsapp_triagem_passos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));
CREATE POLICY "triagem_respostas leitura equipe" ON public.whatsapp_triagem_respostas
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));
CREATE POLICY "triagem_termos leitura equipe" ON public.whatsapp_triagem_termos_proibidos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));

-- 8. Funções de escrita, só service_role. A permissão de quem pediu é conferida aqui dentro. --------------------------
-- Quem pode o quê:
--   * qualquer campo: configuracoes.manage (admin e gestor) OU whatsapp.manage (admin);
--   * mudar ESTADO, PERCENTUAL ou NÚMEROS DE TESTE (o que liga ou desliga mensagem para cliente de verdade): só
--     whatsapp.manage, a mesma exigência da tela antiga whatsapp_salvar_configuracoes. O gestor edita textos e tempos,
--     não liga o robô.
--   * mudar os FREIOS (freio_falhas_envio, freio_erros_hora, max_mensagens, max_tentativas_por_passo, max_novas_por_hora,
--     max_novas_por_dia e intervalo_minimo_s): também só whatsapp.manage. Quem tem só configuracoes.manage não afrouxa
--     freio nenhum. Mandar o valor que já está gravado não conta como mudança (a tela pode reenviar tudo).
--   * a ESCADA: desligada, ensaio, teste, parcial, ligada. Para cima só um degrau por vez; para baixo qualquer um
--     (menos para desligada, que é triagem_desligar, porque desligar também para as conversas abertas).
CREATE OR REPLACE FUNCTION public.triagem_config_salvar(p_usuario uuid, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.whatsapp_triagem_config%ROWTYPE;
  v_estado public.triagem_estado;
  v_numeros text[];
  v_percentual integer;
  v_mexe_em_freio boolean;
  v_degraus constant text[] := ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'];
  v_de integer;
  v_para integer;
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'configuracoes.manage')
                               OR public.has_permission(p_usuario, 'whatsapp.manage')) THEN
    RAISE EXCEPTION 'Configurar a triagem exige a permissão configuracoes.manage.';
  END IF;
  IF jsonb_typeof(coalesce(p_config, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuração inválida.';
  END IF;
  SELECT * INTO c FROM public.whatsapp_triagem_config WHERE id FOR UPDATE;

  v_estado := c.estado;
  IF p_config ? 'estado' THEN
    v_estado := (p_config ->> 'estado')::public.triagem_estado;
    IF v_estado = 'desligada' AND c.estado <> 'desligada' THEN
      RAISE EXCEPTION 'Para desligar use triagem_desligar: ele também para as conversas abertas e cancela os envios pendentes.';
    END IF;
    v_de := array_position(v_degraus, c.estado::text);
    v_para := array_position(v_degraus, v_estado::text);
    IF v_para > v_de + 1 THEN
      RAISE EXCEPTION 'A triagem sobe um degrau por vez (desligada, ensaio, teste, parcial, ligada): de % não vai direto para %.',
        c.estado, v_estado;
    END IF;
  END IF;
  IF p_config ? 'numeros_teste' THEN
    SELECT coalesce(array_agg(DISTINCT n ORDER BY n), '{}'::text[]) INTO v_numeros
      FROM (SELECT public.normalize_whatsapp_phone(x) AS n FROM jsonb_array_elements_text(p_config -> 'numeros_teste') AS x) q
     WHERE n IS NOT NULL;
    IF cardinality(v_numeros) <> (SELECT count(*) FROM jsonb_array_elements_text(p_config -> 'numeros_teste')) THEN
      RAISE EXCEPTION 'Um dos números de teste está vazio ou repetido.';
    END IF;
  ELSE
    v_numeros := c.numeros_teste;
  END IF;
  v_percentual := CASE WHEN p_config ? 'percentual' THEN (p_config ->> 'percentual')::integer ELSE c.percentual END;

  IF (v_estado IS DISTINCT FROM c.estado OR v_percentual IS DISTINCT FROM c.percentual
      OR NOT (v_numeros <@ c.numeros_teste AND c.numeros_teste <@ v_numeros))
     AND NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN
    RAISE EXCEPTION 'Mudar o estado, o percentual ou os números de teste da triagem exige a permissão whatsapp.manage.';
  END IF;

  -- os freios são segurança: só quem pode ligar o robô (whatsapp.manage) muda qualquer um deles
  v_mexe_em_freio :=
       ((p_config ? 'freio_falhas_envio') AND (p_config ->> 'freio_falhas_envio')::integer IS DISTINCT FROM c.freio_falhas_envio)
    OR ((p_config ? 'freio_erros_hora') AND (p_config ->> 'freio_erros_hora')::integer IS DISTINCT FROM c.freio_erros_hora)
    OR ((p_config ? 'max_mensagens') AND (p_config ->> 'max_mensagens')::integer IS DISTINCT FROM c.max_mensagens)
    OR ((p_config ? 'max_tentativas_por_passo') AND (p_config ->> 'max_tentativas_por_passo')::integer IS DISTINCT FROM c.max_tentativas_por_passo)
    OR ((p_config ? 'max_novas_por_hora') AND (p_config ->> 'max_novas_por_hora')::integer IS DISTINCT FROM c.max_novas_por_hora)
    OR ((p_config ? 'max_novas_por_dia') AND (p_config ->> 'max_novas_por_dia')::integer IS DISTINCT FROM c.max_novas_por_dia)
    OR ((p_config ? 'intervalo_minimo_s') AND (p_config ->> 'intervalo_minimo_s')::integer IS DISTINCT FROM c.intervalo_minimo_s);
  IF v_mexe_em_freio AND NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN
    RAISE EXCEPTION 'Mudar os freios da triagem (freio_*, max_* e intervalo_minimo_s) exige a permissão whatsapp.manage.';
  END IF;

  UPDATE public.whatsapp_triagem_config SET
    estado = v_estado,
    numeros_teste = v_numeros,
    percentual = v_percentual,
    espera_resposta_min = CASE WHEN p_config ? 'espera_resposta_min' THEN (p_config ->> 'espera_resposta_min')::integer ELSE espera_resposta_min END,
    retomar_ate_horas = CASE WHEN p_config ? 'retomar_ate_horas' THEN (p_config ->> 'retomar_ate_horas')::integer ELSE retomar_ate_horas END,
    intervalo_minimo_s = CASE WHEN p_config ? 'intervalo_minimo_s' THEN (p_config ->> 'intervalo_minimo_s')::integer ELSE intervalo_minimo_s END,
    max_mensagens = CASE WHEN p_config ? 'max_mensagens' THEN (p_config ->> 'max_mensagens')::integer ELSE max_mensagens END,
    max_tentativas_por_passo = CASE WHEN p_config ? 'max_tentativas_por_passo' THEN (p_config ->> 'max_tentativas_por_passo')::integer ELSE max_tentativas_por_passo END,
    max_novas_por_hora = CASE WHEN p_config ? 'max_novas_por_hora' THEN (p_config ->> 'max_novas_por_hora')::integer ELSE max_novas_por_hora END,
    max_novas_por_dia = CASE WHEN p_config ? 'max_novas_por_dia' THEN (p_config ->> 'max_novas_por_dia')::integer ELSE max_novas_por_dia END,
    atraso_min_s = CASE WHEN p_config ? 'atraso_min_s' THEN (p_config ->> 'atraso_min_s')::integer ELSE atraso_min_s END,
    atraso_max_s = CASE WHEN p_config ? 'atraso_max_s' THEN (p_config ->> 'atraso_max_s')::integer ELSE atraso_max_s END,
    resposta_rapida_demais_ms = CASE WHEN p_config ? 'resposta_rapida_demais_ms' THEN (p_config ->> 'resposta_rapida_demais_ms')::integer ELSE resposta_rapida_demais_ms END,
    exibir_telefone = CASE WHEN p_config ? 'exibir_telefone' THEN p_config ->> 'exibir_telefone' ELSE exibir_telefone END,
    ddd_padrao = CASE WHEN p_config ? 'ddd_padrao' THEN nullif(btrim(p_config ->> 'ddd_padrao'), '') ELSE ddd_padrao END,
    avisar_grupo = CASE WHEN p_config ? 'avisar_grupo' THEN (p_config ->> 'avisar_grupo')::boolean ELSE avisar_grupo END,
    agente_apos_triagem = CASE WHEN p_config ? 'agente_apos_triagem' THEN (p_config ->> 'agente_apos_triagem')::boolean ELSE agente_apos_triagem END,
    link_parceiro = CASE WHEN p_config ? 'link_parceiro' THEN nullif(btrim(p_config ->> 'link_parceiro'), '') ELSE link_parceiro END,
    freio_falhas_envio = CASE WHEN p_config ? 'freio_falhas_envio' THEN (p_config ->> 'freio_falhas_envio')::integer ELSE freio_falhas_envio END,
    freio_erros_hora = CASE WHEN p_config ? 'freio_erros_hora' THEN (p_config ->> 'freio_erros_hora')::integer ELSE freio_erros_hora END,
    retencao_eventos_dias = CASE WHEN p_config ? 'retencao_eventos_dias' THEN (p_config ->> 'retencao_eventos_dias')::integer ELSE retencao_eventos_dias END,
    atualizado_por = p_usuario
  WHERE id;

  SELECT * INTO c FROM public.whatsapp_triagem_config WHERE id;
  RETURN jsonb_build_object('ok', true, 'estado', c.estado, 'percentual', c.percentual,
                            'vale_a_partir_de', c.vale_a_partir_de);
END $function$;

CREATE OR REPLACE FUNCTION public.triagem_passo_salvar(
  p_usuario uuid, p_codigo text, p_ramo public.triagem_ramo, p_texto text,
  p_variantes text[] DEFAULT '{}'::text[], p_repeticao text DEFAULT NULL, p_ativo boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_versao integer;
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'configuracoes.manage') THEN
    RAISE EXCEPTION 'Editar os textos da triagem exige a permissão configuracoes.manage.';
  END IF;
  -- Só edita passo que já existe: o código é amarrado à máquina de etapas, quem cria código novo é migração.
  UPDATE public.whatsapp_triagem_passos
     SET texto = btrim(p_texto),
         variantes = coalesce((SELECT array_agg(btrim(x)) FROM unnest(coalesce(p_variantes, '{}'::text[])) AS x WHERE btrim(x) <> ''), '{}'::text[]),
         repeticao = nullif(btrim(coalesce(p_repeticao, '')), ''),
         ativo = coalesce(p_ativo, ativo),
         atualizado_por = p_usuario
   WHERE codigo = p_codigo AND ramo = p_ramo
   RETURNING versao INTO v_versao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Passo % do ramo % não existe.', p_codigo, p_ramo;
  END IF;
  RETURN jsonb_build_object('ok', true, 'codigo', p_codigo, 'ramo', p_ramo, 'versao', v_versao);
END $function$;

CREATE OR REPLACE FUNCTION public.triagem_resposta_salvar(
  p_usuario uuid, p_passo text, p_intencao public.triagem_intencao, p_frase text,
  p_casamento public.triagem_casamento, p_ativo boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_frase text := public._triagem_normalizar_frase(p_frase);
  v_passo text := nullif(btrim(coalesce(p_passo, '')), '');
  v_id uuid;
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'configuracoes.manage') THEN
    RAISE EXCEPTION 'Editar o quadro de respostas exige a permissão configuracoes.manage.';
  END IF;
  IF v_frase = '' THEN
    RAISE EXCEPTION 'Escreva a frase.';
  END IF;
  IF p_intencao = 'nao_sei' THEN
    RAISE EXCEPTION 'A intenção nao_sei é o que sobra quando nada casa, não se cadastra frase para ela.';
  END IF;
  IF p_casamento <> 'igual' AND char_length(v_frase) < 3 THEN
    RAISE EXCEPTION 'Frase curta demais para "comeca" ou "contem": marcaria resposta errada. Use "igual" ou escreva mais.';
  END IF;
  INSERT INTO public.whatsapp_triagem_respostas (passo, intencao, frase, casamento, ativo)
  VALUES (v_passo, p_intencao, v_frase, p_casamento, coalesce(p_ativo, true))
  ON CONFLICT (coalesce(passo, ''), frase, casamento)
  DO UPDATE SET intencao = EXCLUDED.intencao, ativo = EXCLUDED.ativo
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'frase', v_frase);
END $function$;

REVOKE ALL ON FUNCTION public._triagem_texto_plano(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_normalizar_frase(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_numeros_validos(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_toca_atualizado_em() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_config_antes_gravar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_problemas_de_texto(text, public.triagem_ramo, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_passo_validar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_config_salvar(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_passo_salvar(uuid, text, public.triagem_ramo, text, text[], text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_resposta_salvar(uuid, text, public.triagem_intencao, text, public.triagem_casamento, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._triagem_texto_plano(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_normalizar_frase(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_numeros_validos(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_toca_atualizado_em() TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_config_antes_gravar() TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_problemas_de_texto(text, public.triagem_ramo, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_passo_validar() TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_config_salvar(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_passo_salvar(uuid, text, public.triagem_ramo, text, text[], text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_resposta_salvar(uuid, text, public.triagem_intencao, text, public.triagem_casamento, boolean) TO service_role;

-- 9. Sementes -------------------------------------------------------------------------------------------------------
-- 9.1 Configuração: uma linha, DESLIGADA.
INSERT INTO public.whatsapp_triagem_config (id) VALUES (true);

-- 9.2 Termos proibidos (espelham verificador.ts, regra por regra).
INSERT INTO public.whatsapp_triagem_termos_proibidos (regra, termo, tipo, sobre, ramo, motivo) VALUES
  ('moeda', 'r\s?\$', 'padrao', 'bruto', 'todos', 'O robô nunca fala valor em reais.'),
  ('valor_em_reais', '\y\d[\d.,]*\s*(reais|real|mil)\y|\yreais\y', 'padrao', 'plano', 'todos', 'O robô nunca fala valor.'),
  ('valor_com_centavos', '\y\d{1,3}(\.\d{3})*,\d{2}\y|\y\d+[.,]\d{2}\y(?!\s*(h|horas?))', 'padrao', 'plano', 'todos', 'Número com centavos parece preço.'),
  ('valor_depois_de_valor', '\yvalor(es)?\s*(de|e|:)?\s*\d', 'padrao', 'plano', 'todos', 'A palavra valor seguida de número é preço.'),
  ('porcentagem', '%|\ypor\s?cento\y', 'padrao', 'bruto', 'todos', 'Porcentagem é desconto ou juros.'),
  ('desconto', 'desconto', 'padrao', 'plano', 'todos', 'O robô nunca fala desconto.'),
  ('pix', '\ypix\y', 'padrao', 'plano', 'todos', 'Forma de pagamento é só com a equipe.'),
  ('boleto', '\yboleto', 'padrao', 'plano', 'todos', 'Forma de pagamento é só com a equipe.'),
  ('parcelamento', '\yparcel', 'padrao', 'plano', 'todos', 'Forma de pagamento é só com a equipe.'),
  ('juros', '\yjuros\y', 'padrao', 'plano', 'todos', 'Forma de pagamento é só com a equipe.'),
  ('nota_fiscal', 'nota\s+fiscal', 'padrao', 'plano', 'todos', 'Assunto fiscal é só com a equipe.'),
  ('prazo_em_numero', '\y\d+\s*(dias?|horas?|semanas?|meses|uteis)\y', 'padrao', 'plano', 'todos', 'O robô nunca promete prazo.'),
  ('travessao', '[—–―‒−⸺⸻﹘﹣－]', 'padrao', 'bruto', 'todos', 'Estilo do dono: sem travessão.'),
  ('seta', '[←-⇿➔➘-➯➱-➾⟰-⟿⤀-⥿⬅-⬇]|->|=>|<-', 'padrao', 'bruto', 'todos', 'Estilo do dono: sem seta.'),
  ('parenteses', '[()]', 'padrao', 'bruto', 'todos', 'Estilo do dono: sem parênteses.'),
  ('parceiro', 'parceir', 'trecho', 'plano', 'cliente', 'Cliente final nunca lê a palavra parceiro.'),
  ('parceria', 'parceri', 'trecho', 'plano', 'cliente', 'Cliente final nunca lê a palavra parceria.'),
  ('terceirizado', 'terceiriz', 'trecho', 'plano', 'cliente', 'Terceirizado é o mesmo que parceiro.'),
  ('revenda', 'revend', 'trecho', 'plano', 'cliente', 'O dono só tem duas modalidades: parceiro e cliente final.'),
  ('tabela', 'tabela', 'trecho', 'plano', 'cliente', 'Cliente final nunca lê tabela.'),
  ('preco_diferenciado', 'diferenciad', 'trecho', 'plano', 'cliente', 'Cliente final nunca lê preço diferenciado.'),
  ('preco_especial', '(preco|valor|condicoes?)\s+(especial|especiais|de custo|de atacado)|\yatacado\y', 'padrao', 'plano', 'cliente', 'Cliente final nunca lê preço especial.'),
  -- só para o NOME que o contato digita: o robô repete o primeiro nome, então palavrão e xingamento não podem passar
  ('palavrao', '\y(porra|caralho|merda|puta|puto|viado|fdp|buceta|arrombado|otario)\y', 'padrao', 'plano', 'nome', 'Nome que o contato digita volta na mensagem do robô.'),
  -- quem responde "quero 100 banners" ao pedido de nome não deu nome: é pedido ou produto, vai para a equipe
  ('pedido_ou_produto', '\y(quero|queria|preciso|precisamos|gostaria|orcamento|orcar|banner|banners|adesivo|adesivos|cartao|cartoes|panfleto|panfletos|lona|lonas|placa|placas|vinil|camisa|camiseta|impressao|imprimir|arte|logo|logomarca|fazer|comprar|urgente|valor|preco|quanto)\y', 'padrao', 'plano', 'nome', 'Resposta com pedido ou produto não é nome.');

-- 9.3 Textos das etapas (32) e quadro de respostas (770): gerados das constantes TypeScript.
INSERT INTO public.whatsapp_triagem_passos (codigo, ramo, ordem, texto, variantes, repeticao, ajuda_para_dono, ativo) VALUES
  ('nome', 'cliente', 1, 'Olá, seja bem-vindo à Bex Print! Para a gente seguir e atender você melhor, como posso te chamar? Pode me dizer seu nome e sobrenome.', ARRAY['Oi, que bom ter você por aqui na Bex Print! Para eu te atender melhor, qual é o seu nome e sobrenome?', 'Olá, tudo bem? Aqui é a Bex Print. Para continuar o atendimento, me diga seu nome e sobrenome, por favor.']::text[], 'Desculpe, não consegui entender. Pode escrever seu nome e sobrenome? Por exemplo, Maria Souza.', 'Primeira mensagem para quem acabou de chamar a loja. Pede nome e sobrenome.', true),
  ('nome_curto', 'cliente', 2, 'Para começar, pode me dizer seu nome e sobrenome?', '{}'::text[], NULL, 'Usada quando a pessoa já disse o que quer e o robô só precisa pedir o nome, sem repetir a saudação.', true),
  ('sobrenome', 'cliente', 3, 'Prazer, {{primeiro_nome}}! Qual é o seu sobrenome?', '{}'::text[], 'Desculpe, não consegui entender. Pode escrever só o seu sobrenome? Por exemplo, Souza.', 'Enviada quando a pessoa disse só o primeiro nome. Pede o sobrenome.', true),
  ('primeira_vez', 'cliente', 4, 'Prazer, {{primeiro_nome}}! Você já é cliente da Bex Print ou está nos conhecendo agora?', '{}'::text[], 'Só para eu registrar certinho, me diga assim: já sou cliente, ou primeira vez.', 'Pergunta se a pessoa já é cliente ou está conhecendo a Bex Print agora.', true),
  ('cep', 'cliente', 5, 'Que bom ter você por aqui! Se quiser, me passe só o seu CEP, ou o seu endereço, e a gente deixa guardado para atender melhor. Guardamos só para atender você e preparar seu atendimento. Se preferir não passar agora, sem problema, é só dizer pular.', '{}'::text[], 'Não consegui ler o CEP. Ele tem 8 números, por exemplo 68900-000. Se preferir, é só dizer pular.', 'Pede o CEP ou o endereço, só de quem está na primeira vez. A pessoa pode pular.', true),
  ('telefone', 'cliente', 6, '{{ack}} Para registrar seu contato, vi que você está falando comigo pelo número {{telefone}}. Posso registrar esse mesmo? Responda sim, ou me diga outro número se preferir.', '{}'::text[], 'Para registrar, me diga sim, se for esse número, ou escreva o outro número com DDD.', 'Pergunta se pode registrar o mesmo número com que a pessoa está falando. Mostra só o final do número.', true),
  ('telefone_direto', 'cliente', 7, '{{ack}} Qual número, com DDD, posso registrar para o seu contato?', '{}'::text[], 'Não consegui ler. Escreva só os números, com DDD, por exemplo 96 99999-9999.', 'Usada quando o número da conversa não é um celular comum. Pergunta direto qual número registrar.', true),
  ('telefone_novo', 'cliente', 8, 'Sem problema! Qual número, com DDD, você quer que eu registre?', '{}'::text[], 'Não consegui ler. Escreva só os números, com DDD, por exemplo 96 99999-9999.', 'Enviada quando a pessoa quer registrar outro número. Pede o número com DDD.', true),
  ('fechamento_fora', 'cliente', 9, 'Tudo anotado, {{primeiro_nome}}! No momento estamos fora do atendimento presencial, que funciona das {{abre}} às {{fecha}}, {{dias}}. Mas a gente pode adiantar por aqui. Se quiser, me conte o que você precisa, e a equipe continua com você assim que abrir.', '{}'::text[], NULL, 'Última mensagem quando a loja está fechada. Avisa o horário e diz que a equipe continua depois.', true),
  ('fechamento_fora_sem_horario', 'cliente', 10, 'Tudo anotado, {{primeiro_nome}}! A equipe continua com você assim que possível. Se quiser ir adiantando, me conte o que você precisa.', '{}'::text[], NULL, 'Última mensagem fora do horário quando nenhum dia de atendimento está ligado na tabela de horários.', true),
  ('fechamento_dentro', 'cliente', 11, 'Tudo anotado, {{primeiro_nome}}! Já avisei a equipe, que continua com você em instantes. Se quiser ir adiantando, me conte o que você precisa.', '{}'::text[], NULL, 'Última mensagem quando a loja está aberta. Diz que a equipe já foi avisada.', true),
  ('ack_ja_cliente', 'cliente', 12, 'Que bom ter você de volta!', '{}'::text[], NULL, 'Frase curta de boas-vindas para quem disse que já é cliente.', true),
  ('ack_cep_ok', 'cliente', 13, 'Anotei o CEP {{cep}}, {{bairro}}, {{cidade}}.', '{}'::text[], NULL, 'Confirma o CEP quando a consulta achou bairro e cidade.', true),
  ('ack_cep_sem_consulta', 'cliente', 14, 'Anotei o seu CEP.', '{}'::text[], NULL, 'Confirma o CEP quando a consulta não achou o endereço.', true),
  ('ack_endereco', 'cliente', 15, 'Anotei o seu endereço.', '{}'::text[], NULL, 'Confirma que o endereço escrito foi anotado.', true),
  ('ack_cep_pulado', 'cliente', 16, 'Tudo bem, sem problema.', '{}'::text[], NULL, 'Resposta curta para quem pulou ou recusou o CEP.', true),
  ('ack_preco', 'cliente', 17, 'O valor quem passa é a equipe, com tudo certinho para o seu pedido. Vou só terminar de anotar alguns dados para adiantar.', '{}'::text[], NULL, 'Resposta para quem pergunta valor no meio da conversa. O robô nunca fala preço, só avisa que a equipe passa.', true),
  ('aviso_audio', 'cliente', 18, 'Recebi seu áudio, mas por aqui eu consigo ler só texto. Pode me escrever a resposta? Se preferir, a equipe ouve seu áudio assim que puder.', '{}'::text[], NULL, 'Enviada uma vez, só no começo da conversa, quando a pessoa manda áudio. Pede a resposta por escrito.', true),
  ('aviso_arquivo', 'cliente', 19, 'Recebi seu arquivo e já deixei guardado para a equipe. Antes, só preciso terminar de anotar alguns dados.', '{}'::text[], NULL, 'Enviada uma vez quando a pessoa manda foto ou documento no começo da conversa.', true),
  ('aviso_equipe', 'cliente', 20, 'Claro, já chamo a equipe para continuar com você.', '{}'::text[], NULL, 'Resposta para quem pede para falar com uma pessoa da equipe.', true),
  ('aviso_parar', 'cliente', 21, 'Tudo bem, não vou mais te enviar mensagens automáticas. A equipe continua à disposição por aqui.', '{}'::text[], NULL, 'Resposta para quem pede para parar de receber mensagens automáticas.', true),
  ('reabertura', 'cliente', 22, 'Que bom ver você de volta! Para continuar, vou repetir a última pergunta.', '{}'::text[], NULL, 'Enviada quando a pessoa volta depois de um tempo parado. Avisa que a última pergunta será repetida.', true),
  ('parceiro_nome', 'parceiro', 1, 'Olá, seja bem-vindo ao programa de parceiros da Bex Print! Para a gente seguir, como posso te chamar? Pode me dizer seu nome e sobrenome.', '{}'::text[], 'Desculpe, não consegui entender. Pode escrever seu nome e sobrenome? Por exemplo, Maria Souza.', 'Primeira mensagem do caminho de parceiro. Só sai quando o anúncio é de parceiro ou a pessoa escreveu que quer ser parceiro.', true),
  ('nome_curto', 'parceiro', 2, 'Para começar, pode me dizer seu nome e sobrenome?', '{}'::text[], NULL, 'Usada quando a pessoa já disse o que quer e o robô só precisa pedir o nome, sem repetir a saudação.', true),
  ('parceiro_link', 'parceiro', 3, 'Prazer, {{primeiro_nome}}! O cadastro de parceiro é rápido e é por aqui: {{link_parceiro}}. Depois do cadastro, a equipe libera o seu acesso e conversa com você.', '{}'::text[], NULL, 'Manda o link de cadastro de parceiro, dentro do horário. Só sai depois de a pessoa dizer o nome.', true),
  ('parceiro_link_fora', 'parceiro', 4, 'Prazer, {{primeiro_nome}}! O cadastro de parceiro é rápido e é por aqui: {{link_parceiro}}. Depois do cadastro, a equipe libera o seu acesso e conversa com você. A equipe responde a partir das {{abre}}.', '{}'::text[], NULL, 'Mesmo link de cadastro, para fora do horário, com o aviso de que a equipe responde depois.', true),
  ('parceiro_valor', 'parceiro', 5, 'As condições de parceiro ficam disponíveis depois do cadastro.', '{}'::text[], NULL, 'Única resposta do caminho de parceiro para pergunta de valor. Nunca tem número.', true),
  ('aviso_equipe', 'parceiro', 6, 'Claro, já chamo a equipe para continuar com você.', '{}'::text[], NULL, 'Resposta para quem pede para falar com uma pessoa da equipe.', true),
  ('aviso_parar', 'parceiro', 7, 'Tudo bem, não vou mais te enviar mensagens automáticas. A equipe continua à disposição por aqui.', '{}'::text[], NULL, 'Resposta para quem pede para parar de receber mensagens automáticas.', true),
  ('aviso_audio', 'parceiro', 8, 'Recebi seu áudio, mas por aqui eu consigo ler só texto. Pode me escrever a resposta? Se preferir, a equipe ouve seu áudio assim que puder.', '{}'::text[], NULL, 'Enviada uma vez, só no começo da conversa, quando a pessoa manda áudio. Pede a resposta por escrito.', true),
  ('aviso_arquivo', 'parceiro', 9, 'Recebi seu arquivo e já deixei guardado para a equipe. Antes, só preciso terminar de anotar alguns dados.', '{}'::text[], NULL, 'Enviada uma vez quando a pessoa manda foto ou documento no começo da conversa.', true),
  ('reabertura', 'parceiro', 10, 'Que bom ver você de volta! Para continuar, vou repetir a última pergunta.', '{}'::text[], NULL, 'Enviada quando a pessoa volta depois de um tempo parado. Avisa que a última pergunta será repetida.', true);

INSERT INTO public.whatsapp_triagem_respostas (passo, intencao, frase, casamento, ativo) VALUES
  ('telefone', 'sim', 's', 'igual', true),
  ('telefone', 'sim', 'ss', 'igual', true),
  ('telefone', 'sim', 'sim sim', 'igual', true),
  ('telefone', 'sim', 'simm', 'igual', true),
  ('telefone', 'sim', 'ok ok', 'igual', true),
  ('telefone', 'sim', 'ta ok', 'igual', true),
  ('telefone', 'sim', 'certinho', 'igual', true),
  ('telefone', 'sim', 'pode anotar', 'igual', true),
  ('telefone', 'sim', 'pode salvar', 'igual', true),
  ('telefone', 'sim', 'pode confirmar', 'igual', true),
  ('telefone', 'sim', 'tudo certo', 'igual', true),
  ('telefone', 'sim', 'isso ai mesmo', 'igual', true),
  ('telefone', 'sim', 'e esse sim', 'igual', true),
  ('telefone', 'sim', 'eh esse', 'igual', true),
  ('telefone', 'sim', 'e esse ai', 'igual', true),
  ('telefone', 'sim', 'esse ai mesmo', 'igual', true),
  ('telefone', 'sim', 'emojiok', 'igual', true),
  ('telefone', 'sim', 'sim', 'comeca', true),
  ('telefone', 'sim', 'claro', 'comeca', true),
  ('telefone', 'sim', 'isso', 'comeca', true),
  ('telefone', 'sim', 'pode', 'comeca', true),
  ('telefone', 'sim', 'ok', 'comeca', true),
  ('telefone', 'sim', 'okay', 'comeca', true),
  ('telefone', 'sim', 'blz', 'comeca', true),
  ('telefone', 'sim', 'beleza', 'comeca', true),
  ('telefone', 'sim', 'certo', 'comeca', true),
  ('telefone', 'sim', 'correto', 'comeca', true),
  ('telefone', 'sim', 'exato', 'comeca', true),
  ('telefone', 'sim', 'perfeito', 'comeca', true),
  ('telefone', 'sim', 'confirmo', 'comeca', true),
  ('telefone', 'sim', 'confirmado', 'comeca', true),
  ('telefone', 'sim', 'positivo', 'comeca', true),
  ('telefone', 'sim', 'uhum', 'comeca', true),
  ('telefone', 'sim', 'aham', 'comeca', true),
  ('telefone', 'sim', 'com certeza', 'comeca', true),
  ('telefone', 'sim', 'e esse', 'comeca', true),
  ('telefone', 'sim', 'esse mesmo', 'comeca', true),
  ('telefone', 'sim', 'ta certo', 'comeca', true),
  ('telefone', 'sim', 'ta bom', 'comeca', true),
  ('telefone', 'sim', 'ta otimo', 'comeca', true),
  ('telefone', 'sim', 'de acordo', 'comeca', true),
  ('telefone', 'sim', 'combinado', 'comeca', true),
  ('telefone', 'sim', 'fechado', 'comeca', true),
  ('telefone', 'sim', 'show', 'comeca', true),
  ('telefone', 'sim', 'bora', 'comeca', true),
  ('telefone', 'sim', 'eh esse', 'comeca', true),
  ('telefone', 'sim', 'pode ser', 'comeca', true),
  ('telefone', 'sim', 'pode sim', 'comeca', true),
  ('telefone', 'sim', 'pode registrar', 'comeca', true),
  ('telefone', 'sim', 'e esse mesmo', 'comeca', true),
  ('telefone', 'sim', 'emojiok', 'comeca', true),
  ('telefone', 'sim', 'fechou', 'comeca', true),
  ('telefone', 'sim', 'tranquilo', 'comeca', true),
  ('telefone', 'sim', 'sem problema', 'comeca', true),
  ('telefone', 'sim', 'com certeza pode', 'comeca', true),
  ('telefone', 'sim', 'afirmativo', 'comeca', true),
  ('telefone', 'sim', 'yes', 'comeca', true),
  ('telefone', 'nao', 'n', 'igual', true),
  ('telefone', 'nao', 'nn', 'igual', true),
  ('telefone', 'nao', 'negativo', 'igual', true),
  ('telefone', 'nao', 'nao nao', 'igual', true),
  ('telefone', 'nao', 'nope', 'igual', true),
  ('telefone', 'nao', 'emojinao', 'igual', true),
  ('telefone', 'nao', 'nao e', 'igual', true),
  ('telefone', 'nao', 'nao e esse', 'igual', true),
  ('telefone', 'nao', 'esse nao', 'igual', true),
  ('telefone', 'nao', 'nao pode', 'igual', true),
  ('telefone', 'nao', 'nao obrigado', 'igual', true),
  ('telefone', 'nao', 'nao', 'comeca', true),
  ('telefone', 'nao', 'negativo', 'comeca', true),
  ('telefone', 'nao', 'esse nao', 'contem', true),
  ('telefone', 'nao', 'nao e esse', 'contem', true),
  ('telefone', 'nao', 'nao e meu', 'contem', true),
  ('telefone', 'nao', 'nao e o meu', 'contem', true),
  ('telefone', 'nao', 'nao e meu numero', 'contem', true),
  ('telefone', 'nao', 'nao e o meu numero', 'contem', true),
  ('telefone', 'nao', 'errado', 'contem', true),
  ('telefone', 'nao', 'esta errado', 'contem', true),
  ('telefone', 'nao', 'ta errado', 'contem', true),
  ('telefone', 'nao', 'numero errado', 'contem', true),
  ('telefone', 'mudar', 'pode trocar', 'igual', true),
  ('telefone', 'mudar', 'pode mudar', 'igual', true),
  ('telefone', 'mudar', 'pode trocar sim', 'igual', true),
  ('telefone', 'mudar', 'pode mudar sim', 'igual', true),
  ('telefone', 'mudar', 'pode ser outro', 'igual', true),
  ('telefone', 'mudar', 'pode ser outro numero', 'igual', true),
  ('telefone', 'mudar', 'pode usar outro', 'igual', true),
  ('telefone', 'mudar', 'quero mudar', 'contem', true),
  ('telefone', 'mudar', 'quero trocar', 'contem', true),
  ('telefone', 'mudar', 'mudar', 'contem', true),
  ('telefone', 'mudar', 'trocar', 'contem', true),
  ('telefone', 'mudar', 'outro', 'contem', true),
  ('telefone', 'mudar', 'outro numero', 'contem', true),
  ('telefone', 'mudar', 'e outro', 'contem', true),
  ('telefone', 'mudar', 'e outro numero', 'contem', true),
  ('telefone', 'mudar', 'meu numero e outro', 'contem', true),
  ('telefone', 'mudar', 'prefiro outro', 'contem', true),
  ('telefone', 'mudar', 'usa outro', 'contem', true),
  ('telefone', 'mudar', 'outro telefone', 'contem', true),
  ('telefone', 'mudar', 'outro celular', 'contem', true),
  ('telefone', 'mudar', 'vou passar outro', 'contem', true),
  ('telefone', 'mudar', 'quero passar outro', 'contem', true),
  ('telefone', 'mudar', 'quero informar outro', 'contem', true),
  ('telefone', 'mudar', 'tenho outro', 'contem', true),
  ('telefone', 'mudar', 'uso outro', 'contem', true),
  ('telefone', 'mudar', 'mudar o numero', 'contem', true),
  ('telefone', 'mudar', 'trocar o numero', 'contem', true),
  ('telefone', 'mudar', 'mudar numero', 'contem', true),
  ('telefone', 'mudar', 'esse e do trabalho', 'contem', true),
  ('telefone', 'mudar', 'e de outra pessoa', 'contem', true),
  ('telefone', 'mudar', 'quero registrar outro', 'contem', true),
  ('telefone', 'mudar', 'registra outro', 'contem', true),
  ('telefone', 'mudar', 'anota outro', 'contem', true),
  ('telefone', 'mudar', 'passar outro numero', 'contem', true),
  ('telefone', 'mudar', 'informar outro numero', 'contem', true),
  ('telefone', 'mudar', 'tem outro', 'contem', true),
  ('telefone', 'mudar', 'usa o outro', 'contem', true),
  ('telefone', 'mudar', 'outro whatsapp', 'contem', true),
  ('telefone', 'mudar', 'outro zap', 'contem', true),
  ('telefone', 'mudar', 'outra linha', 'contem', true),
  ('telefone', 'mudar', 'e outra linha', 'contem', true),
  ('telefone', 'mudar', 'qual outro', 'contem', true),
  ('telefone', 'mudar', 'nao e esse e outro', 'contem', true),
  ('telefone', 'mudar', 'troca por outro', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'primeira vez', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'primeira', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'primeiro contato', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'primeira compra', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'primeiro pedido', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'nunca', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'novo', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'nova', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'nao sou cliente', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'ainda nao sou cliente', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'ainda nao', 'comeca', true),
  ('primeira_vez', 'primeira_vez', 'e a primeira vez', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'minha primeira vez', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'primeira vez', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca comprei', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca fiz', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca fui', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'estou conhecendo', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'to conhecendo', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'conheci agora', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'sou novo', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'sou nova', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'novo aqui', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nova aqui', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'ainda nao', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'acabei de conhecer', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca comprei ai', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca comprei com voces', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca fiz pedido', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'e meu primeiro pedido', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'e minha primeira compra', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nao sou cliente', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca fui cliente', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nao conhecia', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'vi o anuncio', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'vi voces no instagram', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'vi no instagram', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'vi no face', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'to conhecendo agora', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'estou conhecendo agora', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'conheci pelo instagram', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'conheci pelo face', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca pedi', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nunca encomendei', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'primeira vez que compro', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'primeira vez que peco', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nao conheco', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'nao conhecia voces', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'primeiro atendimento', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'e o primeiro', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'me indicaram', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'uma amiga indicou', 'contem', true),
  ('primeira_vez', 'primeira_vez', 'um amigo indicou', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja', 'igual', true),
  ('primeira_vez', 'ja_cliente', 'ja sim', 'igual', true),
  ('primeira_vez', 'ja_cliente', 'sou', 'igual', true),
  ('primeira_vez', 'ja_cliente', 'sou sim', 'igual', true),
  ('primeira_vez', 'ja_cliente', 'ja fiz', 'igual', true),
  ('primeira_vez', 'ja_cliente', 'ja sou cliente', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja comprei', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja fiz', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja fui', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja fechei', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'cliente', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'cliente antigo', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja tenho cadastro', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja trabalho', 'comeca', true),
  ('primeira_vez', 'ja_cliente', 'ja sou cliente', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja comprei', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fiz', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fui', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fechei', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'cliente de voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja tenho cadastro', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja trabalho com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja comprei ai', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja comprei com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fiz pedido', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fiz pedidos', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente antigo', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'cliente antigo', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou fregues', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou freguesa', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'compro sempre', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja sou de casa', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja tenho cadastro ai', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fui cliente', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja fechei com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja trabalhei com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja conheco voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente sim', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente ja', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'cliente ha anos', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'cliente de longa data', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja encomendei', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja pedi', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja imprimi com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja imprimi ai', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja comprei varias vezes', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja comprei outras vezes', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente de ja', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'fiz pedido ai', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'fiz pedido com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'compro com voces', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'compro ai', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'ja sou', 'contem', true),
  ('primeira_vez', 'ja_cliente', 'sou cliente de voces', 'contem', true),
  ('cep', 'pular', 'nao', 'igual', true),
  ('cep', 'pular', 'pulo', 'igual', true),
  ('cep', 'pular', 'skip', 'igual', true),
  ('cep', 'pular', 'depois', 'igual', true),
  ('cep', 'pular', 'agora nao', 'igual', true),
  ('cep', 'pular', 'nao sei', 'igual', true),
  ('cep', 'pular', 'nao lembro', 'igual', true),
  ('cep', 'pular', 'pular', 'comeca', true),
  ('cep', 'pular', 'pula', 'comeca', true),
  ('cep', 'pular', 'depois', 'comeca', true),
  ('cep', 'pular', 'mais tarde', 'comeca', true),
  ('cep', 'pular', 'outra hora', 'comeca', true),
  ('cep', 'pular', 'outro dia', 'comeca', true),
  ('cep', 'pular', 'pular', 'contem', true),
  ('cep', 'pular', 'pula', 'contem', true),
  ('cep', 'pular', 'mais tarde', 'contem', true),
  ('cep', 'pular', 'deixa pra depois', 'contem', true),
  ('cep', 'pular', 'deixa pra la', 'contem', true),
  ('cep', 'pular', 'agora nao', 'contem', true),
  ('cep', 'pular', 'nao tenho aqui', 'contem', true),
  ('cep', 'pular', 'nao sei o cep', 'contem', true),
  ('cep', 'pular', 'nao lembro o cep', 'contem', true),
  ('cep', 'pular', 'nao tenho o cep', 'contem', true),
  ('cep', 'pular', 'depois eu passo', 'contem', true),
  ('cep', 'pular', 'depois te passo', 'contem', true),
  ('cep', 'pular', 'outra hora', 'contem', true),
  ('cep', 'pular', 'outro dia', 'contem', true),
  ('cep', 'pular', 'nao sei qual e', 'contem', true),
  ('cep', 'pular', 'esqueci o cep', 'contem', true),
  ('cep', 'pular', 'nao lembro', 'contem', true),
  ('cep', 'pular', 'prefiro passar depois', 'contem', true),
  ('cep', 'pular', 'passo depois', 'contem', true),
  ('cep', 'pular', 'mando depois', 'contem', true),
  ('cep', 'pular', 'vou ver e te falo', 'contem', true),
  ('cep', 'pular', 'agora nao posso', 'contem', true),
  ('cep', 'pular', 'nao tenho em maos', 'contem', true),
  ('cep', 'pular', 'nao estou com ele', 'contem', true),
  ('cep', 'pular', 'nao decorei o cep', 'contem', true),
  ('cep', 'pular', 'nao sei de cabeca', 'contem', true),
  ('cep', 'pular', 'pular essa', 'contem', true),
  ('cep', 'pular', 'pular etapa', 'contem', true),
  ('cep', 'pular', 'pular esta', 'contem', true),
  ('cep', 'pular', 'deixa para depois', 'contem', true),
  ('cep', 'pular', 'deixa para la', 'contem', true),
  ('cep', 'pular', 'mais tarde eu passo', 'contem', true),
  ('cep', 'pular', 'mais tarde te passo', 'contem', true),
  ('cep', 'pular', 'depois eu mando', 'contem', true),
  ('cep', 'pular', 'depois eu te mando', 'contem', true),
  ('cep', 'pular', 'agora eu nao tenho', 'contem', true),
  ('cep', 'pular', 'nao tenho aqui agora', 'contem', true),
  ('cep', 'pular', 'nao sei o cep agora', 'contem', true),
  ('cep', 'pular', 'nao lembro o cep agora', 'contem', true),
  ('cep', 'pular', 'nao faco ideia do cep', 'contem', true),
  ('cep', 'pular', 'nao sei o meu cep', 'contem', true),
  ('cep', 'pular', 'nao sei meu cep', 'contem', true),
  ('cep', 'pular', 'nao tenho cep', 'contem', true),
  ('cep', 'recusar', 'nao quero', 'igual', true),
  ('cep', 'recusar', 'nao precisa', 'igual', true),
  ('cep', 'recusar', 'nao informo', 'igual', true),
  ('cep', 'recusar', 'sem cep', 'igual', true),
  ('cep', 'recusar', 'prefiro nao', 'igual', true),
  ('cep', 'recusar', 'dispenso', 'igual', true),
  ('cep', 'recusar', 'sem endereco', 'igual', true),
  ('cep', 'recusar', 'endereco nao', 'igual', true),
  ('cep', 'recusar', 'prefiro nao', 'contem', true),
  ('cep', 'recusar', 'prefiro nao informar', 'contem', true),
  ('cep', 'recusar', 'nao quero informar', 'contem', true),
  ('cep', 'recusar', 'nao quero passar', 'contem', true),
  ('cep', 'recusar', 'nao vou passar', 'contem', true),
  ('cep', 'recusar', 'nao precisa', 'contem', true),
  ('cep', 'recusar', 'nao informo', 'contem', true),
  ('cep', 'recusar', 'sem cep', 'contem', true),
  ('cep', 'recusar', 'nao quero dar', 'contem', true),
  ('cep', 'recusar', 'nao quero dar o cep', 'contem', true),
  ('cep', 'recusar', 'nao vou informar', 'contem', true),
  ('cep', 'recusar', 'nao desejo informar', 'contem', true),
  ('cep', 'recusar', 'nao gosto de passar dados', 'contem', true),
  ('cep', 'recusar', 'nao passo', 'contem', true),
  ('cep', 'recusar', 'nao passo dados', 'contem', true),
  ('cep', 'recusar', 'nao dou', 'contem', true),
  ('cep', 'recusar', 'prefiro nao passar', 'contem', true),
  ('cep', 'recusar', 'prefiro nao dar', 'contem', true),
  ('cep', 'recusar', 'nao quero compartilhar', 'contem', true),
  ('cep', 'recusar', 'nao compartilho', 'contem', true),
  ('cep', 'recusar', 'sem endereco', 'contem', true),
  ('cep', 'recusar', 'nao me sinto confortavel', 'contem', true),
  ('cep', 'recusar', 'dispenso', 'contem', true),
  ('cep', 'recusar', 'dispenso isso', 'contem', true),
  ('cep', 'recusar', 'nao e necessario', 'contem', true),
  ('cep', 'recusar', 'nao tem necessidade', 'contem', true),
  ('cep', 'recusar', 'nao quero informar meu endereco', 'contem', true),
  ('cep', 'recusar', 'endereco nao', 'contem', true),
  ('cep', 'recusar', 'nao informo endereco', 'contem', true),
  ('cep', 'recusar', 'nao quero passar o cep', 'contem', true),
  ('cep', 'recusar', 'nao vou passar o cep', 'contem', true),
  ('cep', 'recusar', 'nao quero passar endereco', 'contem', true),
  ('cep', 'recusar', 'nao vou dar', 'contem', true),
  ('cep', 'recusar', 'nao quero dar endereco', 'contem', true),
  ('cep', 'recusar', 'nao vou informar o cep', 'contem', true),
  ('cep', 'recusar', 'nao quero informar o cep', 'contem', true),
  ('cep', 'recusar', 'nao desejo passar', 'contem', true),
  ('cep', 'recusar', 'prefiro nao informar o cep', 'contem', true),
  ('cep', 'recusar', 'prefiro nao passar o cep', 'contem', true),
  ('cep', 'recusar', 'nao dou o cep', 'contem', true),
  ('cep', 'recusar', 'nao passo o cep', 'contem', true),
  ('cep', 'recusar', 'nao passo endereco', 'contem', true),
  ('cep', 'recusar', 'melhor nao', 'contem', true),
  ('cep', 'recusar', 'prefiro guardar', 'contem', true),
  (NULL, 'parar', 'parar', 'igual', true),
  (NULL, 'parar', 'pare', 'igual', true),
  (NULL, 'parar', 'para', 'igual', true),
  (NULL, 'parar', 'stop', 'igual', true),
  (NULL, 'parar', 'sair', 'igual', true),
  (NULL, 'parar', 'descadastrar', 'igual', true),
  (NULL, 'parar', 'remover', 'igual', true),
  (NULL, 'parar', 'bloquear', 'igual', true),
  (NULL, 'parar', 'chega', 'igual', true),
  (NULL, 'parar', 'pare de mandar', 'contem', true),
  (NULL, 'parar', 'para de mandar', 'contem', true),
  (NULL, 'parar', 'para de mandar mensagem', 'contem', true),
  (NULL, 'parar', 'nao me mande mais', 'contem', true),
  (NULL, 'parar', 'nao me mande mensagem', 'contem', true),
  (NULL, 'parar', 'nao quero receber', 'contem', true),
  (NULL, 'parar', 'nao quero mais mensagens', 'contem', true),
  (NULL, 'parar', 'nao quero mais receber', 'contem', true),
  (NULL, 'parar', 'nao quero mais mensagem', 'contem', true),
  (NULL, 'parar', 'pare de me mandar mensagem', 'contem', true),
  (NULL, 'parar', 'parem de mandar', 'contem', true),
  (NULL, 'parar', 'para de me mandar', 'contem', true),
  (NULL, 'parar', 'me tira da lista', 'contem', true),
  (NULL, 'parar', 'me remove da lista', 'contem', true),
  (NULL, 'parar', 'me exclua', 'contem', true),
  (NULL, 'parar', 'sair da lista', 'contem', true),
  (NULL, 'parar', 'descadastra meu numero', 'contem', true),
  (NULL, 'parar', 'descadastrar meu numero', 'contem', true),
  (NULL, 'parar', 'nao me envie mais', 'contem', true),
  (NULL, 'parar', 'nao envie mais', 'contem', true),
  (NULL, 'parar', 'pare com isso', 'contem', true),
  (NULL, 'parar', 'para com isso', 'contem', true),
  (NULL, 'parar', 'chega de mensagem', 'contem', true),
  (NULL, 'parar', 'chega de mensagens', 'contem', true),
  (NULL, 'parar', 'deixa de me mandar mensagem', 'contem', true),
  (NULL, 'parar', 'vou denunciar', 'contem', true),
  (NULL, 'parar', 'vou te denunciar', 'contem', true),
  (NULL, 'parar', 'vou bloquear', 'contem', true),
  (NULL, 'parar', 'vou bloquear voces', 'contem', true),
  (NULL, 'parar', 'nao tenho interesse', 'contem', true),
  (NULL, 'parar', 'nao me interessa', 'contem', true),
  (NULL, 'parar', 'remove meu numero', 'contem', true),
  (NULL, 'parar', 'remova meu numero', 'contem', true),
  (NULL, 'parar', 'tira meu numero', 'contem', true),
  (NULL, 'parar', 'para de me enviar', 'contem', true),
  (NULL, 'parar', 'pare de me enviar', 'contem', true),
  (NULL, 'parar', 'nao quero mais contato', 'contem', true),
  (NULL, 'parar', 'nao me chame mais', 'contem', true),
  (NULL, 'parar', 'nao me chamem mais', 'contem', true),
  (NULL, 'parar', 'nao mande mais mensagem', 'contem', true),
  (NULL, 'parar', 'nao manda mais', 'contem', true),
  (NULL, 'parar', 'nao mande mais', 'contem', true),
  (NULL, 'parar', 'para de enviar', 'contem', true),
  (NULL, 'parar', 'pare de enviar', 'contem', true),
  (NULL, 'parar', 'cancelar mensagens', 'contem', true),
  (NULL, 'parar', 'parar mensagens', 'contem', true),
  (NULL, 'parar', 'parar de receber', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com uma pessoa', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com alguem', 'contem', true),
  (NULL, 'falar_com_equipe', 'chama alguem', 'contem', true),
  (NULL, 'falar_com_equipe', 'pessoa de verdade', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com voces', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com uma pessoa', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com um atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com a equipe', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com o dono', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com o responsavel', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com a gerente', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com o gerente', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero um atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'preciso de um atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'preciso falar com alguem', 'contem', true),
  (NULL, 'falar_com_equipe', 'tem alguem ai', 'contem', true),
  (NULL, 'falar_com_equipe', 'tem algum humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'atendimento humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero atendimento humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'me passa para um atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'me passa pra um atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'passa para a equipe', 'contem', true),
  (NULL, 'falar_com_equipe', 'passa pra equipe', 'contem', true),
  (NULL, 'falar_com_equipe', 'chama a equipe', 'contem', true),
  (NULL, 'falar_com_equipe', 'chama o atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'chama o responsavel', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com o vendedor', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com vendedor', 'contem', true),
  (NULL, 'falar_com_equipe', 'pessoa real', 'contem', true),
  (NULL, 'falar_com_equipe', 'uma pessoa de verdade', 'contem', true),
  (NULL, 'falar_com_equipe', 'gente de verdade', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com gente', 'contem', true),
  (NULL, 'falar_com_equipe', 'me liga', 'contem', true),
  (NULL, 'falar_com_equipe', 'pode me ligar', 'contem', true),
  (NULL, 'falar_com_equipe', 'me ligue', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero uma ligacao', 'contem', true),
  (NULL, 'falar_com_equipe', 'falar com uma pessoa de verdade', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com a equipe', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com um humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'quero falar com alguem', 'contem', true),
  (NULL, 'falar_com_equipe', 'humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'passa para um humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'chama um humano', 'contem', true),
  (NULL, 'falar_com_equipe', 'chame um atendente', 'contem', true),
  (NULL, 'falar_com_equipe', 'chame alguem', 'contem', true),
  (NULL, 'falar_com_equipe', 'tem gente ai', 'contem', true),
  (NULL, 'falar_com_equipe', 'tem alguem da equipe', 'contem', true),
  (NULL, 'falar_com_equipe', 'preciso de uma pessoa', 'contem', true),
  (NULL, 'parceiro', 'parceiro', 'igual', true),
  (NULL, 'parceiro', 'parceira', 'igual', true),
  (NULL, 'parceiro', 'parceiros', 'igual', true),
  (NULL, 'parceiro', 'parceria', 'igual', true),
  (NULL, 'parceiro', 'parcerias', 'igual', true),
  (NULL, 'parceiro', 'terceirizado', 'igual', true),
  (NULL, 'parceiro', 'terceirizada', 'igual', true),
  (NULL, 'parceiro', 'terceirizados', 'igual', true),
  (NULL, 'parceiro', 'terceirizadas', 'igual', true),
  (NULL, 'parceiro', 'quero ser parceiro', 'contem', true),
  (NULL, 'parceiro', 'quero ser parceira', 'contem', true),
  (NULL, 'parceiro', 'quero ser um parceiro', 'contem', true),
  (NULL, 'parceiro', 'quero ser uma parceira', 'contem', true),
  (NULL, 'parceiro', 'sou parceiro', 'contem', true),
  (NULL, 'parceiro', 'sou parceira', 'contem', true),
  (NULL, 'parceiro', 'sou terceirizado', 'contem', true),
  (NULL, 'parceiro', 'sou terceirizada', 'contem', true),
  (NULL, 'parceiro', 'programa de parceiros', 'contem', true),
  (NULL, 'parceiro', 'programa de parceria', 'contem', true),
  (NULL, 'parceiro', 'quero ser terceirizado', 'contem', true),
  (NULL, 'parceiro', 'quero ser terceirizada', 'contem', true),
  (NULL, 'parceiro', 'seja parceiro', 'contem', true),
  (NULL, 'parceiro', 'ser parceiro', 'contem', true),
  (NULL, 'parceiro', 'ser parceira', 'contem', true),
  (NULL, 'parceiro', 'interesse em ser parceiro', 'contem', true),
  (NULL, 'parceiro', 'interesse em ser parceira', 'contem', true),
  (NULL, 'parceiro', 'como ser parceiro', 'contem', true),
  (NULL, 'parceiro', 'como ser parceira', 'contem', true),
  (NULL, 'parceiro', 'como virar parceiro', 'contem', true),
  (NULL, 'parceiro', 'como virar parceira', 'contem', true),
  (NULL, 'parceiro', 'quero me tornar parceiro', 'contem', true),
  (NULL, 'parceiro', 'quero me tornar parceira', 'contem', true),
  (NULL, 'parceiro', 'quero me cadastrar como parceiro', 'contem', true),
  (NULL, 'parceiro', 'cadastro de parceiro', 'contem', true),
  (NULL, 'parceiro', 'cadastro de parceiros', 'contem', true),
  (NULL, 'parceiro', 'quero fazer parte do programa de parceiros', 'contem', true),
  (NULL, 'parceiro', 'trabalho como terceirizado', 'contem', true),
  (NULL, 'parceiro', 'trabalho como terceirizada', 'contem', true),
  (NULL, 'parceiro', 'sou grafica parceira', 'contem', true),
  (NULL, 'parceiro', 'ser terceirizado', 'contem', true),
  (NULL, 'parceiro', 'ser terceirizada', 'contem', true),
  (NULL, 'parceiro', 'virar parceiro', 'contem', true),
  (NULL, 'parceiro', 'virar parceira', 'contem', true),
  (NULL, 'parceiro', 'tornar parceiro', 'contem', true),
  (NULL, 'parceiro', 'tornar parceira', 'contem', true),
  (NULL, 'parceiro', 'faco parte do programa de parceiros', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto custa', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto custam', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto saem', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto ficam', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto fica', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto sai', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto e', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto cobram', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto cobra', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto custaria', 'contem', true),
  (NULL, 'pergunta_preco', 'valor', 'contem', true),
  (NULL, 'pergunta_preco', 'valores', 'contem', true),
  (NULL, 'pergunta_preco', 'qual o valor', 'contem', true),
  (NULL, 'pergunta_preco', 'qual valor', 'contem', true),
  (NULL, 'pergunta_preco', 'preco', 'contem', true),
  (NULL, 'pergunta_preco', 'precos', 'contem', true),
  (NULL, 'pergunta_preco', 'qual o preco', 'contem', true),
  (NULL, 'pergunta_preco', 'orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'orcamentos', 'contem', true),
  (NULL, 'pergunta_preco', 'desconto', 'contem', true),
  (NULL, 'pergunta_preco', 'tabela de preco', 'contem', true),
  (NULL, 'pergunta_preco', 'tabela de precos', 'contem', true),
  (NULL, 'pergunta_preco', 'tabela', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto ta', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto esta', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto vai ficar', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto vai custar', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto que e', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto que custa', 'contem', true),
  (NULL, 'pergunta_preco', 'me passa o valor', 'contem', true),
  (NULL, 'pergunta_preco', 'me passa o preco', 'contem', true),
  (NULL, 'pergunta_preco', 'me passa um orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'quero um orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'queria um orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'gostaria de um orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'fazer um orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'orcar', 'contem', true),
  (NULL, 'pergunta_preco', 'pode orcar', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto custa o metro', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto o metro', 'contem', true),
  (NULL, 'pergunta_preco', 'tem desconto', 'contem', true),
  (NULL, 'pergunta_preco', 'faz desconto', 'contem', true),
  (NULL, 'pergunta_preco', 'qual o desconto', 'contem', true),
  (NULL, 'pergunta_preco', 'fazem desconto', 'contem', true),
  (NULL, 'pergunta_preco', 'promocao', 'contem', true),
  (NULL, 'pergunta_preco', 'tabela de valores', 'contem', true),
  (NULL, 'pergunta_preco', 'lista de precos', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto pago', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto vou pagar', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto e que fica', 'contem', true),
  (NULL, 'pergunta_preco', 'qto custa', 'contem', true),
  (NULL, 'pergunta_preco', 'qto fica', 'contem', true),
  (NULL, 'pergunta_preco', 'qto e', 'contem', true),
  (NULL, 'pergunta_preco', 'qnto custa', 'contem', true),
  (NULL, 'pergunta_preco', 'qnto fica', 'contem', true),
  (NULL, 'pergunta_preco', 'q valor', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto fica o', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto sai o', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto fica cada', 'contem', true),
  (NULL, 'pergunta_preco', 'custa quanto', 'contem', true),
  (NULL, 'pergunta_preco', 'fica quanto', 'contem', true),
  (NULL, 'pergunta_preco', 'sai quanto', 'contem', true),
  (NULL, 'pergunta_preco', 'cobram quanto', 'contem', true),
  (NULL, 'pergunta_preco', 'qual o custo', 'contem', true),
  (NULL, 'pergunta_preco', 'qual custo', 'contem', true),
  (NULL, 'pergunta_preco', 'quanto de custo', 'contem', true),
  (NULL, 'pergunta_preco', 'me diz o valor', 'contem', true),
  (NULL, 'pergunta_preco', 'me fala o valor', 'contem', true),
  (NULL, 'pergunta_preco', 'me manda o valor', 'contem', true),
  (NULL, 'pergunta_preco', 'me manda o orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'preciso de um orcamento', 'contem', true),
  (NULL, 'pergunta_preco', 'preciso do valor', 'contem', true),
  (NULL, 'pergunta_preco', 'tem como fazer um orcamento', 'contem', true),
  (NULL, 'saudacao', 'oi', 'igual', true),
  (NULL, 'saudacao', 'oii', 'igual', true),
  (NULL, 'saudacao', 'ola', 'igual', true),
  (NULL, 'saudacao', 'bom dia', 'igual', true),
  (NULL, 'saudacao', 'boa tarde', 'igual', true),
  (NULL, 'saudacao', 'boa noite', 'igual', true),
  (NULL, 'saudacao', 'e ai', 'igual', true),
  (NULL, 'saudacao', 'opa', 'igual', true),
  (NULL, 'saudacao', 'oie', 'igual', true),
  (NULL, 'saudacao', 'tudo bem', 'igual', true),
  (NULL, 'saudacao', 'eai', 'igual', true),
  (NULL, 'saudacao', 'eae', 'igual', true),
  (NULL, 'saudacao', 'fala', 'igual', true),
  (NULL, 'saudacao', 'salve', 'igual', true),
  (NULL, 'saudacao', 'tudo bom', 'igual', true),
  (NULL, 'saudacao', 'td bem', 'igual', true),
  (NULL, 'saudacao', 'hello', 'igual', true),
  (NULL, 'saudacao', 'hi', 'igual', true),
  (NULL, 'saudacao', 'alo', 'igual', true),
  (NULL, 'saudacao', 'como vai', 'igual', true),
  (NULL, 'saudacao', 'ola tudo bem', 'igual', true),
  (NULL, 'saudacao', 'oi tudo bem', 'igual', true),
  (NULL, 'saudacao', 'oi bom dia', 'igual', true),
  (NULL, 'saudacao', 'ola bom dia', 'igual', true),
  (NULL, 'saudacao', 'oi boa tarde', 'igual', true),
  (NULL, 'saudacao', 'ola boa tarde', 'igual', true),
  (NULL, 'saudacao', 'oi boa noite', 'igual', true),
  (NULL, 'saudacao', 'ola boa noite', 'igual', true),
  (NULL, 'saudacao', 'oi pessoal', 'igual', true),
  (NULL, 'saudacao', 'ola pessoal', 'igual', true),
  (NULL, 'saudacao', 'oi gente', 'igual', true),
  (NULL, 'saudacao', 'ola gente', 'igual', true),
  (NULL, 'saudacao', 'bom dia gente', 'igual', true),
  (NULL, 'saudacao', 'boa tarde gente', 'igual', true),
  (NULL, 'saudacao', 'boa noite gente', 'igual', true),
  (NULL, 'saudacao', 'hey', 'igual', true),
  (NULL, 'saudacao', 'e ae', 'igual', true),
  (NULL, 'saudacao', 'fala ai', 'igual', true),
  (NULL, 'saudacao', 'oi oi', 'igual', true),
  (NULL, 'saudacao', 'ola ola', 'igual', true),
  (NULL, 'saudacao', 'ola como vai', 'igual', true),
  (NULL, 'saudacao', 'oi como vai', 'igual', true),
  (NULL, 'saudacao', 'bom dia tudo bem', 'igual', true),
  (NULL, 'saudacao', 'boa tarde tudo bem', 'igual', true),
  (NULL, 'saudacao', 'boa noite tudo bem', 'igual', true),
  (NULL, 'saudacao', 'bom dia pessoal', 'igual', true),
  (NULL, 'saudacao', 'boa tarde pessoal', 'igual', true),
  (NULL, 'saudacao', 'boa noite pessoal', 'igual', true),
  (NULL, 'saudacao', 'oi tudo bom', 'igual', true),
  (NULL, 'saudacao', 'ola tudo bom', 'igual', true),
  (NULL, 'saudacao', 'oi td bem', 'igual', true),
  (NULL, 'saudacao', 'oi turma', 'igual', true),
  (NULL, 'saudacao', 'ola turma', 'igual', true),
  (NULL, 'saudacao', 'ola amigos', 'igual', true),
  (NULL, 'saudacao', 'oi amigos', 'igual', true),
  (NULL, 'agradecimento', 'obrigado', 'comeca', true),
  (NULL, 'agradecimento', 'obrigada', 'comeca', true),
  (NULL, 'agradecimento', 'valeu', 'comeca', true),
  (NULL, 'agradecimento', 'vlw', 'comeca', true),
  (NULL, 'agradecimento', 'muito obrigado', 'comeca', true),
  (NULL, 'agradecimento', 'muito obrigada', 'comeca', true),
  (NULL, 'agradecimento', 'brigado', 'comeca', true),
  (NULL, 'agradecimento', 'brigada', 'comeca', true),
  (NULL, 'agradecimento', 'obg', 'comeca', true),
  (NULL, 'agradecimento', 'obgd', 'comeca', true),
  (NULL, 'agradecimento', 'obrigadao', 'comeca', true),
  (NULL, 'agradecimento', 'obrigadinho', 'comeca', true),
  (NULL, 'agradecimento', 'agradeco', 'comeca', true),
  (NULL, 'agradecimento', 'agradecido', 'comeca', true),
  (NULL, 'agradecimento', 'agradecida', 'comeca', true),
  (NULL, 'agradecimento', 'grato', 'comeca', true),
  (NULL, 'agradecimento', 'grata', 'comeca', true),
  (NULL, 'agradecimento', 'gratidao', 'comeca', true),
  (NULL, 'agradecimento', 'valeu demais', 'comeca', true),
  (NULL, 'agradecimento', 'valeu mesmo', 'comeca', true),
  (NULL, 'agradecimento', 'vlw mesmo', 'comeca', true),
  (NULL, 'agradecimento', 'muito grato', 'comeca', true),
  (NULL, 'agradecimento', 'muito grata', 'comeca', true),
  (NULL, 'agradecimento', 'ate mais', 'comeca', true),
  (NULL, 'agradecimento', 'tmj', 'comeca', true),
  (NULL, 'agradecimento', 'thanks', 'comeca', true),
  (NULL, 'agradecimento', 'thank you', 'comeca', true),
  (NULL, 'agradecimento', 'obrigado pela atencao', 'comeca', true),
  (NULL, 'agradecimento', 'obrigada pela atencao', 'comeca', true),
  (NULL, 'agradecimento', 'obrigado viu', 'comeca', true),
  (NULL, 'agradecimento', 'obrigada viu', 'comeca', true),
  (NULL, 'agradecimento', 'obrigado desde ja', 'comeca', true),
  (NULL, 'agradecimento', 'obrigada desde ja', 'comeca', true),
  (NULL, 'agradecimento', 'desde ja agradeco', 'comeca', true),
  (NULL, 'agradecimento', 'obrigada pelo retorno', 'comeca', true),
  (NULL, 'agradecimento', 'obrigado pelo retorno', 'comeca', true),
  (NULL, 'agradecimento', 'obrigadissimo', 'comeca', true),
  (NULL, 'agradecimento', 'obrigadissima', 'comeca', true),
  (NULL, 'agradecimento', 'valeu pela atencao', 'comeca', true),
  (NULL, 'agradecimento', 'agradeco a atencao', 'comeca', true),
  (NULL, 'agradecimento', 'agradeco desde ja', 'comeca', true),
  (NULL, 'agradecimento', 'muito obrigado pela atencao', 'comeca', true),
  (NULL, 'agradecimento', 'muito obrigada pela atencao', 'comeca', true),
  (NULL, 'agradecimento', 'obrigado de coracao', 'comeca', true),
  (NULL, 'agradecimento', 'obrigada de coracao', 'comeca', true),
  (NULL, 'agradecimento', 'ate logo', 'comeca', true),
  (NULL, 'agradecimento', 'ate breve', 'comeca', true),
  (NULL, 'automatica', 'nao responda', 'contem', true),
  (NULL, 'automatica', 'codigo de verificacao', 'contem', true),
  (NULL, 'automatica', 'seu codigo', 'contem', true),
  (NULL, 'automatica', 'mensagem automatica', 'contem', true),
  (NULL, 'automatica', 'cupom', 'contem', true),
  (NULL, 'automatica', 'curriculo', 'contem', true),
  (NULL, 'automatica', 'este numero nao recebe', 'contem', true),
  (NULL, 'automatica', 'nao responda esta mensagem', 'contem', true),
  (NULL, 'automatica', 'nao responda a esta mensagem', 'contem', true),
  (NULL, 'automatica', 'mensagem automatica nao responda', 'contem', true),
  (NULL, 'automatica', 'responda sair para', 'contem', true),
  (NULL, 'automatica', 'digite 1 para', 'contem', true),
  (NULL, 'automatica', 'digite 2 para', 'contem', true),
  (NULL, 'automatica', 'digite 0 para', 'contem', true),
  (NULL, 'automatica', 'para sair digite', 'contem', true),
  (NULL, 'automatica', 'para cancelar responda', 'contem', true),
  (NULL, 'automatica', 'atendimento virtual', 'contem', true),
  (NULL, 'automatica', 'assistente virtual', 'contem', true),
  (NULL, 'automatica', 'este e um canal', 'contem', true),
  (NULL, 'automatica', 'este canal', 'contem', true),
  (NULL, 'automatica', 'nosso canal oficial', 'contem', true),
  (NULL, 'automatica', 'sua fatura', 'contem', true),
  (NULL, 'automatica', 'fatura vence', 'contem', true),
  (NULL, 'automatica', 'pagamento confirmado', 'contem', true),
  (NULL, 'automatica', 'protocolo de atendimento', 'contem', true),
  (NULL, 'automatica', 'aproveite', 'contem', true),
  (NULL, 'automatica', 'promocao imperdivel', 'contem', true),
  (NULL, 'automatica', 'oferta exclusiva', 'contem', true),
  (NULL, 'automatica', 'ofertas exclusivas', 'contem', true),
  (NULL, 'automatica', 'clique no link', 'contem', true),
  (NULL, 'automatica', 'acesse o link', 'contem', true),
  (NULL, 'automatica', 'acesse o site', 'contem', true),
  (NULL, 'automatica', 'seu pedido foi', 'contem', true),
  (NULL, 'automatica', 'sua senha', 'contem', true),
  (NULL, 'automatica', 'bloqueio de linha', 'contem', true),
  (NULL, 'automatica', 'recarga', 'contem', true),
  (NULL, 'automatica', 'atendimento automatico', 'contem', true),
  (NULL, 'automatica', 'resposta automatica', 'contem', true),
  (NULL, 'automatica', 'este e um atendimento automatico', 'contem', true),
  (NULL, 'automatica', 'mensagem enviada automaticamente', 'contem', true),
  (NULL, 'automatica', 'nao responder', 'contem', true),
  (NULL, 'automatica', 'informamos que', 'contem', true),
  (NULL, 'automatica', 'prezado cliente', 'contem', true),
  (NULL, 'automatica', 'prezada cliente', 'contem', true),
  (NULL, 'automatica', 'estamos entrando em contato', 'contem', true),
  (NULL, 'automatica', 'voce foi selecionado', 'contem', true),
  (NULL, 'automatica', 'voce ganhou', 'contem', true),
  (NULL, 'automatica', 'parabens voce ganhou', 'contem', true),
  (NULL, 'automatica', 'seu limite', 'contem', true),
  (NULL, 'automatica', 'seu cartao', 'contem', true),
  (NULL, 'automatica', 'sua conta foi', 'contem', true),
  (NULL, 'reclamacao', 'robo', 'contem', true),
  (NULL, 'reclamacao', 'voce e um robo', 'contem', true),
  (NULL, 'reclamacao', 'spam', 'contem', true),
  (NULL, 'reclamacao', 'absurdo', 'contem', true),
  (NULL, 'reclamacao', 'nao entendi nada', 'contem', true),
  (NULL, 'reclamacao', 'e um robo', 'contem', true),
  (NULL, 'reclamacao', 'e robo', 'contem', true),
  (NULL, 'reclamacao', 'isso e um robo', 'contem', true),
  (NULL, 'reclamacao', 'voces sao robos', 'contem', true),
  (NULL, 'reclamacao', 'parece robo', 'contem', true),
  (NULL, 'reclamacao', 'parece um robo', 'contem', true),
  (NULL, 'reclamacao', 'e uma maquina', 'contem', true),
  (NULL, 'reclamacao', 'e bot', 'contem', true),
  (NULL, 'reclamacao', 'bot', 'contem', true),
  (NULL, 'reclamacao', 'chatbot', 'contem', true),
  (NULL, 'reclamacao', 'voce e bot', 'contem', true),
  (NULL, 'reclamacao', 'so robo', 'contem', true),
  (NULL, 'reclamacao', 'nao quero falar com robo', 'contem', true),
  (NULL, 'reclamacao', 'nao quero robo', 'contem', true),
  (NULL, 'reclamacao', 'nao falo com robo', 'contem', true),
  (NULL, 'reclamacao', 'to falando com robo', 'contem', true),
  (NULL, 'reclamacao', 'estou falando com robo', 'contem', true),
  (NULL, 'reclamacao', 'falando com um robo', 'contem', true),
  (NULL, 'reclamacao', 'ninguem me responde', 'contem', true),
  (NULL, 'reclamacao', 'que ridiculo', 'contem', true),
  (NULL, 'reclamacao', 'ridiculo', 'contem', true),
  (NULL, 'reclamacao', 'que palhacada', 'contem', true),
  (NULL, 'reclamacao', 'palhacada', 'contem', true),
  (NULL, 'reclamacao', 'que saco', 'contem', true),
  (NULL, 'reclamacao', 'que chato', 'contem', true),
  (NULL, 'reclamacao', 'chato', 'contem', true),
  (NULL, 'reclamacao', 'que enrolacao', 'contem', true),
  (NULL, 'reclamacao', 'enrolacao', 'contem', true),
  (NULL, 'reclamacao', 'nao entendo nada', 'contem', true),
  (NULL, 'reclamacao', 'voce nao entende', 'contem', true),
  (NULL, 'reclamacao', 'nao me entende', 'contem', true),
  (NULL, 'reclamacao', 'nao ta entendendo', 'contem', true),
  (NULL, 'reclamacao', 'isso e spam', 'contem', true),
  (NULL, 'reclamacao', 'e golpe', 'contem', true),
  (NULL, 'reclamacao', 'golpe', 'contem', true),
  (NULL, 'reclamacao', 'isso e golpe', 'contem', true),
  (NULL, 'reclamacao', 'que mensagem e essa', 'contem', true),
  (NULL, 'reclamacao', 'que isso', 'contem', true),
  (NULL, 'reclamacao', 'esse robo', 'contem', true),
  (NULL, 'reclamacao', 'esse bot', 'contem', true),
  (NULL, 'reclamacao', 'voce e uma maquina', 'contem', true),
  (NULL, 'reclamacao', 'e maquina', 'contem', true),
  (NULL, 'reclamacao', 'falando com maquina', 'contem', true),
  (NULL, 'reclamacao', 'falando com uma maquina', 'contem', true);

-- 10. Conferência: se algo fugir, a migração inteira desfaz ---------------------------------------------------------------
DO $conferencia$
DECLARE
  v_n integer;
  v_t text;
  v_f text;
  v_c public.whatsapp_triagem_config%ROWTYPE;
  v_ok boolean;
BEGIN
  -- tabelas: RLS ligada, anon sem nada, authenticated só lê
  FOREACH v_t IN ARRAY ARRAY['public.whatsapp_triagem_config', 'public.whatsapp_triagem_passos',
                             'public.whatsapp_triagem_respostas', 'public.whatsapp_triagem_termos_proibidos'] LOOP
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
    IF NOT has_table_privilege('service_role', v_t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role perdeu acesso a %', v_t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = split_part(v_t, '.', 2);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% deveria ter 1 política (só leitura), tem %', v_t, v_n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = split_part(v_t, '.', 2) AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION '% tem política de escrita', v_t;
    END IF;
  END LOOP;

  -- funções: uma versão de cada, nada para anon nem authenticated, service_role executa
  FOREACH v_f IN ARRAY ARRAY[
    '_triagem_texto_plano', '_triagem_normalizar_frase', '_triagem_numeros_validos', '_triagem_toca_atualizado_em',
    '_triagem_config_antes_gravar', '_triagem_problemas_de_texto', '_triagem_passo_validar',
    'triagem_config_salvar', 'triagem_passo_salvar', 'triagem_resposta_salvar'
  ] LOOP
    SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_f;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% tem % versões (esperado 1): sobrecarga quebra o PostgREST', v_f, v_n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'anon ou authenticated executa %', v_f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                      AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'service_role perdeu o EXECUTE de %', v_f;
    END IF;
  END LOOP;
  -- as de escrita são definer com search_path; os gatilhos e as puras não
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('triagem_config_salvar', 'triagem_passo_salvar', 'triagem_resposta_salvar')
     AND prosecdef AND proconfig::text LIKE '%search_path=public%';
  IF v_n <> 3 THEN RAISE EXCEPTION 'as três funções de salvar precisam de SECURITY DEFINER e search_path'; END IF;

  -- configuração: uma linha, nasce desligada, nada de teste, data de vale vazia
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_config;
  IF v_n <> 1 THEN RAISE EXCEPTION 'config tem % linhas (esperado 1)', v_n; END IF;
  SELECT * INTO v_c FROM public.whatsapp_triagem_config;
  IF v_c.estado <> 'desligada' OR v_c.percentual <> 0 OR cardinality(v_c.numeros_teste) <> 0
     OR v_c.vale_a_partir_de IS NOT NULL OR v_c.agente_apos_triagem OR v_c.max_mensagens <> 8 THEN
    RAISE EXCEPTION 'a configuração não nasceu desligada e vazia';
  END IF;

  -- sementes: contagem exata e nada fora das regras do dono
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_passos;
  IF v_n <> 32 THEN RAISE EXCEPTION 'passos: % de 32', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_passos WHERE ramo = 'cliente';
  IF v_n <> 22 THEN RAISE EXCEPTION 'passos do cliente: % de 22', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_respostas;
  IF v_n <> 770 THEN RAISE EXCEPTION 'respostas: % de 770', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_termos_proibidos;
  IF v_n <> 24 THEN RAISE EXCEPTION 'termos proibidos: % de 24', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_triagem_passos WHERE texto ~* 'revend' OR repeticao ~* 'revend'
                OR array_to_string(variantes, ' ') ~* 'revend')
     OR EXISTS (SELECT 1 FROM public.whatsapp_triagem_respostas WHERE frase ~* 'revend') THEN
    RAISE EXCEPTION 'o radical revend apareceu nas sementes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_triagem_passos
              WHERE texto ~ '[—–]' OR coalesce(repeticao, '') ~ '[—–]' OR array_to_string(variantes, ' ') ~ '[—–]') THEN
    RAISE EXCEPTION 'travessão em texto semeado';
  END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_passos p
   WHERE cardinality(public._triagem_problemas_de_texto(p.texto, p.ramo, true)) > 0
      OR cardinality(public._triagem_problemas_de_texto(coalesce(p.repeticao, 'ok'), p.ramo, true)) > 0;
  IF v_n <> 0 THEN RAISE EXCEPTION '% texto(s) semeado(s) reprovam na própria validação', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_passos
   WHERE ramo = 'cliente' AND (texto || ' ' || coalesce(repeticao, '') || ' ' || array_to_string(variantes, ' ')) ~* 'parceir|parceri|terceiriz|revend|tabela|diferenciad|link_parceiro';
  IF v_n <> 0 THEN RAISE EXCEPTION '% texto(s) do cliente final falam de parceiro, revenda ou tabela', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_triagem_respostas WHERE frase <> public._triagem_normalizar_frase(frase)
              AND frase NOT LIKE 'emoji%' AND frase NOT LIKE '% emoji%') THEN
    RAISE EXCEPTION 'frase do quadro que não sobrevive à normalização';
  END IF;

  -- o verificador de texto pega o que deve pegar (e deixa passar o que deve)
  IF cardinality(public._triagem_problemas_de_texto('O valor é R$ 50', 'cliente', false)) = 0 THEN
    RAISE EXCEPTION 'verificador deixou passar R$';
  END IF;
  IF cardinality(public._triagem_problemas_de_texto('Fale com um parceiro', 'cliente', false)) = 0 THEN
    RAISE EXCEPTION 'verificador deixou passar parceiro no ramo cliente';
  END IF;
  IF cardinality(public._triagem_problemas_de_texto('Fale com um parceiro', 'parceiro', false)) <> 0 THEN
    RAISE EXCEPTION 'verificador barrou parceiro no ramo parceiro';
  END IF;
  IF cardinality(public._triagem_problemas_de_texto('Aqui está {{link_parceiro}}', 'cliente', true)) = 0 THEN
    RAISE EXCEPTION 'link_parceiro passou no ramo cliente';
  END IF;
  IF cardinality(public._triagem_problemas_de_texto('Pronto em 3 dias', 'parceiro', false)) = 0 THEN
    RAISE EXCEPTION 'prazo em número passou';
  END IF;
  IF cardinality(public._triagem_problemas_de_texto('Oi {{primeiro_nome}}, tudo bem?', 'cliente', true)) <> 0 THEN
    RAISE EXCEPTION 'texto limpo foi barrado';
  END IF;

  -- o gatilho recusa de verdade: tenta gravar texto proibido e espera o erro
  v_ok := false;
  BEGIN
    UPDATE public.whatsapp_triagem_passos SET texto = 'Temos preço de parceiro por R$ 10' WHERE codigo = 'nome' AND ramo = 'cliente';
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'o gatilho aceitou texto proibido no ramo cliente'; END IF;
  v_ok := false;
  BEGIN
    UPDATE public.whatsapp_triagem_passos SET texto = 'Olá {{link_parceiro}}' WHERE codigo = 'nome' AND ramo = 'cliente';
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'o gatilho aceitou link_parceiro no ramo cliente'; END IF;

  -- travessões e setas de Unicode que o dono não quer (além do em dash e do en dash): U+2015, U+2012, U+2212, U+2E3A, U+279C
  IF cardinality(public._triagem_problemas_de_texto('Oi ' || chr(8213) || ' tudo bem?', 'parceiro', false)) = 0
     OR cardinality(public._triagem_problemas_de_texto('Oi ' || chr(8210) || ' tudo bem?', 'parceiro', false)) = 0
     OR cardinality(public._triagem_problemas_de_texto('Oi ' || chr(8722) || ' tudo bem?', 'parceiro', false)) = 0
     OR cardinality(public._triagem_problemas_de_texto('Oi ' || chr(11834) || ' tudo bem?', 'parceiro', false)) = 0
     OR cardinality(public._triagem_problemas_de_texto('Vá ' || chr(10140) || ' aqui', 'parceiro', false)) = 0
     OR cardinality(public._triagem_problemas_de_texto('Vá ' || chr(8594) || ' aqui', 'parceiro', false)) = 0
     OR cardinality(public._triagem_problemas_de_texto('Vá ' || chr(11013) || ' aqui', 'parceiro', false)) = 0 THEN
    RAISE EXCEPTION 'travessão ou seta de Unicode passou no verificador';
  END IF;
  IF cardinality(public._triagem_problemas_de_texto('Ana-Clara, tudo bem?', 'parceiro', false)) <> 0 THEN
    RAISE EXCEPTION 'o hífen comum foi barrado como travessão';
  END IF;

  -- a escada vale também no gatilho: pular degrau com UPDATE direto é recusado
  v_ok := false;
  BEGIN
    UPDATE public.whatsapp_triagem_config SET estado = 'ligada' WHERE estado = 'desligada';
  EXCEPTION WHEN raise_exception THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'o gatilho da configuração deixou pular degrau da escada'; END IF;

  -- a linha de configuração não se apaga
  v_ok := false;
  BEGIN
    DELETE FROM public.whatsapp_triagem_config;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'a linha de configuração pôde ser apagada'; END IF;
END
$conferencia$;

COMMIT;
