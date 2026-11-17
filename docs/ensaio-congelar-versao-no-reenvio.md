# Ensaio da migração: congelar a versão também no reenvio

Migração: `supabase/migrations/20261117180000_congelar_versao_no_reenvio.sql`. Estado: **ensaiada no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final. NÃO aplicada: quem aplica é o dono, depois de revisar, antes da 190000 (a renovação da 190000 chama a função nova daqui).** Teste: `tests/congelar-versao-no-reenvio-migracao.test.ts`.

Conferido depois do ensaio, no banco vivo: `tg_orcamento_congela_versao` com md5 `73d5680ed15a4534da13718eafd5ed61`, `confirmar_envio_documento` com `9d0ab672aaba56e75de28ea6fa307317` (os de antes), nenhuma função `orcamento_congelar_versao`, 94 versões, 131 itens de versão.

## O que a migração faz

| Parte | O que faz |
| --- | --- |
| 1 | Função nova `orcamento_congelar_versao(p_orc public.orcamentos, p_aprovando boolean, p_uid uuid) returns uuid`: o corpo do gatilho, com a linha como parâmetro. Mesmo hash de itens e total: reenviar sem mudança não cria versão. SECURITY DEFINER, só `service_role` executa |
| 2 | `tg_orcamento_congela_versao` (guarda de md5 do corpo vivo) passa a só delegar à função nova e guardar `versao_aprovada_id`. O gatilho em si não é recriado |
| 3 | `confirmar_envio_documento` (guarda de md5 do corpo vivo): no ramo do orçamento que já estava enviado, chama a função nova depois de gravar, com o usuário que confirmou. `enviado_em` continua sem ser reescrito |

Sem carga retroativa: nenhum UPDATE, nenhuma versão criada agora. Os 5 orçamentos com mudança real depois do envio (115, 198, 206, 227, 233) só ganham versão quando alguém reenviar. Fica de fora: wa.me e link copiado (`registrar_envio_documento` não é trocada); para congelar neles o servidor chama `orcamento_congelar_versao` (service_role) depois do registro.

Md5 dos corpos impressos pelo banco no ensaio: `orcamento_congelar_versao` `60c04a27d5693293c6cb0481afa73b21`, `tg_orcamento_congela_versao` `16098a54f9fd7b3874894946c7f414ca`, `confirmar_envio_documento` `c4509f50c6b41e9131f5a6530969be56`.

## Ensaio no banco vivo

Antes de trocar, três casos rodaram com o gatilho velho em sub-transações desfeitas (233 enviado para aprovado, 227 enviado para aprovado, 166 rascunho para enviado), guardando o resumo da versão criada (hash do retrato, número, status, valor, datas, autor, itens). Depois da troca, os mesmos três casos rodaram de novo e os resumos foram comparados. O reenvio do 227 foi feito pelo caminho real, `confirmar_envio_documento` com um envio de verdade pelo WhatsApp.

Resultado literal:

