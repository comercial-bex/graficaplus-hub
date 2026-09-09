-- Ninguém era dono de nada.
--
-- Medido: das 12 chaves de `ordens_servico`, oito vazias — e entre elas todas as
-- que dizem quem faz o quê. No orçamento, `vendedor_id` 0 de 3 e `created_by`
-- 1 de 3.
--
-- A causa é simples e está nas duas telas de criação: nenhuma grava esses
-- campos. `handleCreate` do orçamento passa cliente, título e valor; o da OS
-- passa cliente, título, briefing e prazo. Autor, vendedor e responsável
-- ficaram de fora desde sempre.
--
-- O efeito é operacional, não cosmético: sem responsável a OS não cobra
-- ninguém e não existe produtividade por pessoa; sem vendedor não há comissão
-- nem desempenho comercial; e a auditoria, que já registra só 4,8% dos autores,
-- perde mais uma fonte.
--
-- A correção vai no BANCO, não na tela. São dois caminhos de criação hoje e
-- podem virar quatro amanhã (importação, portal do cliente, WhatsApp). Regra
-- que mora na tela é regra que a próxima tela esquece.

-- ---------------------------------------------------------------------------
-- 1. O orçamento nasce com autor e vendedor.
--
-- O vendedor preferido é o DO CLIENTE, não quem digitou: `clientes.vendedor_id`
-- está preenchido nos 4 clientes, e é ele que define de quem é a conta. Um
-- gestor que monta o orçamento para o vendedor não rouba a venda por isso.
--
-- Sem vendedor no cliente, cai em quem está criando — melhor um responsável
-- aproximado que nenhum, porque nulo não se descobre depois.
-- ---------------------------------------------------------------------------
create or replace function public.tg_orcamento_tem_dono()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.vendedor_id is null then
    new.vendedor_id := coalesce(
      (select c.vendedor_id from public.clientes c where c.id = new.cliente_id),
      auth.uid()
    );
  end if;

  return new;
end;
$$;

comment on function public.tg_orcamento_tem_dono is
  'Preenche autor e vendedor do orçamento. Prefere o vendedor DO CLIENTE — é ele que define de quem é a conta — e cai em quem está criando quando o cliente não tem.';

drop trigger if exists tg_orcamento_tem_dono on public.orcamentos;
create trigger tg_orcamento_tem_dono
  before insert on public.orcamentos
  for each row execute function public.tg_orcamento_tem_dono();

-- ---------------------------------------------------------------------------
-- 2. A OS nasce com autor, vendedor e responsável.
--
-- O vendedor vem do orçamento quando a OS nasce de um; senão, do cliente.
--
-- O responsável cai em quem abriu. É um palpite, e um palpite explícito é
-- melhor que nulo: a pergunta "de quem é essa OS" passa a ter uma resposta que
-- alguém pode corrigir, em vez de um vazio que ninguém nota. A tela oferece o
-- seletor para trocar.
-- ---------------------------------------------------------------------------
create or replace function public.tg_os_tem_dono()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_vendedor uuid;
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.vendedor_id is null then
    select o.vendedor_id into v_vendedor
      from public.orcamentos o where o.id = new.orcamento_id;

    new.vendedor_id := coalesce(
      v_vendedor,
      (select c.vendedor_id from public.clientes c where c.id = new.cliente_id),
      auth.uid()
    );
  end if;

  if new.responsavel_id is null then
    new.responsavel_id := coalesce(new.created_by, auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.tg_os_tem_dono is
  'Preenche autor, vendedor e responsável da OS. O vendedor vem do orçamento, depois do cliente; o responsável cai em quem abriu — palpite explícito é melhor que nulo, porque dá para corrigir.';

drop trigger if exists tg_os_tem_dono on public.ordens_servico;
create trigger tg_os_tem_dono
  before insert on public.ordens_servico
  for each row execute function public.tg_os_tem_dono();

-- ---------------------------------------------------------------------------
-- 3. Conserta o que já existe, sem inventar.
--
-- Só preenche a partir de vínculo que EXISTE: o vendedor do cliente e o autor
-- do orçamento. Onde não há de onde tirar, fica nulo — atribuir a OS a alguém
-- por chute seria pior que admitir que não se sabe.
-- ---------------------------------------------------------------------------
update public.orcamentos o
   set vendedor_id = c.vendedor_id
  from public.clientes c
 where c.id = o.cliente_id
   and o.vendedor_id is null
   and c.vendedor_id is not null;

-- Subconsultas, e não JOIN no FROM: o UPDATE não permite referenciar a tabela
-- alvo dentro da própria cláusula FROM.
update public.ordens_servico os
   set vendedor_id = coalesce(
         (select orc.vendedor_id from public.orcamentos orc where orc.id = os.orcamento_id),
         (select c.vendedor_id from public.clientes c where c.id = os.cliente_id))
 where os.vendedor_id is null
   and coalesce(
         (select orc.vendedor_id from public.orcamentos orc where orc.id = os.orcamento_id),
         (select c.vendedor_id from public.clientes c where c.id = os.cliente_id)) is not null;

update public.ordens_servico os
   set responsavel_id = os.created_by
 where os.responsavel_id is null
   and os.created_by is not null;
