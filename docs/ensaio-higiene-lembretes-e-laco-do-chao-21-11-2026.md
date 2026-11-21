# Ensaio: higiene dos lembretes e laço do chão (21/11/2026)

Migração: `supabase/migrations/20261121120000_higiene_lembretes_e_laco_do_chao.sql`.

## O que muda

1. `lembrete_orcamentos_aprovados_sem_os`: o aviso diário aos gestores passa a ignorar quem está inativo
   (`u.ativo IS NOT FALSE`). Era a única rotina de aviso a pessoas que não respeitava `usuarios.ativo`.
2. `lembretes_da_equipe`: ganha o bloco 12, "Em produção, mas ninguém começou numa máquina". Entra no resumo da operação
   (`lembrete_operacao`). Fica de fora a OS que já tem máquina, a que tem apontamento aberto e a que tem job de impressão
   3D. Com nada a cobrar, o bloco não escreve nada. É um sub-bloco com `EXCEPTION` próprio: se falhar, o aviso diário sai
   como saía.

Nenhuma tabela muda, nenhuma função nasce, e as permissões ficam como estão (`CREATE OR REPLACE` mantém os grants).

## Como a troca é feita

`pg_get_functiondef` mais `replace` de um trecho que existe uma vez só, com o md5 do corpo de hoje conferido antes
(`5a5f75b4…` e `5efedcc3…`) e o md5 do corpo novo conferido depois (`7ed3350d…` e `c52e2e74…`). Se alguém mexer numa
das duas funções antes de a migração rodar, ela para.

## Ensaio no banco vivo (21/11/2026, desfeito por `RAISE EXCEPTION`)

A migração inteira, sem o `COMMIT`, com o gestor (Raymison) marcado como inativo dentro da transação.

| O que se olhou | Antes | Depois |
| --- | --- | --- |
| Aviso aos gestores com o gestor **inativo** | avisou o Raymison (`enfileirados` 1) | não avisou ninguém (`enfileirados` 0) |
| Aviso aos gestores com o gestor **ativo** (controle) | avisou o Raymison | avisou o Raymison, igual |
| Bloco novo no resumo da operação | não existia | presente: "Em produção, mas ninguém começou numa máquina: 1. OS #235 … parada em produção há 2 dias" |
| OS 233 e 237 (impressão 3D, com job) | — | fora do bloco, de propósito |
| md5 de `lembrete_orcamentos_aprovados_sem_os` | `5a5f75b4abb65cf763a18226107b6581` | `7ed3350d7810cac624fc63a8c61ac1bd` |
| md5 de `lembretes_da_equipe` | `5efedcc3af2f1af0ded8f11646f1a07b` | `c52e2e74fc0b7c543839f2c8c5c63007` |
| `anon` com `EXECUTE` nas duas | não | não |

## O achado que não era desta migração

Na hora de olhar quem recebe o resumo da operação, apareceu um furo maior: a automação **"Lembrete à operação"** estava
com o telefone do **Léo** no payload ("Olá, Leonardo! … o que está na sua mão hoje"), e o bloqueio de números do dono
(17/11) **não barra a fila de automações**: ela manda direto para o telefone do payload. Resultado, medido em
`whatsapp_logs`: 4 envios ao número bloqueado, às 09:00 de 18, 19, 20 e 21/11.

- **Já feito no banco (21/11):** o payload da automação aponta para o gerente (Raymison) e o texto diz "Olá, Raymison!".
- **Neste PR:** `whatsapp-enviar.server.ts` passa a conferir o bloqueio **nas três filas, antes de chamar o Z-API**
  (a última porta). Sem conseguir ler a lista de bloqueados, a rodada não envia nada. Teste em
  `tests/numero-bloqueado.test.ts`, com um alarme que falha se alguém criar um novo ponto de envio sem conferir.
- **Falta:** publicar o front. Até lá, o que protege o Léo é o payload corrigido.

## Aplicação

Depois do CI verde e do merge: aplicar a migração pela ferramenta do banco (o mesmo arquivo, sem mudar uma vírgula),
conferir os dois md5 e `has_function_privilege('anon', …)` falso, e publicar o front. Conferência no dia seguinte útil
(segunda, 23/11, 09:00): o resumo da operação chega ao gerente, com o bloco novo se houver OS parada em produção.
