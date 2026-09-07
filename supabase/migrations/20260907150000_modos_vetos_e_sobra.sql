-- Três buracos que sobraram da rodada de bases de cobrança.
--
--   1. MODO DE QUALIDADE      14 m²/h é o modo de produção. Em alta qualidade a
--                             mesma máquina faz 7 — o dobro do tempo, o dobro do
--                             custo de máquina. O sistema usava 14 sempre.
--
--   2. MATERIAL QUE NÃO PODE  o CO2 não corta ACM (miolo de alumínio) e NÃO PODE
--                             cortar PVC: o laser quebra a molécula e libera
--                             cloro, que corrode os trilhos e a óptica e é
--                             tóxico. Hoje o sistema apenas dizia "sem
--                             velocidade cadastrada" — a mesma mensagem de um
--                             material que ninguém mediu ainda. Perigo e falta
--                             de cadastro não podem ter a mesma cara.
--
--   3. SOBRA DE AVANÇO        toda impressão puxa material antes e depois do
--                             trabalho. Uma tira de 20 cm não gasta 20 cm de
--                             rolo. O aproveitamento cuidava da largura e
--                             ignorava o comprimento perdido.

-- ---------------------------------------------------------------------------
-- 1. Modos de impressão.
--
-- O tempo de impressão é inversamente proporcional ao número de passadas: o
-- carro percorre a mesma área n vezes. Por isso os modos abaixo são DERIVADOS
-- dos 14 m²/h medidos na casa, e não copiados de folheto — 14 é o modo de 4
-- passadas, então 2 passadas fazem o dobro e 8 fazem metade.
--
-- É uma proporção física, não um chute; mas continua sendo derivação. Meça um
-- trabalho em cada modo e ajuste na tela da máquina.
-- ---------------------------------------------------------------------------
create table if not exists public.maquinas_modos_impressao (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id) on delete cascade,
  nome text not null,
  velocidade_m2_h numeric not null check (velocidade_m2_h > 0),
  passadas integer,
  padrao boolean not null default false,
  ordem integer not null default 0,
  observacao text,
  created_at timestamptz not null default now(),
  unique (maquina_id, nome)
);

comment on table public.maquinas_modos_impressao is
  'Modos de qualidade da impressora. Mais passadas = mais tempo: usar sempre o modo de produção subestima o trabalho caprichado em 2 a 4 vezes.';

-- Um modo padrão por máquina. Sem isto, dois padrões e o orçamento escolhe o
-- primeiro que vier — arbitrário em silêncio, que é o padrão de falha nº 2
-- desta base.
create unique index if not exists maquinas_modos_um_padrao
  on public.maquinas_modos_impressao (maquina_id) where padrao;

alter table public.maquinas_modos_impressao enable row level security;

drop policy if exists "modos leitura equipe" on public.maquinas_modos_impressao;
create policy "modos leitura equipe" on public.maquinas_modos_impressao
  for select using (public.is_staff((select auth.uid())));

drop policy if exists "modos escrita gestao" on public.maquinas_modos_impressao;
create policy "modos escrita gestao" on public.maquinas_modos_impressao
  for all using (public.has_role((select auth.uid()),'admin') or public.has_role((select auth.uid()),'gestor'))
  with check (public.has_role((select auth.uid()),'admin') or public.has_role((select auth.uid()),'gestor'));

grant select, insert, update, delete on public.maquinas_modos_impressao to authenticated;

