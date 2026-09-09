-- A arte não sabia a qual OS pertence.
--
-- De nove chaves em `arquivos`, oito estavam vazias. Só `cliente_id` preenchida
-- nos 3 arquivos que existem.
--
-- Investigando os dois caminhos de upload, o quadro é mais fino do que parecia:
--
--   upload pela OS         grava os_id e enviado_por      ✓ já estava certo
--   upload pelo orçamento  grava só cliente_id            ✗
--
-- O upload do orçamento é o caminho normal: a arte chega junto com o pedido,
-- antes de existir OS. Ela é amarrada ao item por `orcamento_itens.arquivo_id`,
-- e na conversão esse `arquivo_id` é copiado para `itens_os`.
--
-- Só que a cópia é de mão única: o ITEM passa a apontar para o arquivo, e o
-- ARQUIVO continua dizendo que não pertence a OS nenhuma. Por isso "qual arte
-- está em produção nessa ordem" não tem resposta partindo de `arquivos` — e é
-- dessa ponta que a produção pergunta.

-- ---------------------------------------------------------------------------
-- O arquivo segue a peça.
--
-- Quando um item de OS aponta para um arquivo, o arquivo passa a saber de qual
-- OS e de qual item ele é. Gatilho, e não ajuste na conversão: o `arquivo_id`
-- do item também pode ser trocado depois, na tela da OS, e o vínculo tem que
-- acompanhar em qualquer caminho.
--
-- Só preenche o que está vazio. Arte reaproveitada em duas OS existe (reimpressão
-- do mesmo banner), e nesse caso sobrescrever apagaria o vínculo da primeira —
-- trocaria um dado certo por outro igualmente certo, perdendo metade. Quando o
-- arquivo já tem dono, o vínculo novo fica registrado no item, que é onde a
-- pergunta "o que imprimir agora" é feita.
-- ---------------------------------------------------------------------------
create or replace function public.tg_arquivo_segue_o_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.arquivo_id is null then
    return new;
  end if;

  update public.arquivos a
     set os_id = coalesce(a.os_id, new.os_id),
         os_item_id = coalesce(a.os_item_id, new.id)
   where a.id = new.arquivo_id
     and (a.os_id is null or a.os_item_id is null);

  return new;
end;
$$;

comment on function public.tg_arquivo_segue_o_item is
  'Amarra o arquivo à OS e ao item quando o item passa a apontar para ele. Só preenche o que está vazio: arte reaproveitada em outra OS mantém o vínculo original.';

drop trigger if exists tg_arquivo_segue_o_item on public.itens_os;
create trigger tg_arquivo_segue_o_item
  after insert or update of arquivo_id on public.itens_os
  for each row execute function public.tg_arquivo_segue_o_item();

-- Conserta o que já está gravado.
update public.arquivos a
   set os_id = coalesce(a.os_id, i.os_id),
       os_item_id = coalesce(a.os_item_id, i.id)
  from public.itens_os i
 where i.arquivo_id = a.id
   and (a.os_id is null or a.os_item_id is null);
