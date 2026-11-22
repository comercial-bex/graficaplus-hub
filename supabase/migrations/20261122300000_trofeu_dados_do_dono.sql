-- =====================================================================================================
-- TROFÉU DE ACRÍLICO: OS DADOS QUE O DONO RESPONDEU (22/11/2026)
--
-- O que o dono disse, e o que esta migração faz com cada resposta:
--   1. "Nota do espelhado dourado: pode botar R$ 480, a folha dela." Não há nota de compra; o valor é do dono.
--      A folha presumida é de 1,00 x 2,00 m (2,00 m², como as outras chapas que ele vende), então R$ 240,00 o m².
--      O cadastro tinha R$ 174,18 de custo unitário e R$ 87,09 de médio: eram o preço de UMA FOLHA (R$ 174,18 por
--      2,00 m²) lido como se fosse por m², o mesmo erro do preto a R$ 400 (corrigido em 20261122100000).
--      Custo unitário e médio passam a R$ 240,00, e o lote de abertura (4 m²) sai de R$ 87,09 para R$ 240,00: é
--      dele que a baixa da OS tira o custo. O que vem de fora do dono (medida da folha, ausência de nota) fica
--      anotado no material (SEM valor em reais: `caracteristicas` é lido pela equipe toda) e na lista de provisórios.
--   2. "A velocidade do corte do laser: pesquise a máquina e ponha os dados mais próximos." A máquina é a Vuze
--      VC10060-LM (CO2 100 W, mesa 100 x 60 cm). A Vuze não publica velocidade por espessura em acrílico; a fonte
--      mais próxima, lida na tabela, é a "Tabla de corte" e a "Tabla de grabado" de 100 W da Forza
--      (support.forzalaser.com/wp-content/uploads/2021/12/PARAMETROS-REFERENCIALES-100-W.pdf): acrílico 3 mm a
--      24 mm/s, 6 mm a 10 mm/s, 9 mm a 5 mm/s e 12 mm a 3 mm/s (35% da potência); gravação a 400 mm/s com resolução
--      de 0,1 mm (14%). A página da Aeon (aeonlaser.us/blogs/news/co2-laser-settings-for-acrylic, 100 W) confere:
--      3 mm a 25 mm/s e 10 mm a 4 mm/s. O 2 mm não está em nenhuma tabela lida: é interpolado (cerca de 40 mm/s).
--      Sobre o que se leu entra uma folga de 20% (o tubo da casa não entrega os 100 W de catálogo e as curvas
--      freiam o corte; na gravação o vaivém da cabeça come tempo). Velocidades de corte em m/min por espessura:
--        2 mm: 1,9   3 mm: 1,15   6 mm: 0,48   10 mm: 0,2     (antes: 1,5 / 1,0 / 0,4, sem os 10 mm)
--      Gravação: 400 mm/s com intervalo de 0,10 mm dá 0,144 m²/h = 417 min/m²; com a folga, 521, arredondado para
--      520 (antes: 60 min/m², oito vezes menos que a tabela). São PESQUISADOS, NÃO MEDIDOS: continuam na lista de
--      provisórios até alguém cronometrar um corte e uma gravação na máquina.
--   3. "A nossa máquina só corta até 10 mm." Nova coluna `espessura_maxima_de_corte_mm` (10): a conta recusa peça
--      mais grossa, com a frase em português. A ficha do fabricante diz 30 mm (`maquinas.especificacoes`); o
--      cadastro da máquina NÃO é alterado aqui, vale o que o dono disse da oficina.
--   4. "A DTF UV continua desativada, com aviso de que a gente faz por compra externa." A máquina fica INATIVA (não
--      tem custo por hora, velocidade, setup nem valor de compra). O aviso entra no cadastro dela e na lista de
--      provisórios do troféu, para a tela do orçamento mostrar.
--   5. "A chapa de 15 mm é 1 metro": a borda de 15 mm por lado (1,03 x 2,03 m bruta, 1,00 x 2,00 m útil) já era a
--      conta de 20261122100000 e o dono confirmou; nada muda no cadastro dos acrílicos Terzian.
--
--   6. Para o servidor que calcula o preço (`cotarTrofeu`) não adivinhar material pelo nome: as regras passam a
--      apontar o vinil, a laminação, a tinta e a cola (`material_*_id`, com chave estrangeira, que também impede
--      apagar o material por engano) e a quantos ml rende um frasco de cola (250).
--
-- Nenhuma função nova (nada a fechar com REVOKE de função). Ensaio no banco vivo, desfeito por RAISE EXCEPTION:
-- docs/ensaio-trofeu-dados-do-dono-22-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Guardas: o banco está como a migração espera (senão ela para sem gravar nada)
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_dourado public.materiais%ROWTYPE;
  v_nome text;
