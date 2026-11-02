-- A pasta do produto (01/11/2026, pedido do dono, olhando o cadastro do Holdprint).
--
-- O cadastro do Bex Print é uma ficha: preço, margem, máquina padrão, tempo e receita de materiais. O dono quer a
-- estrutura de pasta: descrição, preço, parâmetros padrão, processos, fórmulas, perguntas que guiam o orçamento,
-- roteiro para a IA, informações fiscais e histórico. A estrutura veio de lá; os textos são nossos, gerados aqui a
-- partir do que o próprio cadastro já sabe (descrição, tamanhos, acabamentos). Nenhum texto deles entra.
--
-- Tudo é tabela nova, de propósito: `produtos` tem cinco gatilhos, três visões por nível de dinheiro e colunas com
-- permissão própria, e nada disso precisa mudar para a pasta existir.
--
--   produto_ficha        1 linha por produto: subfamília, medidas padrão, fiscal, prazo, comissão e o roteiro da IA.
--   processos            o catálogo de processos da casa: máquina, etapa, setup, pessoas, produtividade e sobras.
--                        A produtividade nasce VAZIA: número de palpite faz orçar errado; a tela cobra o real.
--   produto_processos    quais processos o produto percorre, em ordem. Nasce da máquina padrão de cada produto.
--   produto_formulas     material calculado por conta (ex.: ilhós pelo perímetro).
--   produto_perguntas    as perguntas que guiam o orçamento e o que cada resposta acrescenta.
--
-- Ainda NÃO mexe no orçamento: nenhuma resposta, fórmula ou processo muda preço nesta etapa.

CREATE TABLE public.produto_ficha (
  produto_id uuid PRIMARY KEY REFERENCES public.produtos(id) ON DELETE CASCADE,
  subfamilia text,
  largura_padrao_m numeric CHECK (largura_padrao_m IS NULL OR largura_padrao_m > 0),
  altura_padrao_m numeric CHECK (altura_padrao_m IS NULL OR altura_padrao_m > 0),
  copias_padrao integer CHECK (copias_padrao IS NULL OR copias_padrao > 0),
  ncm text,
  cst_ipi text,
  ipi_percentual numeric CHECK (ipi_percentual IS NULL OR ipi_percentual >= 0),
  gera_comissao boolean NOT NULL DEFAULT true,
  disponivel_pdv boolean NOT NULL DEFAULT false,
  prazo_producao_dias integer CHECK (prazo_producao_dias IS NULL OR prazo_producao_dias >= 0),
  ia_habilitado boolean NOT NULL DEFAULT false,
  ia_personalidade text,
  ia_como_medir text,
  ia_perguntas text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  descricao text,
  etapa text NOT NULL DEFAULT 'producao' CHECK (etapa IN ('pre_impressao', 'producao', 'acabamento', 'saida')),
  tipo_maquina text,
  setup_min numeric NOT NULL DEFAULT 0 CHECK (setup_min >= 0),
  pessoas integer NOT NULL DEFAULT 1 CHECK (pessoas > 0),
  produtividade_m2_h numeric CHECK (produtividade_m2_h IS NULL OR produtividade_m2_h > 0),
  produtividade_por_familia jsonb NOT NULL DEFAULT '[]'::jsonb,
  sobra_cm jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.produto_processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  processo_id uuid NOT NULL REFERENCES public.processos(id) ON DELETE RESTRICT,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (produto_id, processo_id)
);

CREATE TABLE public.produto_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materiais(id) ON DELETE RESTRICT,
  descricao text,
  script text NOT NULL CHECK (btrim(script) <> ''),
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.produto_perguntas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  pergunta text NOT NULL CHECK (btrim(pergunta) <> ''),
  descricao text,
  obrigatoria boolean NOT NULL DEFAULT true,
  tipo_resposta text NOT NULL DEFAULT 'unica' CHECK (tipo_resposta IN ('unica', 'multipla', 'numero', 'texto')),
  respostas jsonb NOT NULL DEFAULT '[]'::jsonb,
  acoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX produto_processos_produto_idx ON public.produto_processos (produto_id, ordem);
CREATE INDEX produto_formulas_produto_idx ON public.produto_formulas (produto_id, ordem);
CREATE INDEX produto_perguntas_produto_idx ON public.produto_perguntas (produto_id, ordem);

-- A mesma regra da ficha de acabamentos: a equipe lê, admin e gestor escrevem.
DO $p$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['produto_ficha', 'processos', 'produto_processos', 'produto_formulas', 'produto_perguntas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_staff((SELECT auth.uid())))', t || ' staff read', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL
      USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role))
      WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role))$f$,
      t || ' admin write', t);
  END LOOP;
END $p$;

CREATE TRIGGER produto_ficha_touch BEFORE UPDATE ON public.produto_ficha
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER processos_touch BEFORE UPDATE ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- O histórico da pasta. Só o NOME do que mudou: logs_auditoria não é lugar de preço nem de custo.
-- Falha ao registrar não pode impedir o cadastro de salvar.
CREATE OR REPLACE FUNCTION public.tg_historico_da_pasta_do_produto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_produto uuid;
  v_mudou text[] := '{}';
  v_novo jsonb;
  v_velho jsonb;
  v_c text;
