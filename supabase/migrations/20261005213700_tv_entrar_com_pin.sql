-- ============================================================================
-- Entrar com PIN: a TV da Oficina se libera digitando um PIN na própria tela
-- ============================================================================
--
-- POR QUÊ (05/10/2026): o dono pediu a TV "funcionando com PIN 1234, assim
-- fica protegido" — o mesmo gesto da TV2 da agência. Até aqui a única porta
-- era o pareamento por código aprovado por admin ou gestor logado
-- (20261001130000), e nenhuma TV tinha chegado a ser pareada.
--
-- O QUE NÃO SE COPIOU DA TV2 DA AGÊNCIA
--   Lá o PIN padrão está escrito no código e vai a cada leitura num cabeçalho:
--   quem lê o código-fonte entra, e não há como cortar uma tela sem trocar o
--   PIN de todas. Aqui o PIN só existe no banco, como hash bcrypt (pgcrypto),
--   e acertar o PIN não abre o painel direto: dá à TV um CRACHÁ, na mesma
--   `tv_dispositivos` do pareamento. Dali em diante ela lê com o crachá, como
--   as pareadas por código — aparece em /telas, com nome, e pode ser revogada
--   sozinha.
--
-- COMO A TV ENTRA PELO PIN
--   1. A TV sorteia o próprio crachá (32 bytes) e o GUARDA antes de mandar.
--   2. POST /api/tv/pin {pin, token}: o servidor manda ao banco o PIN e o
--      SHA-256 do token — nunca o token.
--   3. PIN certo: o banco grava o hash como dispositivo `entrada = 'pin'` e
--      responde 'liberado'. Resposta perdida no Wi-Fi não deixa órfão: a TV
--      repete com o mesmo token e recebe 'liberado' de novo (repetido), sem
--      outro dispositivo.
--
-- FREIO CONTRA CHUTE (um PIN de 4 dígitos são 10 mil combinações)
--   5 PINs errados do mesmo endereço em 15 minutos e aquele endereço espera;
--   30 errados no total em 15 minutos e todo mundo espera (é quem chuta
--   trocando de endereço). TV que já tem crachá não sente nada: o freio só
--   vale para ENTRAR. Só os erros são gravados, com o SHA-256 do endereço, e
--   somem em 1 dia. Por isso `tv_entrar_com_pin` DEVOLVE {estado} em vez de
--   levantar erro — erro desfaria a transação e o chute não ficaria contado.
--
-- TROCAR O PIN (tv_definir_pin, admin ou gestor em /telas)
--   desconecta as TVs que entraram pelo PIN — se o PIN vazou, trocar tem de
--   cortar quem entrou com ele. As aprovadas por código não mudam. PIN vazio
--   desliga a entrada por PIN (sobra o pareamento por código). Repetir o mesmo
--   PIN não é troca e não desconecta ninguém.
--
-- O PIN INICIAL (1234, pedido do dono) foi gravado direto no banco vivo,
-- fora deste arquivo: o repositório não guarda PIN. Um banco montado do zero
-- a partir das migrações nasce com a entrada por PIN DESLIGADA.

-- ------------------------------------------------------------- 1. tabelas
ALTER TABLE public.tv_dispositivos
  ADD COLUMN entrada text NOT NULL DEFAULT 'codigo',
  ADD CONSTRAINT tv_dispositivos_entrada_valida CHECK (entrada IN ('codigo', 'pin'));

COMMENT ON COLUMN public.tv_dispositivos.entrada IS 'Como a TV ganhou o cracha: codigo (pareamento aprovado em /telas) ou pin (digitou o PIN na propria TV). Trocar o PIN revoga as de entrada pin.';

CREATE TABLE public.tv_pin (
  id boolean PRIMARY KEY DEFAULT true,
  pin_hash text,
  digitos smallint,
  definido_em timestamptz,
  definido_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT tv_pin_uma_linha CHECK (id),
  CONSTRAINT tv_pin_coerente CHECK ((pin_hash IS NULL) = (digitos IS NULL)),
  CONSTRAINT tv_pin_digitos CHECK (digitos IS NULL OR digitos BETWEEN 4 AND 8),
  CONSTRAINT tv_pin_hash_bcrypt CHECK (pin_hash IS NULL OR pin_hash ~ '^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$')
);

INSERT INTO public.tv_pin (id) VALUES (true);

