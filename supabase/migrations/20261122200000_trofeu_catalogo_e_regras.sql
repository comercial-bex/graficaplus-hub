-- =====================================================================================================
-- ORÇAMENTO DE TROFÉU DE ACRÍLICO: O CATÁLOGO DE MODELOS E AS REGRAS DE PREÇO (22/11/2026)
--
-- O pedido do dono. Precificar troféu de acrílico (JariCross econômico, JariCross em duas camadas, KR Combat
-- premium), como o orçamento de 3D: modelo pronto, altura, quantidade e arte, e o sistema calcula. A regra de preço
-- é o ×3 sobre o custo cheio, com desconto por quantidade (×3, ×2,7, ×2,4 e ×2,2 de piso), ×3,5 no premium
-- exclusivo e ×4 só na urgência. A conta é `src/domain/trofeus/conta.ts` (função pura, 40 testes).
--
-- O que esta migração instala (NADA aqui calcula preço; isso é do servidor, no PR seguinte):
--   trofeu_regras   uma linha só: escada de quantidade, piso, urgência, limites de altura, parâmetros do processo
--                   (tinta, cola, gravação, preparo do laser, velocidade de corte) e as regras da arte.
--   trofeu_modelos  o catálogo: nome, linha, altura de referência, minutos de mão de obra, multiplicador da linha.
--   trofeu_pecas    as peças de cada modelo: material, espessura, medida na altura de referência, quantas iguais,
--                   fator de forma do contorno e decoração.
--
-- O que é PROVISÓRIO (as medidas das peças saem das imagens do dono, os tempos são estimados, a velocidade de corte
-- do laser e o consumo de tinta ainda não foram medidos): a coluna `provisorio` do modelo e a lista
-- `trofeu_regras.provisorios` dizem o quê, para a tela avisar. O custo do acrílico espelhado dourado também é
-- provisório: não há nota de compra dele (custo médio R$ 87,09 contra unitário R$ 174,18).
--
-- Quem lê o quê. Modelos e peças: qualquer funcionário (não têm custo). Regras: só quem vê financeiro, porque os
-- multiplicadores são a estratégia de preço; o servidor lê com a chave de serviço para calcular o preço do vendedor.
-- Quem escreve: admin e gestor. `anon` não tem acesso a nada. As três tabelas passam pela auditoria (`tg_auditar`).
--
-- Nenhuma função nova (nada a fechar com REVOKE de função). Ensaio no banco vivo, desfeito por RAISE EXCEPTION:
-- docs/ensaio-trofeu-catalogo-e-regras-22-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Guardas: nada disto existe ainda, e os materiais do seed estão no cadastro, um de cada
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_nome text;
BEGIN
  IF to_regclass('public.trofeu_regras') IS NOT NULL OR to_regclass('public.trofeu_modelos') IS NOT NULL
     OR to_regclass('public.trofeu_pecas') IS NOT NULL THEN
    RAISE EXCEPTION 'as tabelas de troféu já existem: releia antes de criar';
  END IF;
  FOREACH v_nome IN ARRAY ARRAY['ACRILICO CRISTAL VIRGEM 2MM', 'ACRILICO CRISTAL VIRGEM 3MM', 'ACRILICO CRISTAL VIRGEM 6MM',
                                'ACRILICO PRETO VIRGEM 3MM', 'Acrilico esp dourado 2mm'] LOOP
    IF (SELECT count(*) FROM public.materiais WHERE nome = v_nome) <> 1 THEN
      RAISE EXCEPTION 'esperava um material %, achei outro número', v_nome;
    END IF;
  END LOOP;
  IF (SELECT custo_unitario FROM public.materiais WHERE nome = 'ACRILICO PRETO VIRGEM 3MM') <> 194.50 THEN
    RAISE EXCEPTION 'o preto 3 mm não está a R$ 194,50: aplique antes a migração 20261122100000';
  END IF;
  IF to_regprocedure('public.tg_auditar()') IS NULL OR to_regprocedure('public.tg_set_updated_at()') IS NULL
     OR to_regprocedure('public.is_staff(uuid)') IS NULL OR to_regprocedure('public.can_see_financials(uuid)') IS NULL THEN
    RAISE EXCEPTION 'faltam funções de apoio (auditoria, updated_at, is_staff ou can_see_financials)';
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. As regras de preço e do processo: UMA linha
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.trofeu_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unica boolean NOT NULL DEFAULT true UNIQUE CHECK (unica),
  faixas jsonb NOT NULL CHECK (jsonb_typeof(faixas) = 'array' AND jsonb_array_length(faixas) > 0),
  piso_do_multiplicador numeric(5, 2) NOT NULL CHECK (piso_do_multiplicador >= 1),
  multiplicador_de_urgencia numeric(5, 2) NOT NULL CHECK (multiplicador_de_urgencia >= 1),
  altura_minima_m numeric(5, 3) NOT NULL CHECK (altura_minima_m > 0),
  altura_maxima_m numeric(5, 3) NOT NULL,
  tinta_ml_m2 numeric(8, 2) NOT NULL CHECK (tinta_ml_m2 >= 0),
  cola_ml_por_juncao numeric(6, 2) NOT NULL CHECK (cola_ml_por_juncao >= 0),
  gravacao_min_por_m2 numeric(8, 2) NOT NULL CHECK (gravacao_min_por_m2 >= 0),
  preparo_do_laser_min numeric(6, 1) NOT NULL CHECK (preparo_do_laser_min >= 0),
  velocidade_de_corte jsonb NOT NULL CHECK (jsonb_typeof(velocidade_de_corte) = 'object'),
  arte_horas numeric(4, 1) NOT NULL CHECK (arte_horas >= 0),
  arte_multiplicador numeric(4, 2) NOT NULL CHECK (arte_multiplicador >= 1),
  arte_arredonda_na_dezena boolean NOT NULL DEFAULT true,
  arte_desconto_a_partir_de integer NOT NULL CHECK (arte_desconto_a_partir_de >= 0),
  arte_desconto_pct numeric(5, 2) NOT NULL CHECK (arte_desconto_pct >= 0 AND arte_desconto_pct <= 100),
  arte_alteracao_extra numeric(8, 2) NOT NULL CHECK (arte_alteracao_extra >= 0),
  arte_nome_individual numeric(8, 2) NOT NULL CHECK (arte_nome_individual >= 0),
  provisorios text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trofeu_regras_altura_valida CHECK (altura_maxima_m >= altura_minima_m)
);

