# Dicas "?" e tour guiado no painel do parceiro

## 1. Dicas com "?"
Um pequeno "?" ao lado dos títulos e números que podem gerar dúvida. No computador a explicação abre ao passar o mouse; no celular, ao tocar.

Onde entram (painel do parceiro):
- **Início:** Comprar da gráfica, Saldo a pagar, Orçar com a sua marca, Em aberto, Viraram pedido, Nível, Crédito, Convite, Metas.
- **Comprar:** preço de parceiro, Sinal 50% x À vista, observação.
- **Orçamentos:** situações (Rascunho, Enviado, Cliente aprovou, Pedido feito, Perdido), seu preço x preço da gráfica, margem.
- **Minha tabela:** degraus de preço por quantidade, nível.
- **Minha marca:** logo, cor e telefone que saem no PDF.

Textos curtos, em português simples, todos num só lugar para manter o mesmo tom.

## 2. Tour guiado no primeiro acesso
Na primeira vez que o parceiro entra, aparece uma apresentação em 6 passos, destacando cada parte da tela com o resto escurecido:
1. Boas-vindas — o que é o painel.
2. **Comprar da gráfica** — compra direta com preço de parceiro.
3. **Orçar com a sua marca** — PDF com a sua logo para o seu cliente.
4. **Nível e crédito** — como subir de nível e usar o crédito.
5. **Menu** — Tabela, Orçamentos, Marca (no celular, a barra de baixo).
6. Fim — "Comece colocando a sua marca" com botão.

- Botões: Voltar, Próximo, Pular. Indicador "2 de 6".
- Vale em qualquer aparelho: o tour fica salvo na conta, não reaparece em outro celular.
- Botão "Rever o tour" no menu do parceiro (ícone de ajuda) para ver de novo.
- Teclado: setas e Esc. Sem animação para quem pediu menos movimento.
- O cartão "Primeiros passos" atual continua (é a lista de tarefas; o tour é a apresentação).

## Detalhes técnicos
- Reusar `DicaIcone` de `src/components/bex/Dica.tsx` (já abre por toque no celular). Textos novos em `src/lib/dicas.ts`, seção `parceiro`.
- `BlocoDeAcao` ganha prop `dica` no título e por número.
- Novo `src/components/parceiro/tour-guiado.tsx`: componente próprio, sem biblioteca nova; alvos por `data-tour="..."`; recorte com `box-shadow` gigante em volta do retângulo do alvo; cartão posicionado acima/abaixo; em celular o cartão fica fixo embaixo; rola o alvo para a vista.
- Estado "visto" salvo em `user_metadata.tour_parceiro_visto` via `supabase.auth.updateUser` (com cópia em localStorage para não piscar). Só abre depois da tela "Completar cadastro".
- Montado na `casca.tsx`; "Rever o tour" em `menu-do-parceiro.tsx`.
- Teste com Playwright a 1440px e 390px usando uma conta de parceiro, se houver uma disponível.
