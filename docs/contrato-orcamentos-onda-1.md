# Contrato do banco para a tela: orçamentos, onda 1

Para quem escreve o front (PR2). Tudo aqui foi ensaiado no banco vivo em 17/11/2026 e **nada foi aplicado**: as seis migrações esperam o OK do dono, na ordem 100000, 110000, 120000, 130000, 180000, 190000. Os resultados literais estão em `docs/ensaio-*.md` e a sequência completa em `docs/ensaio-orcamentos-onda-1.sql`. Regra da tela: **RPC ausente nunca cai em UPDATE direto**; mostre "ainda não disponível" em português simples.

Como o erro chega: as funções de equipe (`aprovar_orcamento`, `renovar_orcamento_vencido`) lançam `RAISE EXCEPTION` com texto pronto para a tela em `message` e um código de máquina em `details` (o `DETAIL` do Postgres; no `supabase-js` é `error.details`). Falta de permissão vem de `require_permission`, com `message` "Permissão necessária: orcamentos.approve" (ou `.create`, `.send`) e sem `details`. O tipo gerado (`types.ts`) não conhece nenhuma função nova: chame com `(supabase.rpc as any)` até regenerar.

## 1. `responder_orcamento_publico`

```
public.responder_orcamento_publico(p_token text, p_decisao text, p_nome text, p_observacao text, p_ip text) returns jsonb
```

Quem chama: **só o servidor, com a chave de serviço** (EXECUTE só para `service_role`; anon e authenticated recebem `42501`). Quem chama é a server function `responderOrcamentoPublico`; a tela do cliente nunca fala com o banco direto. `p_decisao` é `'aprovado'` ou `'ajuste'`. `p_nome` precisa ter pelo menos 3 letras depois de aparado; `p_token` pelo menos 10 caracteres. `p_observacao` e `p_ip` podem ser vazios ou nulos.

Nunca lança erro por causa do estado do orçamento. Sempre devolve `{ ok: boolean, codigo: string, ... }`:

| `codigo` | `ok` | Campos extras | Quando | Texto sugerido para o cliente |
| --- | --- | --- | --- | --- |
| `ok` | true | `status` (`aprovado` ou `rejeitado`), `orcamento_id` | gravou | Resposta registrada. |
| `ja_aprovado` | false | `status` | já está aprovado e ainda sem OS | Este orçamento já foi aprovado. Não precisa responder de novo. |
| `ja_virou_pedido` | false | `status` | tem OS ou está convertido | Este orçamento já virou pedido e está em produção. |
| `vencido` | false | `status`, `valido_ate` (data `AAAA-MM-DD`) | expirado, ou enviado depois do último dia | A validade deste orçamento acabou. Fale com a equipe para receber um novo. |
| `encerrado` | false | `status` | recusado (qualquer outro estado que não seja enviado) | Este orçamento já foi encerrado. Fale com a equipe se quiser retomar. |
| `nao_liberado` | false | `status` | rascunho | Este orçamento ainda não foi liberado para resposta. Fale com a equipe. |
| `nao_encontrado` | false | | token que não existe | Este link não existe mais. Fale com a equipe para receber um novo. |
| `decisao_invalida` | false | | `p_decisao` diferente de aprovado e ajuste | Não foi possível registrar sua resposta. |
| `dados_invalidos` | false | | nome curto ou token curto ou nulo | Informe seu nome completo para registrar a resposta. |

Regras: só responde quem está em `enviado`, sem OS e dentro da validade. A validade conta de `enviado_em` (na falta dele, de `created_at`) mais `validade_dias`, o último dia vale inteiro, no horário de Brasília: `valido_ate = (coalesce(enviado_em, created_at) em America/Sao_Paulo)::date + validade_dias`, e responde enquanto `hoje (Brasília) <= valido_ate`. Orçamento renovado passa a valer a contar do novo `enviado_em`. Aprovar grava `aprovado_em`, `aprovado_por_nome` e `aprovado_ip`; ajuste grava `rejeitado` (aparece como "Recusado"). A observação do cliente vai para `observacoes` com data e nome. Depois de `ok` com `status = aprovado`, a server function continua chamando `converter_aprovado_pelo_cliente`, como hoje.

Para a página pública: `podeResponder` é verdadeiro só com status `enviado`, sem OS e `hoje <= valido_ate`. A página precisa calcular o mesmo `valido_ate` (hoje o PDF e a página contam de `created_at`; para orçamento renovado o "Válido até" só bate com a regra se passar a contar de `coalesce(enviado_em, created_at)`).

## 2. `tg_orcamento_so_apaga_rascunho_sem_rastro` (gatilho de exclusão)

