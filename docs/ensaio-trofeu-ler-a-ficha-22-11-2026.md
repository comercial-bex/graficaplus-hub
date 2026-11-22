# Troféu: ler a ficha (bloco FICHA-BEX e imagem) e pré-preencher a calculadora (22/11/2026)

Sem migração. Código novo em `src/domain/trofeus/ficha-lida.ts`, `ficha-comparar.ts`, `ficha-ia.ts`, `src/lib/imagem-para-ia.ts`,
`src/lib/api/trofeus-ficha.functions.ts` e `src/components/trofeus/ler-a-ficha.tsx` (o cartão "Ler a ficha" no topo da calculadora).

## O pedido do dono

O vendedor gera a ficha de fabricação do troféu num gerador de imagem ou de texto. Quer que o sistema leia a altura e os dados da
ficha e já preencha o orçamento, e quer um pré-prompt para qualquer gerador devolver as informações no formato que facilite o
orçamento. Decisões do dono (22/11/2026): **não limitar material, espessura, largura e altura ao que está em estoque ou no
cadastro** (o sistema lê o que a ficha traz e aponta o que não bate) e **usar a chave da agência** para ler a imagem.

## O que as 5 fichas mostraram contra o catálogo

| Ficha | Catálogo | O que o sistema faz agora |
| --- | --- | --- |
| KR Combat: aro dourado de 3 mm | só existe dourado de 2 mm | "o modelo usa Acrilico esp dourado 2mm, o preço é o do modelo" |
| KR Combat: base "CAMPEÃO" em preto de 6 mm | camadas de preto de 3 mm | a mesma frase, para a base |
| Capacete: plaqueta frontal de prata de 1 mm | não existe prata no cadastro | "o preço não inclui esta peça; o material não está no cadastro" |
| "CNC router", "laser de fibra", "UV/DTF" | a casa corta e grava no laser CO2 e imprime em vinil laminado na plotter | aviso informativo, sem mexer na conta |
| Uma ficha diz "impressão UV", as outras "vinil + laminação" | vinil laminado | o pré-prompt manda registrar o resto em `observacoes` |

## Como funciona

Três caminhos, do mais barato ao mais caro:

1. **Bloco `FICHA-BEX v1`** colado, sem imagem: lido por regra (`lerBlocoDaFicha`), sem IA, sem chave, sem gasto.
2. **Imagem** (com ou sem texto): modelo de visão no servidor, com a chave da **agência**: `ANTHROPIC_API_KEY` (Claude,
   `claude-sonnet-5-5` por padrão, troca por `ANTHROPIC_MODEL`) e, sem ela, `OPENAI_API_KEY` (`gpt-5-mini`, troca por
   `OPENAI_MODEL`). **Nunca o saldo do Lovable** (`LOVABLE_API_KEY` nem é lida). Sem nenhuma das duas, a tela diz que a leitura de
   imagem não está ligada e o bloco continua funcionando.
3. **Texto livre** sem bloco (o pedido do cliente): o mesmo modelo, só com texto.

O resultado é uma **sugestão**: a tela mostra o que leu (campos, textos e a tabela de peças com o estado de cada material no
cadastro), as dúvidas da IA, e **onde a ficha não bate com o modelo escolhido** (`compararFichaComModelo`). "Usar na calculadora"
preenche só o que a ficha trouxe (modelo, altura, quantidade, urgência, arte, nomes individuais) e recolhe o cartão. **Nada é
gravado e o preço continua sendo o do servidor** (`cotarTrofeu`) no modelo escolhido: peça que o modelo não tem aparece como "o preço
não inclui esta peça".

## Regras que os testes travam

- Permissão `orcamentos.create` conferida **antes** de ler o banco e antes de chamar a IA (custo e privacidade).
- Entrada estrita: texto até 12.000 caracteres, imagem PNG/JPEG/WEBP em base64 até ~5 MB; a tela reduz a imagem para 1.800 px no lado
  maior antes de enviar.
- A imagem **não é guardada**: vai ao provedor e volta como campos.
- A resposta da IA passa por um filtro fechado (`normalizarFichaDaIa`): número absurdo (altura de 9 m, espessura de 80 cm) é
  ignorado com aviso, texto é aparado, campo desconhecido some. Texto escrito dentro da imagem é **dado, nunca ordem**.
- O formato que a IA preenche **não tem campo de preço, custo, multiplicador nem desconto**.
- O catálogo que desce ao navegador tem só **nomes e medidas**; custo, multiplicador, fator de forma e estoque nunca são lidos.
- A chave só existe no servidor e nunca volta na resposta, no detalhe do erro nem no registro.
- 429 da OpenAI com `insufficient_quota` é "sem saldo"; os outros 429 são "tente de novo em um minuto".

## O que foi conferido

- `bunx tsc --noEmit` sem erro e `bunx vitest run`: 522 arquivos (1 pulado) e 8.634 testes aprovados (1 pulado; os 101 novos incluem leitor, filtro da IA,
  comparação com o catálogo do banco vivo, o servidor com a rede simulada e o contrato da tela).
- Chromium de verdade (componente real, só as chamadas de servidor simuladas): **75 conferências, 0 falhas, 0 erros de console**, com as
  fichas reais do KR Combat. Pegou um defeito real, já corrigido: no celular a tabela de peças esticava a coluna do grid e a página
  rolava para o lado (`min-w-0` na coluna).

## O que NÃO foi conferido

- **Nenhuma chamada de verdade ao Claude ou à OpenAI.** Não há chave nesta sessão e o projeto ainda não tem `ANTHROPIC_API_KEY` nem
  `OPENAI_API_KEY` cadastradas (a assistente do WhatsApp segue desligada por decisão do dono). O pedido e a leitura da resposta dos dois
  provedores estão provados em teste com a rede simulada, no formato da documentação de cada um. A prova final é a primeira ficha lida
  com a chave cadastrada.
- A qualidade da leitura de imagem em fichas reais: o gerador embaralha texto (o "6 mm" sobreposto no aro do KR Combat), e a IA
  pode errar. Por isso o resultado é sempre sugestão com as dúvidas à vista.

## Para ligar a leitura de imagem

Cadastrar `ANTHROPIC_API_KEY` (ou `OPENAI_API_KEY`) nos segredos do projeto no Lovable. A chave não passa pelo chat nem pelo código.

## O que fica para depois (decisão do dono)

Preço **pelas peças da ficha** (troféu sob medida): hoje o preço é o do modelo escolhido. Para cotar uma peça fora do cadastro falta uma
regra para o custo do material que não existe: usar o parecido, ou o gestor informar o custo do m² na hora (com registro).
