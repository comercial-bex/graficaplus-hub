# Onde corrigir cada pendência do custo (21/11/2026)

## O que o dono pediu

Abrindo o custeio de um produto (a pasta, aba Preço, quadro "Do que a peça é feita, por m²"), a tela dizia:

> O que falta para o custo fechar: sem matéria-prima na receita

e não dizia onde se responde isso. Pedido: toda pendência do sistema, começando pelo custeio, tem de dizer em destaque,
com letra menor embaixo da frase, "Vá até tal seção, tal módulo", e levar a pessoa até a correção.

## A regra daqui para frente

Pendência de custo mostra três coisas, nesta ordem:

1. **O que falta**, na frase de sempre ("Sem matéria-prima na receita").
2. **Onde corrigir**, em destaque: "Vá até a aba Parâmetros desta pasta, no cartão Materiais deste produto." Mais uma linha
   do que fazer lá.
3. **Um botão que leva até lá.** Dentro da pasta do produto o botão troca de aba, rola e põe um contorno de 4 segundos no
   campo. Nas outras telas é link: abre a pasta, a Planilha de custos ou o outro módulo já no lugar.

O destino de cada pendência mora num arquivo só, `src/domain/precos/onde-corrigir.ts`. A tela só desenha
(`src/components/produtos/onde-corrigir.tsx`). O tipo `Record` e os testes obrigam toda pendência nova a ganhar destino.

## O mapa

### Faltas da ficha técnica (pasta do produto e ficha da Tabela de preços)

| Falta | Onde corrigir | O botão leva a |
| --- | --- | --- |
| Sem matéria-prima na receita | Aba Parâmetros da pasta, cartão Materiais deste produto | `pasta-materiais` |
| Custo digitado à mão (brinde, revenda) | Aba Preço da pasta, campo Custo do cadastro | `pasta-custo-medio` |
| Sem tempo de produção | Aba Parâmetros, cartão Máquina e material principal, campo Tempo estimado | `pasta-tempo` |
| Sem máquina padrão | Aba Parâmetros, cartão Máquina e material principal, campo Máquina padrão | `pasta-maquina` |
| Sem custo de mão de obra | Módulo Planilha de custos, aba Mão de obra | `/planilha-custos?aba=mao-obra` |

Caso da tela do dono (acrílico espelhado, R$ 400,00 de matéria-prima sem nenhum material na receita): a frase passa a dizer
"Hoje vale o custo de R$ 400,00, digitado à mão, que não acompanha o preço de compra", porque esse é o motivo de
o número existir sem receita.

### Avisos de Preços por produto (botão "avisos")

| Aviso | Onde corrigir |
| --- | --- |
| Sem custo real calculado | Aba Preço da pasta, quadro "O que falta para o custo fechar" (que, item a item, leva ao campo) |
| Falta tempo de produção ou custo de mão de obra | O mesmo quadro |
| Material da ficha sem custo cadastrado | Módulo Materiais |
| Ficha sem tinta | Aba Parâmetros, cartão Materiais deste produto |
| Custo incompleto (plotter) | Módulo Custos fixos e mão de obra |
| Tempo de produção presumido | Módulo Máquinas, velocidade da máquina |
| Preço abaixo do custo, da margem mínima ou do mínimo recomendado | Aqui mesmo, no campo do preço de balcão, com "Propor preço" (o gerente aprova) |

Sem destino, de propósito (o teste exige um motivo escrito para cada um): preço do parceiro (decisão da gerência),
"abaixo da regra de três" (o próprio aviso diz que é só referência), velocidade com margem e referência da lona.

### Faltas do custo de um acabamento (tela Acabamentos)

As sete frases que `custo_do_acabamento_interno` escreve (conferidas no banco vivo em 21/11): máquina sem custo por hora
leva a Máquinas; material sem custo de compra leva a Materiais; mão de obra sem custo ou sem encargos leva à Planilha de
custos, aba Mão de obra; sem máquina escolhida e sem tempo dizem para tocar no lápis do próprio acabamento. Frase nova do
banco cai num destino geral ("Confira aqui mesmo"), nunca fica sem orientação.

### Meta, "Fora do ranking"

Produto sem tempo ou sem custo ganhou um link por motivo, direto no campo da pasta (Tempo estimado, ou Custo do cadastro).
Antes só havia "Completar o cadastro", que abria a lista de produtos.

## O que ainda NÃO tem orientação (para o dono decidir a ordem)

Levantado por busca nas telas. Nada disso foi mexido.

- **Calculadora 3D**: "impressora sem custo por hora", "sem potência", "filamento sem custo" dizem "avise a gerência". É
  proposital: quem usa não vê custo, então não adianta mandar para Máquinas. Se a gerência também passa por ali, vale um
  link só para ela.
- **Capacidade, "Falta cadastrar para a conta fechar"**: tem link para Máquinas em parte dos itens; falta conferir item a item.
- **Revisão do orçamento, "Antes de mandar ao cliente, falta:"**: lista o que falta (medida, quantidade, resposta) sem
  levar ao item. É a próxima candidata, porque é a que o vendedor lê todo dia.
- **Concluir OS ("Resolva o que falta para concluir")** e **cartão do quadro ("Falta: pagamento, aceite da arte, arquivo
  final")**: dizem o que falta, não onde resolver.
- **Precificação, selo "sem ficha e sem custo de material"**: sem link.

## Como foi conferido

- `tests/onde-corrigir.test.ts` (25 testes): o mapa cobre toda falta que a ficha produz e todo código de aviso; cada aba,
  campo e rota de destino existe de verdade (o teste lê a pasta e as rotas); o endereço da pasta aceita os campos novos; as
  sete frases de acabamento existem na migração; nenhuma frase tem travessão, seta ou parênteses; as telas usam o mapa.
- `tests/onde-corrigir-tela.test.ts` (7 testes): renderiza o quadro no servidor e confere botão dentro da pasta, link fora
  dela, link para a Planilha de custos, aviso de preço sem botão e letra de 16 px no painel de preços.
- Os dois testes antigos que comparavam a ficha com `toEqual` ganharam o campo novo `itens`.
- Ruído de ambiente: a suíte rodada sem dependências (sem mocks de React) tem 37 falhas, as mesmas na `main` e nesta
  árvore; nenhuma é nova.
- **Não visto no navegador**: o editor exige login que esta sessão não tem. O que se viu foi o HTML que o componente gera.
