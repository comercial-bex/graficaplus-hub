-- Três buracos pequenos que sobraram do mesmo padrão.
--
-- Depois de dar dono ao orçamento e à OS, o que restou de chave vazia se divide
-- em três grupos: cadastro que só você pode preencher (máquina do produto),
-- vínculo que espera uso real (lead do orçamento) — e estes aqui, que são
-- defeito de origem e dá para fechar agora.
--
-- Sobre a auditoria, uma correção ao diagnóstico: `logs_auditoria` com 4,8% de
-- autoria NÃO é caminho quebrado. Medido por entidade:
--
--   perfil_permissoes  34 inserts   0 autores   <- minhas migrações, sem sessão
--   pagamentos          5 registros 5 autores   <- app com sessão, funcionou
--
-- O gatilho de auditoria usa `auth.uid()` e grava certo sempre que há sessão. O
-- número baixo é o meu próprio tráfego de migração diluindo a conta. Não há o
-- que consertar ali.

-- ---------------------------------------------------------------------------
-- 1. O cliente também nasce sem autor.
--
-- Mesmo padrão do orçamento e da OS: a tela de clientes não grava `created_by`.
-- São 4 clientes, nenhum com autor.
-- ---------------------------------------------------------------------------
create or replace function public.tg_carimbar_autor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

comment on function public.tg_carimbar_autor is
  'Carimba `created_by` com quem está criando, quando a tela esquece. Genérico de propósito: o padrão se repetiu em orçamento, OS e cliente.';

drop trigger if exists tg_cliente_tem_autor on public.clientes;
create trigger tg_cliente_tem_autor
  before insert on public.clientes
  for each row execute function public.tg_carimbar_autor();

-- ---------------------------------------------------------------------------
-- 2. Quem mexeu na tarifa?
--
-- `config_precificacao_3d.atualizado_por`, `empresa_config.atualizado_por` e
-- `notificacao_templates.atualizado_por` estão todos vazios. São as tabelas de
-- CONFIGURAÇÃO: mudar a tarifa de energia ou o markup padrão altera o preço de
-- tudo que for orçado depois.
--
-- Uma alteração dessas sem autor é a que mais dói de investigar depois — o
-- preço mudou, ninguém sabe quando nem por quem, e o registro de auditoria da
-- linha não diz porque a coluna existe justamente para isso e estava vazia.
-- ---------------------------------------------------------------------------
create or replace function public.tg_carimbar_quem_atualizou()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  new.atualizado_em := now();
  return new;
end;
$$;

comment on function public.tg_carimbar_quem_atualizou is
  'Carimba quem alterou a configuração. Mudança de tarifa ou markup muda o preço de tudo que for orçado depois — sem autor, não há como investigar.';

drop trigger if exists tg_config_3d_quem_atualizou on public.config_precificacao_3d;
create trigger tg_config_3d_quem_atualizou
  before update on public.config_precificacao_3d
  for each row execute function public.tg_carimbar_quem_atualizou();

-- ---------------------------------------------------------------------------
-- 3. A conta a receber do 3D não sabia de qual orçamento veio.
--
-- `converter_orcamento_em_os` grava `orcamento_id` na conta; a conversão 3D não.
-- Mesmo defeito de mão única que a OS tinha, um nível abaixo: a cobrança existe
-- e não aponta para o que foi vendido.
-- ---------------------------------------------------------------------------
create or replace function public.tg_conta_receber_herda_orcamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.orcamento_id is null and new.os_id is not null then
    new.orcamento_id := (select o.orcamento_id from public.ordens_servico o where o.id = new.os_id);
  end if;
  return new;
end;
$$;

comment on function public.tg_conta_receber_herda_orcamento is
  'A cobrança herda o orçamento da OS. A conversão 2D já gravava; a 3D não, e a conta ficava sem apontar para o que foi vendido.';

drop trigger if exists tg_conta_receber_herda_orcamento on public.contas_receber;
create trigger tg_conta_receber_herda_orcamento
  before insert on public.contas_receber
  for each row execute function public.tg_conta_receber_herda_orcamento();

-- Conserta o que já existe.
update public.contas_receber cr
   set orcamento_id = o.orcamento_id
  from public.ordens_servico o
 where o.id = cr.os_id
   and cr.orcamento_id is null
   and o.orcamento_id is not null;
