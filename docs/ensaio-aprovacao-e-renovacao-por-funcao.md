# Ensaio da migração: aprovar só de enviado e renovar por função

Migração: `supabase/migrations/20261117190000_aprovacao_e_renovacao_por_funcao.sql`. Estado: **ensaiada no banco vivo em 17/11/2026 (com a 180000 antes, porque a renovação depende dela), desfeita por RAISE EXCEPTION final. NÃO aplicada: quem aplica é o dono, depois de revisar.** Teste: `tests/aprovacao-e-renovacao-por-funcao-migracao.test.ts`.

Conferido depois do ensaio, no banco vivo: `aprovar_orcamento` com md5 `c0d686195881973ba42b2e93708ee71a` (o de antes), `api_executar` com `248964a350c5fb61c6c44be8c9b2f293` (intocada), nenhuma função `renovar_orcamento_vencido`, nenhum token `ensaio` em `api_tokens`.

## O que a migração faz

| Parte | O que faz |
| --- | --- |
| A | `aprovar_orcamento(uuid, uuid, text)` (troca guardada pelo md5 do corpo vivo): mesma assinatura e GRANT, com a guarda de origem. Já aprovado devolve o que existe (`ja_aprovado = true`, sem repetir evento nem versão). Com OS ou convertido: erro `tem_os`. Qualquer outro status que não seja enviado: erro `origem_invalida` |
| B | Função nova `renovar_orcamento_vencido(p_orcamento_id uuid) returns jsonb`: exige `orcamentos.create` e `orcamentos.send`; só de expirado ou de enviado vencido, sem OS e com valor; volta a enviado, grava `enviado_em` agora, chama `orcamento_congelar_versao` e registra o evento `orcamento_renovado`. Não manda nada ao cliente |

**Escolha da origem de aprovar (conferida na tela):** só de enviado, não de rascunho. O único chamador é o botão "Cliente aprovou: converter em OS" (`CabecalhoIdentificacao.tsx`, só aparece com o orçamento enviado e para quem tem `orcamentos.approve` e pode converter), que chama `converterEmOS(true)`, que chama `aprovar_orcamento` antes de converter. Rascunho nunca chega lá.

**Desvio do mapa:** `renovar_orcamento_vencido` também recusa orçamento sem valor (`sem_valor`), a mesma regra de `podeRenovar` na tela; o mapa não listava isso na função. Aprovado devolve `ja_aprovado` em vez de erro (idempotente, como o desenho de F1).

Md5 dos corpos impressos pelo banco no ensaio: `aprovar_orcamento` `c41a77749e1673be56e5ddff732b6ad4`, `renovar_orcamento_vencido` `57e68e8f3ad1d5f922b88b4b82d2f827`.

## Ensaio no banco vivo

Os perfis são simulados com `request.jwt.claims` e `SET LOCAL ROLE authenticated`, com contas reais: admin, gestor, financeiro, vendedor (conta que só tem esse papel) e uma conta sem papel. Antes de ensaiar, a 180000 foi criada na mesma transação.

Resultado literal:

```
ENSAIO OK, DESFEITO:
[1] aprovar_orcamento: tirando o bloco da guarda sobra o corpo vivo de antes (md5 igual)=true md5 novo=c41a77749e1673be56e5ddff732b6ad4 md5 de renovar_orcamento_vencido=57e68e8f3ad1d5f922b88b4b82d2f827
    proacl aprovar={postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres} proacl renovar={postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
[2] financeiro aprova 233: ERRO P0001 | Permissão necessária: orcamentos.approve | detalhe=
    conta sem papel aprova 233: ERRO P0001 | Permissão necessária: orcamentos.approve | detalhe=
    admin aprova rascunho 166: ERRO P0001 | Só um orçamento enviado ao cliente pode ser aprovado. Este está como rascunho. | detalhe=origem_invalida
    admin aprova recusado 39: ERRO P0001 | Só um orçamento enviado ao cliente pode ser aprovado. Este está como recusado. | detalhe=origem_invalida
    admin aprova expirado 136: ERRO P0001 | Só um orçamento enviado ao cliente pode ser aprovado. Este está como expirado. | detalhe=origem_invalida
    admin aprova convertido 106: ERRO P0001 | Este orçamento já virou ordem de serviço e não pode ser aprovado de novo. | detalhe=tem_os
    admin aprova 146 (aprovado, com OS): {"versao_id": "5abbd94c-dc5d-4901-9388-56ddce56f32e", "ja_aprovado": true, "orcamento_id": "fd4e117e-f69b-4d13-a933-614c83955ff9"}
    id que nao existe: ERRO P0001 | Orçamento não encontrado | detalhe=
[3] vendedor aprova 233 (enviado): {"versao_id": "c2282732-9aa3-440b-9d3f-2017a9930ba9", "orcamento_id": "442155ff-eceb-4482-87b9-a1d24d6d96d7"}
    status depois=aprovado eventos de aprovacao 0 para 1 versoes 1 para 2 versao_aprovada_id preenchida=true
    segunda chamada (gestor): {"versao_id": "44b23a9c-7b7d-41ce-a166-05ad64923cad", "ja_aprovado": true, "orcamento_id": "442155ff-eceb-4482-87b9-a1d24d6d96d7"} | eventos=1 versoes=2 (nao repete)
[4] financeiro renova 197: ERRO P0001 | Permissão necessária: orcamentos.create | detalhe=
    conta sem papel renova 197: ERRO P0001 | Permissão necessária: orcamentos.create | detalhe=
    anon renova 197: 42501 permission denied for function renovar_orcamento_vencido
    vendedor renova 233 (aprovado agora): ERRO P0001 | Só um orçamento expirado ou enviado e vencido pode ser renovado. Este está como aprovado. | detalhe=origem_invalida
    vendedor renova rascunho 166: ERRO P0001 | Só um orçamento expirado ou enviado e vencido pode ser renovado. Este está como rascunho. | detalhe=origem_invalida
    vendedor renova recusado 39: ERRO P0001 | Só um orçamento expirado ou enviado e vencido pode ser renovado. Este está como recusado. | detalhe=origem_invalida
    vendedor renova 146 (aprovado com OS): ERRO P0001 | Este orçamento já virou ordem de serviço e não pode ser renovado. | detalhe=tem_os
    vendedor renova 106 (convertido): ERRO P0001 | Este orçamento já virou ordem de serviço e não pode ser renovado. | detalhe=tem_os
    vendedor renova expirado sem valor 148: ERRO P0001 | Orçamento sem valor não pode ser reenviado. Preencha os itens antes. | detalhe=sem_valor
    vendedor renova id que nao existe: ERRO P0001 | Orçamento não encontrado. | detalhe=nao_encontrado
    vendedor renova 215 (enviado ainda valido): ERRO P0001 | Este orçamento ainda está dentro da validade, não precisa renovar. | detalhe=ainda_valido
[5] vendedor renova 197 (enviado vencido, enviado_em antes=2026-11-09, versoes=1): {"ok": true, "status": "enviado", "versao_id": "6a0e1a53-7afd-4330-9302-6ccf311b0c85", "enviado_em": "2026-11-17T13:17:54.945969+00:00", "valido_ate": "2026-11-24", "orcamento_id": "4219b95f-bee7-4515-8a57-b10f59dd844f", "status_anterior": "enviado"}
    depois: status=enviado enviado_em hoje=true versoes=1 evento orcamento_renovado=1
    renovar 197 de novo (agora dentro da validade): ERRO P0001 | Este orçamento ainda está dentro da validade, não precisa renovar. | detalhe=ainda_valido
    gestor renova 202 (expirado, versoes=1): {"ok": true, "status": "enviado", "versao_id": "f8a6ed46-1440-4a4a-ab40-e5712259da51", "enviado_em": "2026-11-17T13:17:54.945969+00:00", "valido_ate": "2026-11-24", "orcamento_id": "d6f3968d-2ff5-4e84-ab3c-6cdf479946d5", "status_anterior": "expirado"}
    depois: status=enviado versoes=1
    admin renova 136 (expirado, sem enviado_em, criado ha mais de 7 dias): {"ok": true, "status": "enviado", "versao_id": "ced3e6e7-c109-4bdd-b66b-ed3764352da8", "enviado_em": "2026-11-17T13:17:54.945969+00:00", "valido_ate": "2026-11-24", "orcamento_id": "18efa3b1-5159-4368-b340-cf63cba58788", "status_anterior": "expirado"}
    faixa mudou depois de renovar 197: false
[6] api_executar como esta (196, enviado vencido), confirmado: {"acao": "renovar_orcamento", "ensaio": false, "mensagem": "Gravado."} | status=enviado enviado_em hoje=true versoes 1 para 1 (nao congela: fica como esta)
    troca guardada de api_executar (md5 vivo 248964a3...=true) aplicavel (o trecho aparece uma vez)=true
    com a troca (187, enviado vencido), confirmado: {"acao": "renovar_orcamento", "ensaio": false, "mensagem": "Gravado."} | status=enviado versoes 1 para 1 evento orcamento_renovado=1
    com a troca, orcamento que a API acha que nao vence (233, aprovado): {"erro": "estado_invalido", "mensagem": "Só renova orçamento expirado ou enviado que passou da validade."}
```

