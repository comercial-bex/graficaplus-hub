-- Cada máquina cobra do seu jeito.
--
-- A i1600 recebeu 14 m²/h e passou a cobrar proporcional à metragem. Mas
-- m²/h só serve para a impressora. Aplicado nas outras três, erra tanto quanto
-- a hora cheia errava no banner:
--
--   CNC a laser   a peça é o PERCURSO, e a velocidade depende da chapa. Acrílico
--                 de 3 mm corta a 25 mm/s; de 10 mm, a 3 mm/s. Um único "mm/s
--                 da máquina" erraria por 8× entre os dois. Por isso a
--                 velocidade vira TABELA por material e espessura.
--
--   Recorte       a máquina corta 20 m de vinil em 30 segundos. O que custa é a
--                 DECAPAGEM — tirar o excesso à mão — que leva de 3 a 20 min por
--                 m² conforme o detalhe. Cobrar só o tempo de máquina esconde o
--                 maior custo do serviço.
--
--   Fiber         é por PEÇA: setup uma vez, depois marcar + trocar, n vezes.
--                 50 chaveiros não são "uma hora de máquina" — são 50 × 23 s.
--
-- Pesquisa que embasa os números (07/09/2026):
--   velocidades CO2 100W: gwklaser.com, tabela "best speed" a 90% de potência
--   potência real do CO2:  ~1,9 kW na tomada (fonte ~1 kW + chiller CW-5000
--                          0,6 kW + exaustor), não os 100 W do tubo
--   mercado brasileiro:    corte a laser cobrado por MINUTO, com mínimo de
--                          10 min (Quintal Laser, Brasília: R$ 180/h)
--   fiber:                 ~300 peças/h em marcação simples; fonte de 100.000 h
--   recorte:               precificação por metro linear; decapagem é a mão de
--                          obra dominante; lâmina dura 40–60 h de corte

-- ---------------------------------------------------------------------------
-- 1. Velocidade por material e espessura.
-- ---------------------------------------------------------------------------
create table if not exists public.maquinas_velocidades (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id) on delete cascade,
  operacao text not null default 'corte' check (operacao in ('corte','gravacao','marcacao')),
  material text not null,
  espessura_mm numeric not null default 0,
  velocidade_mm_s numeric not null check (velocidade_mm_s > 0),
  fonte text,
  observacao text,
  created_at timestamptz not null default now(),
  unique (maquina_id, operacao, material, espessura_mm)
);

comment on table public.maquinas_velocidades is
  'Velocidade por material e espessura. Um mm/s único por máquina erra por 8x entre acrílico de 3 mm e de 10 mm.';
comment on column public.maquinas_velocidades.fonte is
  'De onde veio o número. Velocidade de fabricante é ponto de partida; a oficina afina com o que a máquina faz de verdade.';

alter table public.maquinas_velocidades enable row level security;

drop policy if exists "velocidades leitura equipe" on public.maquinas_velocidades;
create policy "velocidades leitura equipe" on public.maquinas_velocidades
  for select using (public.is_staff((select auth.uid())));

drop policy if exists "velocidades escrita gestao" on public.maquinas_velocidades;
create policy "velocidades escrita gestao" on public.maquinas_velocidades
  for all using (public.has_role((select auth.uid()),'admin') or public.has_role((select auth.uid()),'gestor'))
  with check (public.has_role((select auth.uid()),'admin') or public.has_role((select auth.uid()),'gestor'));

grant select, insert, update, delete on public.maquinas_velocidades to authenticated;

-- Semente para o CO2 100W. "Best speed" e não "high": a rápida deixa rebarba
-- e não atravessa chapa grossa — peça que não atravessa é peça refeita.
insert into public.maquinas_velocidades (maquina_id, operacao, material, espessura_mm, velocidade_mm_s, fonte)
select m.id, v.op, v.mat, v.esp, v.vel, 'gwklaser.com — CO2 100W, best speed, 90% potência'
from public.maquinas m
cross join (values
  ('corte','acrilico',3,25),('corte','acrilico',5,10),('corte','acrilico',8,5),('corte','acrilico',10,3),
  ('corte','mdf',3,18),('corte','mdf',5,13),('corte','mdf',10,5),
  ('corte','couro',2,45),('corte','tecido',1,150),
  ('gravacao','geral',0,250)
) as v(op,mat,esp,vel)
where m.numero_serie = 'FD2D54'
on conflict (maquina_id, operacao, material, espessura_mm) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Cada máquina declara como cobra.
-- ---------------------------------------------------------------------------
alter table public.maquinas
  add column if not exists base_cobranca text not null default 'tempo'
    check (base_cobranca in ('area','tempo','peca','metro_linear')),
  add column if not exists tempo_minimo_min integer not null default 0,
  add column if not exists velocidade_mm_s numeric;

grant select (base_cobranca, tempo_minimo_min, velocidade_mm_s) on public.maquinas to authenticated;
grant insert (base_cobranca, tempo_minimo_min, velocidade_mm_s) on public.maquinas to authenticated;
grant update (base_cobranca, tempo_minimo_min, velocidade_mm_s) on public.maquinas to authenticated;

comment on column public.maquinas.base_cobranca is
  'Como esta máquina cobra: area (m²/h), tempo (traçado ÷ mm/s da tabela), peca (setup + n × marcar), metro_linear (traçado + decapagem).';
comment on column public.maquinas.tempo_minimo_min is
  'Mínimo cobrado por trabalho. Prática do mercado de laser: 10 min — ligar, focar e ventilar custam o mesmo para uma peça ou dez.';

-- Potência na TOMADA, não a do laser.
update public.maquinas set base_cobranca='area',         potencia_kw=1.0,  velocidade_m2_h=14                          where numero_serie='12608505';
update public.maquinas set base_cobranca='tempo',        potencia_kw=1.9,  tempo_minimo_min=10                         where numero_serie='FD2D54';
update public.maquinas set base_cobranca='metro_linear', potencia_kw=0.1,  velocidade_mm_s=800                         where modelo='VCUT120CAM';
update public.maquinas set base_cobranca='peca',         potencia_kw=0.5,  velocidade_mm_s=1000, tempo_minimo_min=5    where modelo='V30W20-LG';
update public.maquinas set base_cobranca='tempo',        potencia_kw=0.15                                              where nome='Bambu Lab A1';
