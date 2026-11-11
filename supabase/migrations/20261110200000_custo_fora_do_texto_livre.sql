-- APLICADA em 10/11/2026, em produção, depois de ensaio na mesma base (transação desfeita no fim, 46 conferências, 0 falhas).
-- Resultado conferido depois: 25 linhas guardadas (4 eventos, 1 OS, 20 textos); "R$" nos textos de material de 7 para 0,
-- de produto de 10 para 0 e de acabamento de 3 para 0; chave de custo nos eventos de 4 para 0; o marcador "CUSTO E PREÇO DE
-- BALCÃO PROVISÓRIOS" segue em 10 produtos; os 5 textos de mão de obra ficaram de fora de propósito.

-- Custo fora do texto livre (05/11/2026).
--
-- O que acontecia: valor de custo digitado em campo de texto que a equipe inteira lê (observação de produto,
-- observação de acabamento, "características" de material), mais chaves de custo, margem e lucro dentro do
-- jsonb de 4 eventos antigos de fechamento de OS (`eventos_negocio.dados_posteriores`) e o texto em reais de
-- `ordens_servico.fechamento_estimativas` da OS 212. Quem não vê custo (3 contas internas) lê tudo isso, e a
-- conferência de material com IA manda `caracteristicas` ao gateway de IA.
--
-- O que este arquivo faz (nenhuma linha é apagada; nenhuma coluna de custo, preço, estoque ou permissão muda):
--  1. cria `custo_em_texto_guardado`, tabela só de quem vê custo (financeiro.read; para os eventos e a OS,
--     também resultado.read, como `os_resultado_snapshots`), e guarda ali o ORIGINAL inteiro de cada linha
--     alterada ANTES de alterar;
--  2. nos 4 eventos: tira as chaves de custo, margem e lucro (mesma regra que `fechar_os` usa desde 04/11,
--     `jsonb_sem_custo`); na OS 212: tira o valor em reais das estimativas (`estimativas_sem_reais`);
--  3. em 7 materiais, 10 produtos e 3 acabamentos: troca só a frase com valor por uma frase sem valor.
--
-- Contratos de texto que continuam valendo (conferidos linha a linha abaixo): o marcador
-- "CUSTO E PREÇO DE BALCÃO PROVISÓRIOS" em `produtos.observacoes_internas` (tabela de preços e
-- `pendencias_de_preenchimento`) e os prefixos "PROVISÓRIO", "Estimativa" e "Provisório".
--
-- Seguro para rodar de novo: o que já foi feito é pulado. Para tudo (RAISE EXCEPTION) se o texto vivo não for
-- o que foi listado, se uma âncora não aparecer exatamente uma vez ou se sobrar "R$" no texto novo.
-- As observações de mão de obra (5 linhas) ficam FORA por padrão (`c_incluir_mao_de_obra` = false): ver o relatório.

-- ============================================================================ 1. DESTINO
CREATE TABLE IF NOT EXISTS public.custo_em_texto_guardado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote text NOT NULL,
  tabela text NOT NULL,
  coluna text NOT NULL,
  registro_id uuid NOT NULL,
  rotulo text NULL,
  original_texto text NULL,
  original_json jsonb NULL,
  novo_texto text NULL,
  novo_json jsonb NULL,
  atualizado_em_original timestamptz NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custo_em_texto_guardado_unico UNIQUE (lote, tabela, coluna, registro_id),
  CONSTRAINT custo_em_texto_guardado_um_original CHECK (num_nonnulls(original_texto, original_json) = 1)
);

COMMENT ON TABLE public.custo_em_texto_guardado IS
  'Texto original (com custo) de campos que a equipe inteira lê, guardado antes de o valor sair do texto público. Só quem vê custo lê; ninguém grava pela API.';

