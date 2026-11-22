# Troféu de acrílico: a tela, as ligações e a conferência de ponta a ponta (22/11/2026)

PR da etapa 3. Migração: `supabase/migrations/20261122500000_remover_trofeu_do_orcamento.sql`.
Tela: `src/components/trofeus/calculadora-de-trofeu.tsx` (e `dialogo-do-trofeu.tsx`), rota `/orcamento-trofeu-novo`, botão **Troféu** na tela do orçamento.
Regras de tela sem React: `src/domain/trofeus/tela.ts`.

## O mapa: cada peça, onde está e em que estado

| Peça | Onde | Estado |
| --- | --- | --- |
| Conta de preço (função pura) | `src/domain/trofeus/conta.ts` | Mesclada (#510, #511, #512), testada |
| Catálogo e regras (3 tabelas) | migração `20261122200000` | **Aplicada** no banco vivo e conferida |
| Dados do dono (dourado, laser, 10 mm, DTF UV) | migração `20261122300000` | **Aplicada** e conferida |
| Montagem das taxas e avisos | `src/domain/trofeus/cotacao.ts` | Mesclada, testada |
| Servidor: preço, escada, modelos, reabrir, gravar | `src/lib/api/trofeus.functions.ts` | Mesclada (#511, #512); **esta etapa** acrescenta multiplicador à mão, aval, escada, modelos, reabrir e estoque |
| Gravar troféu e arte no orçamento | migração `20261122400000` (`salvar_trofeu_no_orcamento`) | **Aplicada** e conferida |
| Tirar o troféu com a arte | migração `20261122500000` (`remover_trofeu_do_orcamento`) | Ensaiada no banco vivo; **falta aplicar depois do merge** |
| Tela: calculadora, diálogo, porta nova, botão no orçamento | `src/components/trofeus/*`, `src/routes/_authenticated/orcamento-trofeu-novo.tsx`, `orcamentos.$id.tsx` | **Esta etapa**; falta mesclar e **publicar o front** |

## Como as peças se ligam

```
Tela (navegador, sem custo nenhum)
  ├─ dadosDoTrofeu ──┐
  ├─ cotarTrofeu ────┤  servidor: confere permissão ANTES de ler → lê regras, modelos, peças, materiais,
  ├─ escadaDoTrofeu ─┤  custos fixos, mão de obra e máquinas com a chave de serviço → cotacao.ts → conta.ts
  ├─ lerTrofeuGravado┘  → devolve SÓ preço e avisos (quem tem financeiro.read: também custo, multiplicador e margem)
  ├─ salvarTrofeuNoOrcamento → refaz a conta, compara o total visto, grava pela RPC com o cliente do USUÁRIO
  │        └─ salvar_trofeu_no_orcamento (orcamentos.create por auth.uid()) → orcamento_itens: 1 linha de troféu + 1 por linha de arte
  └─ "Tirar" no orçamento → remover_trofeu_do_orcamento (troféu e arte juntos)
Orçamento: total recalculado (`recalcular`), PDF lê `tipo_produto` e `especificacao`, metragem conta "Troféus de acrílico".
```

## O que a tela faz

- **Passos:** 1 modelo (cartões com foto-descrição e "a partir de R$"), 2 altura, quantidade, urgência e a tabela de preço por
  quantidade, 3 arte (cliente manda, adaptar o modelo, criação exclusiva, com alterações e nomes individuais).
- **Preço ao vivo** (espera 400 ms depois de a pessoa parar de digitar; nunca mostra o preço anterior como se fosse o de agora).
- **Vendedor** vê preço, tabela por quantidade e avisos. Não vê custo, multiplicador nem margem (a tela e a resposta do servidor).
- **Quem vê custo** (`financeiro.read`: gestor, admin) ganha o **simulador**: custo cheio, custo de produção, multiplicador, margem
  líquida com faixa de cor, tempo de laser, e o campo **multiplicador à mão** (×1 a ×10).
- **Aval do gestor:** multiplicador abaixo do piso (×2,2) trava o salvar até confirmar o aval; só gestor ou admin vê a caixa;
  o servidor confere o papel de novo e registra no `logs_auditoria` (`trofeu_multiplicador_manual`, com o multiplicador da escada e o preço
  que a escada daria). Um troféu com preço ajustado **só é editado por quem vê custo**: o vendedor não grava por cima.
- **Estoque só avisa** (decisão do dono, 22/11): "Estoque de X abaixo do necessário. O orçamento sai normalmente; o gestor precisa
  repor antes de produzir." O botão nunca trava por estoque.
- **Porta nova** `/orcamento-trofeu-novo`: cria o orçamento (cliente ou contato avulso) e grava o troféu; falha depois de criar reaproveita
  o mesmo orçamento na nova tentativa (não cria dois).
- **Celular:** uma coluna, cartões largos, alvos de toque de 44 px (o interruptor de urgência vira linha inteira de toque) e uma **barra do
  preço** que acompanha a rolagem, já que o resultado fica no fim da página.

## Defeitos achados na análise (e corrigidos nesta etapa)

1. **Linha de arte com custo zero travaria a conversão em OS.** `converter_orcamento_em_os` recusa "item fora do catálogo sem custo". A
   alteração extra e o nome individual saíam com custo 0. Agora levam o preço ÷ 3 (o ×3 do dono): R$ 10,00 e R$ 1,33. Ensaiado no banco vivo:
   com o custo antigo a mesma conferência acharia a linha "Alteração extra da arte (1)"; com o novo, não acha nada.
2. **Tirar só a linha do troféu deixaria a arte solta, cobrando por um troféu que não existe.** Nova função `remover_trofeu_do_orcamento`
   tira as duas; a arte não se tira à parte (só editando o troféu).
3. **"Sem produto ligado: o custo e a margem deste item não são calculados"** apareceria em toda linha de troféu e de arte. Agora não aparece.
4. **O painel de metragem** trataria o troféu como material de nome "Troféu premium em camadas 28 cm" com 0 m². Agora conta "Troféus de acrílico" e ignora a arte.
5. **O selo de "marcado" cobria o título** dos cartões ("Econômico", "O cliente manda a arte"). Título com folga, linha do modelo dentro do detalhe.
6. **O interruptor de urgência tinha 24 px** de alto (pequeno para o dedo). Linha inteira de toque e área ampliada.
7. A rota do orçamento passou do **teto de 2.800 linhas** que o projeto trava; o diálogo e as notas da linha moram em `dialogo-do-trofeu.tsx`.

## Como foi conferido

- **Testes (CI):** `bunx tsc --noEmit` sem erro e `bunx vitest run` com todos os arquivos aprovados. Novos: `trofeus-tela` (leitura dos campos, o que falta
  antes de pedir o preço, ida e volta do troféu gravado, quando o salvar libera), `trofeus-orcamento-integracao` (as ligações da tela, a rota, a
  busca, a metragem e o SQL da função de remover) e o que cresceu em `trofeus-no-servidor`, `trofeus-cotacao` e `trofeus-conta`
  (multiplicador à mão, aval, registro, escada, modelos, reabrir, estoque, custo das linhas de arte).
- **Navegador de verdade:** o componente real, com a conta real (a mesma função do servidor, com as linhas do banco) e só as chamadas
  de servidor simuladas, rodou no Chromium por cada papel: **60 conferências, 0 falhas, 0 erros no console.** Vendedor (preço, escada R$ 53,90 / 45,90 /
  40,90 / 36,90, 5 troféus = R$ 229,50, com arte exclusiva R$ 449,50, altura 8 cm recusada com a frase certa, salvar manda só escolhas e o total visto), estoque zero
  (avisa e não trava), cadastro quebrado (o modelo diz por que não tem preço), gestor (custo R$ 17,68, margem 42,6%, ×2,5 = R$ 44,90, ×1,8 = R$ 31,90 trava até o aval),
  financeiro sem aval (simula, não grava), editar (volta com 28 cm, 5 un, arte exclusiva; preço ajustado trava o vendedor), porta nova (cria um
  orçamento e grava nele), celular de 390 px (sem rolagem lateral, alvos de 40 px ou mais) e tema escuro.
- **Banco vivo, desfeito por RAISE EXCEPTION:** a função de remover com o usuário de cada papel: grava 2 troféus e 3 linhas de arte, tira o A e as 2 artes dele, o B e a arte
  do B ficam, o total cai R$ 451,90 (R$ 201,90 + 220,00 + 30,00); designer e `anon` barrados; id que não é troféu recusado; `anon` falso e `authenticated` verdadeiro em `EXECUTE`.

## O que NÃO foi conferido

- **As funções de servidor nunca rodaram em produção:** o front ainda não foi publicado. No navegador de teste elas foram simuladas, com a conta real. A conta e a
  gravação foram provadas no banco vivo e em teste, mas a primeira chamada de ponta a ponta pela tela publicada só acontece depois do deploy.
- **A conversão do troféu em OS inteira** (pagamento, versão aprovada, prazo, reserva de material) não foi rodada; só a trava de "item sem custo", que era a que barrava as linhas de arte.
  A **ficha de produção do troféu na OS** (peças por camada, tempo de laser, arquivo de corte) é a etapa 4 e não existe: a OS recebe as linhas, sem a ficha.
- **O PDF** do orçamento com troféu: ele lê `tipo_produto` e `especificacao`, que a gravação preenche, mas não foi gerado nesta etapa.
- "Repetir o último pedido do cliente" copia as linhas do troféu como itens comuns (o mesmo que acontece com o 3D).
