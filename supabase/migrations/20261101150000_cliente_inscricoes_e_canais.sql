-- Ficha do cliente no desenho do Holdprint (01/11/2026): inscrições fiscais
-- discriminadas e canais de contato além do WhatsApp principal.
--
-- No Holdprint o cliente tem "Documentos" (inscrição municipal, "Possui
-- inscrição estadual" e a inscrição estadual, que só habilita quando a resposta
-- é Sim) e "Canais de contato" (telefones 2 e 3, e-mail para a nota fiscal,
-- e-mail para o boleto e site). Aqui só havia nome, documento, e-mail, um
-- telefone e o endereço: quem precisa da inscrição para emitir nota ou do
-- e-mail certo para mandar o boleto anotava em "observações".
--
-- O telefone principal continua sendo o WhatsApp obrigatório do cliente
-- (aa_cliente_precisa_de_whatsapp); os telefones 2 e 3 são livres, porque são
-- contatos e não o canal do atendimento.
--
-- A inscrição estadual só existe quando a resposta é "sim": o banco recusa a
-- combinação inscrição preenchida com "isento" ou "não possui", que era o
-- retrato de um cadastro que mudou de ideia e deixou o número velho para trás.
--
-- Todas as colunas novas nascem vazias ou "nao_informado", então nenhum cliente
-- existente muda. As permissões são as da tabela inteira.

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS possui_inscricao_estadual text NOT NULL DEFAULT 'nao_informado',
  ADD COLUMN IF NOT EXISTS inscricao_estadual text,
  ADD COLUMN IF NOT EXISTS inscricao_municipal text,
  ADD COLUMN IF NOT EXISTS telefone_2 text,
  ADD COLUMN IF NOT EXISTS telefone_3 text,
  ADD COLUMN IF NOT EXISTS email_nota_fiscal text,
  ADD COLUMN IF NOT EXISTS email_boleto text,
  ADD COLUMN IF NOT EXISTS site text;

ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_possui_ie_check;
ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_possui_ie_check
  CHECK (possui_inscricao_estadual IN ('nao_informado', 'sim', 'isento', 'nao'));

ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_ie_so_quando_contribuinte;
ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_ie_so_quando_contribuinte
  CHECK (inscricao_estadual IS NULL OR possui_inscricao_estadual = 'sim');
