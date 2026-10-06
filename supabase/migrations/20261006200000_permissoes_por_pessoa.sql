-- ============================================================================
-- Permissões por pessoa: dar ou tirar UMA permissão de UMA pessoa
-- ============================================================================
--
-- POR QUÊ (decisões do dono em 06/10/2026)
--   1. Só o administrador muda permissões pelas telas. Dar esse poder a mais
--      alguém é dar o controle do sistema.
--   2. Além do papel, uma pessoa pode GANHAR ou PERDER uma permissão só dela,
--      com data de vencimento opcional e motivo. Fica o rastro: quem fez,
--      quando e por quê.
--   3. As chaves que hoje não fazem nada aparecem no painel como tal ("ainda
--      não faz nada"), para o dono decidir depois quais ligar.
--
-- COMO VALE
--   has_permission(pessoa, chave) continua com a MESMA assinatura, STABLE,
--   SECURITY DEFINER e search_path fixo — as 159 policies e as funções que a
--   chamam não mudam. Só o corpo muda:
--
--     efetiva = (chaves dos papéis ∪ dadas ativas) − tiradas ativas
--     ativa   = sem vencimento, ou vencimento no futuro
--
--   Como há no máximo UMA exceção por pessoa + chave (chave primária), a conta
--   é: existe exceção ativa? vale o que ela diz; senão, vale o papel. Pessoa
--   desativada continua sem nada, como antes. Exceção NÃO vale para quem tem o
--   papel admin (o administrador tem tudo, sempre — e uma "tirada" esquecida
--   numa pessoa promovida a admin não pode trancá-lo para fora).
--
--   can_see_financials, can_see_prices e require_permission chamam
--   has_permission e herdam a exceção sem mudança. has_role (73 policies) e
--   is_staff (65) olham só o papel: ali a exceção NÃO vale, e o painel diz isso.
--
--   O corpo novo lê perfil_permissoes direto (pp.perfil = ur.role::text), em
--   vez da view role_permission_matrix. É a mesma conta — a view só filtrava
--   valores de perfil fora do enum, e ur.role::text nunca é um deles — mas usa
--   o índice da chave primária (perfil, permissao) em vez de varrer a matriz e
--   consultar pg_enum a cada chamada. Equivalência provada no ensaio abaixo.
--
-- ONDE MORA
--   permissoes_excecoes            a exceção que vale hoje: uma linha por
--                                  pessoa + chave, sem histórico, pequena — é
--                                  a tabela que has_permission consulta a cada
--                                  linha de 159 policies, então só guarda o que
--                                  está valendo (ou vencido, até ser desfeito).
--   permissoes_excecoes_historico  o rastro, só acrescenta. Gravado por GATILHO,
--                                  nunca pelo navegador: vale também para quem
--                                  mexer direto no banco (fica sem autor, e o
--                                  painel mostra "direto no banco"). Guarda o
--                                  nome da pessoa e do autor na hora, para o
--                                  rastro sobreviver a uma exclusão.
--   Por que duas tabelas e não "linhas com data de revogação": manter as
--   revogadas na tabela quente faria has_permission filtrar o passado a cada
--   linha de cada consulta, e a unicidade pessoa + chave viraria índice
--   parcial. O histórico não precisa de chave estrangeira (sobrevive à pessoa).
--
-- QUEM LÊ E QUEM GRAVA
--   Ninguém lê nem grava as duas tabelas direto: RLS ligada, nenhuma policy e
--   REVOKE ALL de PUBLIC, anon e authenticated (o projeto dá GRANT total a anon
--   e authenticated por padrão, e REVOKE de PUBLIC sozinho não fecha os dois).
--   Tudo passa por funções SECURITY DEFINER:
--     minhas_permissoes()            qualquer pessoa logada: as chaves que valem
--                                    para ELA (o menu e os botões leem daqui)
--     permissoes_da_pessoa(id)       só admin: chaves, origem e histórico
--     definir_excecao_permissao(...) só admin: dar ou tirar, com motivo
--     remover_excecao_permissao(...) só admin: desfazer
--     permissoes_uso_no_banco()      só admin: quantas policies, funções e
--                                    views citam cada chave (o "ainda não faz
--                                    nada" do painel, calculado ao vivo)
--   "Só admin" = papel admin e conta ativa (has_role sozinho não olha
--   usuarios.ativo, e um token vale até uma hora depois de desativar).
--   Funções novas nascem com EXECUTE para PUBLIC: cada uma tem REVOKE explícito
--   e GRANT só para authenticated (service_role mantém o padrão do projeto).
--
-- A MATRIZ POR PAPEL TAMBÉM FICA SÓ COM O ADMIN
--   As 3 policies de escrita de perfil_permissoes aceitavam "papel admin OU
--   permissoes.manage". Hoje só o admin tem permissoes.manage, então nada muda
--   para ninguém — mas uma concessão (pela matriz ou por exceção) entregaria a
--   matriz a outra pessoa. Passam a exigir o papel admin. A chave
--   permissoes.manage deixa de dar esse poder e a descrição dela diz isso.
--
-- SEGURO COM O FRONT ANTIGO
--   O front publicado hoje lê role_permission_matrix (intocada) e grava a matriz
--   como admin (continua aceito). Com permissoes_excecoes vazia, has_permission
--   devolve exatamente o mesmo para toda pessoa × toda chave (ensaio). As
--   funções novas só são chamadas pelo front novo — que, se publicado antes
--   desta migração, cai na leitura antiga da matriz sem quebrar nada.
--
-- ENSAIO (06/10/2026, bloco DO que termina em RAISE EXCEPTION, tudo desfeito
-- e conferido depois: nenhuma tabela, função, papel ou log sobrou)
--   1. Equivalência, tabela de exceções VAZIA, has_permission de hoje × o corpo
--      novo criado com outro nome: 19 pessoas (as 5 reais, 12 sintéticas — uma
--      por papel do enum, uma com todos, uma sem papel —, um id que não é de
--      ninguém e o nulo) × 119 chaves (as 117 + uma inexistente + a nula) =
--      2.261 respostas, 0 diferenças (708 verdadeiras nas duas, hash igual).
--      Com Sergio e a sintética de todos os papéis desativados: 2.261, 0
--      diferenças (573/573). Por pessoa: Harison 115, Yvens 96, Leonardo 37,
--      Sergio 18, Cibele 17 — iguais antes e depois.
--   2. Exceções em pessoas reais e tabelas reais, cada papel simulado
--      (claims + SET LOCAL ROLE): ver ENSAIO 2 logo abaixo.
--   3. Desempenho, como o vendedor (Leonardo), EXPLAIN ANALYZE, mediana de 9
--      (ms) — antiga → nova com a tabela vazia → nova com 64 exceções →
--      antiga de novo (o ruído):
--        lista de orçamentos (orcamentos_comercial)  0,924 → 0,632 → 0,638 (0,818)
--        lista de OS (ordens_servico_comercial)       0,902 → 0,590 → 0,598 (0,771)
--        orcamentos direto (RLS por linha)            1,764 → 1,770 → 1,720 (1,697)
--        catálogo, 933 itens                          0,674 → 0,471 → 0,458 (0,672)
--        4.680 chamadas diretas a has_permission      7,284 → 4,702 → 5,202 (7,224)
--      A busca da exceção custa ~1,5 µs por chamada mesmo com a tabela vazia;
--      escrever a regra de desativado por extenso (ver has_permission) devolve
--      mais que isso. Resultado: igual ou mais rápido em tudo.
-- ENSAIO 2 — este arquivo inteiro, executado dentro do ensaio (md5 do texto
-- ensaiado = md5 do arquivo; depois disso só este comentário mudou), com
-- dar / tirar / vencida / vencimento futuro em pessoas e tabelas reais:
--   - sem exceção, depois da migração: 5 pessoas × 117 chaves = 585 respostas,
--     0 diferenças do retrato de antes;
--   - EXECUTE: anon não chama nenhuma das 6 funções; authenticated chama as 6;
--     o gatilho, ninguém. As duas tabelas: nenhum privilégio para anon nem
--     authenticated (nem SELECT). Visitante (anon): as 7 tentativas negadas;
--   - ADMIN (Harison): vê 115 chaves suas; uso no banco = 31 chaves sem nada;
--     painel do Sergio = 117 chaves, 18 valendo, 2 "só do portal de fora";
--     recusas certas: exceção em si mesmo, portal.read para a equipe, sem
--     motivo, data passada, chave inexistente, e gravar direto na tabela;
--   - OPERADOR (Sergio) ganhou clientes.read: 0 → 10 clientes; dada já
--     VENCIDA de estoque.read: 0 movimentações (não vale); cadastrar cliente
--     continua negado (regra por PAPEL — a exceção não abre);
--   - VENDEDOR (Leonardo) perdeu clientes.read: 10 → 0 clientes, os 25
--     orçamentos iguais; ganhou estoque.read por 2 dias: 0 → 4 movimentações;
--     não vê o próprio painel nem desfaz a própria exceção;
--   - GESTOR (Yvens) sem financeiro.read até amanhã: 72 → 0 contas a pagar,
--     can_see_financials = falso; recebeu permissoes.manage e mesmo assim NÃO
--     grava a matriz nem dá exceção; desfeita a tirada, volta a ler as 72;
--   - FINANCEIRO (Cibele) sem pagamentos.update e .confirm: corrige 1 → 0
--     conta; a tirada VENCIDA de financeiro.read não vale (continua com 72);
--   - "tirada" gravada num admin não vale; pessoa desativada não tem nada,
--     nem a dada; admin desativado não muda exceção;
--   - histórico: as 11 mudanças com autor e motivo; as 3 gravadas direto no
--     banco ficam sem autor ("direto no banco").
--
-- COMO APLICAR (nesta ordem)
--   1. Antes, guardar a contagem por pessoa (para comparar no passo 3):
--        select u.nome, count(*) filter (where public.has_permission(u.id, p.chave))
--          from public.usuarios u cross join public.permissoes p group by 1 order by 1;
--      (em 06/10: Cibele 17, Harison 115, Leonardo 37, Sergio 18, Yvens 96)
--   2. Este arquivo, de uma vez. Seguro com o front publicado hoje.
--   3. Conferir: a mesma contagem do passo 1, igual; a tabela vazia
--        select count(*) from public.permissoes_excecoes;          -- 0
--      e ninguém de fora chamando as funções novas
--        select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE')
--          from pg_proc p where p.proname in ('minhas_permissoes','permissoes_da_pessoa',
--            'definir_excecao_permissao','remover_excecao_permissao','permissoes_uso_no_banco');
--   4. Só então publicar o front. Se ele for antes, nada quebra: o menu cai na
--      leitura antiga da matriz e o painel Permissões avisa que falta esta
--      migração.
-- ============================================================================


-- 1. As duas tabelas ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permissoes_excecoes (
  usuario_id uuid        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  permissao  text        NOT NULL REFERENCES public.permissoes(chave) ON DELETE CASCADE,
  concede    boolean     NOT NULL,
  expira_em  timestamptz,
  motivo     text        NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 500),
  criado_por uuid        REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissoes_excecoes_pkey PRIMARY KEY (usuario_id, permissao)
);

-- Índices das chaves estrangeiras (o projeto não deixa FK sem índice). A busca
-- de has_permission usa a chave primária (usuario_id, permissao).
CREATE INDEX IF NOT EXISTS permissoes_excecoes_permissao_idx
  ON public.permissoes_excecoes (permissao);
CREATE INDEX IF NOT EXISTS permissoes_excecoes_criado_por_idx
  ON public.permissoes_excecoes (criado_por);

COMMENT ON TABLE public.permissoes_excecoes IS
  'Exceção de permissão por pessoa: concede=true dá a chave só para ela, false tira só dela. Vale enquanto expira_em for nulo ou futuro. Lida por has_permission; gravada só por definir_excecao_permissao/remover_excecao_permissao (admin).';

CREATE TABLE IF NOT EXISTS public.permissoes_excecoes_historico (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quando       timestamptz NOT NULL DEFAULT now(),
  acao         text        NOT NULL CHECK (acao IN ('dar', 'tirar', 'desfazer')),
  usuario_id   uuid        NOT NULL,
  usuario_nome text,
  permissao    text        NOT NULL,
  concede      boolean,
  expira_em    timestamptz,
  motivo       text,
  autor_id     uuid,
  autor_nome   text,
  antes        jsonb
);

CREATE INDEX IF NOT EXISTS permissoes_excecoes_historico_usuario_idx
  ON public.permissoes_excecoes_historico (usuario_id, quando DESC);

COMMENT ON TABLE public.permissoes_excecoes_historico IS
  'Rastro das exceções de permissão por pessoa. Só o gatilho grava; sem chave estrangeira para sobreviver à exclusão da pessoa. autor_id nulo = mudança feita direto no banco.';


-- 2. Ninguém lê nem grava direto ---------------------------------------------

ALTER TABLE public.permissoes_excecoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissoes_excecoes_historico ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.permissoes_excecoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.permissoes_excecoes_historico FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.permissoes_excecoes_historico_id_seq FROM PUBLIC, anon, authenticated;
-- Nenhum GRANT de volta e nenhuma policy: as telas leem e gravam pelas funções
-- abaixo, que rodam como dona das tabelas.


-- 3. O rastro, por gatilho ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_permissoes_excecoes_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_autor  uuid := auth.uid();
  v_linha  public.permissoes_excecoes;
  v_acao   text;
  v_motivo text;
begin
  if TG_OP = 'DELETE' then
    v_linha  := OLD;
    v_acao   := 'desfazer';
    -- O motivo de desfazer vem de remover_excecao_permissao, pela sessão.
    v_motivo := nullif(btrim(coalesce(current_setting('bex.motivo_permissao', true), '')), '');
  else
    v_linha  := NEW;
    v_acao   := case when NEW.concede then 'dar' else 'tirar' end;
    v_motivo := NEW.motivo;
  end if;

  insert into public.permissoes_excecoes_historico
    (acao, usuario_id, usuario_nome, permissao, concede, expira_em, motivo,
     autor_id, autor_nome, antes)
  values (
    v_acao,
    v_linha.usuario_id,
    (select u.nome from public.usuarios u where u.id = v_linha.usuario_id),
    v_linha.permissao,
    case when TG_OP = 'DELETE' then null else v_linha.concede end,
    case when TG_OP = 'DELETE' then null else v_linha.expira_em end,
    v_motivo,
    v_autor,
    (select u.nome from public.usuarios u where u.id = v_autor),
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  );
  return null;
end;
$function$;

DROP TRIGGER IF EXISTS tg_permissoes_excecoes_historico ON public.permissoes_excecoes;
CREATE TRIGGER tg_permissoes_excecoes_historico
  AFTER INSERT OR UPDATE OR DELETE ON public.permissoes_excecoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_permissoes_excecoes_historico();

-- Gatilho não precisa de EXECUTE de ninguém (roda pela dona da tabela).
REVOKE ALL ON FUNCTION public.tg_permissoes_excecoes_historico() FROM PUBLIC, anon, authenticated, service_role;


-- 4. has_permission: papel + exceção -----------------------------------------

-- A regra de "pessoa desativada" está escrita aqui por extenso em vez de
-- chamar usuario_desativado(): é a mesma frase, mas cada chamada a uma função
-- SECURITY DEFINER com search_path fixo troca o search_path e custa ~1,7 µs, e
-- has_permission roda por linha em 159 policies. Medido no ensaio: 4.680
-- chamadas levavam 7,9 ms com a função de hoje, 12,8 ms com a exceção e a
-- chamada aninhada, e 4,9 ms assim. Se usuario_desativado mudar, mude aqui
-- também — tests/permissoes-por-pessoa-migracao.test.ts confere as duas.
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not exists (select 1
                       from public.usuarios u
                      where u.id = _user_id
                        and u.ativo is false)
     and coalesce(
           -- 1. a exceção ativa desta pessoa para esta chave (no máximo uma,
           --    pela chave primária). Não vale para quem tem o papel admin.
           (select e.concede
              from public.permissoes_excecoes e
             where e.usuario_id = _user_id
               and e.permissao = _permission
               and (e.expira_em is null or e.expira_em > now())
               and not exists (select 1
                                 from public.user_roles a
                                where a.user_id = _user_id
                                  and a.role = 'admin'::public.app_role)),
           -- 2. sem exceção ativa: o que os papéis da pessoa dão, como sempre.
           exists (select 1
                     from public.user_roles ur
                     join public.perfil_permissoes pp
                       on pp.perfil = ur.role::text
                      and pp.permissao = _permission
                    where ur.user_id = _user_id))
$function$;

-- CREATE OR REPLACE preserva o EXECUTE de hoje; reafirmado para não depender
-- disso: authenticated e service_role chamam, anon e PUBLIC não.
REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;


-- 5. As chaves que valem para quem está logado -------------------------------

CREATE OR REPLACE FUNCTION public.minhas_permissoes()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(p.chave order by p.chave), '{}'::text[])
    from public.permissoes p
   where public.has_permission((select auth.uid()), p.chave)
