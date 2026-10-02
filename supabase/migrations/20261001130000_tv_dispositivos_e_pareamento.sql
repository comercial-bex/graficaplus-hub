-- ============================================================================
-- O crachá da TV: dispositivos, pareamento por código e as portas do servidor
-- ============================================================================
--
-- A TV da Oficina fica na parede, sem teclado e sem login. Ela precisa ler o
-- painel das máquinas sem que o painel vire uma porta aberta: a TV2 da agência
-- resolveu isso com um PIN que vai no pacote do navegador e é comparado lá
-- mesmo — na prática, acesso público. Aqui é o contrário.
--
-- COMO A TV ENTRA (decisão do dono: QR/código aprovado por admin ou gestor
-- logado, sem PIN)
--   1. A TV pede um pareamento ao servidor (POST /api/tv/parear, acao "novo").
--      Ganha um CÓDIGO curto, que ela mostra em letra grande e num QR, e um
--      SEGREDO DE RETIRADA, que só ela conhece e nunca aparece na tela.
--   2. Quem está logado como admin ou gestor abre /telas, digita o código (ou
--      lê o QR), dá um nome à TV e aprova: `tv_aprovar_pareamento`.
--   3. A TV, que estava perguntando "já aprovaram?", apresenta o segredo de
--      retirada. O servidor deriva dele o TOKEN do aparelho (HMAC-SHA256, 32
--      bytes), entrega e grava só o SHA-256 dele em `tv_dispositivos`. Por ser
--      derivado, a mesma TV com o mesmo pedido recebe sempre o mesmo token: se
--      a resposta se perder no Wi-Fi, a pergunta seguinte devolve de novo
--      (`repetido: true`) em vez de deixar um dispositivo órfão.
--   4. Dali em diante a TV manda o token no cabeçalho `x-tv-token` e o
--      servidor confere o hash a cada leitura (`tv_conferir_dispositivo`).
--
-- É o crachá de visitante: a recepção (admin/gestor) entrega o crachá para
-- quem está na frente dela, o crachá tem nome, e dá para cancelar um sem
-- trocar a fechadura dos outros.
--
-- O QUE O BANCO NUNCA GUARDA
--   o token do aparelho e o segredo de retirada em claro. Só o hash dos dois,
--   com CHECK de formato (64 hex) — gravar o valor em claro por engano não
--   passa. Quem lê o banco não consegue montar o acesso de nenhuma TV.
--
-- QUEM ENTRA NAS TABELAS
--   RLS ligada e NENHUMA policy nas três, e os GRANTs de anon e authenticated
--   revogados (tabela nova nasce com ALL para os dois, por privilégio padrão).
--   Entram só o service_role (o servidor) e as funções definer abaixo.
--   `sandbox_exec` (papel da plataforma, com BYPASSRLS) mantém o INSERT/SELECT
--   que recebe por privilégio padrão em toda tabela do projeto — não foi
--   mexido aqui.
--
-- DOIS TIPOS DE FUNÇÃO, DUAS GUARDAS
--   da tela logada   tv_aprovar_pareamento, tv_listar_dispositivos,
--                    tv_revogar_dispositivo, tv_limpar_pedidos ("Liberar a
--                    fila": apaga os pedidos que ninguém aprovou) — SECURITY
--                    DEFINER, EXECUTE só para authenticated, e no corpo: admin
--                    ou gestor (has_role) e conta não desativada. Nenhuma
--                    devolve hash nem token.
--   do servidor      tv_criar_pareamento_da_origem (a porta de entrada: conta
--                    por origem e chama tv_criar_pareamento, que conta a fila
--                    e insere), tv_retirar_pareamento,
--                    tv_conferir_dispositivo — SECURITY INVOKER, EXECUTE só
--                    para service_role, e no corpo `current_user` tem de ser
--                    service_role. Três trancas: sem o GRANT não chama, sem o
--                    papel o corpo recusa, sem o papel a RLS não mostra linha.
--                    São função (e não insert/update soltos pelo PostgREST)
--                    porque cada passo é uma transação: conferir o segredo,
--                    criar o dispositivo e queimar o pareamento acontecem
--                    juntos ou não acontecem.
--
-- FREIOS
--   código      6 caracteres de um alfabeto de 32 (sem I, O, 0 e 1, que se
--               confundem lidos de longe): ~1 bilhão de combinações, validade
--               de 10 minutos, uso único.
--   chute       código que não existe conta uma tentativa POR USUÁRIO em
--               `tv_pareamento_tentativas`; 5 em 10 minutos e a função recusa
--               até o código certo. Por isso `tv_aprovar_pareamento` DEVOLVE
--               {ok:false, motivo} em vez de levantar erro: erro desfaz a
--               transação e a tentativa não ficaria contada.
--   retirada    segredo errado conta em `tv_pareamentos.tentativas`; 5 e o
--               pareamento morre.
--   enchente    no máximo 20 pareamentos vivos, e no máximo 5 pedidos do
--               mesmo endereço (`origem_hash`, o SHA-256 do IP de quem pediu);
--               quem passa recebe 'cheio' (o servidor responde 429). Sem o teto
--               por origem, uma pessoa só pedindo 20 códigos a cada 10 minutos
--               impedia qualquer TV de conseguir o dela. Origem desconhecida
--               (nulo) só conta na fila. Vencidos há mais de 1 hora e nunca
--               retirados são apagados ao criar o próximo, e admin ou gestor
--               apaga os não aprovados na hora com `tv_limpar_pedidos` — é
--               linha de controle desta tabela, não dado de ninguém.
--   relógio     `validade_s` (segundos que faltam, pelo relógio do banco) vai
--               em 'criado' e em 'aguardando': a TV conta no cronômetro dela.
--               Comparar `expira_em` com o relógio de um aparelho com a hora
--               errada fazia a TV pedir código em laço.
--   aprovação   aprovar nos últimos segundos estica a validade para pelo menos
--               2 minutos, senão a TV perderia um pareamento já aprovado.
--
-- `ultimo_acesso_em` é regravado no máximo uma vez por minuto: a TV lê a cada
-- 60 s e não precisa de uma escrita por leitura. É dele que a tela /telas tira
-- o "sem acesso há X".
--
-- Aplicado no banco vivo em 01/10/2026, em duas levas (a segunda trouxe
-- `origem_hash`, `tv_criar_pareamento_da_origem`, `tv_limpar_pedidos`, a
-- retirada repetível e `validade_s`); este arquivo é o retrato do que ficou.

-- ------------------------------------------------------------- 1. tabelas
CREATE TABLE public.tv_dispositivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  token_hash text NOT NULL,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT tv_dispositivos_token_hash_key UNIQUE (token_hash),
  CONSTRAINT tv_dispositivos_token_hash_formato CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tv_dispositivos_nome_tamanho CHECK (nome = btrim(nome) AND char_length(nome) BETWEEN 1 AND 40)
);