insert into public.maquinas_modos_impressao (maquina_id, nome, velocidade_m2_h, passadas, padrao, ordem, observacao)
select m.id, v.nome, v.vel, v.pass, v.padrao, v.ordem, v.obs
from public.maquinas m
cross join (values
  ('Rascunho',       28.0, 2, false, 1, 'Lona de fachada, leitura de longe'),
  ('Produção',       14.0, 4, true,  2, 'Padrão da casa — a velocidade medida'),
  ('Qualidade',       9.3, 6, false, 3, 'Adesivo de vitrine, leitura de perto'),
  ('Alta qualidade',  7.0, 8, false, 4, 'Fotográfico, backlit')
) as v(nome, vel, pass, padrao, ordem, obs)
where m.numero_serie = '12608505'
on conflict (maquina_id, nome) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Material que a máquina não pode cortar.
--
-- Veto não é ausência de dado. "Não medimos ainda" e "isso corrói a sua máquina
-- e libera gás tóxico" são coisas diferentes, e antes desta migração as duas
-- apareciam na tela com a mesma frase.
-- ---------------------------------------------------------------------------
alter table public.maquinas_velocidades
  add column if not exists vetado boolean not null default false,
  add column if not exists motivo text;

comment on column public.maquinas_velocidades.vetado is
  'Material que esta máquina NÃO pode processar. O orçamento recusa com o motivo, em vez de pedir o tempo à mão.';

-- Velocidade fica em 1 nas linhas vetadas só para satisfazer o CHECK > 0: ela
-- nunca é lida, porque `vetado` corta o caminho antes.
insert into public.maquinas_velocidades (maquina_id, operacao, material, espessura_mm, velocidade_mm_s, vetado, motivo, fonte)
select m.id, 'corte', v.mat, 0, 1, true, v.motivo, 'regra de segurança do processo'
from public.maquinas m
cross join (values
  ('pvc',            'PVC no laser libera cloro: corrói os trilhos e a óptica da máquina e é tóxico para quem está na sala. Corte com faca, tupia ou serra.'),
  ('pvc expandido',  'PVC expandido (Forex, Sintra) é PVC: libera cloro no laser. Corte com tupia, serra ou estilete.'),
  ('acm',            'ACM é miolo de polietileno entre duas chapas de ALUMÍNIO — laser de CO2 não corta metal. Use tupia/router ou guilhotina com fresa em V.'),
  ('abs',            'ABS derrete em vez de cortar e libera cianeto de hidrogênio. Troque por acrílico ou PS.'),
  ('policarbonato',  'Policarbonato absorve mal o CO2: a borda sai amarela e queimada. Troque por acrílico.')
) as v(mat, motivo)
where m.numero_serie = 'FD2D54'
on conflict (maquina_id, operacao, material, espessura_mm) do nothing;

-- Poliestireno o CO2 corta bem, mas o fabricante não publica a linha. Fica
-- semeado com a FONTE dizendo que é estimativa: número de partida para medir,
-- não número para confiar.
insert into public.maquinas_velocidades (maquina_id, operacao, material, espessura_mm, velocidade_mm_s, fonte)
select m.id, 'corte', 'ps', v.esp, v.vel, 'estimativa por analogia com acrílico — MEDIR e corrigir'
from public.maquinas m
cross join (values (1,40),(2,30),(3,20)) as v(esp, vel)
where m.numero_serie = 'FD2D54'
on conflict (maquina_id, operacao, material, espessura_mm) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Sobra de avanço.
--
-- O rolo avança antes de a impressão começar (para a cabeça pegar o material) e
-- de novo depois que ela termina (para dar espaço de corte). São centímetros
-- por trabalho, e em pedido de peça pequena viram a maior parte do consumo:
-- 20 cm de avanço numa tira de 20 cm é 100% de sobra.
-- ---------------------------------------------------------------------------
alter table public.maquinas
  add column if not exists avanco_m numeric not null default 0;

comment on column public.maquinas.avanco_m is
  'Metros lineares perdidos por trabalho no carregamento e no corte. Some ao comprimento consumido — não à área impressa.';

grant select (avanco_m) on public.maquinas to authenticated;
grant insert (avanco_m) on public.maquinas to authenticated;
grant update (avanco_m) on public.maquinas to authenticated;

update public.maquinas set avanco_m = 0.20 where numero_serie = '12608505' and avanco_m = 0;
