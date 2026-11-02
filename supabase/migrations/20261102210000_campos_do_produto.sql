-- Aba "Campos" da pasta do produto (fase 2 do plano de 02/11/2026, como o
-- Holdprint): campos que o item do orçamento pergunta só para informar a
-- produção e a arte (texto da placa, cor, nome no brinde), sem mexer no preço.
--
-- Eles moram na mesma tabela das perguntas do Checklist, porque o item já
-- sabe perguntar, gravar em `orcamento_itens.respostas` e mostrar no resumo.
-- A diferença é a finalidade: `cobranca` (pode acrescentar processo e cobrar)
-- ou `informacao` (nunca acrescenta processo). As 128 perguntas de hoje
-- continuam `cobranca`.
--
-- `produto_perguntas` dá SELECT por tabela (não coluna a coluna), então a
-- coluna nova nasce visível para quem já lia a tabela. Conferido em
-- information_schema.role_table_grants antes de escrever esta migração.

ALTER TABLE public.produto_perguntas
  ADD COLUMN IF NOT EXISTS finalidade text NOT NULL DEFAULT 'cobranca';

ALTER TABLE public.produto_perguntas
  DROP CONSTRAINT IF EXISTS produto_perguntas_finalidade_valida;
ALTER TABLE public.produto_perguntas
  ADD CONSTRAINT produto_perguntas_finalidade_valida
  CHECK (finalidade IN ('cobranca', 'informacao'));

-- Campo de informação não acrescenta processo: a ação é o que cobra.
ALTER TABLE public.produto_perguntas
  DROP CONSTRAINT IF EXISTS produto_perguntas_informacao_sem_acao;
ALTER TABLE public.produto_perguntas
  ADD CONSTRAINT produto_perguntas_informacao_sem_acao
  CHECK (finalidade <> 'informacao' OR acoes IS NULL OR jsonb_array_length(acoes) = 0);

COMMENT ON COLUMN public.produto_perguntas.finalidade IS
  'cobranca: pergunta do Checklist, pode acrescentar processo e cobrar. informacao: campo da aba Campos, só informa a produção e a arte.';
