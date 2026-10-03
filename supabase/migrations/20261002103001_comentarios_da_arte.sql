-- ============================================================================
-- Onda 17 — o botão de comentário da fila de Design passa a COMENTAR
-- ============================================================================
--
-- Em /design o botão com o ícone de balão de comentário chamava `concluir`:
-- quem queria deixar um recado sobre a arte marcava o arquivo como FINAL DE
-- PRODUÇÃO e ele sumia da fila. E não havia onde o recado morar:
--
--   arquivo_aprovacoes.comentario  é o comentário de uma DECISÃO (CHECK só
--                                  aceita solicitada/aprovado/reprovado/ajuste);
--                                  gravar recado ali contaria como resposta do
--                                  cliente em vw_aprovacoes_orcamento
--   arquivos.observacao            é UM texto, sobrescrito a cada aprovação por
--                                  registrar_aprovacao_interna
--   os_tarefa_comentarios          exige tarefa — a arte de orçamento não tem
--
-- Por isso uma tabela nova, só de recados, que não muda status de nada.
--
-- Quem lê: quem vê a arte (arquivos.read ou arquivos.approve — a mesma régua da
-- rota /design e do bucket arquivos-clientes). Quem escreve: só a função
-- `comentar_arte`, que carimba o autor pela sessão. Não há UPDATE nem DELETE:
-- recado é histórico, e histórico editável não serve de prova de nada.
--
-- O nome do autor é guardado na linha (autor_nome) porque a policy de
-- `usuarios` só deixa cada um ler a si mesmo: o operador veria "—" no recado
-- de todo colega.
--
-- Retrato do banco vivo: ensaiado com reversão (operador comenta e lê; insert e
-- update direto barrados com 42501; texto vazio recusado; financeiro recusado e
-- lê 0; anon barrado) e depois aplicado.

CREATE TABLE IF NOT EXISTS public.arquivo_comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  autor_nome text,
  comentario text NOT NULL CHECK (length(btrim(comentario)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arquivo_comentarios_arquivo_idx
  ON public.arquivo_comentarios (arquivo_id, created_at);

-- O projeto dá ALL para anon e authenticated em toda tabela nova (default
-- privileges). Fecha tudo e devolve só a leitura; a RLS decide quem.
ALTER TABLE public.arquivo_comentarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arquivo_comentarios FROM anon, authenticated;
GRANT SELECT ON public.arquivo_comentarios TO authenticated;
GRANT ALL ON public.arquivo_comentarios TO service_role;

-- Sem DROP POLICY: a migração só acrescenta. Reaplicar não duplica nem apaga.
DO $p$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'arquivo_comentarios'
                  AND policyname = 'comentarios da arte: le quem ve a arte') THEN
    CREATE POLICY "comentarios da arte: le quem ve a arte" ON public.arquivo_comentarios
      FOR SELECT TO authenticated
      USING (public.has_permission((SELECT auth.uid()), 'arquivos.read')
          OR public.has_permission((SELECT auth.uid()), 'arquivos.approve'));
  END IF;
END $p$;

CREATE OR REPLACE FUNCTION public.comentar_arte(p_arquivo_id uuid, p_comentario text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_texto text := btrim(coalesce(p_comentario, ''));
        v_autor uuid; v_nome text; v_id uuid; v_criado timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '28000'; END IF;
  -- A mesma régua de quem abre /design e de quem lê o bucket: quem vê a arte
  -- pode comentar. Comentar não aprova, não reprova e não conclui nada.
  IF NOT (public.has_permission(v_uid, 'arquivos.read') OR public.has_permission(v_uid, 'arquivos.approve')) THEN
    RAISE EXCEPTION 'Permissão necessária: arquivos.read' USING ERRCODE = '42501';
  END IF;
  -- Mensagens com acento de propósito: `mensagemErro` (src/lib/erros.ts) só
  -- deixa passar texto que reconhece como português; sem acento a tela
  -- trocaria o motivo por "Não foi possível concluir a operação".
  IF v_texto = '' THEN RAISE EXCEPTION 'Escreva o comentário antes de enviar.' USING ERRCODE = '22023'; END IF;
  IF length(v_texto) > 2000 THEN
    RAISE EXCEPTION 'Comentário longo demais: o limite é 2.000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arquivos WHERE id = p_arquivo_id) THEN
    RAISE EXCEPTION 'Arte não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Conta de login sem linha em `usuarios` grava autor nulo em vez de estourar
  -- a FK e perder o recado.
  SELECT u.id, u.nome INTO v_autor, v_nome FROM public.usuarios u WHERE u.id = v_uid;

  INSERT INTO public.arquivo_comentarios (arquivo_id, autor_id, autor_nome, comentario)
  VALUES (p_arquivo_id, v_autor, v_nome, v_texto)
  RETURNING id, created_at INTO v_id, v_criado;

  RETURN jsonb_build_object('id', v_id, 'arquivo_id', p_arquivo_id, 'autor_nome', v_nome,
                            'comentario', v_texto, 'created_at', v_criado);
END $f$;

REVOKE ALL ON FUNCTION public.comentar_arte(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comentar_arte(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