BEGIN
  IF to_regclass('public.trofeu_regras') IS NULL THEN
    RAISE EXCEPTION 'falta a tabela trofeu_regras: aplique antes a migração 20261122200000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'trofeu_regras' AND column_name = 'espessura_maxima_de_corte_mm') THEN
    RAISE EXCEPTION 'esta migração já foi aplicada (trofeu_regras.espessura_maxima_de_corte_mm existe)';
  END IF;
  IF (SELECT count(*) FROM public.trofeu_regras) <> 1 THEN
    RAISE EXCEPTION 'esperava uma linha em trofeu_regras';
  END IF;
  IF (SELECT gravacao_min_por_m2 FROM public.trofeu_regras) <> 60
     OR (SELECT velocidade_de_corte FROM public.trofeu_regras) <> '{"2": 1.5, "3": 1.0, "6": 0.4}'::jsonb THEN
    RAISE EXCEPTION 'as regras do laser já não são as plantadas em 20261122200000: releia antes de mudar';
  END IF;

  IF (SELECT count(*) FROM public.materiais WHERE nome = 'Acrilico esp dourado 2mm') <> 1 THEN
    RAISE EXCEPTION 'esperava um (e só um) material "Acrilico esp dourado 2mm"';
  END IF;
  SELECT * INTO v_dourado FROM public.materiais WHERE nome = 'Acrilico esp dourado 2mm';
  IF v_dourado.custo_unitario <> 174.18 OR v_dourado.custo_medio <> 87.09 THEN
    RAISE EXCEPTION 'o dourado já não está a 174,18 (unitário) e 87,09 (médio): alguém mexeu, releia antes';
  END IF;
  IF v_dourado.largura_chapa_m IS NOT NULL OR v_dourado.largura_util_m IS NOT NULL THEN
    RAISE EXCEPTION 'o dourado já tem medida de chapa: releia antes';
  END IF;
  IF (SELECT count(*) FROM public.material_lotes WHERE material_id = v_dourado.id AND codigo = 'ABERTURA'
         AND custo_unitario_snapshot = 87.09 AND quantidade = 4) <> 1 THEN
    RAISE EXCEPTION 'esperava um lote ABERTURA de 4 m² a R$ 87,09 do dourado';
  END IF;

  IF (SELECT count(*) FROM public.maquinas WHERE tipo = 'impressora_dtf_uv' AND ativa = false) <> 1 THEN
    RAISE EXCEPTION 'esperava uma impressora DTF UV, inativa';
  END IF;

  FOREACH v_nome IN ARRAY ARRAY['Vinil adesivo branco brilho', 'Laminação polimérica', 'Tinta solvente (conjunto)',
                                'Cola para acrílico antimancha 250 ml'] LOOP
    IF (SELECT count(*) FROM public.materiais WHERE nome = v_nome) <> 1 THEN
      RAISE EXCEPTION 'esperava um (e só um) material "%"', v_nome;
    END IF;
  END LOOP;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Regras do troféu: limite de corte do laser, velocidades pesquisadas, gravação e a lista de provisórios
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.trofeu_regras
  ADD COLUMN espessura_maxima_de_corte_mm numeric(4, 1) NOT NULL DEFAULT 10 CHECK (espessura_maxima_de_corte_mm > 0);

COMMENT ON COLUMN public.trofeu_regras.espessura_maxima_de_corte_mm IS
  'Espessura máxima que o laser da casa corta, em mm (o dono, 22/11/2026: até 10 mm). A ficha do fabricante diz 30 mm; vale a da oficina. A conta recusa peça mais grossa.';