COMMENT ON TABLE public.trofeu_regras IS
  'Regras de preço e do processo do troféu de acrílico (uma linha). O preço é o custo cheio vezes o multiplicador (×3, com a escada de quantidade em faixas e o piso). Só lê quem vê financeiro; o servidor lê com a chave de serviço.';
COMMENT ON COLUMN public.trofeu_regras.faixas IS
  'Escada de quantidade: [{"de": 1, "fator": 1}, ...]. O fator multiplica a base da linha (×3): 1, 0,9, 0,8 e 0,7333 dão ×3, ×2,7, ×2,4 e ×2,2.';
COMMENT ON COLUMN public.trofeu_regras.provisorios IS
  'Nomes dos parâmetros que ainda são estimativa: a tela do orçamento avisa até alguém medir e tirar da lista.';

-- ---------------------------------------------------------------------------------------------------
-- 2. O catálogo de modelos e as peças de cada um
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.trofeu_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE CHECK (btrim(nome) <> ''),
  linha text NOT NULL CHECK (linha IN ('economico', 'padrao', 'premium')),
  descricao text,
  altura_referencia_m numeric(5, 3) NOT NULL CHECK (altura_referencia_m > 0),
  minutos_de_mao_de_obra numeric(6, 1) NOT NULL CHECK (minutos_de_mao_de_obra >= 0),
  multiplicador_base numeric(4, 2) NOT NULL DEFAULT 3 CHECK (multiplicador_base >= 1),
  ativo boolean NOT NULL DEFAULT true,
  provisorio boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.trofeu_pecas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL REFERENCES public.trofeu_modelos(id) ON DELETE CASCADE,
  ordem integer NOT NULL CHECK (ordem >= 1),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  material_id uuid NOT NULL REFERENCES public.materiais(id),
  espessura_mm numeric(4, 1) NOT NULL CHECK (espessura_mm > 0),
  largura_m numeric(6, 3) NOT NULL CHECK (largura_m > 0),
  altura_m numeric(6, 3) NOT NULL CHECK (altura_m > 0),
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  fator_de_forma numeric(4, 2) NOT NULL DEFAULT 1 CHECK (fator_de_forma >= 1),
  decoracao text NOT NULL DEFAULT 'nenhuma' CHECK (decoracao IN ('nenhuma', 'vinil_laminado', 'gravacao_laser')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modelo_id, ordem)
);

