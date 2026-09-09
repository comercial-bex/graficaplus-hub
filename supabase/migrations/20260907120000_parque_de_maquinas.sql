-- Cadastro real do parque de máquinas.
--
-- Hoje `maquinas` guarda só o que a produção precisa para calcular (largura
-- útil, custo/hora, potência) e nada do que identifica o equipamento: modelo,
-- fabricante, número de série, foto. Quem abre a tela vê "Wizer i1600" e não
-- sabe se é a que está na sala ou outra.
--
-- Duas separações importam aqui.
--
-- 1) FOTO E FICHA vão em `maquinas`, que a equipe toda lê. São dados de
--    operação: saber qual é a máquina e o que ela faz.
--
-- 2) CONTRATO E VALOR vão para tabela separada, com RLS de financeiro.
--    `maquinas` é legível por `is_staff` — ou seja, operador e designer também.
--    Gravar ali o valor da parcela e o total financiado entregaria o custo do
--    parque a quem não precisa dele, e essa separação é o padrão que o resto do
--    sistema já usa (produto_precos, os_resultados_financeiros).

alter table public.maquinas
  add column if not exists fabricante text,
  add column if not exists modelo text,
  add column if not exists numero_serie text,
  add column if not exists imagem_url text,
  -- jsonb, e não vinte colunas: a ficha de uma fresa a laser não se parece com
  -- a de um plotter de recorte, e criar coluna para cada especificação
  -- transformaria a tabela num formulário de um fabricante só.
  add column if not exists especificacoes jsonb not null default '{}'::jsonb;

comment on column public.maquinas.numero_serie is
  'Identificador do equipamento no fabricante (a Vuze chama de "neurônio"). É por ele que se abre chamado de garantia.';
comment on column public.maquinas.especificacoes is
  'Ficha técnica em formato livre. Cada tipo de máquina tem a sua — laser fala em tubo e área de gravação, plotter em força de corte.';

grant select (fabricante, modelo, numero_serie, imagem_url, especificacoes) on public.maquinas to authenticated;
grant insert (fabricante, modelo, numero_serie, imagem_url, especificacoes) on public.maquinas to authenticated;
grant update (fabricante, modelo, numero_serie, imagem_url, especificacoes) on public.maquinas to authenticated;

-- ---------------------------------------------------------------------------
-- Contrato do equipamento — só para quem vê dinheiro.
-- ---------------------------------------------------------------------------
create table if not exists public.maquinas_contrato (
  maquina_id uuid primary key references public.maquinas(id) on delete cascade,
  numero_contrato text,
  numero_negociacao text,
  condicao_comercial text,
  tipo_venda text,
  parcelas integer,
  valor_parcela numeric(12,2),
  valor_total numeric(12,2),
  entrada_valor numeric(12,2),
  entrada_forma text,
  creditos integer,
  ultima_conexao timestamptz,
  observacoes text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id)
);

comment on table public.maquinas_contrato is
  'Contrato e custo de cada equipamento. Separado de `maquinas` porque aquela é lida por toda a equipe e isto é dado financeiro.';

alter table public.maquinas_contrato enable row level security;

drop policy if exists "contrato maquina leitura financeira" on public.maquinas_contrato;
create policy "contrato maquina leitura financeira" on public.maquinas_contrato
  for select using (public.has_permission((select auth.uid()), 'financeiro.read'));

drop policy if exists "contrato maquina escrita admin" on public.maquinas_contrato;
create policy "contrato maquina escrita admin" on public.maquinas_contrato
  for all using (
    public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor')
  ) with check (
    public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor')
  );

grant select, insert, update, delete on public.maquinas_contrato to authenticated;

drop trigger if exists tg_contrato_maquina_quem_atualizou on public.maquinas_contrato;
create trigger tg_contrato_maquina_quem_atualizou
  before update on public.maquinas_contrato
  for each row execute function public.tg_carimbar_quem_atualizou();

-- ---------------------------------------------------------------------------
-- Bucket das fotos.
--
-- PÚBLICO, ao contrário dos outros do projeto. Foto de equipamento não é dado
-- de cliente: ela aparece em lista, em card e no seletor, e exigir URL assinada
-- em cada render trocaria um risco que não existe por lentidão que existe.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('maquinas-fotos', 'maquinas-fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "foto maquina leitura publica" on storage.objects;
create policy "foto maquina leitura publica" on storage.objects
  for select using (bucket_id = 'maquinas-fotos');

drop policy if exists "foto maquina escrita gestao" on storage.objects;
create policy "foto maquina escrita gestao" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'maquinas-fotos'
    and (public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor'))
  );

drop policy if exists "foto maquina troca gestao" on storage.objects;
create policy "foto maquina troca gestao" on storage.objects
  for update to authenticated using (
    bucket_id = 'maquinas-fotos'
    and (public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor'))
  );
