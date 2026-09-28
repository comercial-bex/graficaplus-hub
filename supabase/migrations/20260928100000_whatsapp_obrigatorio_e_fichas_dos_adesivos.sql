-- ============================================================================
-- O WhatsApp do cliente, e a ficha dos nove adesivos
-- ============================================================================

-- ------------------------------------------ 1. o telefone que recebe mensagem
-- É por ele que sai o orçamento em PDF e o acompanhamento da OS. Sem ele o
-- cliente fica sem canal nenhum.
--
-- Só "estar preenchido" não basta. `normalize_whatsapp_phone` aceita calada
-- dois casos que não recebem mensagem:
--
--   '96 3222-1234'                  -> 9632221234               (fixo)
--   '96 99131-8834 / 96 98140-8722' -> 9699131883496981408722   (dois colados)
--
-- O segundo é o pior: 22 dígitos gravados como se fossem um telefone. Quem
-- digita os dois números do cliente na mesma caixa não vê nada de errado, e a
-- mensagem simplesmente nunca chega.
CREATE OR REPLACE FUNCTION public.telefone_recebe_whatsapp(p_telefone text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $f$
  -- Celular brasileiro: DDD (2 digitos, 11 a 99) + 9 + 8 digitos.
  SELECT CASE
    WHEN p_telefone IS NULL THEN false
    ELSE COALESCE(public.normalize_whatsapp_phone(p_telefone) ~ '^[1-9][1-9]9[0-9]{8}$', false)
  END;
$f$;

REVOKE ALL ON FUNCTION public.telefone_recebe_whatsapp(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telefone_recebe_whatsapp(text) TO authenticated;

-- GATILHO, e não CHECK constraint, por duas razões medidas na hora de aplicar:
--
-- 1. Um CHECK dá mensagem crua do Postgres; o gatilho diz em português o que
--    fazer, e distingue "não informou" de "informou um fixo".
-- 2. `NOT VALID` **não** protege a linha antiga de edições futuras — ele só
--    pula o scan na criação. Com o CHECK no lugar, editar o E-MAIL do cliente
--    "ELEICAO 2026 EDI DOS SANTOS SOUZA" (cadastrado sem telefone em 04/09)
--    passava a ser recusado. O gatilho em `UPDATE OF telefone` com
--    `WHEN (NEW.telefone IS DISTINCT FROM OLD.telefone)` só olha quando o
--    telefone muda, então o cadastro antigo continua editável no resto e
--    segue aparecendo na pendência `cliente_sem_contato` até alguém perguntar
--    o número ao cliente.
CREATE OR REPLACE FUNCTION public.tg_cliente_precisa_de_whatsapp()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $f$
BEGIN
  IF public.telefone_recebe_whatsapp(NEW.telefone) THEN RETURN NEW; END IF;

  IF COALESCE(btrim(NEW.telefone), '') = '' THEN
    RAISE EXCEPTION 'Informe o WhatsApp do cliente. E por ele que sai o orcamento em PDF e o acompanhamento da OS.'
      USING ERRCODE = '22023', HINT = 'Formato: (96) 99999-9999';
  END IF;

  RAISE EXCEPTION 'O numero % nao recebe WhatsApp. Precisa ser um celular com DDD e o 9 na frente.', NEW.telefone
    USING ERRCODE = '22023',
          HINT = 'Telefone fixo nao recebe. Se o cliente tem dois numeros, guarde um aqui e o outro em Contatos.';
END $f$;

REVOKE ALL ON FUNCTION public.tg_cliente_precisa_de_whatsapp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_cliente_precisa_de_whatsapp ON public.clientes;
CREATE TRIGGER aa_cliente_precisa_de_whatsapp
  BEFORE INSERT ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.tg_cliente_precisa_de_whatsapp();

DROP TRIGGER IF EXISTS ab_cliente_precisa_de_whatsapp_update ON public.clientes;
CREATE TRIGGER ab_cliente_precisa_de_whatsapp_update
  BEFORE UPDATE OF telefone ON public.clientes
  FOR EACH ROW
  WHEN (NEW.telefone IS DISTINCT FROM OLD.telefone)
  EXECUTE FUNCTION public.tg_cliente_precisa_de_whatsapp();

-- ENSAIADO, com reversão:
--   sem telefone              -> barrado
--   fixo (96 3222-1234)       -> barrado
--   dois números colados      -> barrado
--   (96) 98121-6527           -> aceito, gravado como 96981216527
--   editar depois para fixo   -> barrado
--   editar OUTRO campo do cliente antigo sem telefone -> continua funcionando


-- ------------------------------- 2. a ficha dos nove adesivos de medida fixa
-- Nove produtos da linha de campanha estavam sem ficha técnica de material. Não
-- foi preciso inventar nada: o material já estava escolhido em
-- `produtos.material_principal_id`, a medida está no nome do produto, e o
-- espaçamento entre peças (3 mm) e a perda de refile (8%) já estavam
-- cadastrados em `produtos.espacamento_pecas_m` e `custos_tabela.pct_perda_material`.
--
-- A conta: (largura + espaçamento) × (altura + espaçamento) × (1 + refile).
--
--   Praguinha 7 × 7      0,0058 m²  vinil branco      R$  0,06
--   Praguinha 10 × 10    0,0115 m²  vinil branco      R$  0,11
--   Pragão 15 × 15       0,0253 m²  vinil branco      R$  0,24
--   Pragão 30 × 30       0,0992 m²  vinil branco      R$  0,94
--   Bola Leitoso 33×33   0,1198 m²  vinil branco      R$  1,14
--   Testeira 90 × 12     0,1200 m²  vinil branco      R$  1,14
--   Bolão Leitoso 48×48  0,2520 m²  vinil branco      R$  2,39
--   Perfurado 90 × 33    0,3248 m²  vinil perfurado   R$  7,15
--   Perfurado 90 × 50    0,4905 m²  vinil perfurado   R$ 10,79
--
-- Vale olhar para o Pragão 15 × 15: R$ 0,24 de material, enquanto o avanço da
-- plotter perde R$ 3,42 de vinil por trabalho. O desperdício de pôr a máquina
-- para rodar é catorze vezes a peça. É o argumento da taxa mínima, em número.
WITH medidas(nome, larg, alt) AS (VALUES
  ('Adesivo Praguinha 7 × 7 cm',    0.07, 0.07),
  ('Adesivo Praguinha 10 × 10 cm',  0.10, 0.10),
  ('Pragão 15 × 15 cm',             0.15, 0.15),
  ('Pragão 30 × 30 cm',             0.30, 0.30),
  ('Bola Leitoso 33 × 33 cm',       0.33, 0.33),
  ('Bolão Leitoso 48 × 48 cm',      0.48, 0.48),
  ('Testeira 90 × 12 cm',           0.90, 0.12),
  ('Adesivo Perfurado 90 × 33 cm',  0.90, 0.33),
  ('Adesivo Perfurado 90 × 50 cm',  0.90, 0.50)
),
perda AS (SELECT COALESCE(max(valor),0)/100 AS pct FROM public.custos_tabela WHERE codigo='pct_perda_material')
INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, observacao)
SELECT p.id, p.material_principal_id,
       round(((m.larg + p.espacamento_pecas_m) * (m.alt + p.espacamento_pecas_m)
              * (1 + (SELECT pct FROM perda)))::numeric, 4),
       format('%s x %s m + %s m de espacamento entre pecas, mais %s%% de refile',
              m.larg, m.alt, p.espacamento_pecas_m, (SELECT pct*100 FROM perda)::int)
FROM medidas m
JOIN public.produtos p ON p.nome = m.nome
WHERE p.material_principal_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id);

-- O gatilho da Onda 2 recompôs o custo dos nove sozinho.
-- A pendência `produto_sem_ficha` caiu de 14 para 5.
--
-- OS CINCO QUE SOBRARAM não são deriváveis e precisam de decisão:
--   Impressão A3 / A4 colorida   papel couché 150g não existe como material
--   Letra caixa em PVC           a chapa cadastrada é PVC 3mm, a peça é 10mm
--   Cartão de visita (milheiro)  terceirizado — couché 300g, 1000 un
--   Panfleto A5 (milheiro)       terceirizado — couché 115g, 1000 un
-- Os dois últimos talvez devam ser marcados como serviço, se a gráfica compra
-- pronto e revende.