BEGIN
  IF TG_TABLE_NAME = 'produtos' THEN
    v_produto := NEW.id;
    FOREACH v_c IN ARRAY ARRAY['nome', 'descricao', 'unidade', 'ativo', 'preco_base', 'custo_medio', 'margem_minima',
                               'maquina_padrao_id', 'material_principal_id', 'tempo_producao_min', 'area_minima_cobrada'] LOOP
      IF to_jsonb(NEW) -> v_c IS DISTINCT FROM to_jsonb(OLD) -> v_c THEN v_mudou := v_mudou || v_c; END IF;
    END LOOP;
    IF cardinality(v_mudou) = 0 THEN RETURN NEW; END IF;
  ELSE
    v_novo := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    v_velho := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    v_produto := (coalesce(v_novo, v_velho) ->> 'produto_id')::uuid;
    IF TG_OP = 'UPDATE' THEN
      FOR v_c IN SELECT k FROM jsonb_object_keys(v_novo) k WHERE k NOT IN ('updated_at', 'created_at') LOOP
        IF v_novo -> v_c IS DISTINCT FROM v_velho -> v_c THEN v_mudou := v_mudou || v_c; END IF;
      END LOOP;
      IF cardinality(v_mudou) = 0 THEN RETURN NEW; END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
    VALUES (auth.uid(), 'produtos', v_produto, lower(TG_OP),
            jsonb_build_object('tabela', TG_TABLE_NAME, 'campos', to_jsonb(v_mudou)));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'histórico do produto % não registrado: %', v_produto, SQLERRM;
  END;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

REVOKE ALL ON FUNCTION public.tg_historico_da_pasta_do_produto() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER produtos_historico_da_pasta AFTER UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.tg_historico_da_pasta_do_produto();
CREATE TRIGGER produto_ficha_historico AFTER INSERT OR UPDATE OR DELETE ON public.produto_ficha
  FOR EACH ROW EXECUTE FUNCTION public.tg_historico_da_pasta_do_produto();
CREATE TRIGGER produto_processos_historico AFTER INSERT OR UPDATE OR DELETE ON public.produto_processos
  FOR EACH ROW EXECUTE FUNCTION public.tg_historico_da_pasta_do_produto();
CREATE TRIGGER produto_formulas_historico AFTER INSERT OR UPDATE OR DELETE ON public.produto_formulas
  FOR EACH ROW EXECUTE FUNCTION public.tg_historico_da_pasta_do_produto();
CREATE TRIGGER produto_perguntas_historico AFTER INSERT OR UPDATE OR DELETE ON public.produto_perguntas
  FOR EACH ROW EXECUTE FUNCTION public.tg_historico_da_pasta_do_produto();

-- O catálogo de processos da casa. Sem produtividade: quem conhece a oficina preenche.
INSERT INTO public.processos (nome, etapa, tipo_maquina) VALUES
  ('Arte final', 'pre_impressao', NULL),
  ('Impressão eco-solvente', 'producao', 'plotter_impressao'),
  ('Recorte eletrônico', 'producao', 'plotter_recorte'),
  ('Corte e gravação a laser CO2', 'producao', 'laser_co2'),
  ('Marcação a laser fiber', 'producao', 'laser_fiber'),
  ('Impressão 3D', 'producao', 'impressora_3d'),
  ('Refile manual', 'acabamento', NULL),
  ('Laminação', 'acabamento', NULL),
  ('Depilação de adesivo recortado', 'acabamento', NULL),
  ('Colocação de ilhós', 'acabamento', NULL),
  ('Bainha', 'acabamento', NULL),
  ('Bastão, ponteira e corda', 'acabamento', NULL),
  ('Embalagem', 'saida', NULL),
  ('Instalação', 'saida', NULL),
  ('Deslocamento de equipe', 'saida', NULL);

-- Cada produto já tem máquina padrão: é o primeiro processo dele.
INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, 0
  FROM public.produtos p
  JOIN public.maquinas m ON m.id = p.maquina_padrao_id
  JOIN public.processos pr ON pr.tipo_maquina = m.tipo::text;

-- O rascunho do roteiro da IA, escrito do que o cadastro já sabe. Fica desligado até alguém revisar.
INSERT INTO public.produto_ficha (produto_id, ia_personalidade, ia_como_medir, ia_perguntas)
SELECT p.id,
       '## O que é' || E'\n' || coalesce(nullif(btrim(p.descricao), ''), p.nome)
         || CASE WHEN p.familia IS NOT NULL THEN E'\n\n## Família\n' || p.familia ELSE '' END,
       CASE WHEN lower(coalesce(p.unidade, '')) IN ('m2', 'm²')
            THEN E'## Perguntar sempre\n- Quantas peças?\n- Qual a medida de cada peça (largura x altura)?'
                 || coalesce(E'\n\n## Se o cliente não souber a medida, oferecer\n' || t.lista, '')
                 || CASE WHEN coalesce(p.area_minima_cobrada, 0) > 0
                         THEN E'\n\n## Atenção\nÁrea mínima cobrada: ' || trim(trailing '.' from trim(trailing '0' from p.area_minima_cobrada::text)) || ' m².'
                         ELSE '' END
            ELSE E'## Perguntar sempre\n- Qual a quantidade (em ' || coalesce(p.unidade, 'un') || ')?'
                 || coalesce(E'\n\n## Tamanhos que oferecemos\n' || t.lista, '')
       END,
       CASE WHEN p.tipo::text = 'servico'
            THEN E'## Antes de orçar\n- Onde e quando o serviço será feito?'
            ELSE E'## Antes de orçar\n- O cliente já tem a arte pronta ou precisamos criar?\n- Retira na loja, entrega ou instalação?'
                 || coalesce(E'\n- Qual acabamento? Opções: ' || a.lista, '')
       END
  FROM public.produtos p
  LEFT JOIN LATERAL (
    SELECT string_agg('- ' || z.nome, E'\n' ORDER BY z.ordem, z.nome) AS lista
      FROM public.produto_tamanhos z WHERE z.produto_id = p.id) t ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(c.nome, ', ' ORDER BY c.nome) AS lista
      FROM public.produto_acabamentos pa JOIN public.acabamentos c ON c.id = pa.acabamento_id
     WHERE pa.produto_id = p.id) a ON true;
