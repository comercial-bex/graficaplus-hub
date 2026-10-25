-- Acabamentos ligados ao produto, com custo de máquina e mão de obra (25/10/2026).
--
-- Pedido do dono: "eu escolho o produto, depois escolho o acabamento — se é na CNC, corte a laser,
-- recorte dedicado ou manual, que puxa a hora da máquina e a mão de obra, e quanto custa".
-- Hoje o acabamento é texto livre em orcamento_itens.acabamento e 2 produtos de serviço sem ligação
-- com os produtos a que se aplicam.
--
-- Esta migração cria o CADASTRO (acabamentos + produto_acabamentos) e a CONTA do custo. Escolher o
-- acabamento no orçamento (e virar linha cobrada) é a etapa seguinte; as tabelas já a sustentam.
-- Não toca em produtos, orçamentos nem nos 2 produtos de serviço (ainda usados em orçamentos).
--
-- Custo = material + máquina (min ÷ 60 × (R$/h + kW × tarifa)) + mão de obra (min ÷ 60 × R$/h com
-- encargos) + indireto (min de gente ÷ 60 × R$/h administrativo), as mesmas regras do custo cheio do
-- produto. Tempo ZERO não é custo zero: a função devolve o aviso do que falta.
-- Desfazer: DROP das duas tabelas e das duas funções.

CREATE TABLE IF NOT EXISTS public.acabamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  processo text NOT NULL CHECK (processo IN ('laser', 'cnc', 'recorte', 'manual', 'outro')),
  maquina_id uuid REFERENCES public.maquinas(id) ON DELETE SET NULL,
  base text NOT NULL CHECK (base IN ('m2', 'metro_linear', 'un', 'min')),
  minutos_maquina numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_maquina >= 0),
  minutos_mao_de_obra numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_mao_de_obra >= 0),
  material_id uuid REFERENCES public.materiais(id) ON DELETE SET NULL,
  material_qtd numeric(12,4) NOT NULL DEFAULT 0 CHECK (material_qtd >= 0),
  preco_venda numeric(12,2) CHECK (preco_venda IS NULL OR preco_venda >= 0),
  preco_parceiro numeric(12,2) CHECK (preco_parceiro IS NULL OR preco_parceiro >= 0),
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acabamentos IS 'Processos de acabamento (laser, CNC, recorte, manual) com o tempo de máquina e de gente POR UNIDADE DA BASE (m², metro linear, peça ou minuto).';

CREATE TABLE IF NOT EXISTS public.produto_acabamentos (
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  acabamento_id uuid NOT NULL REFERENCES public.acabamentos(id) ON DELETE CASCADE,
  obrigatorio boolean NOT NULL DEFAULT false,
  padrao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (produto_id, acabamento_id)
);
CREATE INDEX IF NOT EXISTS produto_acabamentos_acabamento_idx ON public.produto_acabamentos (acabamento_id);

ALTER TABLE public.acabamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produto_acabamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acab staff read" ON public.acabamentos;
CREATE POLICY "acab staff read" ON public.acabamentos FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));
DROP POLICY IF EXISTS "acab admin write" ON public.acabamentos;
CREATE POLICY "acab admin write" ON public.acabamentos FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role));
DROP POLICY IF EXISTS "prodacab staff read" ON public.produto_acabamentos;
CREATE POLICY "prodacab staff read" ON public.produto_acabamentos FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));
DROP POLICY IF EXISTS "prodacab admin write" ON public.produto_acabamentos;
CREATE POLICY "prodacab admin write" ON public.produto_acabamentos FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role));