$function$;

COMMENT ON FUNCTION public.minhas_permissoes() IS
  'Chaves que valem para quem chama (papéis + exceções ativas, pessoa ativa). Um array só: não passa pelo corte de 1.000 linhas do PostgREST.';

REVOKE ALL ON FUNCTION public.minhas_permissoes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minhas_permissoes() TO authenticated;


-- 6. O painel de uma pessoa (só admin) ---------------------------------------

CREATE OR REPLACE FUNCTION public.permissoes_da_pessoa(p_usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_pessoa jsonb;
begin
  if v_uid is null
     or not public.has_role(v_uid, 'admin'::public.app_role)
     or public.usuario_desativado(v_uid) then
    raise exception 'Só o administrador vê e muda as permissões de cada pessoa.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', u.id,
           'nome', u.nome,
           'ativo', u.ativo,
           'papeis', coalesce((select jsonb_agg(r.role::text order by r.role::text)
                                 from public.user_roles r
                                where r.user_id = u.id), '[]'::jsonb))
    into v_pessoa
    from public.usuarios u
   where u.id = p_usuario_id;

  if v_pessoa is null then
    raise exception 'Pessoa não encontrada.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'pessoa', v_pessoa,
    'agora', now(),
    'chaves', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'chave', p.chave,
               'dominio', p.dominio,
               'descricao', p.descricao,
               'efetiva', public.has_permission(p_usuario_id, p.chave),
               -- Chave que só o portal de fora tem (a mesma regra que
               -- definir_excecao_permissao usa para recusar "dar").
               'so_de_fora', (
                  exists (select 1 from public.perfil_permissoes f
                           where f.permissao = p.chave
                             and f.perfil in ('cliente', 'parceiro'))
                  and not exists (select 1 from public.perfil_permissoes f
                                   where f.permissao = p.chave
                                     and f.perfil not in ('cliente', 'parceiro'))),
               'papeis', coalesce((
                  select jsonb_agg(ur.role::text order by ur.role::text)
                    from public.user_roles ur
                    join public.perfil_permissoes pp
                      on pp.perfil = ur.role::text
                     and pp.permissao = p.chave
                   where ur.user_id = p_usuario_id), '[]'::jsonb),
               'excecao', (
                  select jsonb_build_object(
                           'concede', e.concede,
                           'expira_em', e.expira_em,
                           'ativa', (e.expira_em is null or e.expira_em > now()),
                           'motivo', e.motivo,
                           'criado_em', e.created_at,
                           'criado_por_nome', (select a.nome from public.usuarios a
                                                where a.id = e.criado_por))
                    from public.permissoes_excecoes e
                   where e.usuario_id = p_usuario_id
                     and e.permissao = p.chave))
             order by p.dominio, p.chave), '[]'::jsonb)
        from public.permissoes p),
    'historico', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'quando', h.quando,
               'acao', h.acao,
               'permissao', h.permissao,
               'concede', h.concede,
               'expira_em', h.expira_em,
               'motivo', h.motivo,
               'autor_nome', h.autor_nome,
               'direto_no_banco', h.autor_id is null)
             order by h.quando desc, h.id desc), '[]'::jsonb)
        from (select *
                from public.permissoes_excecoes_historico x
               where x.usuario_id = p_usuario_id
               order by x.quando desc, x.id desc
               limit 50) h)
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.permissoes_da_pessoa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.permissoes_da_pessoa(uuid) TO authenticated;