COMMENT ON COLUMN public.trofeu_regras.velocidade_de_corte IS
  'Metros cortados por minuto, por espessura em mm: {"2": 1.9, ...}. Vêm da tabela de 100 W da Forza (conferida com a Aeon) com 20% de folga: pesquisados, não medidos.';
COMMENT ON COLUMN public.trofeu_regras.provisorios IS
  'Nomes dos parâmetros que ainda são estimativa e dos avisos abertos: a tela do orçamento avisa até alguém medir ou resolver e tirar da lista.';

-- Os materiais da decoração e da cola, apontados por id (o servidor lê o custo por eles)
ALTER TABLE public.trofeu_regras
  ADD COLUMN material_vinil_id uuid REFERENCES public.materiais(id),
  ADD COLUMN material_laminacao_id uuid REFERENCES public.materiais(id),
  ADD COLUMN material_tinta_id uuid REFERENCES public.materiais(id),
  ADD COLUMN material_cola_id uuid REFERENCES public.materiais(id),
  ADD COLUMN cola_ml_por_frasco numeric(6, 1) NOT NULL DEFAULT 250 CHECK (cola_ml_por_frasco > 0);

UPDATE public.trofeu_regras
   SET material_vinil_id = (SELECT id FROM public.materiais WHERE nome = 'Vinil adesivo branco brilho'),
       material_laminacao_id = (SELECT id FROM public.materiais WHERE nome = 'Laminação polimérica'),
       material_tinta_id = (SELECT id FROM public.materiais WHERE nome = 'Tinta solvente (conjunto)'),
       material_cola_id = (SELECT id FROM public.materiais WHERE nome = 'Cola para acrílico antimancha 250 ml');

ALTER TABLE public.trofeu_regras
  ALTER COLUMN material_vinil_id SET NOT NULL,
  ALTER COLUMN material_laminacao_id SET NOT NULL,
  ALTER COLUMN material_tinta_id SET NOT NULL,
  ALTER COLUMN material_cola_id SET NOT NULL;

COMMENT ON COLUMN public.trofeu_regras.material_vinil_id IS 'Vinil da decoração (custo por m²). O servidor do troféu lê o custo por este id.';
COMMENT ON COLUMN public.trofeu_regras.material_laminacao_id IS 'Laminação da decoração (custo por m²).';
COMMENT ON COLUMN public.trofeu_regras.material_tinta_id IS 'Tinta da plotter (custo por ml).';
COMMENT ON COLUMN public.trofeu_regras.material_cola_id IS 'Cola do acrílico (custo por frasco; cola_ml_por_frasco diz quantos ml rende).';

UPDATE public.trofeu_regras
   SET velocidade_de_corte = '{"2": 1.9, "3": 1.15, "6": 0.48, "10": 0.2}'::jsonb,
       gravacao_min_por_m2 = 520.00,
       provisorios = ARRAY['tinta_ml_m2', 'cola_ml_por_juncao', 'gravacao_min_por_m2', 'preparo_do_laser_min', 'velocidade_de_corte',
                           'arte_horas', 'arte_desconto', 'medidas_dos_modelos', 'espelhado_dourado_sem_nota',
                           'dtf_uv_compra_externa'];

-- ---------------------------------------------------------------------------------------------------
-- 2. O espelhado dourado: R$ 480,00 a folha (informado pelo dono, sem nota), 2,00 m² por folha presumidos
-- ---------------------------------------------------------------------------------------------------
UPDATE public.materiais
   SET custo_unitario = 240.00,
       custo_medio = 240.00,
       largura_chapa_m = 1.000, comprimento_chapa_m = 2.000,
       largura_util_m = 1.000, comprimento_util_m = 2.000,
       caracteristicas = 'Chapa de acrílico espelhado dourado 2 mm. Custo informado pelo dono em 22/11/2026, SEM nota de compra: a folha de 1,00 x 2,00 m (2,00 m²) é uma medida presumida. O valor fica nos campos de custo (o histórico, na auditoria), não neste texto, que a equipe toda lê. Confirmar a medida da folha e lançar a nota quando chegar.',
       updated_at = now()
 WHERE nome = 'Acrilico esp dourado 2mm';

