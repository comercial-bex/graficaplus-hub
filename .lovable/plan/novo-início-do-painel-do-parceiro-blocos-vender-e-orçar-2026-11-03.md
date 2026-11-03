# Novo Início do painel do parceiro: blocos Vender e Orçar

## Objetivo
A tela Início do parceiro abre com dois blocos grandes, cada um com sua cor:
- **Comprar da gráfica** (venda direta): verde-ciano. Botão "Nova compra", total do mês e últimas compras com o status do pagamento.
- **Orçar para o meu cliente**: magenta. Botão "Novo orçamento", números (no mês, em aberto, viraram pedido) e últimos orçamentos.

Tudo o que já existe continua: aviso de atendente, primeiros passos, nível, crédito, ofertas, convite, metas e pedidos.

## Layout
```text
Computador (largura total, sem faixas vazias nas laterais)
+---------------------------------------------------------------+
| Olá, Nome · Parceiro desde ...           [Nível] [Crédito]    |
+-------------------------------+-------------------------------+
|  COMPRAR DA GRÁFICA (ciano)   |  ORÇAR PARA CLIENTE (magenta) |
|  [Nova compra]                |  [Novo orçamento]             |
|  total no mês · a pagar       |  no mês · aberto · pedidos    |
|  últimas 3 compras            |  últimos 3 orçamentos         |
+-------------------------------+-------------------------------+
| Nível e progresso (2/3)          | Crédito + Convite (1/3)    |
| Ofertas (rolagem horizontal)     | Metas                      |
| Pedidos                                                       |
+---------------------------------------------------------------+

Celular
Saudação curta -> bloco Comprar -> bloco Orçar (um embaixo do outro,
botões grandes no polegar) -> nível -> crédito -> ofertas em carrossel
-> metas -> pedidos
```
- A área de conteúdo do painel passa a usar a largura toda da tela (hoje fica limitada ao centro), com até 4 colunas em telas grandes.
- Em telas bem largas, Metas e Pedidos ficam lado a lado.

## Visual e microefeitos
- Cada bloco tem fundo com degradê suave da sua cor, ícone grande em selo colorido e um traço de cor no topo.
- Ao passar o mouse: o bloco sobe levemente, a sombra ganha a cor do bloco e a seta do botão desliza.
- Os números sobem contando ao abrir a tela; os cartões aparecem em sequência suave.
- Ao tocar no celular: leve encolhimento de "botão pressionado".
- Quem configurou o sistema para menos movimento não vê animações.
- Funciona igual nos temas claro e escuro.
- Estado vazio útil: "Nenhuma compra ainda — faça a primeira" com botão.

## Detalhes técnicos
- `src/components/parceiro/casca.tsx`: trocar `max-w-6xl` por largura total com respiro lateral (`px-4 md:px-7 2xl:px-10`).
- `src/routes/parceiro.index.tsx`: reorganizar em grid (`lg:grid-cols-2` para os blocos, `xl:grid-cols-3` para o resto).
- Novo `src/components/parceiro/bloco-de-acao.tsx`: cartão reutilizável (cor, ícone, ação, números, lista).
- Lista de compras: ler `parceiro_orcamentos` com `venda_direta = true` (já visível ao parceiro) mostrando `total_pedido` e `pagamento_modelo`; últimos orçamentos com `venda_direta = false`.
- Tokens novos em `src/styles.css`: `--venda`, `--orcamento` e degradês/sombras, versões clara e escura; animações `@keyframes` com `motion-reduce`.
- Contador animado leve sem biblioteca nova.
- Sem mudanças no banco. Conferir com Playwright em 1440px e 390px.
