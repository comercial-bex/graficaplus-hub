-- Produto novo volta a entrar no cadastro
-- ---------------------------------------------------------------------------
-- Desde a migração 20260924170000 (custo cheio da peça) NENHUM produto novo
-- entrava: o INSERT em `produtos` caía com
--
--     record "new" has no field "produto_id"
--
-- e a edição de tempo de produção ou de máquina padrão caía do mesmo jeito.
-- Ninguém viu porque o último produto real é de 22/08 — o defeito ficou
-- esperando o primeiro cadastro, e foi achado em 01/10/2026 por um verificador
-- que tentou inserir um produto de teste.
--
-- A causa é o gatilho `tg_produto_recalcula_composicao`, que serve a duas
-- tabelas (`produtos` e `produto_materiais`) e decidia o id com
--
--     CASE TG_TABLE_NAME WHEN 'produtos' THEN COALESCE(NEW.id, OLD.id)
--                        ELSE COALESCE(NEW.produto_id, OLD.produto_id) END
--
-- O PL/pgSQL resolve a expressão INTEIRA antes de escolher o ramo: na tabela
-- `produtos` o campo `NEW.produto_id` não existe, e a expressão não compila —
-- mesmo o ramo certo sendo o outro. O bloco EXCEPTION que protege o cadastro
-- vinha DEPOIS dessa linha, então não segurava nada.
--
-- Com IF, cada ramo só é lido quando é o dele. O resto da função é igual.
--
-- Ensaiado (DO ... RAISE EXCEPTION, tudo desfeito): antes, o INSERT falhava com
-- a mensagem acima; depois, inserir produto, editar tempo, editar máquina
-- padrão, e incluir, alterar e apagar linha da receita passam, e a
-- precificação do produto novo é criada (1 linha).

CREATE OR REPLACE FUNCTION public.tg_produto_recalcula_composicao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_produto uuid;
BEGIN
  IF TG_TABLE_NAME = 'produtos' THEN
    IF TG_OP = 'DELETE' THEN v_produto := OLD.id; ELSE v_produto := NEW.id; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN v_produto := OLD.produto_id; ELSE v_produto := NEW.produto_id; END IF;
  END IF;
  IF v_produto IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM public.sincronizar_precificacao_do_produto(v_produto);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Não deu para recompor o custo do produto %: %', v_produto, SQLERRM;
  END;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.tg_produto_recalcula_composicao() FROM PUBLIC, anon, authenticated;