-- 7. Dar ou tirar (só admin) ------------------------------------------------

CREATE OR REPLACE FUNCTION public.definir_excecao_permissao(
  p_usuario_id uuid,
  p_permissao  text,
  p_concede    boolean,
  p_expira_em  timestamptz,
  p_motivo     text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_uid is null
     or not public.has_role(v_uid, 'admin'::public.app_role)
     or public.usuario_desativado(v_uid) then
    raise exception 'Só o administrador muda permissões.' using errcode = '42501';
  end if;

  if p_usuario_id is null
     or not exists (select 1 from public.usuarios u where u.id = p_usuario_id) then
    raise exception 'Pessoa não encontrada.' using errcode = 'P0002';
  end if;

  -- Isto também impede o admin de mexer em si mesmo: quem chama é admin.
  if public.has_role(p_usuario_id, 'admin'::public.app_role) then
    raise exception 'O administrador tem todas as permissões, sempre: exceção não vale para ele.'
      using errcode = '22023';
  end if;

  if not exists (select 1
                   from public.user_roles r
                  where r.user_id = p_usuario_id
                    and r.role not in ('cliente'::public.app_role, 'parceiro'::public.app_role)) then
    raise exception 'Exceção é só para quem é da equipe. Dê um papel a esta pessoa antes.'
      using errcode = '22023';
  end if;

  if p_permissao is null
     or not exists (select 1 from public.permissoes p where p.chave = p_permissao) then
    raise exception 'Permissão desconhecida: %', coalesce(p_permissao, '(vazia)')
      using errcode = '22023';
  end if;

  if p_concede is null then
    raise exception 'Diga se é para dar ou para tirar.' using errcode = '22023';
  end if;

  -- Chave que só o portal de fora tem (cliente ou parceiro) não vai para a
  -- equipe: mudaria a tela dela para a de cliente sem abrir nada de útil.
  if p_concede
     and exists (select 1 from public.perfil_permissoes pp
                  where pp.permissao = p_permissao
                    and pp.perfil in ('cliente', 'parceiro'))
     and not exists (select 1 from public.perfil_permissoes pp
                      where pp.permissao = p_permissao
                        and pp.perfil not in ('cliente', 'parceiro')) then
    raise exception 'Esta permissão é do portal de cliente ou de parceiro, não da equipe.'
      using errcode = '22023';
  end if;

  if length(v_motivo) < 3 then
    raise exception 'Escreva o motivo (pelo menos 3 letras): é ele que explica a exceção daqui a seis meses.'
      using errcode = '22023';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'O motivo passou de 500 letras.' using errcode = '22023';
  end if;

  if p_expira_em is not null and p_expira_em <= now() then
    raise exception 'A data de vencimento já passou.' using errcode = '22023';
  end if;

  insert into public.permissoes_excecoes
    (usuario_id, permissao, concede, expira_em, motivo, criado_por, created_at)
  values
    (p_usuario_id, p_permissao, p_concede, p_expira_em, v_motivo, v_uid, now())
  on conflict (usuario_id, permissao) do update
    set concede    = excluded.concede,
        expira_em  = excluded.expira_em,
        motivo     = excluded.motivo,
        criado_por = excluded.criado_por,
        created_at = excluded.created_at;

  return jsonb_build_object('efetiva', public.has_permission(p_usuario_id, p_permissao));
end;
$function$;

REVOKE ALL ON FUNCTION public.definir_excecao_permissao(uuid, text, boolean, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.definir_excecao_permissao(uuid, text, boolean, timestamptz, text) TO authenticated;


-- 8. Desfazer (só admin) ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remover_excecao_permissao(
  p_usuario_id uuid,
  p_permissao  text,
  p_motivo     text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or not public.has_role(v_uid, 'admin'::public.app_role)
     or public.usuario_desativado(v_uid) then
    raise exception 'Só o administrador muda permissões.' using errcode = '42501';
  end if;

  -- O gatilho do histórico lê o motivo daqui (só dentro desta transação).
  perform set_config('bex.motivo_permissao', btrim(coalesce(p_motivo, '')), true);

  delete from public.permissoes_excecoes e
   where e.usuario_id = p_usuario_id
     and e.permissao = p_permissao;

  if not found then
    raise exception 'Não há exceção desta permissão para esta pessoa.' using errcode = 'P0002';
  end if;

  perform set_config('bex.motivo_permissao', '', true);

  return jsonb_build_object('efetiva', public.has_permission(p_usuario_id, p_permissao));
end;
$function$;

REVOKE ALL ON FUNCTION public.remover_excecao_permissao(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remover_excecao_permissao(uuid, text, text) TO authenticated;


-- 9. O que cada chave faz no banco (só admin), calculado ao vivo -------------
--
-- Conta as policies (todos os esquemas, storage inclusive), as funções e as
-- views do esquema public que citam a chave entre aspas simples. Nenhuma das
-- funções desta migração cita chave nenhuma, para não se contar.
-- A parte da tela (guarda de rota e hasPermission no código) o painel soma do
-- lado do front, conferida por teste.

CREATE OR REPLACE FUNCTION public.permissoes_uso_no_banco()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null
     or not public.has_role(v_uid, 'admin'::public.app_role)
     or public.usuario_desativado(v_uid) then
    raise exception 'Só o administrador vê o uso das permissões.' using errcode = '42501';
  end if;

  with regras as materialized (
         select coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') as texto
           from pg_catalog.pg_policies pol),
       funcoes as materialized (
         select pr.prosrc as texto
           from pg_catalog.pg_proc pr
          where pr.pronamespace = 'public'::regnamespace
            and pr.prokind in ('f', 'p')),
       visoes as materialized (
         select pg_catalog.pg_get_viewdef(c.oid) as texto
           from pg_catalog.pg_class c
          where c.relnamespace = 'public'::regnamespace
            and c.relkind in ('v', 'm'))
  select coalesce(jsonb_object_agg(k.chave, jsonb_build_object(
           'politicas', (select count(*) from regras r
                          where strpos(r.texto, '''' || k.chave || '''') > 0),
           'funcoes',   (select count(*) from funcoes f
                          where strpos(f.texto, '''' || k.chave || '''') > 0),
           'visoes',    (select count(*) from visoes v
                          where strpos(v.texto, '''' || k.chave || '''') > 0))), '{}'::jsonb)
    into v_res
    from public.permissoes k;

  return v_res;
end;
$function$;

REVOKE ALL ON FUNCTION public.permissoes_uso_no_banco() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.permissoes_uso_no_banco() TO authenticated;


-- 10. A matriz por papel: só o admin grava -----------------------------------

ALTER POLICY "perfil_permissoes admin insert" ON public.perfil_permissoes
  WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

ALTER POLICY "perfil_permissoes admin update" ON public.perfil_permissoes
  USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

ALTER POLICY "perfil_permissoes admin delete" ON public.perfil_permissoes
  USING (public.has_role((select auth.uid()), 'admin'::public.app_role));

UPDATE public.permissoes
   SET descricao = 'Gerenciar permissões. Desde 06/10/2026 só o papel administrador muda permissões: esta chave sozinha não dá esse poder.'
 WHERE chave = 'permissoes.manage';
