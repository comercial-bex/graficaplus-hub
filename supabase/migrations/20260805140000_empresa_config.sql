-- Dados do emissor em tabela, não em código.
--
-- src/lib/pdf/empresa.ts trazia os dados fixos ("SUA EMPRESA LTDA", CNPJ
-- 00.000.000/0001-00) com um comentário dizendo que migraríamos para uma tabela
-- depois. Enquanto isso, qualquer orçamento enviado a cliente sai com CNPJ
-- inválido, e corrigir exige alterar código e republicar — ninguém do escritório
-- consegue. A inscrição estadual, que o documento de referência traz, não tinha
-- nem onde ser guardada.
--
-- Linha única (id fixo em true, o mesmo padrão de config_precificacao_3d).

CREATE TABLE IF NOT EXISTS public.empresa_config (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  nome                text NOT NULL DEFAULT 'BEX PRINT OS',
  razao_social        text,
  cnpj                text,
  inscricao_estadual  text,
  slogan              text,
  endereco            text,
  bairro              text,
  cidade              text,
  estado              text,
  cep                 text,
  telefones           text,
  email               text,
  site                text,
  -- caminho no bucket de logos; o PDF assina a URL na hora de renderizar
  logo_path           text,
  cor_primaria        text DEFAULT '#7B2E8B',
  -- texto do rodapé com as condições gerais que hoje estão fixas no componente
  condicoes_gerais    text,
  atualizado_por      uuid REFERENCES public.usuarios(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- FK precisa de índice próprio: o Postgres só cria automático para PK/UNIQUE.
CREATE INDEX IF NOT EXISTS idx_empresa_config_atualizado_por
  ON public.empresa_config (atualizado_por);

INSERT INTO public.empresa_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.empresa_config ENABLE ROW LEVEL SECURITY;

-- Todo mundo autenticado lê (o cabeçalho do documento não é sigiloso);
-- só quem administra configuração escreve. A permissão é `configuracoes.manage`
-- (hoje só o perfil admin) — `settings.manage` não existe neste sistema, só
-- `impressao3d.settings.manage`, que é de outro módulo.
DROP POLICY IF EXISTS empresa_config_leitura ON public.empresa_config;
CREATE POLICY empresa_config_leitura ON public.empresa_config
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS empresa_config_escrita ON public.empresa_config;
CREATE POLICY empresa_config_escrita ON public.empresa_config
  FOR UPDATE TO authenticated
  USING (has_permission((select auth.uid()), 'configuracoes.manage'))
  WITH CHECK (has_permission((select auth.uid()), 'configuracoes.manage'));

GRANT SELECT, UPDATE ON public.empresa_config TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_empresa_config_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  NEW.updated_at := now();
  NEW.atualizado_por := (select auth.uid());
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_empresa_config_touch ON public.empresa_config;
CREATE TRIGGER tg_empresa_config_touch
  BEFORE UPDATE ON public.empresa_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_empresa_config_touch();