ALTER TABLE public.custo_em_texto_guardado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custo_em_texto_guardado quem ve custo le" ON public.custo_em_texto_guardado;
CREATE POLICY "custo_em_texto_guardado quem ve custo le" ON public.custo_em_texto_guardado
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR (
      public.can_see_financials((select auth.uid()))
      AND (
        tabela NOT IN ('eventos_negocio', 'ordens_servico')
        OR public.has_permission((select auth.uid()), 'resultado.read')
      )
    )
  );

-- A tabela nasce aberta para anon e authenticated (privilégio padrão do Supabase): fechar já.
REVOKE ALL ON public.custo_em_texto_guardado FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.custo_em_texto_guardado TO authenticated;

-- ============================================================================ 2. EVENTOS DE FECHAMENTO E OS 212
DO $eventos_e_os$
DECLARE
  c_lote constant text := '2026-11-05-texto-livre';
  c_eventos constant uuid[] := ARRAY[
    '72c10254-1e6d-4899-8568-815a34e08cbc'::uuid,  -- OS 44: fechamento
    '44b6b2a6-13f9-4f58-b422-75a47036c6e1'::uuid,  -- OS 44: conclusão retroativa (custo_operacional, fonte_do_custo)
    '357c4c8e-b46b-4f51-87ad-9c3c39f9395d'::uuid,  -- OS 216: fechamento
    'ee059153-eacb-4f69-9daa-3d3031b0fdd7'::uuid   -- OS 212: fechamento
  ];
  c_os_212 constant uuid := '325597d1-1511-48b2-bca4-826e93294975';
  r record;
  v_novo jsonb;
  v_guardado jsonb;
  v_linhas integer;
  v_alterados integer := 0;
  v_feitos integer := 0;
  v_os_atual jsonb;
  v_os_upd timestamptz;
  v_os_numero integer;