Leitura: financeiro e conta sem papel não aprovam nem renovam; vendedor, gestor e admin sim. Aprovar de rascunho, recusado ou expirado dá `origem_invalida`, de convertido `tem_os`, e repetir a aprovação não repete evento nem versão. Renovar recusa tudo que não é expirado ou enviado vencido, e o enviado ainda válido (`ainda_valido`), o que tem OS (`tem_os`) e o sem valor (`sem_valor`). Renovar grava `enviado_em` agora, a validade passa a contar de novo (`valido_ate` 24/11), o evento nasce e a faixa "mudou depois de enviado" fica apagada.

## api_executar renovar_orcamento (F1 e F3, o conflito do papel)

`api_executar` roda como `authenticated` por dentro (`SET LOCAL ROLE authenticated` depois de gravar as claims do dono do token), então a escrita dela passa pela RLS e por qualquer gatilho que olhe `current_user`. **Nesta onda não precisa mudar, e não foi mudada:** não existe gatilho de transição de status (ele é do PR3), a renovação por API continua funcionando como está (item [6], primeira linha) e o gatilho de exclusão (F3) não a toca. Duas coisas que o ensaio mostrou: (1) a renovação da API não congela a versão (versões 1 para 1 no 196), então a faixa "mudou depois de enviado" continua acesa depois dela; (2) quando o gatilho de transição do PR3 entrar, o `UPDATE` direto dela como `authenticated` será barrado.

A troca guardada já está provada e fica pronta para o PR3 (não vai nesta onda): com o md5 vivo `248964a350c5fb61c6c44be8c9b2f293` conferido, trocar o trecho `UPDATE public.orcamentos SET status = 'enviado', enviado_em = now() WHERE id = v_id;` (aparece uma vez) por `PERFORM public.renovar_orcamento_vencido(v_id);`. Ensaiado: a API passa a renovar pela mesma regra (permissões `orcamentos.create` e `orcamentos.send` do dono do token, origem, sem OS), congela a versão e registra o evento (187: `evento orcamento_renovado=1`); a checagem própria da API (`estado_invalido`) continua valendo antes.

## Revisão de 17/11/2026: nunca enviado e régua do dia

Dois achados da revisão, corrigidos em `renovar_orcamento_vencido` (corpo novo `57e68e8f3ad1d5f922b88b4b82d2f827`):

1. **Expirado que nunca foi enviado não renova.** No banco vivo 9 dos 10 expirados (136, 137, 138, 139, 140, 148, 149, 156, 176) têm `enviado_em` nulo e nenhum documento enviado; renovar os poria em "enviado" com versão "enviada" e validade contando, sem o cliente ter recebido nada. Agora a função recusa com o código `nunca_enviado` quando o status é expirado, `enviado_em` é nulo e não há linha em `documentos_enviados`. A tela (`podeRenovar`) também não oferece o botão para eles.
2. **"Vencido" é a régua do link do cliente**: dia de Brasília, último dia inteiro (antes era o instante: envio mais validade antes de agora). Assim a renovação não libera um orçamento que o link ainda aceita.

Ensaio refeito no banco vivo em 17/11/2026 (100000, 180000 e 190000 na mesma transação, `RAISE EXCEPTION` final), resultado literal:

```
[6] vendedor renova 136 (expirado, nunca enviado): ERRO P0001 | Este orçamento nunca foi enviado ao cliente, então não há o que renovar. Envie pelo botão Enviar. | detalhe=nunca_enviado
    vendedor renova 137 (expirado, nunca enviado): ERRO P0001 | Este orçamento nunca foi enviado ao cliente, então não há o que renovar. Envie pelo botão Enviar. | detalhe=nunca_enviado
    status do 136 depois: expirado enviado_em=nulo
    gestor renova 202 (expirado, enviado em 09/11): {"ok": true, "status": "enviado", "versao_id": "f8a6ed46-1440-4a4a-ab40-e5712259da51", "enviado_em": "2026-11-17T13:47:03.496821+00:00", "valido_ate": "2026-11-
    215 enviado as 00:01 de ha 7 dias (pelo instante ja venceu, pelo dia de Brasilia o ultimo dia e hoje): ERRO P0001 | Este orçamento ainda está dentro da validade, não precisa renovar. | detalhe=ainda_valido
    215 enviado as 00:01 de ha 8 dias (venceu ontem): {"ok": true, "status": "enviado", "versao_id": "c97a53c4-6e7b-4abb-b409-bfa499e08793", "enviado_em": "2026-11-17T13:47:0
[7] EXECUTE anon/authenticated/service_role: renovar=false/true/true congelar=false/false/true
```

O resto do ensaio da seção acima (permissões, origens, `tem_os`, `sem_valor`, `ainda_valido`) continua valendo; onde ele mostra o 136 sendo renovado, esse caso passou a ser recusado como acima. Mesma ressalva dos demais: as sequências avançam no ensaio e não voltam.
