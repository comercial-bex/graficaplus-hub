# Ensaio da migração: resposta do cliente só em orçamento enviado

Migração: `supabase/migrations/20261117110000_resposta_do_cliente_so_em_enviado.sql`. Estado: **ensaiada no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final. NÃO aplicada: quem aplica é o dono, depois de revisar.** Teste: `tests/resposta-do-cliente-so-em-enviado-migracao.test.ts`.

Conferido depois do ensaio, no banco vivo: nenhuma função `responder_orcamento_publico`, 9 orçamentos recusados, 31 aprovados, 26 enviados, 127 no total.

## O que a migração faz

Cria a função `responder_orcamento_publico(p_token text, p_decisao text, p_nome text, p_observacao text, p_ip text) returns jsonb`, `SECURITY DEFINER`, `search_path = public`, executável só por `service_role`. Com a linha travada (`FOR UPDATE`), só aceita resposta de orçamento em `enviado`, sem OS e dentro da validade. A validade conta do envio (`enviado_em`, na falta dele a criação) mais `validade_dias`, o último dia vale inteiro, no horário de Brasília. Aprovar grava `aprovado_em`, nome e IP; "ajuste" grava recusado (`rejeitado` no enum); a observação é anotada com data e nome. Nunca lança erro por causa do estado do orçamento: devolve `{ok, codigo, ...}`.

Md5 do corpo (`pg_proc.prosrc`) impresso pelo banco no ensaio: `fd8cdb0b9085736f8d63e0965fa9c691`. O teste do repositório recalcula esse número a partir do arquivo.

## Ensaio no banco vivo

Função criada na mesma transação, chamada com `SET LOCAL ROLE` anon, authenticated e service_role, com tokens reais, e um bloco final `RAISE EXCEPTION 'ENSAIO OK, DESFEITO'`. O limite da validade foi ensaiado ajustando `enviado_em` dentro da transação.

Resultado literal:

```
ENSAIO OK, DESFEITO:
[0] antes: rejeitados=9 aprovados=31 total=127
[1] anon: 42501 permission denied for function responder_orcamento_publico
    authenticated: 42501 permission denied for function responder_orcamento_publico
[2] 197 enviado vencido (ate 16/11): {"ok": false, "codigo": "vencido", "status": "enviado", "valido_ate": "2026-11-16"}
    132 rascunho com link: {"ok": false, "codigo": "nao_liberado", "status": "rascunho"}
    142 aprovado sem OS, ajuste: {"ok": false, "codigo": "ja_aprovado", "status": "aprovado"} status depois=aprovado
    146 aprovado com OS: {"ok": false, "codigo": "ja_virou_pedido", "status": "aprovado"}
    106 convertido: {"ok": false, "codigo": "ja_virou_pedido", "status": "convertido"}
    inexistente: {"ok": false, "codigo": "nao_encontrado"}
    decisao invalida: {"ok": false, "codigo": "decisao_invalida"}
    nome curto: {"ok": false, "codigo": "dados_invalidos"}
    token nulo: {"ok": false, "codigo": "dados_invalidos"}
[3] 229 com ultimo dia ontem: {"ok": false, "codigo": "vencido", "status": "enviado", "valido_ate": "2026-11-16"}
    228 com ultimo dia hoje: {"ok": true, "codigo": "ok", "status": "aprovado", "orcamento_id": "49a20e33-5709-49f4-bf03-4b0fa76d0957"} status=aprovado
[4] 233 ajuste: {"ok": true, "codigo": "ok", "status": "rejeitado", "orcamento_id": "442155ff-eceb-4482-87b9-a1d24d6d96d7"} status=rejeitado obs termina com: 2026 10:08:41] Teste Ensaio: Mudar a cor
    233 segunda resposta: {"ok": false, "codigo": "encerrado", "status": "rejeitado"}
[5] 227 aprovado: {"ok": true, "codigo": "ok", "status": "aprovado", "orcamento_id": "3992df03-b809-487b-9a38-0a807fbaca3a"} status=aprovado nome=[Maria Teste] ip=203.0.113.9 versao_aprovada=true versoes antes/depois=1/2 aprovado_em preenchido=true
[6] dentro do ensaio: rejeitados=10 (era 9) aprovados=33 (era 31)
```

Leitura: 142 (aprovado sem OS, o caso "derrubar um aprovado") agora devolve `ja_aprovado` e continua aprovado; 132 (rascunho com link) devolve `nao_liberado`; 197 (enviado, venceu em 16/11) devolve `vencido`; no limite, o último dia (hoje) responde e o dia seguinte não. Aprovar passa pelos gatilhos de versão e de aviso sem erro (versão aprovada criada). A fila de aviso e a sequência da fila podem ter avançado no ensaio (sequências não voltam); nada foi enfileirado de verdade.

Corrida: o `FOR UPDATE` serializa duas respostas ao mesmo tempo; a segunda resposta no mesmo orçamento devolve `encerrado` ou `ja_aprovado` (provado em série no item [4]).

## Códigos devolvidos

`ok`, `ja_aprovado`, `ja_virou_pedido`, `vencido` (traz `valido_ate`), `encerrado`, `nao_liberado`, `nao_encontrado`, `decisao_invalida`, `dados_invalidos`. A lista completa e o que a tela deve dizer está em `docs/contrato-orcamentos-onda-1.md`.

## Revisão de 17/11/2026: ordem de aplicação

O cabeçalho dizia que o front tolera a função ausente. Não tolera: `responderOrcamentoPublico` falha fechado (lança a mensagem de link indisponível e não grava nada). Por isso esta migração tem de ser aplicada ANTES do Publish do front, e o rollback não é só o `DROP FUNCTION`: primeiro volta o front anterior, depois o DROP. Em 17/11/2026 há 9 orçamentos enviados dentro da validade com link aberto para resposta. O cabeçalho foi corrigido; o corpo da função não mudou (md5 `fd8cdb0b9085736f8d63e0965fa9c691`, o mesmo do ensaio acima).