```
ENSAIO OK, DESFEITO:
[1] enviado_para_aprovado_227: igual antes e depois=true | efb84ec438be58fd29736875f93e9262|2|aprovada|448.00|false|true|6e6693f1-ea58-42b8-acf6-46fae959566a|6e6693f1-ea58-42b8-acf6-46fae959566a|itens=1|aprovada_id_ok=true
[1] enviado_para_aprovado_233: igual antes e depois=true | 50fc6ef3cf6c43914e2c5de04cc2169d|2|aprovada|148.16|false|true|6e6693f1-ea58-42b8-acf6-46fae959566a|6e6693f1-ea58-42b8-acf6-46fae959566a|itens=2|aprovada_id_ok=true
[1] rascunho_para_enviado_166: igual antes e depois=true | 060c0b006332f9b1749be960cceba9f2|1|enviada|97.35|true|false|-|6e6693f1-ea58-42b8-acf6-46fae959566a|itens=1
[2] confirmar_envio_documento: tirando as 5 linhas novas sobra o corpo vivo de antes (md5 igual)=true md5 antes=9d0ab672aaba56e75de28ea6fa307317
    md5 novo de confirmar=c4509f50c6b41e9131f5a6530969be56 do gatilho=16098a54f9fd7b3874894946c7f414ca da funcao nova=60c04a27d5693293c6cb0481afa73b21
[3] 227 antes do reenvio: versoes=1 faixa mudou=true valor da versao=57.60 valor atual=448.00
    depois do reenvio: versoes=2 valor da versao nova=448.00 hash da versao igual ao dos itens de agora=true faixa mudou=false enviado_em igual=true
    segundo reenvio sem mudanca: versoes=2 (nao nasce a 3)
[4] 233 reenviado: versoes 1 para 2
    134 (aprovado) congelar direto: versoes 2 para 2
    167 (aprovado) congelar direto: versoes 2 para 2
[5] anon em orcamento_congelar_versao: 42501
    authenticated em orcamento_congelar_versao: 42501
    authenticated em confirmar_envio_documento: 42501
    service_role em orcamento_congelar_versao: ok
[6] versoes no banco dentro do ensaio: 96 (eram 94)
```

Leitura: o gatilho novo grava exatamente a mesma versão que o velho nos três casos (mesmo hash do retrato, mesmo autor, mesmos itens, `versao_aprovada_id` apontando para ela). A função de reenvio fez a faixa "mudou depois de enviado" do 227 apagar (de `mudou=true`, 57,60 contra 448,00, para `mudou=false`), sem reescrever `enviado_em`. Reenviar de novo sem mudança não cria a versão 3, e orçamentos com conteúdo igual à versão (134 e 167) não ganham versão. O 233 também tinha mudado depois do envio e ganhou a versão 2.

## Revisão de 17/11/2026: a área corrigida não cria versão nova

`orcamento_congelar_versao` agora trata como "mesmo conteúdo" também o caso em que os itens batem sem a coluna derivada `area_cobrada` e o total é o mesmo (a 100000 corrige a conta dessa coluna). Sem isso, o 217 ganharia uma versão nova só porque a área foi corrigida. Corpo novo: `60c04a27d5693293c6cb0481afa73b21` (o do gatilho `16098a54f9fd7b3874894946c7f414ca` e o de `confirmar_envio_documento` `c4509f50c6b41e9131f5a6530969be56` não mudaram).

Ensaio refeito no banco vivo em 17/11/2026 (100000 e 180000 na mesma transação, `RAISE EXCEPTION` final), resultado literal:

```
[4] orcamento_congelar_versao sobre os 6 (hash guardado igual ao de agora? | versoes antes para depois):
    54: hash igual=false | versoes 1 para 2
    98: hash igual=false | versoes 1 para 2
    115: hash igual=false | versoes 1 para 2
    150: hash igual=false | versoes 1 para 2
    175: hash igual=false | versoes 1 para 2
    217: hash igual=false | versoes 1 para 1
[5] controle no 217, largura de um item mais 1 cm: true campos ["area_total", "area_unitaria", "largura", "valor_total", "valor_unitario"]
    congelar com mudanca real no 217: versoes 1 para 2
```

Leitura: o 217 reaproveita a versão (1 para 1) mesmo com o hash velho diferente, e uma mudança real de largura ainda cria a versão 2. Os outros cinco (54, 98, 115, 150, 175) ganham versão no primeiro reenvio por um motivo que NÃO é a área e já existia antes desta onda: o hash guardado deles já era diferente do hash dos itens de hoje antes de qualquer migração (lido no banco vivo: 54 `2b4d8cd8...` guardado contra `0590c543...` de agora, 98 `dbc5094b...` contra `37389af9...`, 150 `3eb37f55...` contra `50136e22...`, 175 `7c431aa7...` contra `b876ab1a...`), porque o item ganhou colunas depois que a versão foi congelada. Reenviar congela o estado de hoje, o que não é errado; reaproveitar versão nesses casos pediria comparar só as chaves que o retrato guardou, como a faixa faz, e fica como decisão do dono.
