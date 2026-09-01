-- Aproveitamento de bobina: onde guardar as larguras.
--
-- Nada no banco sabia a largura de impressão da máquina nem a largura da bobina.
-- Sem esses dois números não dá para responder a pergunta que a produção faz
-- todo dia — quantas peças saem por fileira e quantos metros lineares o pedido
-- consome — e é dessa conta que sai o m² de bobina que o catálogo cobra.

-- ---------------------------------------------------------------------------
-- Máquina: a boca de impressão e a margem que ela não alcança.
-- ---------------------------------------------------------------------------
alter table public.maquinas
  add column if not exists largura_util_m numeric(6,3),
  add column if not exists margem_lateral_m numeric(6,3) not null default 0.010;

comment on column public.maquinas.largura_util_m is
  'Boca de impressão em metros. Ex.: 1.800 numa i1600 de 1,80 m.';
comment on column public.maquinas.margem_lateral_m is
  'Margem de cada lado que a impressora não alcança. Entra duas vezes na conta.';

-- ---------------------------------------------------------------------------
-- Material: a bobina que está carregada.
--
-- O gargalo real é o MENOR entre a boca da máquina e a largura da bobina: uma
-- máquina de 1,80 m com bobina de 1,06 m imprime 1,06 m.
-- ---------------------------------------------------------------------------
alter table public.materiais
  add column if not exists largura_bobina_m numeric(6,3),
  add column if not exists comprimento_bobina_m numeric(8,2);

comment on column public.materiais.largura_bobina_m is
  'Largura do rolo em metros. 1,06 é a medida padrão de vinil adesivo no mercado.';
comment on column public.materiais.comprimento_bobina_m is
  'Metros lineares por rolo fechado. Serve para saber quantos rolos o pedido consome.';

-- ---------------------------------------------------------------------------
-- Produto: o espaço que a faca precisa entre uma peça e a vizinha.
--
-- É do produto, não da máquina: recorte no contorno pede mais folga que corte
-- reto, e o catálogo entrega tudo recortado.
-- ---------------------------------------------------------------------------
alter table public.produtos
  add column if not exists espacamento_pecas_m numeric(6,3) not null default 0.003;

comment on column public.produtos.espacamento_pecas_m is
  'Folga entre peças para o recorte, em metros. Padrão 3 mm.';

-- ---------------------------------------------------------------------------
-- Larguras das bobinas que a operação já usa.
-- 1,06 m é a medida de mercado do vinil adesivo; a lona vem em 1,60 m.
-- Rolo de 50 m é o fechamento padrão do fornecedor.
-- ---------------------------------------------------------------------------
update public.materiais set largura_bobina_m = 1.060, comprimento_bobina_m = 50
 where nome in ('Vinil adesivo branco brilho', 'Vinil adesivo perfurado', 'Vinil jateado')
   and largura_bobina_m is null;

update public.materiais set largura_bobina_m = 1.600, comprimento_bobina_m = 50
 where nome in ('Lona 280g brilho', 'Lona 440g reforçada')
   and largura_bobina_m is null;

update public.materiais set largura_bobina_m = 1.060, comprimento_bobina_m = 50
 where nome = 'Laminação polimérica' and largura_bobina_m is null;

-- ---------------------------------------------------------------------------
-- Sai a marca do cálculo abandonado.
--
-- `conta_no_limite_carroceria` foi criada na migração anterior para responder
-- "cabem N peças por veículo". Era a pergunta errada: o limite de 0,5 m² é
-- regra de APLICAÇÃO no carro do eleitor, e virar número na tela sugeria uma
-- recomendação de venda que não existe — na prática vai um adesivo por carro.
-- Quem pergunta "quantas saem" está perguntando de produção, e isso agora é
-- respondido pelo aproveitamento de bobina. A restrição legal continua, em
-- texto, no campo `exigencias` do produto.
--
-- Coluna sem uso vira armadilha: alguém lê o nome e supõe que ela decide algo.
-- ---------------------------------------------------------------------------
alter table public.produtos drop column if exists conta_no_limite_carroceria;

-- ---------------------------------------------------------------------------
-- A máquina da operação. Largura informada pelo dono (boca de 1,80 m); modelos
-- i1600 existem em 1,60 e 1,80, então o campo fica editável na tela de Máquinas.
-- ---------------------------------------------------------------------------
insert into public.maquinas (nome, tipo, ativa, largura_util_m, margem_lateral_m, setor)
select 'Wizer i1600 — eco-solvente', 'plotter_impressao', true, 1.800, 0.010, 'impressao'
where not exists (select 1 from public.maquinas where nome like 'Wizer i1600%');

-- Cada produto do catálogo ligado à bobina que consome: é daí que a conta de
-- aproveitamento tira a largura.
update public.produtos p set material_principal_id = m.id
from public.materiais m
where m.nome = 'Vinil adesivo perfurado'
  and p.nome in ('Adesivo Perfurado 90 × 33 cm', 'Adesivo Perfurado 90 × 50 cm')
  and p.material_principal_id is null;

update public.produtos p set material_principal_id = m.id
from public.materiais m
where m.nome = 'Vinil adesivo branco brilho'
  and p.nome in ('Adesivo Praguinha 7 × 7 cm', 'Adesivo Praguinha 10 × 10 cm',
                 'Bolão Leitoso 48 × 48 cm', 'Bola Leitoso 33 × 33 cm',
                 'Pragão 15 × 15 cm', 'Pragão 30 × 30 cm', 'Testeira 90 × 12 cm')
  and p.material_principal_id is null;