UPDATE public.material_lotes l
   SET custo_unitario_snapshot = 240.00, custo_total = round(l.quantidade * 240.00, 2)
  FROM public.materiais m
 WHERE m.id = l.material_id AND m.nome = 'Acrilico esp dourado 2mm' AND l.codigo = 'ABERTURA' AND l.custo_unitario_snapshot = 87.09;

-- ---------------------------------------------------------------------------------------------------
-- 3. A DTF UV continua INATIVA, agora com o aviso de que a decoração em DTF sai por compra externa
-- ---------------------------------------------------------------------------------------------------
UPDATE public.maquinas
   SET especificacoes_comerciais = especificacoes_comerciais || jsonb_build_object(
         'aviso_22_11_2026',
         'O troféu de acrílico NÃO usa a DTF UV. Enquanto a máquina não chegar e não tiver custo por hora, velocidade, setup e valor de compra, a decoração em DTF UV sai por COMPRA EXTERNA (o adesivo DTF UV vem pronto de fornecedor e entra como matéria-prima ou serviço de terceiro). Ativar só quando esses números existirem (decisão do dono, 22/11/2026).'),
       updated_at = now()
 WHERE tipo = 'impressora_dtf_uv' AND ativa = false;

-- ---------------------------------------------------------------------------------------------------
-- 4. O registro do que mudou e do que valia antes (é daqui que se desfaz)
-- ---------------------------------------------------------------------------------------------------
INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
SELECT NULL, 'materiais', m.id, 'trofeu_dados_do_dono', jsonb_build_object(
         'migracao', '20261122300000',
         'dourado', jsonb_build_object(
           'antes', jsonb_build_object('custo_unitario', 174.18, 'custo_medio', 87.09, 'lote_abertura', 87.09, 'medida', NULL),
           'depois', jsonb_build_object('custo_unitario', 240.00, 'custo_medio', 240.00, 'lote_abertura', 240.00, 'medida', '1,00 x 2,00 m (presumida)'),
           'fonte', 'dono, 22/11/2026: folha de R$ 480,00, sem nota'),
         'laser', jsonb_build_object(
           'antes', jsonb_build_object('corte_m_min', jsonb_build_object('2', 1.5, '3', 1.0, '6', 0.4), 'gravacao_min_m2', 60),
           'depois', jsonb_build_object('corte_m_min', jsonb_build_object('2', 1.9, '3', 1.15, '6', 0.48, '10', 0.2), 'gravacao_min_m2', 520,
                                        'espessura_maxima_mm', 10),
           'fonte', 'tabela de 100 W da Forza (corte e gravação) conferida com a Aeon; 2 mm interpolado; 20% de folga; pesquisados, não medidos'),
         'dtf_uv', 'continua inativa; aviso de compra externa no cadastro da máquina')
  FROM public.materiais m
 WHERE m.nome = 'Acrilico esp dourado 2mm';