Gatilho `BEFORE DELETE` em `orcamentos`. Não é chamado pela tela; ela só faz `DELETE` como hoje (a policy continua deixando só admin e gestor). Se o orçamento não é rascunho ou tem qualquer rastro, o `DELETE` falha com **`23001`** (`restrict_violation`) e `message` pronta para a tela:

`Este orçamento não pode ser apagado: <motivo>. Fale com o gestor.`

Motivos (o trecho depois dos dois pontos): `ele já passou da fase de rascunho`, `ele já foi enviado ao cliente`, `o cliente já abriu o link`, `ele tem aprovação do cliente`, `ele tem ordem de serviço`, `ele tem comprovante de pagamento`, `ele tem cobrança lançada`, `ele está ligado a pedido de parceiro, cobrança no WhatsApp, peça 3D ou arquivo de impressão`, `ele já gerou PDF`. Para vendedor e financeiro o `DELETE` devolve 0 linhas (policy), sem erro: a tela deve conferir a contagem e dizer "Seu perfil não pode apagar". O botão de apagar só aparece para admin e gestor, e só em rascunho. Vale também para service_role e migração. **Atenção:** o rascunho 185 não tem rastro e fica apagável.

## 3. `orcamento_historico_de_versoes`

```
public.orcamento_historico_de_versoes(p_orcamento uuid) returns jsonb
```

Executável por `authenticated` e `service_role`. Só leitura. Devolve um array JSON, da versão mais nova para a mais velha, ou `[]` quando o orçamento não tem versão, o id não existe, não há sessão ou a conta não vê preço (`can_see_prices`). `[]` é "sem versões" e também "sem permissão": a tela não consegue distinguir e deve mostrar o estado vazio com texto neutro. Nunca lança erro de regra; erro de rede ou função ausente (`42883`, `PGRST202`) deve virar "Histórico ainda não disponível", nunca estado vazio.

Cada item:

| Campo | Tipo | Observação |
| --- | --- | --- |
| `id` | uuid | |
| `numero` | inteiro | 1, 2, 3... |
| `status` | `'enviada'` ou `'aprovada'` | |
| `criada_em`, `enviada_em`, `aprovada_em` | timestamp ou null | `enviada_em` nulo na versão criada só ao aprovar |
| `autor` | texto ou null | nome de quem aprovou ou criou; nulo vira "Autor não registrado" |
| `valor_total` | número | |
| `qtd_itens` | inteiro | 0 na versão retroativa |
| `retroativa` | booleano | retrato antigo sem lista de itens |
| `e_a_aprovada` | booleano | é `versao_aprovada_id` do orçamento |
| `o_que_mudou` | objeto ou null | nulo na versão 1. Chaves: `mudou`, `itens_novos`, `itens_tirados`, `itens_mudados`, `campos` (lista), `termos` (lista), `retrato_sem_itens` |
| `valor_anterior` | número ou null | total da versão anterior; nulo na versão 1 |

## 4. `orcamento_congelar_versao` (interna)

```
public.orcamento_congelar_versao(p_orc public.orcamentos, p_aprovando boolean, p_uid uuid) returns uuid
```

Só `service_role` (e as funções do sistema, que são do dono do banco). **A tela nunca chama.** Devolve o id da versão (a última, se o conteúdo não mudou; uma nova, se mudou). Mesmo hash de itens e total: não cria versão. Quem chama: `tg_orcamento_congela_versao` (mudança de status), `confirmar_envio_documento` (reenvio do orçamento que já estava enviado, pelo WhatsApp do sistema), `renovar_orcamento_vencido`. Para wa.me e link copiado, que passam por `registrar_envio_documento` (não trocada), **o servidor deve chamar esta função com `service_role` depois do registro**, passando a linha atual do orçamento (`SELECT *`), `false` e o id de quem enviou. Sem isso, nesses dois caminhos a faixa "mudou depois de enviado" continua acesa.

## 5. `renovar_orcamento_vencido`

```
public.renovar_orcamento_vencido(p_orcamento_id uuid) returns jsonb
```

Executável por `authenticated` e `service_role`. Exige `orcamentos.create` **e** `orcamentos.send` (admin, gestor e vendedor têm as duas; financeiro não tem nenhuma). Só renova orçamento **expirado**, ou **enviado que já passou da validade**, sem OS e com valor. "Vencido" aqui é a conta exata do quadro e da API: `coalesce(enviado_em, created_at) + validade_dias dias < agora` (e `validade_dias > 0`), diferente da regra do link do cliente, que deixa o último dia valer inteiro. Faz: `status = enviado`, `enviado_em = agora`, congela a versão e grava o evento `orcamento_renovado`. Não manda mensagem ao cliente.

