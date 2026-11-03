# Vendas diretas do revendedor

## O que o revendedor vai ver
- No painel do parceiro, um novo menu **Comprar** com o botão **Nova compra**.
- O revendedor lança os itens com a mesma janela de passos do orçamento: Tipo, Produto, Medida e quantidade, Preço e revisão. Não pede cliente nem gera PDF.
- Os preços vêm sempre da tabela de parceiro do nível dele. O revendedor não pode editar o preço.
- Na finalização, ele escolhe a forma de pagamento (Pix, dinheiro, cartão, boleto ou crédito do parceiro) e a situação do pagamento: pago, parcial ou em aberto. Ele também pode deixar uma observação e anexar o layout de cada item.
- Uma lista **Minhas compras** mostra o número, a data, o total, a situação do pagamento e a etapa da produção.

## O que a gráfica vai ver
- Ao confirmar a compra, o sistema cria uma OS de produção com o parceiro como cliente e a marca **Venda direta**. A OS segue para o Kanban como as outras.
- No ERP, a tela **Vendas diretas** lista as compras de todos os parceiros. A equipe pode conferir e ajustar a situação do pagamento.

## Fora deste passo
Baixa de estoque, lançamento no caixa e comissão não entram agora, porque você escolheu apenas "Vira OS". A baixa de estoque já acontece pelo fluxo normal da OS.

## Detalhes técnicos
- Novas tabelas `vendas_diretas` e `venda_direta_itens`, com GRANT e RLS: o parceiro vê só as próprias compras e a equipe vê todas.
- Função SQL `confirmar_venda_direta(id)`, do tipo SECURITY DEFINER. Ela recalcula cada preço no servidor pela tabela de nível do parceiro, para o navegador não definir o preço. Depois cria a OS e os itens e registra o vínculo com a compra.
- Reaproveitar `EscolhaDeProduto` e `PassosDoItem`. O passo de preço fica somente para leitura.
- Novas telas: `parceiro.compras.index.tsx`, `parceiro.compras.$id.tsx` e `vendas-diretas.tsx`. Adicionar o item no menu do parceiro e no ERP. As dicas ficam em `dicas.ts`.
- Testes: o preço segue o nível do parceiro e uma compra confirmada gera exatamente uma OS.
- Registrar a tarefa no roadmap.md.
