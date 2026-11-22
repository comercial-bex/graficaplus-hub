# Troféu de acrílico: a ficha de produção na OS (22/11/2026)

PR da etapa 4. **Sem migração.**
Domínio: `src/domain/trofeus/ficha.ts`. Servidor: `fichaDoTrofeuDaOs` em `src/lib/api/trofeus.functions.ts`.
Tela: `src/components/trofeus/ficha-do-trofeu.tsx`, no modal do quadro (`ficha-da-os.tsx`, em "O que vai ser produzido") e na aba Itens da OS (`os.$id.tsx`).

## O problema

Quando o orçamento com troféu vira OS, a produção recebia só uma linha ("Troféu premium em camadas 28 cm") e a especificação
("Altura 28 cm · 11 peças em acrílico"). Para cortar, faltava o que a conta de preço já sabia: **quais peças, de que material e espessura,
com que medida naquela altura, quantas no pedido, como cada uma é decorada e quanto tempo de laser o pedido pede.**

## Como chega à OS

- A conversão (`converter_orcamento_em_os`) já copia `parametros` do item do orçamento para `itens_os.parametros`, com as escolhas do troféu
  (`origem`, `modelo_id`, `altura_cm`, `urgente`, `arte`). **Não precisou mexer na conversão nem criar migração.**
- O navegador **não lê** `itens_os.parametros` (sem `GRANT`). Por isso a ficha sai de uma função de servidor: confere `os.read` **antes**, lê com
  a chave de serviço e devolve só os campos da ficha, montados por lista explícita.
- A quantidade é a do item da OS (se a produção mudou a quantidade lá, a ficha acompanha). O modelo desativado depois da venda continua com ficha.
  Troféu sem as escolhas gravadas, ou cujo modelo sumiu, **some da ficha em vez de inventar peças**.

## O que a ficha mostra (e o que nunca mostra)

| Mostra | Nunca mostra |
| --- | --- |
| Modelo, altura, quantidade, selo de urgência | Preço, custo, multiplicador, margem, aval |
| Peças: nome, material, espessura, **medida em cm na altura do pedido**, quantas por troféu e no pedido todo, decoração | O `multiplicador_manual` que o gestor tenha gravado no item |
| Peças no pedido, m² de acrílico, metros de contorno, **tempo de laser estimado** | Qualquer coluna de valor |
| A arte: tipo, alterações extras, nomes individuais | |
| Aviso de medidas ainda estimadas, e de espessura sem velocidade cadastrada (tempo vira "—") | |

OS sem troféu não mostra nada (nem "carregando"): a maioria das OS não tem troféu.

## A conta de tempo é a do preço

`tests/trofeus-ficha.test.ts` compara, modelo a modelo e para 1, 5, 20 e 50 troféus, a ficha com `calcularTrofeu`: minutos de laser (do pedido todo,
com o preparo uma vez só), metros de corte, área e número de peças **dão o mesmo**. Vale também em outra altura. O preparo do laser entra uma vez por pedido
e a gravação só soma tempo nas peças gravadas.

## Como foi conferido

- **Testes (CI):** `bunx tsc --noEmit` sem erro e a suíte inteira aprovada. Novos: `trofeus-ficha` (14, a conta), a parte da ficha em `trofeus-no-servidor`
  (permissão antes de ler, só as tabelas da ficha, sem preço nem custo, quantidade da OS, dois troféus, modelo sumido ou desativado, falhas) e
  `trofeus-ficha-integracao` (os dois lugares onde aparece, sem leitura de banco pelo navegador, sem dinheiro, sem `title=`).
- **Navegador de verdade:** o componente real, com a conta real e só a chamada de servidor simulada, no Chromium: **24 conferências, 0 falhas, 0 erros no console.**
  Econômico ×5 (15 peças, placa 20 × 16 cm, base 20 × 5 cm com 10 no pedido, arte exclusiva com alteração e nomes, aviso de estimativa), premium ×20 (220 peças,
  9 linhas porque a base em camadas junta 3, laser 5 h 3 min), OS sem troféu (nada na tela), falha (aviso em português), espessura sem velocidade (tempo "—" e o motivo),
  celular de 390 px (a página não rola para o lado; a tabela rola dentro do próprio quadro) e tema escuro.

## O que NÃO foi conferido

- A chamada de ponta a ponta com uma **OS de troféu de verdade**: ainda não existe uma no banco (o troféu acabou de ir ao ar). A função de servidor foi provada em teste com o banco
  simulado e a conta foi provada contra a de preço; a primeira OS real com troféu é a prova final depois do deploy.
- O **PDF da via de produção** não leva a tabela de peças (ele imprime só descrição e especificação). A ficha está na tela da OS e no quadro.
- **Arquivo de corte e mockup por peça:** o troféu usa o mesmo mockup e arquivo de impressão da OS (a divisão que já existe no quadro); não há arquivo de corte por peça.