BEGIN
  IF to_regclass('public.custo_em_texto_guardado') IS NULL THEN
    RAISE EXCEPTION 'custo_em_texto_guardado: o destino não existe; nada foi alterado';
  END IF;

  FOR r IN
    SELECT e.id, e.tipo, e.dados_posteriores AS atual, o.numero
      FROM public.eventos_negocio e
      LEFT JOIN public.ordens_servico o ON o.id = e.os_id
     WHERE e.id = ANY (c_eventos)
     ORDER BY e.created_at, e.id
  LOOP
    v_novo := public.jsonb_sem_custo(r.atual);
    IF jsonb_typeof(r.atual) = 'object' AND r.atual ? 'estimativas' THEN
      v_novo := v_novo || jsonb_build_object('estimativas', public.estimativas_sem_reais(r.atual -> 'estimativas'));
    END IF;
    IF v_novo IS NOT DISTINCT FROM r.atual THEN
      v_feitos := v_feitos + 1;
      CONTINUE;
    END IF;

    -- 1º guarda o original inteiro
    INSERT INTO public.custo_em_texto_guardado (lote, tabela, coluna, registro_id, rotulo, original_json, novo_json)
    VALUES (c_lote, 'eventos_negocio', 'dados_posteriores', r.id, format('OS %s, evento %s', r.numero, r.tipo), r.atual, v_novo)
    ON CONFLICT (lote, tabela, coluna, registro_id) DO NOTHING;
    SELECT g.original_json INTO v_guardado
      FROM public.custo_em_texto_guardado g
     WHERE g.lote = c_lote AND g.tabela = 'eventos_negocio' AND g.coluna = 'dados_posteriores' AND g.registro_id = r.id;
    IF v_guardado IS DISTINCT FROM r.atual THEN
      RAISE EXCEPTION 'evento %: já existe um original guardado diferente do que está no banco; confira antes de repetir', r.id;
    END IF;

    -- 2º troca só a coluna dados_posteriores
    UPDATE public.eventos_negocio SET dados_posteriores = v_novo WHERE id = r.id AND dados_posteriores = r.atual;
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    IF v_linhas <> 1 THEN
      RAISE EXCEPTION 'evento %: a linha mudou no meio da limpeza; nada foi alterado', r.id;
    END IF;
    v_alterados := v_alterados + 1;
  END LOOP;

  -- OS 212: o texto em reais das estimativas (a OS 216 tem estimativas sem valor e fica como está)
  SELECT o.fechamento_estimativas, o.updated_at, o.numero INTO v_os_atual, v_os_upd, v_os_numero
    FROM public.ordens_servico o WHERE o.id = c_os_212;
  IF FOUND THEN
    v_novo := public.estimativas_sem_reais(v_os_atual);
    IF v_novo IS NOT DISTINCT FROM v_os_atual THEN
      v_feitos := v_feitos + 1;
    ELSE
      INSERT INTO public.custo_em_texto_guardado (lote, tabela, coluna, registro_id, rotulo, original_json, novo_json, atualizado_em_original)
      VALUES (c_lote, 'ordens_servico', 'fechamento_estimativas', c_os_212, format('OS %s', v_os_numero), v_os_atual, v_novo, v_os_upd)
      ON CONFLICT (lote, tabela, coluna, registro_id) DO NOTHING;
      SELECT g.original_json INTO v_guardado
        FROM public.custo_em_texto_guardado g
       WHERE g.lote = c_lote AND g.tabela = 'ordens_servico' AND g.coluna = 'fechamento_estimativas' AND g.registro_id = c_os_212;
      IF v_guardado IS DISTINCT FROM v_os_atual THEN
        RAISE EXCEPTION 'OS 212: já existe um original guardado diferente do que está no banco; confira antes de repetir';
      END IF;
      UPDATE public.ordens_servico SET fechamento_estimativas = v_novo WHERE id = c_os_212 AND fechamento_estimativas = v_os_atual;
      GET DIAGNOSTICS v_linhas = ROW_COUNT;
      IF v_linhas <> 1 THEN
        RAISE EXCEPTION 'OS 212: a linha mudou no meio da limpeza; nada foi alterado';
      END IF;
      v_alterados := v_alterados + 1;
    END IF;
  END IF;

  -- conferência: nas linhas listadas não pode sobrar chave de custo nem valor em reais
  IF EXISTS (
    SELECT 1
      FROM public.eventos_negocio e,
           LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(e.dados_posteriores) = 'object' THEN e.dados_posteriores ELSE '{}'::jsonb END) AS k
     WHERE e.id = ANY (c_eventos) AND k ~* '(custo|margem|lucro|markup|divergencia)'
  ) THEN
    RAISE EXCEPTION 'eventos_negocio: ainda sobrou chave de custo, margem ou lucro; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eventos_negocio e WHERE e.id = ANY (c_eventos) AND e.dados_posteriores::text ~ 'R\$') THEN
    RAISE EXCEPTION 'eventos_negocio: ainda sobrou valor em reais; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.id = c_os_212 AND o.fechamento_estimativas::text ~ 'R\$') THEN
    RAISE EXCEPTION 'OS 212: ainda sobrou valor em reais; nada foi alterado';
  END IF;

  PERFORM set_config('bex.limpeza_alterados_eventos', v_alterados::text, true);
  RAISE NOTICE 'eventos e OS: % alterados, % já estavam feitos', v_alterados, v_feitos;
END
$eventos_e_os$;

-- ============================================================================ 3. TEXTOS (materiais, produtos, acabamentos)
-- Cada linha: tabela, coluna, id, nome, md5 do texto listado, e até duas trocas (âncora para texto novo).
-- A âncora tem de aparecer exatamente UMA vez; o md5 garante que o texto vivo é o que foi listado.
DO $textos$
DECLARE
  c_lote constant text := '2026-11-05-texto-livre';
  c_incluir_mao_de_obra constant boolean := false;  -- só vira true com o OK do dono (ver o relatório)
  r record;
  v_atual text;
  v_upd timestamptz;
  v_novo text;
  v_guardado text;
  v_n integer;
  v_linhas integer;
  v_alterados integer := 0;
  v_feitos integer := 0;
  v_ausentes integer := 0;