Sucesso:

```json
{ "ok": true, "orcamento_id": "...", "status": "enviado", "status_anterior": "expirado" | "enviado",
  "enviado_em": "2026-11-17T13:17:54Z", "valido_ate": "2026-11-24", "versao_id": "..." }
```

Erros (`message` em português pronta para a tela; `details` é o código):

| `details` | `message` | Quando |
| --- | --- | --- |
| `nao_encontrado` | Orçamento não encontrado. | id inexistente ou fora da RLS |
| `tem_os` | Este orçamento já virou ordem de serviço e não pode ser renovado. | tem OS ou está convertido |
| `origem_invalida` | Só um orçamento expirado ou enviado e vencido pode ser renovado. Este está como `<situação>`. | rascunho, aprovado ou recusado (`rascunho`, `aprovado`, `recusado`) |
| `ainda_valido` | Este orçamento ainda está dentro da validade, não precisa renovar. | enviado que não venceu |
| `sem_valor` | Orçamento sem valor não pode ser reenviado. Preencha os itens antes. | valor total zero |
| (sem `details`) | Permissão necessária: orcamentos.create ou orcamentos.send | sem a permissão |

Isto substitui o `UPDATE` direto de `camposDaRenovacao` em `orcamentos.index.tsx` e na tela do orçamento. `AGENTS.md` (linha dos escritores de `enviado_em`) passa a listar `renovar_orcamento_vencido` e deixa de listar "manual status Select" e `camposDaRenovacao` quando o front mudar.

## 6. `aprovar_orcamento` (trocada)

```
public.aprovar_orcamento(p_orcamento_id uuid, p_versao_id uuid default null, p_observacao text default null) returns jsonb
```

Assinatura e permissão (`orcamentos.approve`: admin, gestor e vendedor) **não mudam**. Passa a conferir a origem, **só de enviado** (escolha confirmada na tela: o único chamador é o botão "Cliente aprovou: converter em OS", que só aparece com o orçamento enviado).

| Situação do orçamento | Resultado |
| --- | --- |
| enviado, sem OS | aprova como antes: `{ orcamento_id, versao_id }`, evento `orcamento_aprovado`, versão aprovada |
| já aprovado | `{ orcamento_id, versao_id, ja_aprovado: true }`, sem evento nem versão novos (a tela pode seguir para converter) |
| tem OS ou convertido | erro, `details = tem_os`: Este orçamento já virou ordem de serviço e não pode ser aprovado de novo. |
| rascunho, recusado ou expirado | erro, `details = origem_invalida`: Só um orçamento enviado ao cliente pode ser aprovado. Este está como `<situação>`. |
| id inexistente | erro sem `details`: Orçamento não encontrado |
| sem permissão | Permissão necessária: orcamentos.approve |

Com isso, o `Select` de status deixa de ser caminho de aprovação no PR2 (o gatilho que fecha o `UPDATE` direto é do PR3, depois do Publish).

## 7. Sem mudança de contrato para a tela

- `tg_orcamento_congela_versao`: mesmo gatilho, mesma versão gravada (provado caso a caso no ensaio); só passou a delegar.
- `confirmar_envio_documento(p_usuario uuid, p_envio_id uuid)`: mesma assinatura e retorno `{status_mudou, enviado_em_gravado}`; só service_role; no reenvio de orçamento já enviado passa a congelar a versão.
- `area_cobrada` (colunas geradas de `orcamento_itens` e `itens_os`): mesmo nome, tipo e views; o valor agora arredonda uma vez, no lote (120 adesivos de 5 x 5 cm: 0,300 m2, não 0,360). `valor_total` não muda.
- `api_executar`: não foi mudada. A troca guardada para o PR3 está provada em `docs/ensaio-aprovacao-e-renovacao-por-funcao.md`.

## Pendências que o front e o dono precisam saber

1. **Rascunho sem rastro fica apagável**, inclusive o 185 (item a zero): decidir antes se o botão de apagar vai existir.
2. **Sem saída de rascunho com rastro** (217, 69, 218, 226, 247, 132 e os com peça 3D): sem Cancelado (fora da onda), a mensagem manda "falar com o gestor".
3. **Os 8 enviados vencidos com link** (115, 158, 168, 174, 175, 187, 196, 197): depois da 110000 o cliente deixa de poder responder; renovar é por pessoa, caso a caso.
4. **wa.me e link copiado** não congelam a versão sem a chamada do servidor descrita em 4.
5. A renovação por `api_executar` hoje não congela a versão; fica para a troca guardada do PR3.
6. Validade do link (último dia inteiro, contada do envio) e do quadro (instante exato) diferem em até um dia, de propósito.
