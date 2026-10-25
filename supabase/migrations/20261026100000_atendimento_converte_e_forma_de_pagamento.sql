-- Fase 1 e 2 do diagnóstico ponta a ponta (25/10/2026, docs/diagnostico-ponta-a-ponta-2026-10-25.md).
--
-- 1) O ATENDIMENTO (vendedor) passa a autorizar e converter o orçamento em OS. Antes só admin e gestor
--    convertiam: o vendedor fechava com o cliente e a OS esperava alguém com a permissão (hoje 8
--    orçamentos aprovados esperando). A conversão continua passando pelas mesmas travas do banco
--    (valor aprovado, alçada de desconto, item sem custo) e o desconto fora da alçada segue com quem
--    tem "Aprovar desconto" (gerente e admin). Espelho em src/lib/permissions.ts.
-- 2) Forma de pagamento sempre em minúsculas: o banco tinha "PIX"/"pix" e "DINHEIRO"/"dinheiro" (2
--    lançamentos de 19/10 vieram em maiúsculas) e o relatório por forma contava como coisas diferentes.
-- Desfazer: DELETE FROM perfil_permissoes WHERE perfil = 'vendedor' AND permissao IN
--   ('orcamentos.approve','orcamentos.convert'); DROP TRIGGER tg_pagamento_forma_minuscula ON pagamentos.
INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT 'vendedor'::app_role, p FROM (VALUES ('orcamentos.approve'), ('orcamentos.convert')) v(p)
WHERE NOT EXISTS (SELECT 1 FROM public.perfil_permissoes x WHERE x.perfil::text = 'vendedor' AND x.permissao = v.p);

UPDATE public.pagamentos SET forma_pagamento = lower(btrim(forma_pagamento))
 WHERE forma_pagamento IS DISTINCT FROM lower(btrim(forma_pagamento));

CREATE OR REPLACE FUNCTION public.tg_pagamento_forma_minuscula() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  NEW.forma_pagamento := lower(btrim(NEW.forma_pagamento));
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS tg_pagamento_forma_minuscula ON public.pagamentos;
CREATE TRIGGER tg_pagamento_forma_minuscula BEFORE INSERT OR UPDATE OF forma_pagamento ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_pagamento_forma_minuscula();
