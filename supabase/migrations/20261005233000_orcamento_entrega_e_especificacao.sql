-- ============================================================================
-- Orçamento: entrega, observação ao cliente e especificação de cada item
-- ============================================================================
--
-- POR QUÊ (05/10/2026): o dono mandou o modelo de orçamento que a gráfica usa
-- (nº 1059) e pediu o PDF "semelhante ao que já fazemos". O modelo tem
-- ENDEREÇO: ENTREGA ("Cliente retira na empresa"), PAGAMENTO, OBSERVAÇÃO e a
-- data de entrega — e o PDF do sistema saía sem os quatro:
--
--   - `endereco_entrega`, `precisa_entrega`, `precisa_instalacao`,
--     `observacao_cliente` e `observacao_interna` existem em `orcamentos`, o
--     papel authenticated pode GRAVAR (grant de tabela), mas não pode LER (o
--     SELECT é por coluna e estas ficaram de fora quando o dinheiro foi para os
--     espelhos). Nenhuma é dinheiro. Sem a leitura, a tela não tinha como
--     mostrar o que gravou e o PDF lia `undefined`.
--   - Nenhuma tela gravava entrega no orçamento, e `converter_orcamento_em_os`
--     COPIA `precisa_entrega`, `precisa_instalacao` e `endereco_entrega` para a
--     OS: toda OS nascia "sem entrega", e o painel da produção não tinha como
--     separar retirada de entrega.
--
-- ESPECIFICAÇÃO DO ITEM
--   "Descrição" é o nome do que se vende (sai em negrito no PDF). Material,
--   cores, frente/verso, ilhós a cada X cm — o que a produção precisa saber —
--   não tinha lugar e ia no WhatsApp. `orcamento_itens.especificacao` guarda
--   isso; o PDF imprime embaixo da descrição, nas duas vias.
--   Na conversão, o gatilho `tg_itens_os_herda_especificacao` leva o texto para
--   `itens_os.especificacoes` ({"texto": …}) — sem mexer na função de
--   conversão, que é longa e crítica.
--
-- VIEWS DE ITENS
--   `tipo_produto` (criado pelo Lovable em 05/10) e `especificacao` entram no
--   FIM das três views `orcamento_itens_*` (CREATE OR REPLACE VIEW só aceita
--   coluna nova no fim). As duas views security_invoker exigem do leitor o
--   SELECT nas colunas citadas — daí o GRANT antes de recriar (view invoker
--   com coluna sem grant morre inteira). A comercial é definer
--   (security_invoker=false, security_barrier) e mantém o filtro dela.

-- ------------------------------------------------------------- 1. leituras
GRANT SELECT (precisa_entrega, precisa_instalacao, endereco_entrega, observacao_cliente, observacao_interna)
  ON public.orcamentos TO authenticated;

-- ------------------------------------------------------ 2. especificação
ALTER TABLE public.orcamento_itens ADD COLUMN especificacao text;

COMMENT ON COLUMN public.orcamento_itens.especificacao IS 'Detalhes de produção do item (material, cores, frente/verso, acabamento detalhado). Sai no PDF embaixo da descrição e vai para itens_os.especificacoes->>texto na conversão.';

GRANT SELECT (especificacao, tipo_produto) ON public.orcamento_itens TO authenticated;

-- ------------------------------------------------------------- 3. views
CREATE OR REPLACE VIEW public.orcamento_itens_operacional WITH (security_invoker = true) AS
 SELECT id,
    orcamento_id,
    descricao,
    quantidade,
    unidade,
    ordem,
    created_at,
    largura,
    altura,
    area_unitaria,
    area_total,
    acabamento,
    arquivo_id,
    produto_id,
    area_minima,
    area_cobrada,
    tipo_produto,
    especificacao
   FROM orcamento_itens;

CREATE OR REPLACE VIEW public.orcamento_itens_comercial WITH (security_invoker = false, security_barrier = true) AS
 SELECT oi.id,
    oi.orcamento_id,
    oi.descricao,
    oi.quantidade,
    oi.unidade,
    oic.valor_unitario,
    oic.valor_total,
    oi.ordem,
    oi.created_at,
    oi.largura,
    oi.altura,
    oi.area_unitaria,
    oi.area_total,
    oi.acabamento,
    oi.arquivo_id,
    oi.produto_id,
    oi.area_minima,
    oi.area_cobrada,
    oi.tipo_produto,
    oi.especificacao
   FROM orcamento_itens oi
     LEFT JOIN orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE is_staff(auth.uid()) AND can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro WITH (security_invoker = true) AS
 SELECT oi.id,
    oi.orcamento_id,
    oi.descricao,
    oi.quantidade,
    oi.unidade,
    oic.valor_unitario,
    oic.custo_unitario,
    oic.valor_total,
    oi.ordem,
    oi.created_at,
    oi.largura,
    oi.altura,
    oi.area_unitaria,
    oi.area_total,
    oi.acabamento,
    oi.arquivo_id,
    oi.produto_id,
    oi.area_minima,
    oi.area_cobrada,
    oi.tipo_produto,
    oi.especificacao
   FROM orcamento_itens oi
     LEFT JOIN orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE can_see_financials(( SELECT auth.uid() AS uid));

-- ------------------------------------------- 4. a especificação vai para a OS
CREATE OR REPLACE FUNCTION public.tg_itens_os_herda_especificacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_especificacao text;
begin
  if NEW.orcamento_item_id is null then
    return NEW;
  end if;

  select oi.especificacao into v_especificacao
    from public.orcamento_itens oi
   where oi.id = NEW.orcamento_item_id;

  if v_especificacao is not null and btrim(v_especificacao) <> '' then
    NEW.especificacoes := coalesce(NEW.especificacoes, '{}'::jsonb)
                          || jsonb_build_object('texto', btrim(v_especificacao));
  end if;
  return NEW;
end;
$function$;

-- Função de gatilho não é chamada por ninguém de fora: sem EXECUTE para quem
-- entra pela API (gatilho nasce com EXECUTE para PUBLIC).
REVOKE ALL ON FUNCTION public.tg_itens_os_herda_especificacao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_itens_os_herda_especificacao
  BEFORE INSERT ON public.itens_os
  FOR EACH ROW EXECUTE FUNCTION public.tg_itens_os_herda_especificacao();
