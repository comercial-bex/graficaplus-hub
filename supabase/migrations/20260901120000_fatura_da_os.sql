-- Fatura da OS: o último elo do encanamento do setor.
--
-- Orçamento → OS → custo real → cobrança. Os três primeiros existiam; o quarto
-- acontecia fora do sistema. A conta a receber e as parcelas JÁ nascem na
-- conversão do orçamento — o que faltava não era outra tabela financeira, era o
-- DOCUMENTO: o papel que o cliente recebe dizendo o que deve, quando vence e
-- quanto já pagou.
--
-- Por isso a fatura entra no pipeline de PDF que já existe (orçamento, OS,
-- recibo de material) em vez de virar um módulo à parte. Criar um segundo lugar
-- para registrar cobrança seria criar um segundo saldo devedor.

-- Quem fatura é o financeiro — e ele não tem permissão comercial. Sem isto, a
-- pessoa que emite a cobrança não conseguiria gravar o documento que emitiu.
drop policy if exists "docs insert" on public.documentos_gerados;
create policy "docs insert" on public.documentos_gerados
  for insert with check (
    has_permission((select auth.uid()), 'orcamentos.create')
    or (tipo = 'recibo_material' and has_permission((select auth.uid()), 'estoque.exit'))
    or (tipo = 'fatura' and has_permission((select auth.uid()), 'financeiro.read'))
  );

drop policy if exists "docs read" on public.documentos_gerados;
create policy "docs read" on public.documentos_gerados
  for select using (
    has_permission((select auth.uid()), 'orcamentos.create')
    or (tipo = 'recibo_material' and has_permission((select auth.uid()), 'estoque.read'))
    or (tipo = 'fatura' and has_permission((select auth.uid()), 'financeiro.read'))
  );