CREATE TABLE public.tv_pin_tentativas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origem_hash text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tv_pin_tentativas_origem_formato CHECK (origem_hash IS NULL OR origem_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX tv_pin_tentativas_criado_em_idx ON public.tv_pin_tentativas (criado_em);

ALTER TABLE public.tv_pin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_pin_tentativas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tv_pin FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tv_pin_tentativas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.tv_pin_tentativas_id_seq FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.tv_pin IS 'O PIN da TV da Oficina (uma linha so): hash bcrypt e quantos digitos. Sem hash = entrada por PIN desligada. RLS ligada e nenhuma policy.';
COMMENT ON TABLE public.tv_pin_tentativas IS 'PINs errados digitados na TV, com o SHA-256 do endereco: 5 por endereco ou 30 no total em 15 min e a entrada espera. Somem em 1 dia.';

-- ------------------------------------------ 2. funções do servidor (rotas)
CREATE OR REPLACE FUNCTION public.tv_estado_do_pin()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_digitos smallint;
begin
  if current_user <> 'service_role' then
    raise exception 'tv: só o servidor chama esta função' using errcode = '42501';
  end if;

  select p.digitos into v_digitos from public.tv_pin p where p.id;

  -- Só o que a TV precisa para desenhar o teclado: se há PIN e quantas casas.
  return jsonb_build_object('ligado', v_digitos is not null, 'digitos', v_digitos);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tv_entrar_com_pin(p_pin text, p_token_hash text, p_origem_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_pin public.tv_pin%rowtype;
  v_da_origem integer;
  v_primeira_da_origem timestamptz;
  v_no_total integer;
  v_primeira_no_total timestamptz;
  v_dispositivo public.tv_dispositivos%rowtype;
  v_nome text;
begin
  if current_user <> 'service_role' then
    raise exception 'tv: só o servidor chama esta função' using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'tv: token mal formado' using errcode = '22023';
  end if;
  if p_origem_hash is not null and p_origem_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'tv: origem mal formada' using errcode = '22023';
  end if;

  -- Uma entrada por vez: dois chutes ao mesmo tempo não passam juntos pela
  -- contagem do freio.
  perform pg_advisory_xact_lock(hashtext('tv_entrar_com_pin'));

  select p.* into v_pin from public.tv_pin p where p.id;
  if v_pin.pin_hash is null then
    return jsonb_build_object('estado', 'pin_desligado');
  end if;

  delete from public.tv_pin_tentativas t where t.criado_em < now() - interval '1 day';

  select count(*), min(t.criado_em) into v_da_origem, v_primeira_da_origem
    from public.tv_pin_tentativas t
   where t.criado_em > now() - interval '15 minutes'
     and t.origem_hash is not distinct from p_origem_hash;
  if v_da_origem >= 5 then
    return jsonb_build_object('estado', 'bloqueado',
      'libera_s', greatest(1, ceil(extract(epoch from (v_primeira_da_origem + interval '15 minutes' - now()))))::integer);
  end if;

  select count(*), min(t.criado_em) into v_no_total, v_primeira_no_total
    from public.tv_pin_tentativas t
   where t.criado_em > now() - interval '15 minutes';
  if v_no_total >= 30 then
    return jsonb_build_object('estado', 'bloqueado',
      'libera_s', greatest(1, ceil(extract(epoch from (v_primeira_no_total + interval '15 minutes' - now()))))::integer);
  end if;

  -- PIN fora do formato conta como errado: quem sonda não aprende a forma.
  if coalesce(p_pin, '') !~ '^[0-9]{4,8}$'
     or extensions.crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash then
    insert into public.tv_pin_tentativas (origem_hash) values (p_origem_hash);
    return jsonb_build_object('estado', 'pin_errado', 'restantes', greatest(0, 4 - v_da_origem));
  end if;

  -- PIN certo. O mesmo token de novo é a mesma TV repetindo o pedido.
  select d.* into v_dispositivo from public.tv_dispositivos d where d.token_hash = p_token_hash;
  if found then
    if v_dispositivo.revogado_em is not null then
      -- Crachá revogado não volta: a TV sorteia outro e entra de novo.
      return jsonb_build_object('estado', 'token_revogado');
    end if;
    return jsonb_build_object('estado', 'liberado', 'nome', v_dispositivo.nome, 'repetido', true);
  end if;

  v_nome := 'TV pelo PIN · ' || to_char(now() at time zone 'America/Belem', 'DD/MM HH24:MI');
  insert into public.tv_dispositivos (nome, token_hash, criado_por, entrada)
  values (v_nome, p_token_hash, null, 'pin');

  -- Quem acertou zera os próprios erros: a TV que errou duas vezes antes de
  -- acertar não fica com a conta pendurada para a próxima vez.
  delete from public.tv_pin_tentativas t where t.origem_hash is not distinct from p_origem_hash;

  return jsonb_build_object('estado', 'liberado', 'nome', v_nome, 'repetido', false);
end;
$function$;

-- ------------------------------------- 3. funções da tela logada (/telas)
CREATE OR REPLACE FUNCTION public.tv_definir_pin(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_pin text := btrim(coalesce(p_pin, ''));
  v_atual public.tv_pin%rowtype;
  v_desconectadas integer := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if public.usuario_desativado(v_uid)
     or not (public.has_role(v_uid, 'admin') or public.has_role(v_uid, 'gestor')) then
    raise exception 'Só administrador ou gestor pode cuidar das TVs' using errcode = '42501';
  end if;
  if v_pin <> '' and v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
  end if;

  select p.* into v_atual from public.tv_pin p where p.id for update;
  if not found then
    insert into public.tv_pin (id) values (true) returning * into v_atual;
  end if;

  -- O mesmo PIN de novo (ou desligar o que já está desligado) não é troca:
  -- não desconecta ninguém.
  if v_pin <> '' and v_atual.pin_hash is not null
     and extensions.crypt(v_pin, v_atual.pin_hash) = v_atual.pin_hash then
    return jsonb_build_object('ok', true, 'ligado', true, 'digitos', v_atual.digitos,
                              'igual', true, 'desconectadas', 0);
  end if;
  if v_pin = '' and v_atual.pin_hash is null then
    return jsonb_build_object('ok', true, 'ligado', false, 'digitos', null,
                              'igual', true, 'desconectadas', 0);
  end if;

  update public.tv_pin p
     set pin_hash = case when v_pin = '' then null
                         else extensions.crypt(v_pin, extensions.gen_salt('bf', 8)) end,
         digitos = case when v_pin = '' then null else char_length(v_pin) end,
         definido_em = now(),
         definido_por = v_uid
   where p.id;

  -- PIN trocado ou desligado: quem entrou com o antigo sai. As TVs aprovadas
  -- por código não dependem do PIN e ficam.
  update public.tv_dispositivos d
     set revogado_em = now(), revogado_por = v_uid
   where d.entrada = 'pin' and d.revogado_em is null;
  get diagnostics v_desconectadas = row_count;

  -- PIN novo, conta nova: os erros contra o antigo não seguram ninguém.
  delete from public.tv_pin_tentativas t where t.criado_em is not null;

  return jsonb_build_object('ok', true, 'ligado', v_pin <> '',
                            'digitos', case when v_pin = '' then null else char_length(v_pin) end,
                            'igual', false, 'desconectadas', v_desconectadas);
end;
$function$;

-- A lista de /telas passa a dizer como cada TV entrou, se o PIN está ligado
-- e quantos PINs errados houve nos últimos 15 minutos (alguém chutando).
-- Nenhuma chave com hash, PIN ou token.
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
               'entrada', d.entrada,
               'criado_em', d.criado_em,
               'criado_por', uc.nome,
               'ultimo_acesso_em', d.ultimo_acesso_em,
               'revogado_em', d.revogado_em,
               'revogado_por', ur.nome)
             order by (d.revogado_em is not null), d.criado_em desc)
        from public.tv_dispositivos d
        left join public.usuarios uc on uc.id = d.criado_por
        left join public.usuarios ur on ur.id = d.revogado_por), '[]'::jsonb),
    'pin', (
      select jsonb_build_object(
               'ligado', p.pin_hash is not null,
               'digitos', p.digitos,
               'definido_em', p.definido_em,
               'definido_por', u.nome)
        from public.tv_pin p
        left join public.usuarios u on u.id = p.definido_por
       where p.id),
    'pin_erros_15min', (
      select count(*) from public.tv_pin_tentativas t
       where t.criado_em > now() - interval '15 minutes')
  );
end;
$function$;

-- ------------------------------------------------------- 4. quem pode chamar
REVOKE ALL ON FUNCTION public.tv_estado_do_pin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tv_entrar_com_pin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_estado_do_pin() TO service_role;
GRANT EXECUTE ON FUNCTION public.tv_entrar_com_pin(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.tv_definir_pin(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.tv_listar_dispositivos() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tv_definir_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_listar_dispositivos() TO authenticated;
