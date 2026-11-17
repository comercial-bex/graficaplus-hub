# Ensaio da migração: histórico de versões do orçamento

Migração: `supabase/migrations/20261117130000_orcamento_historico_de_versoes.sql`. Estado: **ensaiada no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final. NÃO aplicada: quem aplica é o dono, depois de revisar.** Teste: `tests/orcamento-historico-de-versoes-migracao.test.ts`.

Conferido depois do ensaio, no banco vivo: 94 versões, 131 itens de versão, nenhuma função `orcamento_historico_de_versoes`.

## O que a migração faz

Cria a função de leitura `orcamento_historico_de_versoes(p_orcamento uuid) returns jsonb` (STABLE, SECURITY DEFINER, `search_path = public`). Devolve, da mais nova para a mais velha, só os campos que a tela precisa: id, número, status, datas, autor, total, quantidade de itens, se é retroativa, se é a aprovada, o que mudou em relação à anterior (`orcamento_retrato_diferencas`) e o total anterior. Lê quem vê preço (`can_see_prices`, a mesma regra de `orcamento_diferenca_da_versao`); quem não vê, não tem sessão ou passa id nulo ou inexistente recebe `[]`. Anon fora; authenticated e service_role executam. Não grava nada.

Md5 do corpo impresso pelo banco no ensaio: `676b8c35c23fc2cdff16aac6465d83fb`. ACL: `postgres`, `authenticated`, `service_role`.

## Ensaio no banco vivo

Resultado literal (trechos longos do JSON mantidos):

```
ENSAIO OK, DESFEITO:
[0] md5 da funcao=676b8c35c23fc2cdff16aac6465d83fb proacl={postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
[1] admin, orcamento 159: 3 versoes; numeros em ordem=3,2,1; v1 o_que_mudou nulo=true
    versao mais nova de 159: {"id": "07c353ff-0ea2-4aa8-92ec-16b67daba4ac", "autor": "Jhesselem Medeiros", "numero": 3, "status": "aprovada", "criada_em": "2026-11-03T11:51:58.049374+00:00", "qtd_itens": 1, "enviada_em": null, "retroativa": false, "aprovada_em": "2026-11-03T11:51:58.049374+00:00", "o_que_mudou": {"mudou": false, "campos": [], "termos": ["precisa_entrega"], "itens_novos": 0, "itens_mudados": 0, "itens_tirados": 0, "retrato_sem_itens": false}, "valor_total": 70.09, "e_a_aprovada": true, "valor_anterior": 70.09}
[2] admin, orcamento 106: [{"id": "d70f5857-bcbf-4367-b307-ec947d36ac21", "autor": null, "numero": 2, "status": "aprovada", "criada_em": "2026-10-23T13:27:26.323789+00:00", "qtd_itens": 1, "enviada_em": "2026-10-23T13:28:14.384014+00:00", "retroativa": false, "aprovada_em": "2026-10-23T13:27:26.323789+00:00", "o_que_mudou": {"mudou": true, "campos": [], "termos": [], "itens_novos": 1, "itens_mudados": 0, "itens_tirados": 0, "retrato_sem_itens": false}, "valor_total": 32.64, "e_a_aprovada": true, "valor_anterior": 0.00}, {"id": "a4fe3ee1-2ed8-4d36-bf37-6790e3d8d1ac", "autor": null, "numero": 1, "status": "enviada", "criada_em": "2026-10-23T00:54:13.809523+00:00", "qtd_itens": 0, "enviada_em": "2026-10-22T13:19:59.061+00:00", "retroativa": true, "aprovada_em": null, "o_que_mudou": null, "valor_total": 0.00, "e_a_aprovada": false, "valor_anterior": null}]
[3] admin, orcamento sem versao: []
    p_orcamento nulo: []
    id que nao existe: []
[4] gestor em 159: 3 versoes
[4] financeiro em 159: 3 versoes
[4] vendedor em 159: 3 versoes
[4] sem papel em 159: 0 versoes
[5] anon: 42501 permission denied for function orcamento_historico_de_versoes
[6] versoes antes/depois=94/94
```

Leitura: a versão 1 de cada orçamento sai com `o_que_mudou` nulo (primeira versão); a retroativa do 106 sai com `retroativa=true` e `qtd_itens=0` (a tela diz "Retrato antigo, sem lista de itens"); `autor` fica nulo quando a versão não tem autor (a tela diz "Autor não registrado"); nenhuma versão foi criada.
