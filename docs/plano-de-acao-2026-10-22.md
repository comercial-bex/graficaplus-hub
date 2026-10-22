# Plano de ação — Bex Print, 22/10/2026

Conferência do `diagnostico-bex-print-2026-10-22.md` contra o banco de produção (só `SELECT`, contagens) e o código, mais duas situações novas pedidas pelo dono: **produção interna** (amostra, vitrine, mostruário) e **consumo de tinta pelo programa de impressão (RIP)**.

Legenda: **[Certeza]** visto no banco ou no código · **[Provável]** dedução forte · **[Chute]** hipótese.

---

## 1. O diagnóstico bate?

**Bate no essencial.** A tese central se confirma: o sistema está construído e quase não foi exercitado.

Divergências:

1. **R6 (custo do orçamento vazio) está errado em parte.** O diagnóstico diz que o custo estava vazio em 59/59. Hoje 12 de 61 orçamentos têm custo, porque o gatilho `tg_orcamento_soma_os_itens` (19/10) grava o custo a cada item. Os 49 sem custo são orçamentos sem item, ou só com item livre. **Eu discordo da solução "view sobre `orcamento_custos`":** o cabeçalho já é calculado no banco. O problema que sobra é o item livre (R7), não a fonte do custo.
2. **R4 é dado antigo, não regra ausente.** A função `converter_orcamento_em_os` atual já grava "convertido". Os 9 orçamentos com OS que continuam "aprovado" (#55, #61, #67, #71, #73, #75, #78, #98, #108) nasceram antes da regra, ou entraram por outro caminho [Provável]. A correção é de dado, não de função.
3. **R14 `search_path`: resolvido para o que importa.** Nenhuma função `SECURITY DEFINER` está sem `search_path` fixo. As citadas no diagnóstico não são DEFINER.
4. **Os números mudaram desde a manhã:** 61 orçamentos (eram 59) e **26 enviados/aprovados sem versão** (eram 22, o R1 piorou com o uso). As OS são 8 em entrada, 1 em design, 1 concluída e 1 cancelada (a #49, cancelada em 21/10).

### Status de cada achado

| ID | Status | Prova (22/10) |
|---|---|---|
| R1 versão congelada | **Confirmado e piorando** | `orcamento_versoes` = 0; 26 enviados/aprovados sem versão |
| R2 fechar sem prova | **Confirmado** | OS 44: 2 registros de histórico; `fechar_os` só barra tarefa obrigatória, e `os_tarefas` = 0 |
| R3 eixos de status | **Confirmado** | `status_arte` só "pendente"; `status_logistica` só "nao_iniciada"; 3 OS com `status ≠ status_geral` |
| R4 aprovado → convertido | **Confirmado nos dados; regra já existe** | 9 com OS continuam "aprovado"; 8 aprovados sem OS |
| R5 rastro do lead | **Confirmado** | 12 leads, 0 com cliente; `conversa_id` sem FK em `orcamentos` e `arquivos` |
| R6 custo vazio | **Em parte refutado** | 12 de 61 com custo; o gatilho existe desde 19/10 |
| R7 item livre | **Confirmado; atacado hoje** | 16 de 41 itens sem produto. Em 22/10: aviso "Usar o produto" e o banner por m² (a causa de 8 desses) |
| R8 sem responsável/prazo | **Confirmado** | 11/11 sem designer, operador e máquina; 8/11 sem prazo |
| R9 entrega | **Confirmado** | `entregas_instalacoes` = 0 |
| R10 portal/NPS | **Confirmado** | `portal_cliente_acessos` = 0 |
| R11 parceiros | **Em andamento** | 0 parceiros, mas desde 22/10: convite da casa, `/seja-parceiro`, login separado, preço de parceiro, 2 clientes marcados |
| R12 dois checklists | **Confirmado** | `qualidade_*` com 1/2 linhas × `checklists_os`/`checklist_respostas` com 0 |
| R13 estruturas duplicadas | **Confirmado** | resultados: 0 / 11 / 1 |
| R14 integridade/segurança | **Em parte resolvido** | DEFINER sem `search_path`: 0. RLS ligado sem política: 12 tabelas, todas acessadas só por função (TV, catálogo, portal, exceções). Falta documentar |
| R15 escrita no navegador | **Confirmado, risco menor** | Os totais já são somados no banco; a tela ainda grava direto |
| R16 migrações fora do repo | **Confirmado** | — |

### Achados novos

- **R17 · Não existe OS interna.** [Certeza] `ordens_servico.cliente_id` é obrigatório e não há campo de finalidade. Um banner de amostra, um brinquedo 3D de vitrine ou um copo gravado de mostruário só entra como venda para um cliente fictício. Isso gera conta a receber, aviso ao cliente, NPS e meta de vendedor que não deveriam existir, e o custo não cai em lugar nenhum.
- **R18 · A tinta é um material só, estimado por m².** [Certeza] "Tinta solvente (conjunto)" está em ml, a R$ 0,09/ml, com 4.000 ml. A ficha da lona impressa estima 12 ml/m². O consumo real por cor, que o programa de impressão (RIP) informa, não entra no sistema.
- **R19 · A baixa da OS sugeria quantidade sem a área.** Resolvido em 22/10 (#166). A OS #164 ficou com 0,955 m² de lona presos em reserva: decisão do dono.
- **R20 · Recriar view apaga as opções de segurança.** Resolvido em 22/10 (#167) nas views de produto. Fica a regra para toda migração futura.

---

## 2. Produção interna (amostra, vitrine, mostruário)

### O que o dono descreveu

- Banner de amostra para vendas futuras.
- Brinquedo 3D para a vitrine.
- Copo gravado na fiber para mostruário.

São trabalhos que usam máquina, material e hora de gente, mas não têm cliente nem receita.

### Proposta

1. **Finalidade da OS**: `venda` (padrão), `mostruario` (amostra, vitrine, mostruário), `uso_interno` (placa da própria gráfica, uniforme) e `reposicao` (refazer peça perdida ou com defeito, ligada à OS original).
2. **Cliente da casa**: um cadastro "Bex Print (interno)", marcado como interno. A OS continua com cliente (não quebra nenhuma tela nem relatório), e a finalidade decide o resto.
3. **O que muda numa OS que não é de venda:**
   - não gera conta a receber nem parcelas, e o fechamento não exige pagamento;
   - não manda aviso ao cliente, link de portal nem NPS;
   - não conta em meta, comissão ou faturamento.
   - **o resto segue igual:** material previsto, reserva, baixa, agenda de máquina, apontamento, custo real, Kanban, TV.
4. **Onde o custo cai:** no resultado do mês, numa linha própria ("Mostruário e uso interno: R$ X"), separada do custo das vendas. Uma amostra não pode ser lida como prejuízo de OS.
5. **Como nasce:**
   - pelo botão "Nova OS interna" na tela de OS, com finalidade, produto e motivo obrigatórios;
   - no 3D, o mesmo botão ao lado de "Criar orçamento 3D" (o orçamento 3D já calcula o custo; a OS interna herda o custo, sem preço).
6. **Quem pode:** gestor e admin (a OS interna gasta material sem receita). O vendedor pode pedir; o gestor libera.
7. **Rastro:** mostruário ganha "onde está" (vitrine, balcão, com o vendedor X) e "baixado em" quando sair do mostruário. Responde à pergunta "quanto temos de amostra parada".

**Esforço:** M (migração + 1 tela + ajustes nos 4 gatilhos financeiros).
**O que pode quebrar:** os gatilhos que criam conta a receber e aviso na conversão precisam respeitar a finalidade; relatórios que somam OS precisam filtrar "venda".
**Como testar:** uma OS de mostruário do banner, de ponta a ponta. Ela deve baixar lona e tinta, não criar conta a receber e aparecer na linha de mostruário do resultado.

---

## 3. Tinta: o que o programa de impressão informa

### A resposta curta à pergunta do dono

O consumo **exato** de tinta só o programa de impressão (o RIP) sabe, porque depende da imagem: um fundo preto gasta muito mais que um texto. O sistema consegue **estimar antes** (média por m², para o orçamento) e **registrar depois** (o número do RIP, para o estoque e o custo). A regra do negócio já é essa: orçamento com média, baixa com o real.

### A imagem enviada

O print do RIP mostra o volume por cor:

| Cor | Volume |
|---|---|
| Cyan | 0,14 ml |
| Magenta | 0,11 ml |
| Yellow | 0,12 ml |
| Black | 0,06 ml |
| **Total** | **0,43 ml** |

[Provável] É uma peça pequena ou uma prova; um banner de 1 m² na média de hoje gastaria 12 ml.

### Proposta, em três passos

1. **Tinta por cor no estoque.** Trocar "Tinta solvente (conjunto)" por 4 materiais (C, M, Y, K), cada um com estoque e custo próprios, já que o frasco é comprado por cor. A ficha dos produtos impressos passa a ter as 4 linhas com a média por m².
   - **Esforço:** P.
   - **Decisão do dono:** a compra é por cor ou por conjunto?
2. **O operador informa o RIP no apontamento da impressão.** O apontamento ganha 4 campos em ml (C, M, Y, K) e o anexo do print da tela do RIP, como prova.
   - Ao concluir, a baixa da tinta usa o **número do RIP**, não a média da ficha. Lona e acabamento seguem pela previsão.
   - Sem o número do RIP, a baixa usa a média e marca "estimado".
   - **Esforço:** M.
3. **O sistema aprende a média.** Cada RIP registrado vira um ponto: ml por m² por produto e por modo de impressão. Na tela do produto aparece "média real dos últimos 30 trabalhos: 9,8 ml/m² (ficha diz 12)", com um botão para atualizar a ficha. Assim o orçamento fica mais certo com o tempo.
   - **Esforço:** P, depois do passo 2.

**Opcional, depois:** ler o print do RIP automaticamente (IA de visão) e pré-preencher os 4 campos para o operador só conferir.
- **Custo:** cada leitura gasta crédito de IA.
- **Risco:** número lido errado.
- **Regra:** o operador sempre confirma. Só vale a pena se digitar os 4 números for, na prática, o que trava o operador.

**Como testar:** imprimir o banner de amostra (OS de mostruário, seção 2), digitar os 4 números do RIP e conferir três coisas: o estoque de cada cor baixou exatamente esse volume, o custo real da OS mostra a tinta pelo custo de cada cor, e a média do produto passou a ter 1 ponto.

---

## 4. Plano de implementação em ondas

### Onda 1 — antes de operar mais pedidos (esta semana)

| # | O quê | Achado | Esforço | Teste |
|---|---|---|---|---|
| 1.1 | Congelar a versão ao enviar o orçamento; editar depois de enviado cria versão nova; a OS lê a versão aprovada | R1 | M | Enviar, mudar preço, conferir que o PDF e a OS mostram o valor aprovado |
| 1.2 | Fechar OS exige arte aprovada (ou "sem arte"), um apontamento e entrega ou retirada registrada; pular etapa só com `os.status.override` e motivo | R2 | M | Tentar fechar uma OS em "entrada": recusa com o que falta |
| 1.3 | Corrigir o status dos 9 orçamentos com OS para "convertido" (dado, reversível) | R4 | P | Funil passa a contar 10 convertidos |
| 1.4 | Item livre exige custo manual, ou vira produto | R7 | P | Item livre sem custo é recusado com o motivo |
| 1.5 | Rodar 3 casos reais até o fechamento: o banner de amostra (OS interna), um 2D de cliente, um de parceiro (john terry ou Max Lima) | Uso | — | Cada caso fecha sem dado inventado |

### Onda 2 — próximas duas semanas

| # | O quê | Achado | Esforço |
|---|---|---|---|
| 2.1 | **OS interna** (finalidade, cliente da casa, sem financeiro, linha própria no resultado) | R17 | M |
| 2.2 | **Tinta por cor + RIP no apontamento + baixa pelo real** | R18 | P + M |
| 2.3 | Eixos de status derivados de fatos (arte ← aprovação, produção ← apontamento, logística ← entrega) | R3 | M |
| 2.4 | Conversão gera tarefas padrão por categoria, sugere máquina e designer; prazo obrigatório ao enviar | R8, R2 | M |
| 2.5 | Entrega nasce na conversão quando "precisa entrega/instalação"; comprovante obrigatório; cadastrar o instalador | R9 | M |
| 2.6 | Tela para marcar cliente parceiro + linha "desconto de parceiro" + preço de parceiro dos produtos mais vendidos | R11 | P |

### Onda 3 — melhorias

| # | O quê | Achado | Esforço |
|---|---|---|---|
| 3.1 | Média real de tinta por produto e botão de atualizar a ficha | R18 | P |
| 3.2 | Rastro de origem: lead → cliente → orçamento; FK em `conversa_id` | R5 | M |
| 3.3 | Portal e NPS disparados na aprovação e no fechamento | R10 | P |
| 3.4 | Escolher um modelo de checklist e um de resultado; aposentar os outros | R12, R13 | M |
| 3.5 | Documentar as 12 tabelas com RLS sem política (acesso só por função); trazer as migrações reais para o repo | R14, R16 | P |
| 3.6 | Leitura automática do print do RIP (IA), se a digitação travar o operador | R18 | M |
| 3.7 | Avaliar NF-e/NFS-e e boleto/Pix | Mercado | G |

**O que mais sobe a prontidão com menos esforço:** os 3 casos reais da onda 1 (1.5). Eles sobem o "uso comprovado", que é o eixo em 35%, e mostram o que ainda falta sem escrever código novo.

---

## 5. Perguntas que só o dono responde

1. **Tinta:** a compra é por cor (C, M, Y, K separados) ou em conjunto? E as máquinas 3D e a fiber, têm consumível que deva entrar do mesmo jeito (filamento já entra pelo orçamento 3D)?
2. **OS interna:** quem pode abrir (só gestor e admin, ou vendedor pedindo)? O custo do mostruário entra como despesa de marketing no resultado do mês?
3. **Mostruário:** quer controlar onde cada amostra está e quando sai da vitrine?
4. **Fechar OS:** qual a prova mínima? Proposta: arte aprovada ou "sem arte", um apontamento, e foto da peça ou assinatura de retirada.
5. **OS 44 e a OS #164:** a 44 é teste? E os 0,955 m² de lona presos na #164: devolvo ao estoque ou baixo como perda?
6. **Prazo:** obrigatório no orçamento, ou padrão por tipo de produto?
7. **NF-e e boleto:** agora ou depois?
