-- Expande arquivos conforme PRD e protege histórico físico/lógico.
CREATE TYPE public.tipo_arquivo AS ENUM ('arte','briefing','referencia','producao','orcamento','comprovante','outro');
CREATE TYPE public.status_arquivo AS ENUM ('ativo','substituido','inativo','aprovado','rejeitado');

ALTER TABLE public.arquivos
  ADD COLUMN IF NOT EXISTS tipo public.tipo_arquivo NOT NULL DEFAULT 'outro',
  ADD COLUMN IF NOT EXISTS status public.status_arquivo NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS tarefa_id UUID REFERENCES public.tarefas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversa_id UUID,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS aprovado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_aprovacao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observacao TEXT,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

UPDATE public.arquivos
SET status = CASE
    WHEN ativo = false THEN 'inativo'::public.status_arquivo
    WHEN substituido_por IS NOT NULL THEN 'substituido'::public.status_arquivo
    WHEN final_producao = true THEN 'aprovado'::public.status_arquivo
    ELSE status
  END;

CREATE INDEX IF NOT EXISTS idx_arquivos_status ON public.arquivos(status, ativo);
CREATE INDEX IF NOT EXISTS idx_arquivos_os_nome_versao ON public.arquivos(os_id, nome, versao DESC);
CREATE INDEX IF NOT EXISTS idx_arquivos_tarefa ON public.arquivos(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_arquivos_conversa ON public.arquivos(conversa_id);

CREATE OR REPLACE FUNCTION public.prevent_delete_arquivos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Arquivos não podem ser apagados; marque como substituido ou inativo.';
END $$;

DROP TRIGGER IF EXISTS tg_prevent_delete_arquivos ON public.arquivos;
CREATE TRIGGER tg_prevent_delete_arquivos
  BEFORE DELETE ON public.arquivos
  FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_arquivos();

CREATE OR REPLACE FUNCTION public.sync_arquivo_aprovacao()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'arte' AND NEW.arquivo_id IS NOT NULL THEN
    UPDATE public.arquivos
    SET status = CASE WHEN NEW.aprovado THEN 'aprovado'::public.status_arquivo ELSE 'rejeitado'::public.status_arquivo END,
        aprovado_por = NEW.usuario_id,
        data_aprovacao = NEW.created_at,
        observacao = COALESCE(NEW.observacao, observacao),
        ativo = true
    WHERE id = NEW.arquivo_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_sync_arquivo_aprovacao ON public.aprovacoes;
CREATE TRIGGER tg_sync_arquivo_aprovacao
  AFTER INSERT ON public.aprovacoes
  FOR EACH ROW EXECUTE FUNCTION public.sync_arquivo_aprovacao();
