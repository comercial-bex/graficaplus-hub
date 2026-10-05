ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS tipo_produto text;
GRANT SELECT (tipo_produto), INSERT (tipo_produto), UPDATE (tipo_produto) ON public.orcamento_itens TO authenticated;
GRANT ALL ON public.orcamento_itens TO service_role;