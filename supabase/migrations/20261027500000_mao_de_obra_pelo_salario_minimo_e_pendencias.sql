-- 27/10/2026 — mão de obra pelo salário mínimo, vencimento da parcela e abertura do estoque.
--
-- 1) MÃO DE OBRA. O módulo 3D estava em R$ 40/h com 0% de encargos (padrão que veio de fábrica) e as 5
--    funções do 2D em R$ 10,65/h (média nacional de impressor, R$ 2.342, ÷ 220 h). O dono pediu a regra
--    da casa: salário mínimo ÷ horas realmente trabalhadas, com os encargos.
--      salário mínimo 2026 (Decreto 12.797/2025) ........................ R$ 1.621,00
--      horas do mês: 8 h/dia (10 h na casa − 2 h de almoço) × 22 dias úteis = 176 h
--      encargos do Simples Nacional (FGTS 8% + 13º 8,33% + férias e 1/3 11,11%
--        + FGTS sobre 13º e férias 1,55% + provisão de rescisão 3,2%) ... 32,19%
--      salário-hora = 1.621 ÷ 176 = R$ 9,2102; custo real da hora = × 1,3219 = R$ 12,17
--    (Contra R$ 14,08 do critério de 220 h com a média nacional, e R$ 40,00 do padrão de fábrica.)
--    Fora do Simples entram INSS patronal, RAT e terceiros (+27,8%): a calculadora da tela marca por regime.
--    Salário real de cada pessoa substitui o mínimo: `salario_mensal` e `horas_mensais` agora moram na
--    função (uma linha por função OU por pessoa) e o custo/hora é salário ÷ horas.
-- 2) A parcela sem vencimento (por desenho: "vence na saída do pedido") passa a vencer no PRAZO de entrega
--    da OS quando ele existe. Sem prazo ela segue sem data — o defeito é a OS sem prazo.
-- 3) As OS abertas sem prazo ganham o prazo padrão (criação + 5 dias úteis) SÓ quando essa data ainda não
--    passou; as que já passariam ficam sem prazo, para quem fala com o cliente dizer o prazo real.
-- 4) Quatro materiais cadastrados com "saldo informado" tinham lote mas nenhuma movimentação: o livro de
--    Movimentações não os mostrava. Entra a movimentação de abertura (custo 0: não mexe no custo médio).

ALTER TABLE public.custos_mao_de_obra ADD COLUMN IF NOT EXISTS salario_mensal numeric;
ALTER TABLE public.custos_mao_de_obra ADD COLUMN IF NOT EXISTS horas_mensais numeric;

-- Só troca o que ainda é a estimativa de 25/10 (R$ 10,65/h): salário real digitado depois não é sobrescrito.
UPDATE public.custos_mao_de_obra
   SET salario_mensal = 1621,
       horas_mensais = 176,
       custo_hora = round(1621.0 / 176, 4),
       encargos_pct = 0.3219,
       observacoes = 'Provisório, sobre o salário mínimo de 2026 (R$ 1.621, Decreto 12.797/2025) ÷ 176 h (8 h/dia × 22 dias úteis) = R$ 9,21/h, com 32,19% de encargos do Simples = R$ 12,17/h. Substituir pelo salário real da pessoa ou da função.'
 WHERE ativo AND custo_hora = 10.65 AND COALESCE(salario_mensal, 0) = 0;

UPDATE public.custos_tabela SET valor = round(1621.0 / 176, 4) WHERE codigo = 'mo_custo_hora' AND valor = 10.65;

-- Módulo 3D: `mo_custo_hora_padrao` é o custo cheio (a calculadora usa o valor como está).
UPDATE public.config_precificacao_3d
   SET mo_salario_mensal = 1621, mo_horas_mensais = 176, mo_encargos_pct = 32.19,
       mo_custo_hora_padrao = round(1621.0 * 1.3219 / 176, 2),
       atualizado_em = now()
 WHERE mo_custo_hora_padrao = 40 AND COALESCE(mo_encargos_pct, 0) = 0;

