-- Preencher a pasta do produto com o que o sistema já sabe (03/11/2026, OK do
-- dono: "pode executar"). A nota "Pronto para a IA" mostrou 5,6 de 10 em média;
-- parte do que faltava já estava em outra tabela, só não tinha sido ligada.
-- Aqui só entra o que se DERIVA de dado que já existe: nada de preço, custo,
-- texto para o cliente nem revisão de quem atende (essa é um aceite de pessoa).
--
-- Tudo idempotente: roda de novo sem repetir e sem sobrescrever o que alguém
-- já preencheu.
--
-- 1. Medida padrão da pasta = o tamanho pronto marcado como padrão do produto
--    (`produto_tamanhos.padrao`). Só em produto vendido por área (m²) e só onde
--    a pasta ainda não tem medida. A medida padrão alimenta a conta de
--    acabamento e a prévia das fórmulas na pasta; nenhum preço de orçamento a lê.
-- 2. Material principal = a bobina da ficha, quando a ficha tem UMA só bobina
--    (material com largura de bobina cadastrada). É o que liga o cartão de
--    aproveitamento da bobina no item do orçamento (só informa, não muda preço)
--    e agrupa a metragem por material. Ficha com duas bobinas (lona + vinil)
--    fica de fora: escolher uma é decisão de quem conhece o trabalho. Material
--    sem largura de bobina (chapa, tinta) nunca é escolhido: o cartão pediria
--    "cadastre a largura da bobina" para um produto que não sai de bobina.
-- 3. As três placas (ACM, PS e PVC) ganham as perguntas que os outros produtos
--    de comunicação visual já têm, com a resposta já marcada para não travar o
--    item: arte pronta (opcional), instalação por nossa conta ("Não, o cliente
--    instala") e embalagem ("Não", a IA só marca se o cliente falar).

-- 1. Medida padrão.
WITH padrao AS (
  SELECT DISTINCT ON (t.produto_id) t.produto_id, t.largura, t.altura
    FROM public.produto_tamanhos t
   WHERE t.padrao AND t.largura > 0 AND t.altura > 0
   ORDER BY t.produto_id, t.ordem, t.created_at
)
UPDATE public.produto_ficha f
   SET largura_padrao_m = p.largura,
       altura_padrao_m = p.altura,
       updated_at = now()
  FROM padrao p
  JOIN public.produtos pr ON pr.id = p.produto_id
 WHERE f.produto_id = p.produto_id
   AND pr.ativo
   AND pr.tipo::text <> 'servico'
   AND lower(replace(coalesce(pr.unidade, ''), '²', '2')) = 'm2'
   AND (coalesce(f.largura_padrao_m, 0) <= 0 OR coalesce(f.altura_padrao_m, 0) <= 0);

-- 2. Material principal.
WITH bobinas AS (
  SELECT pm.produto_id,
         (array_agg(m.id))[1] AS material_id,
         count(DISTINCT m.id) AS quantas
    FROM public.produto_materiais pm
    JOIN public.materiais m ON m.id = pm.material_id
   WHERE coalesce(m.largura_bobina_m, 0) > 0
   GROUP BY pm.produto_id
)
UPDATE public.produtos p
   SET material_principal_id = b.material_id,
       updated_at = now()
  FROM bobinas b
 WHERE b.produto_id = p.id
   AND b.quantas = 1
   AND p.ativo
   AND p.tipo::text <> 'servico'
   AND p.material_principal_id IS NULL;

-- 3. Perguntas das placas. Os processos são achados pelo nome, para valer em
-- qualquer banco; se algum não existir, nada é inserido.
WITH placas AS (
  SELECT p.id
    FROM public.produtos p
   WHERE p.ativo AND p.tipo::text = 'produto' AND p.familia = 'Placas'
),
proc AS (
  SELECT
    (SELECT id FROM public.processos WHERE nome = 'Arte final' LIMIT 1) AS arte,
    (SELECT id FROM public.processos WHERE nome = 'Instalação' LIMIT 1) AS instalacao,
    (SELECT id FROM public.processos WHERE nome = 'Deslocamento de equipe' LIMIT 1) AS deslocamento,
    (SELECT id FROM public.processos WHERE nome = 'Embalagem' LIMIT 1) AS embalagem
)
INSERT INTO public.produto_perguntas
  (produto_id, pergunta, descricao, obrigatoria, tipo_resposta, respostas, acoes, ordem, resposta_padrao, nao_perguntar, ia_modo, finalidade)
SELECT p.id, q.pergunta, NULL, q.obrigatoria, 'unica', q.respostas, q.acoes, q.ordem, q.padrao, false, q.ia_modo, 'cobranca'
  FROM placas p
  CROSS JOIN proc
  CROSS JOIN LATERAL (VALUES
    ('A arte está pronta?', false,
       '["Sim, arte pronta", "Não, precisamos criar"]'::jsonb,
       jsonb_build_array(jsonb_build_object('resposta', 'Não, precisamos criar', 'processo_id', proc.arte)),
       1, NULL::text, 'perguntar'),
    ('A instalação é por nossa conta?', true,
       '["Sim, instalamos", "Não, o cliente instala"]'::jsonb,
       jsonb_build_array(
         jsonb_build_object('resposta', 'Sim, instalamos', 'processo_id', proc.instalacao),
         jsonb_build_object('resposta', 'Sim, instalamos', 'processo_id', proc.deslocamento)),
       10, 'Não, o cliente instala', 'perguntar'),
    ('Precisa embalar para transporte?', true,
       '["Sim", "Não"]'::jsonb,
       jsonb_build_array(jsonb_build_object('resposta', 'Sim', 'processo_id', proc.embalagem)),
       20, 'Não', 'seguir_cliente')
  ) AS q(pergunta, obrigatoria, respostas, acoes, ordem, padrao, ia_modo)
 WHERE proc.arte IS NOT NULL AND proc.instalacao IS NOT NULL
   AND proc.deslocamento IS NOT NULL AND proc.embalagem IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.produto_perguntas x
      WHERE x.produto_id = p.id AND x.pergunta = q.pergunta
   );
