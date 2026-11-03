# Medidas desenhadas no "Comprar" (produtos por m²)

## O que muda para o parceiro
Na tela **Comprar**, quando o item escolhido é vendido por m² (banner, lona, adesivo...), os dois campos soltos "Largura (m)" e "Altura (m)" dão lugar ao mesmo painel de medidas do passo "Itens" do orçamento:
- Desenho da peça na proporção certa, com cotas de **largura (X)** e **altura (Y)** que mudam enquanto digita.
- Escolha da unidade (mm, cm ou m), sempre guardada em metros.
- Tamanhos prontos do produto (ou os comuns do tipo) em cartões para tocar.
- Área da peça, área do lote e área cobrada (com o mínimo do produto, quando houver).
- Dicas "?" já existentes explicando largura e altura.

Produtos por unidade continuam só com Quantidade. Preço, pagamento e envio não mudam.

## Detalhes técnicos
- `src/routes/parceiro.compras.tsx`: trocar os dois `Campo` por `MedidasDaPeca` (de `src/components/orcamento/medidas-da-peca.tsx`), ligado a `largura`/`altura`/`quantidade` do item, montando os tamanhos prontos do mesmo jeito que `src/components/parceiro/editor-de-orcamento.tsx` (~linha 1136) já faz.
- Layout do cartão do item: medidas em largura total no celular; no computador, painel à esquerda e quantidade/total/remover à direita.
- Nenhuma mudança no banco nem no cálculo de preço.
- Conferir com Playwright se houver conta de parceiro; senão, verificar compilação.