BEGIN
  IF to_regclass('public.custo_em_texto_guardado') IS NULL THEN
    RAISE EXCEPTION 'custo_em_texto_guardado: o destino não existe; nada foi alterado';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- ---- materiais.caracteristicas (7)
      ('materiais', 'caracteristicas', 'f6d0bbd8-3584-4044-a8ec-9d202ddb498a'::uuid, 'ACRILICO CRISTAL VIRGEM 10MM', '8d56bb6eedddfc7d44562d7662ae6a77',
        $a$: R$ 1.282,49 a chapa$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('materiais', 'caracteristicas', '73ee336a-3a2a-46f1-a0f8-3805b9f282e4', 'ACRILICO CRISTAL VIRGEM 2MM', 'fbd4843d8c600ac4c12b8d6e288dfedc',
        $a$: R$ 316,00 a chapa$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('materiais', 'caracteristicas', 'd4f62f64-1647-49a6-9827-30ca6547ab6c', 'ACRILICO CRISTAL VIRGEM 3MM', '39b544409f476900e9981197177824a6',
        $a$: R$ 398,43 a chapa$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('materiais', 'caracteristicas', '256eccac-112f-4516-bc6a-f17bc5045fbb', 'ACRILICO CRISTAL VIRGEM 6MM', '0cc3569164dfde5b04aae3ea1d92ed61',
        $a$: R$ 801,51 a chapa$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('materiais', 'caracteristicas', 'a51f633e-4445-4023-be9b-0d692f550bf2', 'Kit hotend original A1/A1 Mini (BEGRINT)', '6c8b44ee8a7feeb0ef59e996ce80323f',
        $a$Total do pedido R$ 198,46 (2 kits).$a$, $a$Pedido de 2 kits.$a$, $a$$a$, $a$$a$, false),
      ('materiais', 'caracteristicas', '6d0d32b0-2893-4a34-9eb1-fc38a2d3ac6e', 'Placa fria Glacier (cold plate)', '839844b1fa7a2ff3ef1d654c1b8c7454',
        $a$Total do pedido R$ 161,32 (2 placas).$a$, $a$Pedido de 2 placas.$a$, $a$$a$, $a$$a$, false),
      ('materiais', 'caracteristicas', 'f9a95b1a-3de2-4486-a330-2d714573d524', 'Vinil transparente 1,22 m (Alltak Premium)', '33475ba2f358a416362acad3f5121924',
        $a$Custo REAL: R$ 21,50 por metro linear (nota da Camaleão, 26/10/2026) ÷ 1,22 m de largura = R$ 17,62/m².$a$,
        $a$Custo REAL conforme a nota da Camaleão (26/10/2026). Largura de 1,22 m.$a$, $a$$a$, $a$$a$, false),
      -- ---- produtos.observacoes_internas (4 ativos + 6 clones inativos com o marcador)
      ('produtos', 'observacoes_internas', 'ea107d14-1ccf-4c36-b946-4ca6768ab4ea', 'Acabamento manual (mão de obra)', '105238f906556e4da71c65454ab9faec',
        $a$Preço e custo pela regra da casa de 27/10/2026 (ver Acabamentos): custo R$ 24,17/h (1 pessoa + rateio), markup padrão de 60% = R$ 0,64 por minuto (R$ 38,40/h).$a$,
        $a$Preço pela regra da casa de 27/10/2026 (ver Acabamentos).$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', '504a9190-317b-4e44-8e7c-e9214ea0d1dd', 'Adesivo transparente', '23d27305e5f707fa8fc4a5aad47744e8',
        $a$(R$ 21,50 por metro linear ÷ 1,22 m = R$ 17,62/m², nota da Camaleão de 26/10)$a$, $a$(nota da Camaleão de 26/10)$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', '923148dd-1675-4fc8-9a35-1778418d6e85', 'Corte a laser (CNC Laser)', '630460e8f7a5235de482ebe9cb6d1141',
        $a$Preço e custo pela regra da casa de 27/10/2026 (ver Acabamentos): custo R$ 33,03/h (máquina + energia + 1 pessoa + rateio), markup padrão de 60% = R$ 0,88 por minuto (R$ 52,80/h).$a$,
        $a$Preço pela regra da casa de 27/10/2026 (ver Acabamentos).$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', 'f7e2dc28-9f0f-49f9-ba05-62f8cdedb1da', 'Recorte eletrônico (plotter de recorte)', 'f869a4c4e3f2f746c36e1afdef0b2b67',
        $a$Preço e custo pela regra da casa de 27/10/2026 (ver Acabamentos): custo R$ 1,21/m, markup padrão de 60% = R$ 1,93/m.$a$,
        $a$Preço pela regra da casa de 27/10/2026 (ver Acabamentos).$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', '3ae5022a-968d-41db-bb85-e462318cb583', 'Adesivo blackout (inativo)', '881366bbc6bc02c5734fee815656114f',
        $a$ (R$ 9.21)$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', 'd741f73d-2129-41ef-9c67-fea281029620', 'Adesivo fosco (inativo)', '881366bbc6bc02c5734fee815656114f',
        $a$ (R$ 9.21)$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', 'd28f271f-5745-4606-8d88-67ea6a51a46b', 'Adesivo PROMO (inativo)', '881366bbc6bc02c5734fee815656114f',
        $a$ (R$ 9.21)$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', '6d3bcfa5-3a60-4e86-bc7f-92b4ee886d24', 'Adesivo perfurado promocional (inativo)', '186e1c43cf42875139cc867ac0c84646',
        $a$ (R$ 9.38)$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', '74cbbb9d-47a5-4cf3-8111-dc4517879743', 'Lona backlight (inativo)', '06d0f6f4c780a2ca3592b3930d382ff9',
        $a$ (R$ 20.26)$a$, $a$$a$, $a$$a$, $a$$a$, false),
      ('produtos', 'observacoes_internas', '104c2b37-2112-4c97-865e-7842b6696cd5', 'Lona fosca (inativo)', '06d0f6f4c780a2ca3592b3930d382ff9',
        $a$ (R$ 20.26)$a$, $a$$a$, $a$$a$, $a$$a$, false),
      -- ---- acabamentos.observacao (3)
      ('acabamentos', 'observacao', '6972bede-222a-45e9-a599-594972a94f57', 'Acabamento manual (mão de obra)', 'e7d474417515caada1bf55591e4c7791',
        $a$: custo da hora ÷ 60 × (1 + markup padrão de 60%). Custo da hora R$ 24,17 = 1 pessoa R$ 12,17 (salário mínimo ÷ 176 h com encargos) + rateio administrativo R$ 12,00.$a$,
        $a$.$a$, $a$$a$, $a$$a$, false),
      ('acabamentos', 'observacao', '4b608717-bc90-47d4-84d8-4a4b97070631', 'Corte a laser (CNC Laser)', '40162e667b7d531c5830f5ea42dd1aca',
        $a$: custo da hora ÷ 60 × (1 + markup padrão de 60%). Custo da hora R$ 33,03 = máquina R$ 6,70 (contrato ÷ 10.000 h) + energia R$ 2,15 (1,9 kW × R$ 1,1339) + 1 pessoa R$ 12,17 + rateio administrativo R$ 12,00.$a$,
        $a$.$a$, $a$$a$, $a$$a$, false),
      ('acabamentos', 'observacao', '58b78cdf-9798-4d99-a88a-230dad6a8051', 'Recorte eletrônico (plotter de recorte)', 'f0379ebdd8f46b8b9d41d74f7fdb3814',
        $a$: custo por metro × (1 + markup padrão de 60%). Custo por metro R$ 1,21 = 3 min de depuração (1 pessoa + rateio: R$ 24,17/h) + 0,0208 min de máquina (800 mm/s) com a plotter a R$ 0,70/h e energia de 0,1 kW.$a$,
        $a$.$a$, $a$$a$, $a$$a$, false),
      -- ---- custos_mao_de_obra.observacoes (5): FORA por padrão. Mexer aqui dispara a recomposição do custo de TODOS os produtos.
      ('custos_mao_de_obra', 'observacoes', 'f38d1413-7411-457b-930f-e37793618a47', 'Mão de obra: Acabamento', '27677226c4d6ff3862c5dc71d4c29820',
        $a$(R$ 1.621,00, Decreto 12.797/2025)$a$, $a$(Decreto 12.797/2025)$a$, $a$com 32,19% de encargos do Simples = R$ 12,17/h.$a$, $a$com os encargos do Simples.$a$, true),
      ('custos_mao_de_obra', 'observacoes', 'a6ea66ff-cb13-457a-af10-a66d80ef32cf', 'Mão de obra: Designer', '27677226c4d6ff3862c5dc71d4c29820',
        $a$(R$ 1.621,00, Decreto 12.797/2025)$a$, $a$(Decreto 12.797/2025)$a$, $a$com 32,19% de encargos do Simples = R$ 12,17/h.$a$, $a$com os encargos do Simples.$a$, true),
      ('custos_mao_de_obra', 'observacoes', '75e9bb7f-bc53-454c-ae8f-054f8b2d388f', 'Mão de obra: Entregador', '27677226c4d6ff3862c5dc71d4c29820',
        $a$(R$ 1.621,00, Decreto 12.797/2025)$a$, $a$(Decreto 12.797/2025)$a$, $a$com 32,19% de encargos do Simples = R$ 12,17/h.$a$, $a$com os encargos do Simples.$a$, true),
      ('custos_mao_de_obra', 'observacoes', '2cdce276-5911-4b60-9b86-714a0fae99d4', 'Mão de obra: Impressor', '27677226c4d6ff3862c5dc71d4c29820',
        $a$(R$ 1.621,00, Decreto 12.797/2025)$a$, $a$(Decreto 12.797/2025)$a$, $a$com 32,19% de encargos do Simples = R$ 12,17/h.$a$, $a$com os encargos do Simples.$a$, true),
      ('custos_mao_de_obra', 'observacoes', '9d4bdbc1-eeeb-46ef-ac07-4f9f5a7dd8a6', 'Mão de obra: Instalador', '27677226c4d6ff3862c5dc71d4c29820',
        $a$(R$ 1.621,00, Decreto 12.797/2025)$a$, $a$(Decreto 12.797/2025)$a$, $a$com 32,19% de encargos do Simples = R$ 12,17/h.$a$, $a$com os encargos do Simples.$a$, true)
    ) AS v(tabela, coluna, id, rotulo, md5_original, a1, t1, a2, t2, so_com_ok)
    WHERE NOT v.so_com_ok OR c_incluir_mao_de_obra
  LOOP
    EXECUTE format('SELECT %I, updated_at FROM public.%I WHERE id = $1', r.coluna, r.tabela) INTO v_atual, v_upd USING r.id;
    -- EXECUTE não atualiza FOUND (só o GET DIAGNOSTICS vê): conferir FOUND aqui pulava TODAS as linhas como "ausentes".
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    IF v_linhas = 0 THEN
      v_ausentes := v_ausentes + 1;   -- banco sem essa linha (ambiente novo): nada a fazer
      CONTINUE;
    END IF;

    -- já feito por esta mesma limpeza?
    SELECT g.novo_texto INTO v_guardado
      FROM public.custo_em_texto_guardado g
     WHERE g.lote = c_lote AND g.tabela = r.tabela AND g.coluna = r.coluna AND g.registro_id = r.id;
    IF FOUND AND v_atual IS NOT DISTINCT FROM v_guardado THEN
      v_feitos := v_feitos + 1;
      CONTINUE;
    END IF;

    -- é o texto que foi listado? Se não for, para tudo: ninguém troca o que não conhece.
    IF v_atual IS NULL OR md5(v_atual) <> r.md5_original THEN
      RAISE EXCEPTION '%.% (%): o texto vivo não é o que foi listado (md5 %); nada foi alterado',
        r.tabela, r.coluna, r.id, md5(coalesce(v_atual, ''));
    END IF;

    -- trocas com âncora contada
    v_novo := v_atual;
    v_n := (length(v_novo) - length(replace(v_novo, r.a1, ''))) / length(r.a1);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%.% (%): a primeira âncora aparece % vezes (esperado 1); nada foi alterado', r.tabela, r.coluna, r.id, v_n;
    END IF;
    v_novo := replace(v_novo, r.a1, r.t1);
    IF r.a2 <> '' THEN
      v_n := (length(v_novo) - length(replace(v_novo, r.a2, ''))) / length(r.a2);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%.% (%): a segunda âncora aparece % vezes (esperado 1); nada foi alterado', r.tabela, r.coluna, r.id, v_n;
      END IF;
      v_novo := replace(v_novo, r.a2, r.t2);
    END IF;

    -- guardas do texto novo
    IF v_novo ~ 'R\$' OR btrim(v_novo) = '' THEN
      RAISE EXCEPTION '%.% (%): o texto novo ainda tem "R$" ou ficou vazio; nada foi alterado', r.tabela, r.coluna, r.id;
    END IF;
    IF (v_atual ILIKE '%CUSTO E PREÇO DE BALCÃO PROVISÓRIOS%') <> (v_novo ILIKE '%CUSTO E PREÇO DE BALCÃO PROVISÓRIOS%')
       OR (v_atual LIKE 'PROVISÓRIO%') <> (v_novo LIKE 'PROVISÓRIO%')
       OR (v_atual LIKE 'Provisório%') <> (v_novo LIKE 'Provisório%')
       OR (v_atual LIKE 'Estimativa%') <> (v_novo LIKE 'Estimativa%') THEN
      RAISE EXCEPTION '%.% (%): a troca mexeria no marcador ou no prefixo que a tabela de preços e as pendências leem; nada foi alterado', r.tabela, r.coluna, r.id;
    END IF;

    -- 1º guarda o original inteiro
    INSERT INTO public.custo_em_texto_guardado (lote, tabela, coluna, registro_id, rotulo, original_texto, novo_texto, atualizado_em_original)
    VALUES (c_lote, r.tabela, r.coluna, r.id, r.rotulo, v_atual, v_novo, v_upd)
    ON CONFLICT (lote, tabela, coluna, registro_id) DO NOTHING;
    SELECT g.original_texto INTO v_guardado
      FROM public.custo_em_texto_guardado g
     WHERE g.lote = c_lote AND g.tabela = r.tabela AND g.coluna = r.coluna AND g.registro_id = r.id;
    IF v_guardado IS DISTINCT FROM v_atual THEN
      RAISE EXCEPTION '%.% (%): já existe um original guardado diferente do que está no banco; confira antes de repetir', r.tabela, r.coluna, r.id;
    END IF;

    -- 2º troca só essa coluna (o UPDATE não cita nenhuma coluna de custo, preço ou estoque)
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I = $3', r.tabela, r.coluna, r.coluna)
      USING v_novo, r.id, v_atual;
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    IF v_linhas <> 1 THEN
      RAISE EXCEPTION '%.% (%): a linha mudou no meio da limpeza; nada foi alterado', r.tabela, r.coluna, r.id;
    END IF;
    v_alterados := v_alterados + 1;
  END LOOP;

  PERFORM set_config('bex.limpeza_alterados_textos', v_alterados::text, true);
  RAISE NOTICE 'textos: % alterados, % já estavam feitos, % linhas ausentes', v_alterados, v_feitos, v_ausentes;
END
$textos$;

-- A tabela nova entra no cache do PostgREST (a equipe de custo poderá consultá-la pela API/tela depois).
NOTIFY pgrst, 'reload schema';