-- A conta. A versão _interno não confere quem chama (só o banco usa); a pública exige financeiro.read.
CREATE OR REPLACE FUNCTION public.custo_do_acabamento_interno(p_acabamento uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; v_maq_custo numeric := 0; v_kw numeric := 0; v_setor text; v_maq_nome text;
  v_tarifa numeric := 0; v_admin numeric := 0;
  v_funcao text; v_mo_hora numeric; v_mo_enc numeric;
  v_mat_custo numeric := 0;
  v_material numeric := 0; v_maquina numeric := 0; v_mao numeric := 0; v_indireto numeric := 0;
  v_faltas text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO a FROM public.acabamentos WHERE id = p_acabamento;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acabamento não encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(max(valor), 0) INTO v_tarifa FROM public.custos_tabela WHERE ativo AND codigo = 'energia_tarifa_kwh';
  SELECT COALESCE(max(valor), 0) INTO v_admin FROM public.custos_tabela WHERE ativo AND codigo = 'custo_admin_hora';

  IF a.maquina_id IS NOT NULL THEN
    SELECT mq.nome, COALESCE(mq.custo_hora, 0), COALESCE(mq.potencia_kw, 0), mq.setor
      INTO v_maq_nome, v_maq_custo, v_kw, v_setor
      FROM public.maquinas mq WHERE mq.id = a.maquina_id;
    IF v_maq_custo <= 0 THEN
      v_faltas := array_append(v_faltas, 'máquina ' || COALESCE(v_maq_nome, '?') || ' sem custo por hora');
    END IF;
    v_maquina := (a.minutos_maquina / 60.0) * (v_maq_custo + v_kw * v_tarifa);
  ELSIF a.processo IN ('laser', 'cnc', 'recorte') THEN
    v_faltas := array_append(v_faltas, 'processo de máquina sem máquina escolhida');
  END IF;

  IF a.minutos_maquina <= 0 AND a.minutos_mao_de_obra <= 0 THEN
    v_faltas := array_append(v_faltas, 'sem tempo de máquina nem de mão de obra');
  ELSIF a.processo IN ('laser', 'cnc', 'recorte') AND a.minutos_mao_de_obra <= 0 THEN
    v_faltas := array_append(v_faltas, 'sem tempo de mão de obra (preparo, depuração, retirada)');
  END IF;

  SELECT cm.funcao, cm.custo_hora, COALESCE(cm.encargos_pct, 0)
    INTO v_funcao, v_mo_hora, v_mo_enc
    FROM public.custos_mao_de_obra cm
   WHERE cm.ativo
   ORDER BY (cm.setor IS NOT DISTINCT FROM COALESCE(v_setor, 'Acabamento')) DESC, cm.custo_hora DESC
   LIMIT 1;
  IF a.minutos_mao_de_obra > 0 THEN
    IF COALESCE(v_mo_hora, 0) <= 0 THEN
      v_faltas := array_append(v_faltas, 'sem custo de mão de obra cadastrado');
    ELSE
      v_mao := (a.minutos_mao_de_obra / 60.0) * v_mo_hora * (1 + v_mo_enc);
      IF v_mo_enc <= 0 THEN v_faltas := array_append(v_faltas, 'mão de obra sem encargos'); END IF;
    END IF;
    v_indireto := (a.minutos_mao_de_obra / 60.0) * v_admin;
  END IF;

  IF a.material_id IS NOT NULL AND a.material_qtd > 0 THEN
    SELECT COALESCE(mt.custo_medio, mt.custo_unitario, 0) INTO v_mat_custo FROM public.materiais mt WHERE mt.id = a.material_id;
    IF COALESCE(v_mat_custo, 0) <= 0 THEN v_faltas := array_append(v_faltas, 'material sem custo de compra'); END IF;
    v_material := a.material_qtd * COALESCE(v_mat_custo, 0);
  END IF;

  RETURN jsonb_build_object(
    'acabamento_id', a.id, 'nome', a.nome, 'base', a.base, 'processo', a.processo,
    'maquina', v_maq_nome, 'funcao', v_funcao,
    'custo_material', round(v_material, 4), 'custo_maquina', round(v_maquina, 4),
    'custo_mao_obra', round(v_mao, 4), 'custo_indireto', round(v_indireto, 4),
    'custo_total', round(v_material + v_maquina + v_mao + v_indireto, 4),
    'completo', (array_length(v_faltas, 1) IS NULL), 'faltas', to_jsonb(v_faltas)
  );
END $function$;
REVOKE ALL ON FUNCTION public.custo_do_acabamento_interno(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.custo_do_acabamento(p_acabamento uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'Seu perfil não pode ver custos.' USING ERRCODE = '42501';
  END IF;
  RETURN public.custo_do_acabamento_interno(p_acabamento);
END $function$;
REVOKE ALL ON FUNCTION public.custo_do_acabamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.custo_do_acabamento(uuid) TO authenticated;

-- Os cinco acabamentos de partida. Só entra tempo que o cadastro já afirma:
--   bainha + ilhós e laminação: tempo, material e preço dos dois produtos de serviço de hoje;
--   recorte eletrônico: 800 mm/s da plotter de recorte = 48 m/min = 0,0208 min por metro (a
--     depuração, retirar o excesso, NÃO está informada e o custo avisa);
--   laser e manual: cobrados por minuto, sem inventar a velocidade do corte.
INSERT INTO public.acabamentos (nome, processo, maquina_id, base, minutos_maquina, minutos_mao_de_obra, material_id, material_qtd, preco_venda, observacao)
SELECT 'Bainha + ilhós', 'manual', NULL, 'metro_linear', 0, 10, (SELECT id FROM public.materiais WHERE nome = 'Ilhós metálico'), 2, 9.00,
       'Do produto "Acabamento de lona (bainha + ilhós)": 10 min por metro e 2 ilhós.'
WHERE NOT EXISTS (SELECT 1 FROM public.acabamentos WHERE nome = 'Bainha + ilhós');
INSERT INTO public.acabamentos (nome, processo, maquina_id, base, minutos_maquina, minutos_mao_de_obra, material_id, material_qtd, preco_venda, observacao)
SELECT 'Laminação de adesivo', 'manual', NULL, 'm2', 0, 15, (SELECT id FROM public.materiais WHERE nome = 'Laminação polimérica'), 1.05, 28.00,
       'Do produto "Laminação de adesivo": 15 min por m² e 1,05 m² de laminação.'
WHERE NOT EXISTS (SELECT 1 FROM public.acabamentos WHERE nome = 'Laminação de adesivo');
INSERT INTO public.acabamentos (nome, processo, maquina_id, base, minutos_maquina, minutos_mao_de_obra, observacao)
SELECT 'Recorte eletrônico (plotter de recorte)', 'recorte', (SELECT id FROM public.maquinas WHERE nome LIKE 'Plotter de Recorte%' LIMIT 1), 'metro_linear', 0.0208, 0,
       'Máquina: 800 mm/s = 0,0208 min por metro. FALTA informar o tempo de depuração (retirar o excesso) e o custo/hora da plotter de recorte.'
WHERE NOT EXISTS (SELECT 1 FROM public.acabamentos WHERE nome = 'Recorte eletrônico (plotter de recorte)');
INSERT INTO public.acabamentos (nome, processo, maquina_id, base, minutos_maquina, minutos_mao_de_obra, observacao)
SELECT 'Corte a laser (CNC Laser)', 'laser', (SELECT id FROM public.maquinas WHERE nome LIKE 'CNC Laser%' LIMIT 1), 'min', 1, 1,
       'Cobrado por minuto de corte, com o operador acompanhando (1 min de gente por min de máquina). NUNCA cortar PVC no laser: libera cloro.'
WHERE NOT EXISTS (SELECT 1 FROM public.acabamentos WHERE nome = 'Corte a laser (CNC Laser)');
INSERT INTO public.acabamentos (nome, processo, maquina_id, base, minutos_maquina, minutos_mao_de_obra, observacao)
SELECT 'Acabamento manual (mão de obra)', 'manual', NULL, 'min', 0, 1,
       'Cobrado por minuto de mão de obra: refile, colagem, montagem.'
WHERE NOT EXISTS (SELECT 1 FROM public.acabamentos WHERE nome = 'Acabamento manual (mão de obra)');

-- Quais produtos aceitam cada acabamento (ponto de partida; editável na tela).
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id, padrao)
SELECT p.id, a.id, (a.nome = 'Bainha + ilhós')
  FROM public.produtos p JOIN public.acabamentos a ON a.nome = 'Bainha + ilhós'
 WHERE p.nome IN ('Lona 280g impressa', 'Lona 440g reforçada impressa', 'Banner com bastão e corda', 'Fachada luminosa em lona')
ON CONFLICT DO NOTHING;
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id)
SELECT p.id, a.id
  FROM public.produtos p JOIN public.acabamentos a ON a.nome = 'Laminação de adesivo'
 WHERE p.nome IN ('Adesivo vinil branco impresso', 'Adesivo vinil recortado', 'Adesivo jateado')
ON CONFLICT DO NOTHING;
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id)
SELECT p.id, a.id
  FROM public.produtos p JOIN public.acabamentos a ON a.nome = 'Recorte eletrônico (plotter de recorte)'
 WHERE p.nome IN ('Adesivo vinil branco impresso', 'Adesivo vinil recortado')
ON CONFLICT DO NOTHING;
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id)
SELECT p.id, a.id
  FROM public.produtos p JOIN public.acabamentos a ON a.nome = 'Corte a laser (CNC Laser)'
 WHERE p.nome LIKE 'Acrílico%' OR p.nome = 'Quadro Acrilico'
ON CONFLICT DO NOTHING;
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id)
SELECT p.id, a.id
  FROM public.produtos p JOIN public.acabamentos a ON a.nome = 'Acabamento manual (mão de obra)'
 WHERE p.nome LIKE 'Placa%' OR p.nome IN ('Letra caixa em PVC', 'Fachada luminosa em lona', 'Quadro Acrilico')
ON CONFLICT DO NOTHING;
