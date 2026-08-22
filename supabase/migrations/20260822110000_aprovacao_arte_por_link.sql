-- Aprovação de arte por link externo.
--
-- `arquivo_tokens_externos` e `arquivo_aprovacoes` estavam modeladas há tempo —
-- token com validade, escopo, revogação, decisão do cliente e canal — e não havia
-- uma linha de tela para nenhuma das duas. Este é o passo mais repetido do dia a
-- dia de uma gráfica: mandar a arte, esperar o "pode imprimir" e conseguir provar
-- depois que foi aprovado.
--
-- O cliente NÃO faz login. Tudo o que a página pública consegue fazer passa por
-- estas funções, que recebem o token em claro, conferem o hash e devolvem apenas
-- o daquele arquivo. O token nunca é gravado em claro.

-- ---------------------------------------------------------------------------
-- Hash do token. sha256 é nativo desde o PG 11; o token só existe em claro na
-- resposta que cria o link — depois disso nem o banco consegue reconstruí-lo.
-- ---------------------------------------------------------------------------
create or replace function public.hash_token_aprovacao(p_token text)
returns text
language sql
immutable
set search_path to 'public'
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------------------
-- Staff gera o link.
-- ---------------------------------------------------------------------------
create or replace function public.criar_link_aprovacao(
  p_arquivo_id uuid,
  p_dias integer default 7
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_arquivo public.arquivos%rowtype;
  v_token text;
  v_dias integer := greatest(1, least(coalesce(p_dias, 7), 60));
begin
  v_uid := public.require_permission('arquivos.request_approval');

  select * into v_arquivo from public.arquivos where id = p_arquivo_id;
  if not found then raise exception 'Arquivo não encontrado'; end if;
  if v_arquivo.os_id is null then
    raise exception 'Este arquivo não está ligado a uma OS — o cliente não teria contexto para aprovar.';
  end if;

  -- 32 bytes aleatórios: inadivinhável e curto o bastante para caber num link
  -- de WhatsApp sem quebrar linha. pgcrypto vive em `extensions` e a função fixa
  -- search_path em public, então a chamada precisa vir qualificada.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- Um link vivo por arquivo: gerar outro invalida o anterior, senão o cliente
  -- decide por um link antigo apontando para uma arte que já foi substituída.
  update public.arquivo_tokens_externos
     set revogado_em = now()
   where arquivo_id = p_arquivo_id and revogado_em is null and usado_em is null;

  insert into public.arquivo_tokens_externos
    (token_hash, os_id, arquivo_id, escopo, expira_em, created_by)
  values
    (public.hash_token_aprovacao(v_token), v_arquivo.os_id, p_arquivo_id,
     jsonb_build_object('acao', 'aprovar_arte'), now() + (v_dias || ' days')::interval, v_uid);

  -- Registra o pedido e coloca a OS no estado que o cliente vai encontrar.
  insert into public.arquivo_aprovacoes (arquivo_id, decisao, usuario_id, cliente_id, canal)
  values (p_arquivo_id, 'solicitada', v_uid, v_arquivo.cliente_id, 'link');

  -- tg_bloquear_update_status_os recusa UPDATE direto de status e só abre para
  -- admin/gestor ou para quem liga esta flag. O designer que pede a aprovação não
  -- é nenhum dos dois: sem isto, gerar o link falha para quem mais usa a função.
  perform set_config('app.avancar_os_status', 'on', true);
  update public.ordens_servico
     set status = 'aguardando_aprovacao_arte'
   where id = v_arquivo.os_id
     and status not in ('concluido', 'faturado', 'cancelado');
  perform set_config('app.avancar_os_status', 'off', true);

  return jsonb_build_object(
    'token', v_token,
    'expira_em', now() + (v_dias || ' days')::interval,
    'arquivo', v_arquivo.nome
  );
end;
$$;

comment on function public.criar_link_aprovacao is
  'Gera o link de aprovação de uma arte. Devolve o token em claro UMA vez.';

revoke all on function public.criar_link_aprovacao(uuid, integer) from public;
grant execute on function public.criar_link_aprovacao(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Cliente abre o link (sem login).
--
-- Devolve `situacao` em vez de erro: "link vencido" e "já respondido" são
-- respostas legítimas que a página precisa saber explicar, não falhas.
-- ---------------------------------------------------------------------------
create or replace function public.abrir_aprovacao(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t public.arquivo_tokens_externos%rowtype;
  a public.arquivos%rowtype;
  os public.ordens_servico%rowtype;
  v_cliente text;
  v_empresa text;
  v_decisao text;
begin
  select * into t from public.arquivo_tokens_externos
   where token_hash = public.hash_token_aprovacao(p_token);
  if not found then
    return jsonb_build_object('situacao', 'invalido');
  end if;
  if t.revogado_em is not null then
    return jsonb_build_object('situacao', 'revogado');
  end if;

  select * into a from public.arquivos where id = t.arquivo_id;
  select * into os from public.ordens_servico where id = t.os_id;
  select nome into v_cliente from public.clientes where id = a.cliente_id;
  select coalesce(razao_social, nome) into v_empresa from public.empresa_config limit 1;

  -- Depois de decidido o link continua abrindo, mostrando o que foi decidido:
  -- o cliente costuma voltar no link para conferir o que respondeu.
  if t.usado_em is not null then
    select decisao into v_decisao from public.arquivo_aprovacoes
     where arquivo_id = t.arquivo_id and decisao <> 'solicitada'
     order by created_at desc limit 1;
    return jsonb_build_object(
      'situacao', 'respondido',
      'decisao', v_decisao,
      'respondido_em', t.usado_em,
      'arquivo_nome', a.nome,
      'os_numero', os.numero,
      'empresa', v_empresa
    );
  end if;

  if t.expira_em < now() then
    return jsonb_build_object('situacao', 'expirado', 'expirou_em', t.expira_em, 'empresa', v_empresa);
  end if;

  return jsonb_build_object(
    'situacao', 'aberto',
    'arquivo_nome', a.nome,
    'arquivo_caminho', a.caminho,
    'arquivo_mime', coalesce(a.mime_type, a.mime),
    'bucket', coalesce(a.bucket, 'arquivos-clientes'),
    'os_numero', os.numero,
    'os_titulo', os.titulo,
    'cliente', v_cliente,
    'empresa', v_empresa,
    'expira_em', t.expira_em
  );
end;
$$;

comment on function public.abrir_aprovacao is
  'Página pública de aprovação: devolve os dados da arte a partir do token.';

revoke all on function public.abrir_aprovacao(text) from public;
grant execute on function public.abrir_aprovacao(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cliente decide (sem login).
-- ---------------------------------------------------------------------------
create or replace function public.registrar_decisao_aprovacao(
  p_token text,
  p_decisao text,
  p_comentario text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t public.arquivo_tokens_externos%rowtype;
  a public.arquivos%rowtype;
begin
  if p_decisao not in ('aprovado', 'ajuste') then
    raise exception 'Decisão inválida';
  end if;
  -- Pedir ajuste sem dizer o quê deixa a produção parada sem saber o que fazer.
  if p_decisao = 'ajuste' and coalesce(length(btrim(p_comentario)), 0) < 3 then
    raise exception 'Descreva o ajuste desejado para a equipe saber o que corrigir.';
  end if;

  select * into t from public.arquivo_tokens_externos
   where token_hash = public.hash_token_aprovacao(p_token)
   for update;
  if not found then raise exception 'Link inválido'; end if;
  if t.revogado_em is not null then raise exception 'Este link foi cancelado pela gráfica.'; end if;
  if t.usado_em is not null then raise exception 'Este link já foi respondido.'; end if;
  if t.expira_em < now() then raise exception 'Este link venceu. Peça um novo à gráfica.'; end if;

  select * into a from public.arquivos where id = t.arquivo_id;

  update public.arquivo_tokens_externos set usado_em = now() where id = t.id;

  insert into public.arquivo_aprovacoes (arquivo_id, decisao, cliente_id, comentario, canal)
  values (t.arquivo_id, p_decisao, a.cliente_id, nullif(btrim(p_comentario), ''), 'link');

  -- CASE devolve text; status_arquivo e status_os são enums e exigem cast.
  update public.arquivos
     set status = (case when p_decisao = 'aprovado' then 'aprovado' else 'rejeitado' end)::status_arquivo,
         data_aprovacao = case when p_decisao = 'aprovado' then now() else null end,
         observacao = coalesce(nullif(btrim(p_comentario), ''), observacao)
   where id = t.arquivo_id;

  -- A OS anda sozinha: era isso que fazia alguém ficar olhando o WhatsApp para
  -- depois mudar o status na mão.
  -- Mesma trava aqui, e é onde ela mais importa: quem responde é o cliente, que
  -- não tem sessão nenhuma. A transição é legítima e auditada por
  -- arquivo_aprovacoes, então a flag é ligada só em volta deste UPDATE.
  perform set_config('app.avancar_os_status', 'on', true);
  update public.ordens_servico
     set status = (case when p_decisao = 'aprovado' then 'arte_aprovada' else 'arte_rejeitada' end)::status_os
   where id = t.os_id
     and status not in ('concluido', 'faturado', 'cancelado');
  perform set_config('app.avancar_os_status', 'off', true);

  return jsonb_build_object('ok', true, 'decisao', p_decisao);
end;
$$;

comment on function public.registrar_decisao_aprovacao is
  'Grava a decisão do cliente vinda do link público e move a OS.';

revoke all on function public.registrar_decisao_aprovacao(text, text, text) from public;
grant execute on function public.registrar_decisao_aprovacao(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ver a imagem sem login.
--
-- O bucket é privado e a URL assinada do Storage exige sessão — que o cliente não
-- tem. A saída é uma policy estreita: o objeto fica legível enquanto EXISTE um
-- link de aprovação vivo apontando para ele. Link usado, vencido ou revogado
-- fecha a imagem de novo.
--
-- O caminho é `orcamento/<uuid>/<timestamp>.<ext>`, então não é adivinhável — o
-- mesmo modelo de exposição de uma URL assinada.
-- ---------------------------------------------------------------------------
create or replace function public.arquivo_em_aprovacao_aberta(p_caminho text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.arquivo_tokens_externos t
    join public.arquivos a on a.id = t.arquivo_id
    where a.caminho = p_caminho
      and t.revogado_em is null
      and t.usado_em is null
      and t.expira_em > now()
  )
$$;

comment on function public.arquivo_em_aprovacao_aberta is
  'True enquanto houver link de aprovação vivo para o arquivo neste caminho.';

grant execute on function public.arquivo_em_aprovacao_aberta(text) to anon, authenticated;

drop policy if exists "arte visivel durante aprovacao" on storage.objects;
create policy "arte visivel durante aprovacao" on storage.objects
  for select to anon
  using (
    bucket_id = 'arquivos-clientes'
    and public.arquivo_em_aprovacao_aberta(name)
  );

-- A policy roda por objeto listado; sem índice o caminho vira varredura.
create index if not exists idx_arquivos_caminho on public.arquivos (caminho);
create index if not exists idx_tokens_aprovacao_vivos
  on public.arquivo_tokens_externos (arquivo_id)
  where revogado_em is null and usado_em is null;