CREATE INDEX trofeu_pecas_modelo_idx ON public.trofeu_pecas (modelo_id);
CREATE INDEX trofeu_pecas_material_idx ON public.trofeu_pecas (material_id);

COMMENT ON TABLE public.trofeu_modelos IS
  'Catálogo de modelos de troféu de acrílico. Cada modelo é uma lista de peças (trofeu_pecas) numa altura de referência; escolher outra altura escala a área ao quadrado e o corte na proporção.';
COMMENT ON COLUMN public.trofeu_modelos.provisorio IS
  'Medidas das peças e tempos estimados a partir da imagem do modelo, ainda não medidos numa produção.';
COMMENT ON COLUMN public.trofeu_pecas.fator_de_forma IS
  'Perímetro real do contorno dividido pelo perímetro do retângulo da peça: 1 é retângulo; contorno recortado passa de 1.';

CREATE TRIGGER tg_trofeu_regras_updated BEFORE UPDATE ON public.trofeu_regras
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_trofeu_modelos_updated BEFORE UPDATE ON public.trofeu_modelos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_auditar_trofeu_regras AFTER INSERT OR UPDATE OR DELETE ON public.trofeu_regras
  FOR EACH ROW EXECUTE FUNCTION public.tg_auditar();
CREATE TRIGGER tg_auditar_trofeu_modelos AFTER INSERT OR UPDATE OR DELETE ON public.trofeu_modelos
  FOR EACH ROW EXECUTE FUNCTION public.tg_auditar();
CREATE TRIGGER tg_auditar_trofeu_pecas AFTER INSERT OR UPDATE OR DELETE ON public.trofeu_pecas
  FOR EACH ROW EXECUTE FUNCTION public.tg_auditar();

-- ---------------------------------------------------------------------------------------------------
-- 3. Quem lê e quem escreve. `anon` não tem nada.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.trofeu_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trofeu_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trofeu_pecas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trofeu_regras, public.trofeu_modelos, public.trofeu_pecas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trofeu_regras, public.trofeu_modelos, public.trofeu_pecas TO authenticated;

CREATE POLICY trofeu_regras_leitura ON public.trofeu_regras FOR SELECT TO authenticated
  USING (public.can_see_financials((SELECT auth.uid())));
CREATE POLICY trofeu_regras_escrita ON public.trofeu_regras FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role));

CREATE POLICY trofeu_modelos_leitura ON public.trofeu_modelos FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));
CREATE POLICY trofeu_modelos_escrita ON public.trofeu_modelos FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role));

CREATE POLICY trofeu_pecas_leitura ON public.trofeu_pecas FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));
CREATE POLICY trofeu_pecas_escrita ON public.trofeu_pecas FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role));

-- ---------------------------------------------------------------------------------------------------
-- 4. Os dados: as regras do dono (22/11/2026) e os três modelos das imagens dele
-- ---------------------------------------------------------------------------------------------------
INSERT INTO public.trofeu_regras (
  faixas, piso_do_multiplicador, multiplicador_de_urgencia, altura_minima_m, altura_maxima_m,
  tinta_ml_m2, cola_ml_por_juncao, gravacao_min_por_m2, preparo_do_laser_min, velocidade_de_corte,
  arte_horas, arte_multiplicador, arte_arredonda_na_dezena, arte_desconto_a_partir_de, arte_desconto_pct,
  arte_alteracao_extra, arte_nome_individual, provisorios)