-- ---------------------------------------------------------------------------------------------------
-- 5. Conferência final: o que mudou é o que foi planejado, e só isso
-- ---------------------------------------------------------------------------------------------------
DO $final$
BEGIN
  IF (SELECT espessura_maxima_de_corte_mm FROM public.trofeu_regras) <> 10 THEN RAISE EXCEPTION 'o limite de corte deveria ser 10 mm'; END IF;
  IF (SELECT velocidade_de_corte FROM public.trofeu_regras) <> '{"2": 1.9, "3": 1.15, "6": 0.48, "10": 0.2}'::jsonb THEN
    RAISE EXCEPTION 'velocidades de corte diferentes das planejadas';
  END IF;
  IF (SELECT gravacao_min_por_m2 FROM public.trofeu_regras) <> 520 THEN RAISE EXCEPTION 'gravação deveria ser 520 min/m²'; END IF;
  IF NOT ('espelhado_dourado_sem_nota' = ANY (SELECT unnest(provisorios) FROM public.trofeu_regras))
     OR NOT ('dtf_uv_compra_externa' = ANY (SELECT unnest(provisorios) FROM public.trofeu_regras))
     OR 'custo_do_espelhado_dourado' = ANY (SELECT unnest(provisorios) FROM public.trofeu_regras) THEN
    RAISE EXCEPTION 'a lista de provisórios não ficou como planejada';
  END IF;
  IF (SELECT custo_unitario FROM public.materiais WHERE nome = 'Acrilico esp dourado 2mm') <> 240
     OR (SELECT custo_medio FROM public.materiais WHERE nome = 'Acrilico esp dourado 2mm') <> 240 THEN
    RAISE EXCEPTION 'o dourado deveria estar a R$ 240,00 o m²';
  END IF;
  IF (SELECT custo_total FROM public.material_lotes l JOIN public.materiais m ON m.id = l.material_id
       WHERE m.nome = 'Acrilico esp dourado 2mm' AND l.codigo = 'ABERTURA') <> 960 THEN
    RAISE EXCEPTION 'o lote de abertura do dourado deveria valer R$ 960,00 (4 m² a R$ 240,00)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.maquinas WHERE tipo = 'impressora_dtf_uv' AND ativa) THEN
    RAISE EXCEPTION 'a DTF UV não pode ficar ativa nesta migração';
  END IF;
  IF (SELECT count(*) FROM public.maquinas WHERE tipo = 'impressora_dtf_uv' AND especificacoes_comerciais ? 'aviso_22_11_2026') <> 1 THEN
    RAISE EXCEPTION 'o aviso da DTF UV não entrou';
  END IF;
  IF (SELECT count(*) FROM public.trofeu_regras r
        JOIN public.materiais v ON v.id = r.material_vinil_id AND v.unidade = 'm²'
        JOIN public.materiais l ON l.id = r.material_laminacao_id AND l.unidade = 'm²'
        JOIN public.materiais t ON t.id = r.material_tinta_id AND t.unidade = 'ml'
        JOIN public.materiais c ON c.id = r.material_cola_id AND c.unidade = 'un') <> 1 THEN
    RAISE EXCEPTION 'os materiais da decoração e da cola não ficaram apontados com a unidade certa';
  END IF;
  IF has_table_privilege('anon', 'public.trofeu_regras', 'SELECT') THEN RAISE EXCEPTION 'anon passou a ler trofeu_regras'; END IF;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (os valores de antes estão no logs_auditoria, acao 'trofeu_dados_do_dono'):
--   ALTER TABLE public.trofeu_regras DROP COLUMN espessura_maxima_de_corte_mm, DROP COLUMN material_vinil_id, DROP COLUMN material_laminacao_id,
--          DROP COLUMN material_tinta_id, DROP COLUMN material_cola_id, DROP COLUMN cola_ml_por_frasco;
--   UPDATE public.trofeu_regras SET velocidade_de_corte = '{"2": 1.5, "3": 1.0, "6": 0.4}'::jsonb, gravacao_min_por_m2 = 60.00,
--          provisorios = ARRAY['tinta_ml_m2', 'cola_ml_por_juncao', 'gravacao_min_por_m2', 'preparo_do_laser_min', 'velocidade_de_corte',
--                              'arte_horas', 'arte_desconto', 'medidas_dos_modelos', 'custo_do_espelhado_dourado'];
--   UPDATE public.materiais SET custo_unitario = 174.18, custo_medio = 87.09, largura_chapa_m = NULL, comprimento_chapa_m = NULL,
--          largura_util_m = NULL, comprimento_util_m = NULL, caracteristicas = NULL WHERE nome = 'Acrilico esp dourado 2mm';
--   UPDATE public.material_lotes l SET custo_unitario_snapshot = 87.09, custo_total = 348.36 FROM public.materiais m
--    WHERE m.id = l.material_id AND m.nome = 'Acrilico esp dourado 2mm' AND l.codigo = 'ABERTURA';
--   UPDATE public.maquinas SET especificacoes_comerciais = especificacoes_comerciais - 'aviso_22_11_2026' WHERE tipo = 'impressora_dtf_uv';
-- =====================================================================================================