DO $r$
DECLARE x record;
BEGIN
  FOR x IN SELECT id FROM public.produtos LOOP
    PERFORM public.sincronizar_precificacao_do_produto(x.id);
  END LOOP;
END $r$;

UPDATE public.decisoes_pendentes
   SET resolvida_em = now(),
       resposta = 'R$ 40/h estava errado. Mão de obra = salário mínimo 2026 (R$ 1.621) ÷ 176 h (8 h × 22 dias úteis) com 32,19% de encargos do Simples = R$ 12,17/h, no 2D e no 3D. Provisório: vale o salário real de cada pessoa quando for informado (decisão do dono, 27/10/2026).'
 WHERE chave = 'mao_de_obra_3d_40_por_hora' AND resolvida_em IS NULL;

-- 2) vencimento da parcela = prazo da OS -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.somar_dias_uteis(p_data date, p_dias integer)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
AS $f$
DECLARE d date := p_data; n integer := 0;
BEGIN
  WHILE n < p_dias LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $f$;

CREATE OR REPLACE FUNCTION public.tg_parcela_nasce_com_o_prazo_da_os()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $f$
BEGIN
  IF NEW.vencimento IS NULL THEN
    SELECT o.prazo_entrega INTO NEW.vencimento
      FROM public.contas_receber c JOIN public.ordens_servico o ON o.id = c.os_id
     WHERE c.id = NEW.conta_id;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS tg_parcela_nasce_com_o_prazo_da_os ON public.parcelas_receber;
CREATE TRIGGER tg_parcela_nasce_com_o_prazo_da_os BEFORE INSERT ON public.parcelas_receber
  FOR EACH ROW EXECUTE FUNCTION public.tg_parcela_nasce_com_o_prazo_da_os();

CREATE OR REPLACE FUNCTION public.tg_os_prazo_vira_vencimento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $f$
BEGIN
  UPDATE public.parcelas_receber p
     SET vencimento = NEW.prazo_entrega
    FROM public.contas_receber cr
   WHERE cr.os_id = NEW.id AND p.conta_id = cr.id
     AND p.vencimento IS NULL AND p.status <> 'paga';
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS tg_os_prazo_vira_vencimento ON public.ordens_servico;
CREATE TRIGGER tg_os_prazo_vira_vencimento AFTER UPDATE OF prazo_entrega ON public.ordens_servico
  FOR EACH ROW WHEN (NEW.prazo_entrega IS NOT NULL AND OLD.prazo_entrega IS DISTINCT FROM NEW.prazo_entrega)
  EXECUTE FUNCTION public.tg_os_prazo_vira_vencimento();

-- 3) prazo padrão só onde ele ainda é verdadeiro -----------------------------------------------------
UPDATE public.ordens_servico o
   SET prazo_entrega = public.somar_dias_uteis(o.created_at::date, 5)
 WHERE o.finalidade::text = 'venda'
   AND o.status::text NOT IN ('concluido', 'faturado', 'cancelado')
   AND o.prazo_entrega IS NULL
   AND public.somar_dias_uteis(o.created_at::date, 5) >= (now() AT TIME ZONE 'America/Belem')::date;

-- 4) abertura dos materiais cadastrados com saldo -----------------------------------------------------
INSERT INTO public.movimentacoes_estoque (material_id, lote_id, tipo, quantidade, unidade, custo_unitario_snapshot, origem, motivo, created_at)
SELECT l.material_id, l.id, 'entrada', l.quantidade, l.unidade, 0, 'inventario',
       'Abertura: saldo informado no cadastro do material (movimentação registrada em 27/10/2026)', l.created_at
  FROM public.material_lotes l
 WHERE l.codigo = 'ABERTURA'
   AND l.observacao ILIKE 'Saldo informado no cadastro%'
   AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque m WHERE m.lote_id = l.id);