VALUES (
  '[{"de": 1, "fator": 1}, {"de": 5, "fator": 0.9}, {"de": 20, "fator": 0.8}, {"de": 50, "fator": 0.7333}]'::jsonb,
  2.20, 4.00, 0.120, 0.400,
  12.00, 1.00, 60.00, 5.0, '{"2": 1.5, "3": 1.0, "6": 0.4}'::jsonb,
  3.0, 3.00, true, 20, 50.00,
  30.00, 4.00,
  ARRAY['tinta_ml_m2', 'cola_ml_por_juncao', 'gravacao_min_por_m2', 'preparo_do_laser_min', 'velocidade_de_corte',
        'arte_horas', 'arte_desconto', 'medidas_dos_modelos', 'custo_do_espelhado_dourado']);

INSERT INTO public.trofeu_modelos (nome, linha, descricao, altura_referencia_m, minutos_de_mao_de_obra, multiplicador_base)
VALUES
  ('Troféu econômico', 'economico',
   'Placa única de acrílico cristal 2 mm com impressão e contorno recortado, sobre base preta em duas camadas (JariCross, linha econômica).',
   0.180, 15.0, 3.00),
  ('Troféu padrão em duas camadas', 'padrao',
   'Placa principal e peça decorativa de cristal 2 mm impressas, base preta em duas camadas e placa frontal do colocado (JariCross 2026).',
   0.180, 25.0, 3.00),
  ('Troféu premium em camadas', 'premium',
   'Onze peças: placa principal, coluna, aros espelhados dourados, silhueta gravada, placa da edição e base preta em camadas (KR Combat, 3ª edição).',
   0.280, 60.0, 3.00);

INSERT INTO public.trofeu_pecas (modelo_id, ordem, nome, material_id, espessura_mm, largura_m, altura_m, quantidade, fator_de_forma, decoracao)
SELECT m.id, v.ordem, v.nome, mat.id, v.espessura, v.largura, v.altura, v.quantidade, v.fator, v.decoracao
  FROM (VALUES
    ('Troféu econômico', 1, 'Placa principal', 'ACRILICO CRISTAL VIRGEM 2MM', 2.0, 0.200, 0.160, 1, 1.35, 'vinil_laminado'),
    ('Troféu econômico', 2, 'Base', 'ACRILICO PRETO VIRGEM 3MM', 3.0, 0.200, 0.050, 2, 1.00, 'nenhuma'),
    ('Troféu padrão em duas camadas', 1, 'Placa principal', 'ACRILICO CRISTAL VIRGEM 2MM', 2.0, 0.200, 0.170, 1, 1.20, 'vinil_laminado'),
    ('Troféu padrão em duas camadas', 2, 'Peça decorativa', 'ACRILICO CRISTAL VIRGEM 2MM', 2.0, 0.100, 0.120, 1, 1.50, 'vinil_laminado'),
    ('Troféu padrão em duas camadas', 3, 'Base', 'ACRILICO PRETO VIRGEM 3MM', 3.0, 0.200, 0.060, 2, 1.00, 'nenhuma'),
    ('Troféu padrão em duas camadas', 4, 'Placa frontal', 'ACRILICO PRETO VIRGEM 3MM', 3.0, 0.200, 0.060, 1, 1.00, 'vinil_laminado'),
    ('Troféu premium em camadas', 1, 'Placa principal', 'ACRILICO CRISTAL VIRGEM 3MM', 3.0, 0.130, 0.130, 1, 1.10, 'vinil_laminado'),
    ('Troféu premium em camadas', 2, 'Coluna', 'ACRILICO CRISTAL VIRGEM 6MM', 6.0, 0.060, 0.240, 1, 1.30, 'nenhuma'),
    ('Troféu premium em camadas', 3, 'Aro decorativo', 'Acrilico esp dourado 2mm', 2.0, 0.060, 0.240, 1, 1.60, 'nenhuma'),
    ('Troféu premium em camadas', 4, 'Aro da base', 'Acrilico esp dourado 2mm', 2.0, 0.160, 0.120, 1, 1.40, 'nenhuma'),
    ('Troféu premium em camadas', 5, 'Silhueta gravada', 'ACRILICO CRISTAL VIRGEM 3MM', 3.0, 0.160, 0.100, 1, 1.80, 'gravacao_laser'),
    ('Troféu premium em camadas', 6, 'Placa da edição', 'ACRILICO CRISTAL VIRGEM 3MM', 3.0, 0.120, 0.100, 1, 1.20, 'vinil_laminado'),
    ('Troféu premium em camadas', 7, 'Suporte interno', 'ACRILICO PRETO VIRGEM 3MM', 3.0, 0.180, 0.050, 1, 1.00, 'nenhuma'),
    ('Troféu premium em camadas', 8, 'Base em camadas', 'ACRILICO PRETO VIRGEM 3MM', 3.0, 0.200, 0.070, 3, 1.00, 'nenhuma'),
    ('Troféu premium em camadas', 9, 'Placa do campeão', 'ACRILICO PRETO VIRGEM 3MM', 3.0, 0.200, 0.070, 1, 1.00, 'vinil_laminado')
  ) AS v(modelo, ordem, nome, material, espessura, largura, altura, quantidade, fator, decoracao)
  JOIN public.trofeu_modelos m ON m.nome = v.modelo
  JOIN public.materiais mat ON mat.nome = v.material;

