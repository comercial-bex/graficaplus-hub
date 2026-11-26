# Troféu: cotar as peças de uma ficha, sem modelo cadastrado (26/11/2026)

Sem migração. Código novo em `src/domain/trofeus/sob-medida.ts` (conta e regras, pura), `src/domain/trofeus/sob-medida-tela.ts`
(linhas da tela, pura), `src/components/trofeus/cotar-pecas-da-ficha.tsx` (a tela) e a função de servidor `cotarFichaSobMedida`
em `src/lib/api/trofeus.functions.ts`. O catálogo que a "Ler a ficha" devolve ganhou o `id` e a `unidade` de cada material (nunca
custo nem estoque).

## O pedido do dono

"Eu não preciso ter matéria-prima dentro para fazer cotação. Eu preciso saber o valor dos produtos, ter esses parâmetros, e dar
o valor; corro atrás depois." Os três modelos (econômico, padrão e premium) já cotam. Faltava cotar uma ficha de fora, como o
JariCross 10 Anos, cujas peças (placa de 6 mm, base de 10 mm, plaqueta de prata) nenhum modelo tem.

## O que a cotação precisa, e o que NÃO precisa

| Precisa | Não precisa |
| --- | --- |
| lista de peças (material, espessura, medida, quantidade, decoração) | estoque da chapa (só avisa: "o orçamento sai normalmente") |
| custo do m² de cada material, maior que zero | a chapa comprada |
| velocidade de corte da espessura (2, 3, 6 e 10 mm) | material "perfeito": dá para usar um da mesma espessura |
| mão de obra e multiplicador (os da linha Padrão) | modelo cadastrado |

## Como funciona

Depois de "Ler a ficha" (bloco FICHA-BEX sem IA, ou imagem lida pela IA da agência), o cartão mostra **Cotar as peças da ficha**: uma
linha editável por peça. O material do cadastro é sugerido quando existe um igual (mesma cor e mesma espessura). Quando não
existe, a pessoa escolhe um da **mesma espessura** e a resposta avisa "cotada com X no lugar de Y: o preço dela é estimativa".

O servidor monta um **modelo de passagem** com as peças e chama a MESMA `cotarTrofeuComABase` do `cotarTrofeu`. Não existe uma
segunda conta.

## Decisões de partida (estimativas, para o dono confirmar)

- **Mão de obra e multiplicador seguem a linha Padrão**, na altura pedida (os minutos crescem na proporção da altura, como no modelo).
- **Substituto só da mesma espessura.** O custo do m² é do material naquela espessura: a base de 10 mm nunca é cotada com o preto
  de 3 mm, que sairia umas três vezes mais barata.
- **Fator de forma 1 por padrão** (retângulo), editável por peça. O contorno recortado (o capacete) só alonga o corte, que pesa pouco.
- **Arte e multiplicador à mão ficam fora** desta tela (a arte se cota na calculadora).

## Regras que os testes travam

- `tests/trofeus-sob-medida.test.ts` (conta pura): **as peças do modelo Padrão, passadas pelo caminho sob medida na altura dele,
  dão exatamente o preço do Padrão** (R$ 85,90), com a mesma escada de quantidade; no dobro da altura também; o substituto só da
  mesma espessura; a mão de obra cresce com a altura; os avisos não carregam dinheiro.
- `tests/trofeus-sob-medida-no-servidor.test.ts`: a entrada é estrita (preço, custo, multiplicador, arte, modelo e custo do m²
  vindos do navegador são recusados); a permissão vem antes de qualquer leitura com a chave de serviço; quem não vê custo recebe só
  preço e avisos (nem a palavra "multiplicador"); o material tem de ser chapa da mesma espessura; cadastro incompleto é erro em
  português; o estoque só avisa; e a **equivalência de ponta a ponta com `cotarTrofeu`**.
- `tests/trofeus-sob-medida-tela.test.ts`: as linhas vindas da ficha, a conversão, o pedido só sai completo, a tela desenhada no
  servidor (uma linha por peça, botão desligado enquanto falta material, mensagem quando não há chapa da espessura), e o contrato
  estático: a tela só chama o servidor de cotar a ficha, não calcula preço, não grava e não lê o banco.
- Mutações que derrubam o teste certo: sem a checagem de espessura no servidor; mão de obra que não cresce com a altura;
  substituto de qualquer espessura; permissão depois da leitura; sem o aviso de material trocado; tela que multiplica o preço; tela
  que importa `cotarTrofeu`.

## O que foi conferido

- `tsc --noEmit` sem erro, `vite build` ok e `vitest run`: 528 arquivos e 8.835 testes aprovados (1 pulado).
- Com os custos reais do cadastro (leitura em 26/11/2026), o JariCross 10 Anos a 18 cm, 1 troféu, sem arte nem urgência, sai por
  **R$ 100,90** com a plaqueta de prata cotada como branco 2 mm e a base como cristal 10 mm, e por **R$ 103,90** com a plaqueta
  como espelhado 2 mm e a base como branco 10 mm. O Padrão cadastrado, na mesma altura, sai por R$ 85,90.

## O que NÃO foi conferido

- **A tela num navegador de verdade, logada.** Ela foi desenhada no servidor (HTML) e travada em teste, mas ninguém clicou nela.
- **A função de servidor no banco vivo.** Os testes usam o banco simulado; a conta foi rodada com os custos reais lidos por
  consulta, não pela função publicada. A primeira cotação real depois da publicação é a prova final.
- **Os custos de prata e de preto de 10 mm.** Não existem no cadastro. As duas substituições mudam o preço em cerca de R$ 3 por
  troféu, mas o valor certo só sai quando os dois materiais forem cadastrados.

## O que fica para depois

- **Gravar o troféu sob medida no orçamento.** Hoje o valor é lançado como item livre; gravar com a ficha de produção exige mudar a
  RPC `salvar_trofeu_no_orcamento` (migração, o dono aplica).
- **Comparar as três linhas lado a lado** para a mesma altura e quantidade (três chamadas de `cotarTrofeu`).
- **Cadastrar a chapa de prata e a de preto de 10 mm** com o custo do m² útil (preço da folha ÷ 2,00 m²): é o que tira o aviso
  de estimativa. Não precisa de estoque.