CREATE TABLE public.tv_pareamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  retirada_hash text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  aprovado_em timestamptz,
  aprovado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  nome text,
  dispositivo_id uuid REFERENCES public.tv_dispositivos(id) ON DELETE SET NULL,
  consumido_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0,
  origem_hash text,
  CONSTRAINT tv_pareamentos_codigo_formato CHECK (codigo ~ '^[A-HJ-NP-Z2-9]{6}$'),
  CONSTRAINT tv_pareamentos_retirada_hash_formato CHECK (retirada_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tv_pareamentos_nome_tamanho CHECK (nome IS NULL OR (nome = btrim(nome) AND char_length(nome) BETWEEN 1 AND 40)),
  CONSTRAINT tv_pareamentos_aprovado_tem_nome CHECK (aprovado_em IS NULL OR nome IS NOT NULL),
  CONSTRAINT tv_pareamentos_consumido_foi_aprovado CHECK (consumido_em IS NULL OR aprovado_em IS NOT NULL),
  CONSTRAINT tv_pareamentos_origem_hash_formato CHECK (origem_hash IS NULL OR origem_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX tv_pareamentos_codigo_vivo_uidx
  ON public.tv_pareamentos (codigo) WHERE consumido_em IS NULL;

CREATE TABLE public.tv_pareamento_tentativas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tv_pareamento_tentativas_usuario_idx
  ON public.tv_pareamento_tentativas (usuario_id, criado_em);

ALTER TABLE public.tv_dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_pareamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_pareamento_tentativas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tv_dispositivos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tv_pareamentos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tv_pareamento_tentativas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.tv_pareamento_tentativas_id_seq FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.tv_dispositivos IS 'TVs de parede pareadas. Guarda so o SHA-256 do token do aparelho; RLS ligada e nenhuma policy: so service_role e funcoes definer entram.';
COMMENT ON TABLE public.tv_pareamentos IS 'Pedidos de pareamento de TV: codigo curto de uso unico, validade de 10 min, hash do segredo de retirada.';
COMMENT ON COLUMN public.tv_pareamentos.origem_hash IS 'SHA-256 do endereco de quem pediu o codigo. So serve ao freio de enchente (5 pedidos vivos por origem) e e apagado quando o pedido e consumido.';
COMMENT ON TABLE public.tv_pareamento_tentativas IS 'Codigos de pareamento errados por usuario, para frear chute (5 em 10 min).';

-- ------------------------------------- 2. funções da tela logada (/telas)
CREATE OR REPLACE FUNCTION public.tv_aprovar_pareamento(p_codigo text, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_erradas integer;
  v_primeira timestamptz;
  v_par public.tv_pareamentos%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if public.usuario_desativado(v_uid)
     or not (public.has_role(v_uid, 'admin') or public.has_role(v_uid, 'gestor')) then
    raise exception 'Só administrador ou gestor pode cuidar das TVs' using errcode = '42501';
  end if;

  if char_length(v_nome) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;

  select count(*), min(t.criado_em) into v_erradas, v_primeira
    from public.tv_pareamento_tentativas t
   where t.usuario_id = v_uid and t.criado_em > now() - interval '10 minutes';
  if v_erradas >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'muitas_tentativas',
                              'liberado_em', v_primeira + interval '10 minutes');
  end if;

  if v_codigo !~ '^[A-HJ-NP-Z2-9]{6}$' then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_mal_formado');
  end if;

  select p.* into v_par
    from public.tv_pareamentos p
   where p.codigo = v_codigo
   order by (p.consumido_em is null) desc, p.criado_em desc
   limit 1
   for update;

  if not found then
    insert into public.tv_pareamento_tentativas (usuario_id) values (v_uid);
    delete from public.tv_pareamento_tentativas t where t.criado_em < now() - interval '1 day';
    return jsonb_build_object('ok', false, 'motivo', 'codigo_nao_encontrado',
                              'tentativas_restantes', greatest(0, 4 - v_erradas));
  end if;
  if v_par.aprovado_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_ja_usado');
  end if;
  if v_par.expira_em <= now() or v_par.tentativas >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_expirado');
  end if;

  update public.tv_pareamentos p
     set aprovado_em = now(),
         aprovado_por = v_uid,
         nome = v_nome,
         expira_em = greatest(p.expira_em, now() + interval '2 minutes')
   where p.id = v_par.id;

  return jsonb_build_object('ok', true, 'nome', v_nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tv_listar_dispositivos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if public.usuario_desativado(v_uid)
     or not (public.has_role(v_uid, 'admin') or public.has_role(v_uid, 'gestor')) then
    raise exception 'Só administrador ou gestor pode cuidar das TVs' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'agora', now(),
    'pareamentos_pendentes', (
      select count(*) from public.tv_pareamentos p
       where p.consumido_em is null and p.aprovado_em is null and p.expira_em > now()),
    'aprovados_aguardando', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', p.nome, 'aprovado_em', p.aprovado_em, 'expira_em', p.expira_em)
             order by p.aprovado_em desc)
        from public.tv_pareamentos p
       where p.consumido_em is null and p.aprovado_em is not null and p.expira_em > now()), '[]'::jsonb),
    'dispositivos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'nome', d.nome,
               'criado_em', d.criado_em,
               'criado_por', uc.nome,
               'ultimo_acesso_em', d.ultimo_acesso_em,
               'revogado_em', d.revogado_em,
               'revogado_por', ur.nome)
             order by (d.revogado_em is not null), d.criado_em desc)
        from public.tv_dispositivos d
        left join public.usuarios uc on uc.id = d.criado_por
        left join public.usuarios ur on ur.id = d.revogado_por), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tv_revogar_dispositivo(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_nome text;
  v_revogado timestamptz;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if public.usuario_desativado(v_uid)
     or not (public.has_role(v_uid, 'admin') or public.has_role(v_uid, 'gestor')) then
    raise exception 'Só administrador ou gestor pode cuidar das TVs' using errcode = '42501';
  end if;

  select d.nome, d.revogado_em into v_nome, v_revogado
    from public.tv_dispositivos d
   where d.id = p_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;
  if v_revogado is not null then
    return jsonb_build_object('ok', true, 'ja_revogada', true, 'nome', v_nome);
  end if;

  update public.tv_dispositivos d
     set revogado_em = now(), revogado_por = v_uid
   where d.id = p_id;

  return jsonb_build_object('ok', true, 'ja_revogada', false, 'nome', v_nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tv_limpar_pedidos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_apagados integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if public.usuario_desativado(v_uid)
     or not (public.has_role(v_uid, 'admin') or public.has_role(v_uid, 'gestor')) then
    raise exception 'Só administrador ou gestor pode cuidar das TVs' using errcode = '42501';
  end if;

  -- Só pedido que ninguém aprovou. O aprovado que a TV ainda vai buscar fica:
  -- apagá-lo desfaria uma aprovação que alguém acabou de dar.
  delete from public.tv_pareamentos p
   where p.consumido_em is null and p.aprovado_em is null;
  get diagnostics v_apagados = row_count;

  return jsonb_build_object('ok', true, 'apagados', v_apagados);
end;
$function$;

-- ------------------------------------------ 3. funções do servidor (rotas)
CREATE OR REPLACE FUNCTION public.tv_criar_pareamento(p_codigo text, p_retirada_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_pendentes integer;
  v_libera timestamptz;
  v_id uuid;
  v_expira timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'tv: só o servidor chama esta função' using errcode = '42501';
  end if;
  if coalesce(p_codigo, '') !~ '^[A-HJ-NP-Z2-9]{6}$'
     or coalesce(p_retirada_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'tv: pareamento mal formado' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('tv_criar_pareamento'));

  delete from public.tv_pareamentos p
   where p.consumido_em is null and p.expira_em < now() - interval '1 hour';

  select count(*), min(p.expira_em) into v_pendentes, v_libera
    from public.tv_pareamentos p
   where p.consumido_em is null and p.expira_em > now();
  if v_pendentes >= 20 then
    return jsonb_build_object('estado', 'cheio', 'motivo', 'fila', 'libera_em', v_libera);
  end if;

  begin
    insert into public.tv_pareamentos (codigo, retirada_hash)
    values (p_codigo, p_retirada_hash)
    returning id, expira_em into v_id, v_expira;
  exception when unique_violation then
    return jsonb_build_object('estado', 'codigo_repetido');
  end;

  -- validade_s: quanto falta, medido pelo relógio do banco. A TV conta a partir
  -- do cronômetro dela; comparar expira_em com o relógio da TV erra quando o
  -- aparelho está com a hora errada.
  return jsonb_build_object('estado', 'criado', 'pareamento_id', v_id,
                            'codigo', p_codigo, 'expira_em', v_expira,
                            'validade_s', greatest(0, floor(extract(epoch from (v_expira - now()))))::integer);
end;
$function$;

-- A porta que o servidor usa. A de cima (2 argumentos) ficou como peça de
-- dentro: conta a fila e insere. Esta conta a ORIGEM antes e grava a origem
-- depois, na mesma transação.
CREATE OR REPLACE FUNCTION public.tv_criar_pareamento_da_origem(p_codigo text, p_retirada_hash text, p_origem_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_da_origem integer;
  v_libera timestamptz;
  v_resposta jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'tv: só o servidor chama esta função' using errcode = '42501';
  end if;
  if p_origem_hash is not null and p_origem_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'tv: origem mal formada' using errcode = '22023';
  end if;

  -- A mesma trava da função de dentro (é reentrante na transação): dois pedidos
  -- da mesma origem ao mesmo tempo não passam juntos pela contagem.
  perform pg_advisory_xact_lock(hashtext('tv_criar_pareamento'));

  -- Sem origem conhecida não há por quem contar: vale só o teto da fila.
  if p_origem_hash is not null then
    select count(*), min(p.expira_em) into v_da_origem, v_libera
      from public.tv_pareamentos p
     where p.consumido_em is null and p.expira_em > now()
       and p.origem_hash = p_origem_hash;
    if v_da_origem >= 5 then
      return jsonb_build_object('estado', 'cheio', 'motivo', 'origem', 'libera_em', v_libera);
    end if;
  end if;

  v_resposta := public.tv_criar_pareamento(p_codigo, p_retirada_hash);

  if v_resposta->>'estado' = 'criado' and p_origem_hash is not null then
    update public.tv_pareamentos p
       set origem_hash = p_origem_hash
     where p.id = (v_resposta->>'pareamento_id')::uuid;
  end if;

  return v_resposta;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tv_retirar_pareamento(p_pareamento_id uuid, p_retirada_hash text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_par public.tv_pareamentos%rowtype;
  v_dispositivo uuid;
  v_nome text;
begin
  if current_user <> 'service_role' then
    raise exception 'tv: só o servidor chama esta função' using errcode = '42501';
  end if;
  if coalesce(p_retirada_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'tv: retirada mal formada' using errcode = '22023';
  end if;

  select p.* into v_par
    from public.tv_pareamentos p
   where p.id = p_pareamento_id
   for update;
  if not found then
    return jsonb_build_object('estado', 'recusado');
  end if;
  if v_par.retirada_hash <> p_retirada_hash then
    update public.tv_pareamentos p set tentativas = p.tentativas + 1 where p.id = v_par.id;
    return jsonb_build_object('estado', 'recusado');
  end if;
  if v_par.consumido_em is not null then
    -- A resposta 'pareado' pode ter se perdido no caminho (Wi-Fi da oficina, TV
    -- reiniciando). Quem volta com o segredo certo E com o mesmo crachá que este
    -- pedido criou é a mesma TV: a entrega se repete, sem criar outro
    -- dispositivo. Crachá revogado não se repete.
    select d.nome into v_nome
      from public.tv_dispositivos d
     where d.id = v_par.dispositivo_id
       and d.token_hash = p_token_hash
       and d.revogado_em is null;
    if found then
      return jsonb_build_object('estado', 'pareado', 'nome', v_nome, 'repetido', true);
    end if;
    return jsonb_build_object('estado', 'consumido');
  end if;
  if v_par.expira_em <= now() or v_par.tentativas >= 5 then
    return jsonb_build_object('estado', 'expirado');
  end if;
  if v_par.aprovado_em is null then
    return jsonb_build_object('estado', 'aguardando', 'expira_em', v_par.expira_em,
                              'validade_s', greatest(0, floor(extract(epoch from (v_par.expira_em - now()))))::integer);
  end if;

  insert into public.tv_dispositivos (nome, token_hash, criado_por)
  values (v_par.nome, p_token_hash, v_par.aprovado_por)
  returning id into v_dispositivo;

  -- A origem só serve ao freio de enchente enquanto o pedido está vivo.
  update public.tv_pareamentos p
     set consumido_em = now(), dispositivo_id = v_dispositivo, origem_hash = null
   where p.id = v_par.id;

  return jsonb_build_object('estado', 'pareado', 'nome', v_par.nome, 'repetido', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tv_conferir_dispositivo(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_nome text;
  v_revogado timestamptz;
  v_ultimo timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'tv: só o servidor chama esta função' using errcode = '42501';
  end if;

  select d.id, d.nome, d.revogado_em, d.ultimo_acesso_em
    into v_id, v_nome, v_revogado, v_ultimo
    from public.tv_dispositivos d
   where d.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('estado', 'desconhecida');
  end if;
  if v_revogado is not null then
    return jsonb_build_object('estado', 'revogada');
  end if;

  if v_ultimo is null or v_ultimo < now() - interval '1 minute' then
    update public.tv_dispositivos d set ultimo_acesso_em = now() where d.id = v_id;
  end if;

  return jsonb_build_object('estado', 'ativa', 'nome', v_nome);
end;
$function$;

-- ------------------------------------------------------- 4. quem pode chamar
-- Função nasce com EXECUTE para PUBLIC e, por privilégio padrão do projeto,
-- também para anon, authenticated e service_role nominalmente. As da tela
-- ficam só com authenticated (a guarda de papel está no corpo); as do servidor
-- ficam só com service_role.
REVOKE ALL ON FUNCTION public.tv_aprovar_pareamento(text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.tv_listar_dispositivos() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.tv_revogar_dispositivo(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.tv_limpar_pedidos() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tv_aprovar_pareamento(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_listar_dispositivos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_revogar_dispositivo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_limpar_pedidos() TO authenticated;

REVOKE ALL ON FUNCTION public.tv_criar_pareamento(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tv_criar_pareamento_da_origem(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tv_retirar_pareamento(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tv_conferir_dispositivo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_criar_pareamento(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tv_criar_pareamento_da_origem(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tv_retirar_pareamento(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tv_conferir_dispositivo(text) TO service_role;

-- CONFERIDO, em ensaios com rollback (RAISE EXCEPTION no fim), simulando as
-- contas reais por `request.jwt.claims` + SET LOCAL ROLE:
--   tabelas     anon e authenticated (inclusive o admin, direto): 42501 nas
--               três, para ler e para inserir; service_role insere e lê;
--               hash fora do formato e código com "0": 23514
--   servidor    dono do banco, anon e admin logado chamando as três funções
--               do servidor: 42501; service_role: criado (validade 10 min) →
--               aguardando → segredo errado 'recusado' (tentativas=1) → id que
--               não existe 'recusado' → depois de aprovado 'pareado' com o
--               nome → de novo 'consumido'; dispositivo gravado com o hash, o
--               aprovador e o nome; conferir: 'desconhecida' / 'ativa' /
--               'revogada'; acesso há 30 s não regrava, há 2 min regrava;
--               vencido: 'expirado'; mesmo código vivo: 'codigo_repetido'
--   enchente    1º ao 20º 'criado', 21º e 22º 'cheio'; o vencido há 2 h foi
--               apagado ao criar, o consumido ficou
--   tela        anon: 42501 nas três; operador listando, financeiro e vendedor
--               aprovando, vendedor revogando: 42501 "Só administrador ou
--               gestor pode cuidar das TVs"; admin: código errado →
--               codigo_nao_encontrado (restam 4, 1 tentativa gravada), com "0"
--               → codigo_mal_formado, sem nome → nome_invalido, vencido →
--               codigo_expirado, " abc-def " + "  TV   da  Oficina " → ok com
--               nome "TV da Oficina", de novo → codigo_ja_usado (também depois
--               de retirado); lista sem nenhuma chave com hash ou token;
--               revogar → ok, de novo → ja_revogada, inexistente →
--               nao_encontrada; 5 códigos errados e o 6º pedido, com o código
--               CERTO, devolve muitas_tentativas (libera em 10 min)
--   desgaste    5 segredos de retirada errados: o 6º pedido, com o segredo
--               CERTO, devolve 'expirado' (tentativas=5) e aprovar o código
--               dele devolve codigo_expirado; nenhum dispositivo criado
--   última hora aprovar faltando 30 s: a validade passa a 120 s
--   sem sessão  authenticated sem `sub`: 42501 "Usuário não autenticado"
--   cadeia      criar → aprovar (o outro admin) → retirar → conferir →
--               tv_painel_maquinas(), tudo como service_role: 'ativa' e um
--               objeto jsonb
--   API real    com a chave pública (anon), pelo PostgREST: GET nas três
--               tabelas e POST em tv_listar_dispositivos e
--               tv_conferir_dispositivo respondem 401 / 42501
--   SEGUNDA LEVA (origem, limpar, retirada repetível, validade_s)
--   portas      anon chamando tv_criar_pareamento_da_origem e tv_limpar_pedidos,
--               admin logado chamando a da origem: 42501; vendedor limpando:
--               42501; anon e admin lendo `origem_hash` direto na tabela: 42501
--   origem      7 pedidos do mesmo endereço: 5 'criado', 2 'cheio' (motivo
--               origem); 6 sem origem: 6 'criado' (validade_s 600); outras
--               origens até o teto: 9 'criado', 3 'cheio' (motivo fila), 20
--               vivos, 14 com origem gravada; origem fora do formato: 22023
--   limpar      com 1 aprovado e 19 por aprovar: apagados 19, sobrou o
--               aprovado; a origem que estava no teto volta a receber
--               'criado'; só com aprovado na fila: apagados 0
--   repetível   retirar: 'pareado' (repetido false); de novo, mesmo segredo e
--               mesmo hash de token: 'pareado' (repetido true), 1 dispositivo
--               só; mesmo segredo e OUTRO hash de token: 'consumido'; segredo
--               errado: 'recusado'; `origem_hash` do consumido: nulo; depois
--               de revogar o dispositivo: 'consumido'
--   validade_s  'criado' e 'aguardando' devolvem 600 logo depois de criar
--   cadeia      (objetos vivos) criar pela origem → aprovar (o outro admin) →
--               retirar duas vezes → conferir 'ativa' → tv_painel_maquinas()
--               devolve objeto com 14 chaves
-- NÃO CONFERIDO: admin ou gestor com `usuarios.ativo = false` (a guarda usa
-- `usuario_desativado`, a mesma de `has_permission`; ensaiar exigiria UPDATE em
-- conta real) e gestor de verdade aprovando (hoje há 2 admins e 0 gestores).
-- Depois dos ensaios: 0 linhas nas três tabelas.