-- ---------------------------------------------------------------------------------------------------
-- 5. Conferência final: o que entrou é o que foi planejado, e `anon` não toca em nada
-- ---------------------------------------------------------------------------------------------------
DO $final$
DECLARE
  v_t text;
BEGIN
  IF (SELECT count(*) FROM public.trofeu_regras) <> 1 THEN RAISE EXCEPTION 'esperava uma linha de regras'; END IF;
  IF (SELECT count(*) FROM public.trofeu_modelos) <> 3 THEN RAISE EXCEPTION 'esperava três modelos'; END IF;
  IF (SELECT count(*) FROM public.trofeu_pecas) <> 15 THEN
    RAISE EXCEPTION 'esperava 15 peças (2 + 4 + 9), vieram %: algum material do seed não casou', (SELECT count(*) FROM public.trofeu_pecas);
  END IF;
  IF EXISTS (SELECT 1 FROM public.trofeu_modelos m WHERE NOT EXISTS (SELECT 1 FROM public.trofeu_pecas p WHERE p.modelo_id = m.id)) THEN
    RAISE EXCEPTION 'há modelo sem peça';
  END IF;
  IF (SELECT sum(quantidade) FROM public.trofeu_pecas p JOIN public.trofeu_modelos m ON m.id = p.modelo_id WHERE m.linha = 'premium') <> 11 THEN
    RAISE EXCEPTION 'o premium deveria ter 11 peças';
  END IF;
  IF (SELECT jsonb_array_length(faixas) FROM public.trofeu_regras) <> 4 THEN RAISE EXCEPTION 'esperava 4 faixas de quantidade'; END IF;
  FOREACH v_t IN ARRAY ARRAY['trofeu_regras', 'trofeu_modelos', 'trofeu_pecas'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN
      RAISE EXCEPTION '% está sem RLS', v_t;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT') OR has_table_privilege('anon', 'public.' || v_t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_t, 'UPDATE') OR has_table_privilege('anon', 'public.' || v_t, 'DELETE') THEN
      RAISE EXCEPTION 'anon ainda tem acesso a %', v_t;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated não lê %', v_t;
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = ('public.' || v_t)::regclass) <> 2 THEN
      RAISE EXCEPTION '% deveria ter duas políticas (leitura e escrita)', v_t;
    END IF;
  END LOOP;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (as três tabelas só existem por esta migração; nada de fora depende delas):
--   DROP TABLE public.trofeu_pecas;
--   DROP TABLE public.trofeu_modelos;
--   DROP TABLE public.trofeu_regras;
-- =====================================================================================================
