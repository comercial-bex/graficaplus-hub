# Ensaio da migração: correções de preço no banco (15/11/2026)

Migração: `supabase/migrations/20261115190000_precos_correcoes_de_banco.sql`. Estado: **ensaiada no banco vivo em 15/11/2026, desfeita por RAISE EXCEPTION final; depois APLICADA no banco vivo em 15/11/2026 e conferida (70 linhas na view para 70 produtos, função de proposta criada, 13 produtos com IA desligada, 2 custos zero preenchidos, 12 propostas ainda pendentes).** Conferi antes que o executor desfaz tudo: criei uma tabela de teste, levantei erro e a tabela não existia depois. O preço de nenhum produto muda (provado no item 0 abaixo). Nenhuma mensagem sai para ninguém.

Origem do trabalho: auditoria de orçamentos, preços e margem de 15/11 (`docs/auditoria-orcamentos-precos-margem-15-11.md`). Esta migração faz só a parte de banco. Não faz: `area_unitaria` e `area_cobrada` geradas (outra rodada), trava contra UPDATE de `preco_base` (depende do dono), recálculo de custo de orçamento aprovado.

## O que muda em produção ao aplicar

| Item | O que faz | Muda dado? |
| --- | --- | --- |
| 1 | `produto_custo_cheio` passa a ter uma linha por produto | Não. É uma view. |
| 2 | Função `preco_proposta_criar(produto, preço, motivo)` e origem `manual` aceita no CHECK | Só quando alguém chamar. A migração não cria proposta. |
| 3 | Gatilho de aviso de custo fora da faixa de 30 por cento | Só grava linha em `logs_auditoria` quando um item for gravado ou editado. Não altera valor nenhum. |
| 4 | Gatilho que grava `preco_minimo` do cálculo 3D quando vem zero | Só em cálculo novo. Os 30 antigos ficam como estão. |
| 5 | Histórico da pasta do produto guarda preço de e para, piso, margens e autor | Só em mudança futura de preço, custo ou margem mínima. |
| 6 | Custo zero preenchido em item de orçamento não aprovado e não convertido | **2 itens**, ambos do orçamento 39 (rejeitado). |
| 7 | Desliga `ia_habilitado` | **13 produtos**, reversível, com rastro. |

## Item 0: preço de produto não muda

Foto de `produtos.preco_base` de todos os produtos antes da migração, comparada com a de depois: 0 diferenças, 0 produtos novos. A proposta manual criada no ensaio não mexe em `preco_base` (9,00 antes, 9,00 depois). Os `UPDATE produtos` do item 5 existem só dentro do ensaio, para provar o histórico, e foram desfeitos.

## Item 1: view com uma linha por produto

A duplicata vinha de `produto_precificacao`, que guarda duas linhas por produto, uma chamada "Composição do custo" e outra "Preço base", às vezes com custos diferentes. A view agora escolhe UMA linha por produto com `LEFT JOIN LATERAL ... LIMIT 1`: a de maior custo cheio, no empate a "Composição do custo", depois o id. É a mesma regra que `desconto_avaliar` já aplicava com `max`, então a alçada de quem vende não cresce.

| | Linhas | Produtos distintos |
| --- | --- | --- |
| Antes | 109 | 70 |
| Depois | 70 | 70 |

Os produtos ativos tinham 65 linhas e agora têm 40 linhas para 40 produtos ativos. A conta é de hoje: durante o dia outra sessão mudou a quantidade de produtos ativos, então os números de ativos não são os 77 e 49 da auditoria.

- **Colunas:** 14 antes, 14 depois, mesma ordem e mesmos tipos. A migração confere isso antes de trocar e para se o banco mudou.
- **security_invoker e GRANTs:** `CREATE OR REPLACE VIEW` descarta as opções, então são reaplicados. A view viva não tinha `security_invoker` e dava SELECT só a `service_role`, `postgres` e `sandbox_exec` (nenhum para `anon` nem `authenticated`). Agora tem `security_invoker=true` e SELECT só para `service_role`; `anon` e `authenticated` seguem sem acesso. Os dois consumidores são `SECURITY DEFINER`, então não perdem nada.
- **Consumidores conferidos no código e nas funções SQL:**
  - `desconto_avaliar(uuid, numeric, numeric, numeric)` agrupa por produto e usa `max(custo_cheio)` e `bool_and` de `so_material`. Antes e depois, para os 70 produtos: 0 diferenças no custo cheio e 0 em `so_material`.
  - `meta_por_produto(date)` juntava a view direto e listava produto repetido no ranking. Agora devolve 39 linhas para 39 produtos distintos.
  - No código da tela: nenhum `from("produto_custo_cheio")`. `src/domain/precificacao/simulador.ts` só cita a view em comentário e `types.ts` guarda os tipos gerados.

## Item 2: proposta manual de preço

`preco_proposta_criar(p_produto_id uuid, p_preco numeric, p_motivo text) returns uuid`. Mesma checagem de papel de `preco_proposta_aprovar` e `preco_proposta_recusar`: admin ou gestor que vê custo (`has_role` mais `pode_ver_custo`). Grava em `precos_propostas` com `origem = 'manual'`, piso pela mesma conta das propostas existentes (`round(custo_medio / (1 - margem_minima / 100), 2)`), margem atual e margem do preço proposto, e uma linha em `logs_auditoria` com preço, nunca custo.

ACL: `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` e `GRANT EXECUTE TO authenticated`. A checagem de papel está por dentro da função.

O CHECK de origem ganha `'manual'` de forma aditiva (os dois valores antigos ficam).

Ensaio, com o produto Acabamento de lona (preço 9,00, piso 6,67):

| Caso | Resultado |
| --- | --- |
| Vendedor | recusado, 42501 |
| `anon` | permission denied (sem EXECUTE) |
| Preço 0, preço negativo, preço nulo | recusado, 22023 |
| Motivo em branco | recusado, 22023 |
| Produto que não existe | recusado, P0002 |
| Depois das recusas | 12 propostas, as mesmas de antes |
| Admin com preço 10,00 | criada: origem manual, pendente, preço atual 9,00, piso 6,67, margem atual 55,56, margem proposta 60,00 |
| Mesmo preço de novo | devolve a mesma proposta, continua 1 pendente |
| Outro preço com pendente aberta | recusado: decida a pendente antes |
| `produtos.preco_base` | 9,00 antes, 9,00 depois |
| Log da criação | 1 linha, sem a palavra custo |

Proposta abaixo do piso é aceita na criação de propósito: quem decide é `preco_proposta_aprovar`, que já recusa preço abaixo do piso vivo.

## Item 3: aviso de custo fora da faixa

Gatilho `tg_orcamento_itens_zz_aviso_custo`, `AFTER INSERT OR UPDATE OF custo_unitario, produto_id, quantidade, largura, altura, area_minima`. `AFTER` porque lê `area_cobrada`, que é coluna gerada. Não devolve linha, então não bloqueia nem altera nada. Compara o custo gravado da linha (`custo_unitario` vezes a quantidade) com `custo_medio` do produto vezes a área cobrada (produto por m2 com área) ou vezes a quantidade (o resto). Acima de 30 por cento de diferença, grava uma linha `custo_fora_da_faixa` em `logs_auditoria` com orçamento, item, produto, quantidade, área e a diferença em por cento. Só dispara quando um dos campos da conta mudou.

`tg_orcamento_item_custo_do_produto` não foi alterado.

Falha ao gravar o aviso vira `RAISE WARNING` com o erro e o SQLSTATE, e o item é gravado normalmente. Não há `EXCEPTION` que esconda o motivo.

Ensaio com um item real (Quadro Acrílico, 13 peças, custo esperado da linha 640,67):

| Passo | Avisos | Item |
| --- | --- | --- |
| Custo gravado absurdo (1.000.000 por peça) | 0 para 1 | custo ficou 1.000.000, valor unitário 89,90 sem mudar |
| Volta para o esperado | 1, não cresce | |
| 25 por cento acima | 1, não cresce | |
| 40 por cento acima | 2 | avisa |

Se esses avisos fossem gerados hoje para os itens já gravados, 17 itens seriam pegos. A migração não regrava item nenhum, então esses 17 não geram linha agora; geram quando alguém editar o item.

O registro leva só a diferença em por cento, sem custo em reais: `logs_auditoria` é lido por gestor sem permissão de custo. A conta fica reproduzível a partir do item e do produto por quem vê custo.

## Item 4: preço mínimo do cálculo 3D

Gatilho `BEFORE INSERT` em `orcamento_3d_calculos`: quando `preco_minimo` vem 0 e `custo_operacional` é maior que 0, grava `round(custo_operacional / 0.70, 2)`. Preço mínimo informado fica como veio, e custo operacional zero fica zero.

| custo_operacional | preco_minimo informado | preco_minimo gravado |
| --- | --- | --- |
| 100 | 0 | 142,86 |
| 100 | 250 | 250 |
| 0 | 0 | 0 |
| 849,7566 | 0 | 1.213,94 |

**Backfill dos 30 registros: não feito.** A tabela é imutável de propósito: o gatilho `trg_immutable_orcamento_3d_calculos` recusa UPDATE e DELETE ("gere nova versão", 27/10/2026). Tentar regravar um registro antigo no ensaio deu exatamente esse erro. Os 30 continuam com `preco_minimo` 0, e liberar a imutabilidade só para um backfill abriria a regra para sempre. O caminho certo é a tela gerar uma nova versão do cálculo, que já nasce com o piso. Se o dono quiser os 30 corrigidos, é decisão dele e pede uma migração própria com a imutabilidade suspensa dentro da transação.

## Item 5: histórico de preço da pasta do produto

`tg_historico_da_pasta_do_produto` trocada na definição viva (md5 do `prosrc` conferido no começo da migração: `da8e14c4208ca0a42d2230a448537e3c`). O que já gravava segue igual. Quando `preco_base`, `custo_medio` ou `margem_minima` mudam em `produtos`, o `detalhes` ganha:

`preco_de`, `preco_para`, `abaixo_do_piso_antes` e `abaixo_do_piso_depois` (verdadeiro ou falso), `custo_mudou` (verdadeiro ou falso), `autor_tipo` (`pessoa`, `chave_de_servico` ou `sem_sessao`) e `autor_id` (o `auth.uid()`, nulo nas duas últimas).

**Nem o custo em reais, nem o piso, nem a margem são gravados**, só se o preço estava abaixo do piso e se o custo mudou. Revisão independente de 15/11: `logs_auditoria` é lido por gestor sem permissão de custo (a política só pede admin ou gestor) e piso ou margem em por cento, somados ao preço, devolvem o custo. Nenhum log existente tinha chave de custo, piso ou margem. Margem mínima entra no gatilho porque muda o piso.

A gravação com preço é feita sem tratamento que engole erro: se o rastro não grava, a troca de preço não passa. O resto do histórico (outras colunas e as tabelas da pasta) mantém o aviso `RAISE WARNING` que já tinha. `usuario_id` só é preenchido se o usuário existir em `usuarios` (a chave estrangeira), o `autor_id` guarda o id de qualquer jeito.

Ensaio no produto Acabamento de lona, com o autor simulado pelas claims do JWT:

| Mudança | Detalhe gravado |
| --- | --- |
| preço 9,00 para 10,00, admin | preço de 9,00 para 10,00, abaixo_do_piso falso e falso, custo_mudou falso, autor_tipo pessoa, autor_id do admin |
| custo mudou | custo_mudou verdadeiro. Nenhuma chave com o valor do custo, do piso ou da margem |
| margem mínima mais 1 | campos com margem_minima, sem piso nem margem em número |
| claims com role service_role e sem usuário | autor_tipo chave_de_servico, autor_id nulo |
| sem claims | autor_tipo sem_sessao |
| só a descrição | `{"campos": ["descricao"], "tabela": "produtos"}`, como antes |

Os valores em `preco_de` e `preco_para` ficam em `logs_auditoria`, que só admin e gestor leem. Preço não é custo, então pode.

A frase do histórico na tela (`frasesDoHistorico` em `src/domain/catalogo/pasta-do-produto.ts`) ainda mostra só o nome do campo. Ler os valores novos é trabalho da tela, de outra tarefa.

## Item 6: custo zero preenchido

Regra: só onde `custo_unitario = 0`, item com produto de custo cadastrado maior que 0, em orçamento que não está `aprovado` nem `convertido`. A conta é a do gatilho `tg_orcamento_item_custo_do_produto`, que dispara no UPDATE (a coluna é regravada com o mesmo 0 e o gatilho preenche). A migração para tudo se o valor unitário ou o total de qualquer item mudar, ou se um orçamento aprovado ou convertido entrar na lista. Cada item preenchido deixa uma linha `custo_zero_preenchido` em `logs_auditoria` com o custo de antes e o de depois.

Itens afetados, antes e depois:

| Orçamento | Item | Qtd | Custo antes | Custo depois | Valor unitário | Valor total |
| --- | --- | --- | --- | --- | --- | --- |
| 39 rejeitado | Bola Leitoso 33 × 33 cm | 30 | 0,00 | 0,79 | 8,30 sem mudar | 249,00 sem mudar |
| 39 rejeitado | Bolão Leitoso 48 × 48 cm | 20 | 0,00 | 1,66 | 18,00 sem mudar | 360,00 sem mudar |

**Por que são só 2 e não os itens da auditoria.** O Acrílico 3mm do orçamento 67, os do 212 e os itens de orçamentos aprovados ou convertidos ficam de fora pela regra do escopo. O 67 está `convertido` e os itens de 195, 54, 56 e outros estão `aprovado`. O 212 já não tem custo zero no banco hoje. Os itens livres sem produto (banners, adesivos e taxas) ficam de fora porque a regra do gatilho depende de `produto_id`; o vínculo com a ficha `cb58f5d8` pede decisão do dono.

Provas no ensaio:

- Linhas de rastro: 2, nenhuma em orçamento aprovado ou convertido.
- Itens de orçamento aprovado ou convertido com custo ou valor diferente do de antes: 0.
- Itens com custo diferente de zero que mudaram de custo: 0.
- Itens com produto de custo e custo ainda zero depois da migração: 4, todos em orçamento aprovado ou convertido. Nenhum em orçamento aberto.

## Item 7: IA desligada em produto com problema de preço

A flag `ia_habilitado` mora em `produto_ficha`, não em `produtos`. Critérios, para produto ativo com a IA ligada: preço nulo ou menor ou igual a zero, preço abaixo do piso, ou proposta de preço pendente. A migração só desliga, nunca liga. Cada produto desligado deixa uma linha `ia_desligada_por_preco` em `logs_auditoria` com os motivos, e o `produto_ficha_historico` registra a mudança de campo.

Lista exata (13 produtos). Produtos com a IA ligada: 68 antes, 55 depois.

| Produto | Preço | Motivos |
| --- | --- | --- |
| Acabamento manual (mão de obra) ea107d14-1ccf-4c36-b946-4ca6768ab4ea | 38,40 | abaixo do piso, proposta pendente |
| Adesivo transparente 504a9190-317b-4e44-8e7c-e9214ea0d1dd | 59,90 | proposta pendente |
| Adesivo vinil branco impresso aef1d1c9-5dbb-4860-bb80-818d64729464 | 55,00 | proposta pendente |
| BOLSA TERMICA 30L 02084c59-cc5e-49c3-b3b5-55d18b2581d0 | 59,00 | abaixo do piso, proposta pendente |
| COPO TERMICO 500ML fb5b6cd1-3998-41a0-90d3-50f219c909a8 | 40,00 | abaixo do piso, proposta pendente |
| Corte a laser (CNC Laser) 923148dd-1675-4fc8-9a35-1778418d6e85 | 52,80 | abaixo do piso, proposta pendente |
| Faixa em lona 89f0f92c-91f1-46ef-a960-7c1615497e2e | 45,00 | proposta pendente |
| Impressão 3D (serviço) 1dc26b82-fefa-41a7-92c5-f880668a978f | sem preço | sem preço válido |
| KIT CHURRASCO 12PÇ c07299b0-a140-4a1f-860b-dfcb2be8d998 | 89,00 | abaixo do piso, proposta pendente |
| Lona 280g impressa 2fcb2825-56b8-4e8b-a4f7-386cf3612e2c | 45,00 | proposta pendente |
| Lona para cavalete 71d065ab-a984-4e7f-a132-69f218fa1daf | 45,00 | proposta pendente |
| NECESSAIRE PERSONALIZADA 1a646e6f-1988-4fda-9a3f-c0284112f9d8 | 39,90 | abaixo do piso, proposta pendente |
| Recorte eletrônico (plotter de recorte) f7e2dc28-9f0f-49f9-ba05-62f8cdedb1da | 1,93 | abaixo do piso, proposta pendente |

Ligados pela migração: 0. Produtos ativos que ainda ficaram com a IA ligada e problema de preço ou proposta pendente: 0.

**Os ids do pedido.** `1dc26b82-fefa-41a7-92c5-f880668a978f` é a Impressão 3D (serviço), sem preço, e está na lista. O id completo do outro é `046eb529-4a08-42dc-82df-404f851fbcfb`, o Certificado A4 papel texturizado vergê 180g: preço 9,90, custo 0, **sem ficha** (`produto_ficha`). Ele não tem a flag para desligar (nasce desligada) e não casa com os critérios, porque o preço é válido, o custo zero impede o cálculo do piso e não há proposta. Fica fora da lista. O custo dele é decisão do dono.

Para religar, depois que o preço for decidido, um produto por vez:

```sql
UPDATE public.produto_ficha SET ia_habilitado = true WHERE produto_id = '<id do produto>';
```

## Segurança e acesso

- Funções novas com `REVOKE` de `PUBLIC`, `anon` e `authenticated` (e `service_role` na `preco_proposta_criar`). Só `preco_proposta_criar` tem `GRANT EXECUTE`, para `authenticated`, com a checagem de papel por dentro. No ensaio: `public` e `anon` sem EXECUTE, `authenticated` com.
- Os três gatilhos e a função de histórico não são chamáveis de fora.
- `produto_custo_cheio` segue fechada: nada para `anon` nem `authenticated`.
- Nenhuma mensagem a cliente, nenhuma fila de aviso, nenhum preço alterado.

## Riscos

1. **O histórico com preço bloqueia a troca de preço se o rastro falhar.** É de propósito, para o rastro não sumir em silêncio. O ensaio provou o caminho feliz com pessoa, chave de serviço e sem sessão. A única chave estrangeira é `usuario_id`, tratada com a subconsulta em `usuarios`.
2. **Resolvido na revisão:** piso e margem em número foram tirados do histórico e o aviso do item 3 não grava custo em reais, porque gestor sem permissão de custo lê `logs_auditoria`.
3. **O aviso do item 3 pode gerar volume** quando muitos itens forem editados de uma vez. Hoje 17 itens gravados estão fora da faixa.
4. **A IA fica desligada em 13 produtos** até a proposta de preço ser decidida. Quem pergunta por eles no WhatsApp deixa de receber resposta automática de preço.
5. **O backfill dos 30 cálculos 3D não foi feito** (imutabilidade). O piso só existe nos cálculos novos.
6. **Outra sessão mexe no mesmo banco.** Os números de produtos ativos mudaram durante o dia. A migração confere o corpo do histórico por md5 e as colunas da view antes de trocar e para se o banco mudou.

## Como aplicar

1. O dono autoriza.
2. Rodar o arquivo da migração inteiro (ele é uma transação, com `lock_timeout` de 5 segundos).
3. Conferir: `SELECT count(*), count(DISTINCT produto_id) FROM produto_custo_cheio;` deve dar 70 e 70 (ou os números do dia, iguais entre si).
4. Conferir `SELECT count(*) FROM logs_auditoria WHERE acao IN ('custo_zero_preenchido','ia_desligada_por_preco');` deve dar 2 e 13 (se nada mudou no meio tempo).

## Volta

O script abaixo desfaz a migração. **Não foi executado nem ensaiado**: escrevi a partir das definições vivas guardadas aqui. Rode primeiro com `RAISE EXCEPTION` no fim, como o ensaio. Ele religa a IA só dos produtos que a migração desligou, o que é decisão do dono.

```sql
DO $volta$
BEGIN
  -- 7. religar a IA so dos produtos que a migracao desligou (decisao do dono, produto a produto, depois do preco decidido)
  UPDATE public.produto_ficha f SET ia_habilitado = true
   WHERE f.produto_id IN (SELECT l.entidade_id FROM public.logs_auditoria l
                           WHERE l.acao = 'ia_desligada_por_preco' AND l.detalhes ->> 'migracao' = '20261115190000');
  -- 6. voltar o custo zero dos itens que a migracao preencheu
  UPDATE public.orcamento_itens i SET custo_unitario = 0
   WHERE i.id IN (SELECT l.entidade_id FROM public.logs_auditoria l
                   WHERE l.acao = 'custo_zero_preenchido' AND l.detalhes ->> 'migracao' = '20261115190000');
  -- 5. historico: corpo antigo (md5 do prosrc da8e14c4208ca0a42d2230a448537e3c, conferido antes da troca)
  CREATE OR REPLACE FUNCTION public.tg_historico_da_pasta_do_produto()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $old$
  DECLARE
    v_produto uuid; v_mudou text[] := '{}'; v_novo jsonb; v_velho jsonb; v_c text;
  BEGIN
    IF TG_TABLE_NAME = 'produtos' THEN
      v_produto := NEW.id;
      FOREACH v_c IN ARRAY ARRAY['nome', 'descricao', 'unidade', 'ativo', 'preco_base', 'custo_medio', 'margem_minima',
                                 'maquina_padrao_id', 'material_principal_id', 'tempo_producao_min', 'area_minima_cobrada'] LOOP
        IF to_jsonb(NEW) -> v_c IS DISTINCT FROM to_jsonb(OLD) -> v_c THEN v_mudou := v_mudou || v_c; END IF;
      END LOOP;
      IF cardinality(v_mudou) = 0 THEN RETURN NEW; END IF;
    ELSE
      v_novo := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
      v_velho := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
      v_produto := (coalesce(v_novo, v_velho) ->> 'produto_id')::uuid;
      IF TG_OP = 'UPDATE' THEN
        FOR v_c IN SELECT k FROM jsonb_object_keys(v_novo) k WHERE k NOT IN ('updated_at', 'created_at') LOOP
          IF v_novo -> v_c IS DISTINCT FROM v_velho -> v_c THEN v_mudou := v_mudou || v_c; END IF;
        END LOOP;
        IF cardinality(v_mudou) = 0 THEN RETURN NEW; END IF;
      END IF;
    END IF;
    BEGIN
      INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
      VALUES (auth.uid(), 'produtos', v_produto, lower(TG_OP), jsonb_build_object('tabela', TG_TABLE_NAME, 'campos', to_jsonb(v_mudou)));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'historico do produto % nao registrado: %', v_produto, SQLERRM;
    END;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END $old$;
  -- 4. e 3. gatilhos novos
  DROP TRIGGER IF EXISTS tg_orcamento_3d_calculos_piso ON public.orcamento_3d_calculos;
  DROP FUNCTION IF EXISTS public.tg_orcamento_3d_calculos_piso();
  DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_aviso_custo ON public.orcamento_itens;
  DROP FUNCTION IF EXISTS public.tg_orcamento_item_aviso_custo_fora_da_faixa();
  -- 2. proposta manual
  DROP FUNCTION IF EXISTS public.preco_proposta_criar(uuid, numeric, text);
  DELETE FROM public.precos_propostas WHERE origem = 'manual' AND status = 'pendente';
  IF NOT EXISTS (SELECT 1 FROM public.precos_propostas WHERE origem = 'manual') THEN
    ALTER TABLE public.precos_propostas DROP CONSTRAINT precos_propostas_origem_check;
    ALTER TABLE public.precos_propostas ADD CONSTRAINT precos_propostas_origem_check CHECK (origem IN ('abaixo_do_piso', 'referencia_m2'));
  END IF;
  -- 1. a view antiga (uma linha por linha de produto_precificacao, sem security_invoker, so service_role)
  CREATE OR REPLACE VIEW public.produto_custo_cheio AS
  SELECT p.id AS produto_id, p.nome, p.tempo_producao_min, pr.preco_base, pr.custo_medio,
         COALESCE(NULLIF(pp.custo_material, 0::numeric), pr.custo_medio, 0::numeric) AS custo_material,
         COALESCE(pp.custo_maquina, 0::numeric) AS custo_maquina, COALESCE(pp.custo_mao_obra, 0::numeric) AS custo_mao_obra,
         COALESCE(pp.custo_indireto, 0::numeric) AS custo_indireto,
         COALESCE(NULLIF(pp.custo_material, 0::numeric), pr.custo_medio, 0::numeric) + COALESCE(pp.custo_maquina, 0::numeric)
           + COALESCE(pp.custo_mao_obra, 0::numeric) + COALESCE(pp.custo_indireto, 0::numeric) AS custo_cheio,
         pp.produto_id IS NULL OR NULLIF(pp.custo_material, 0::numeric) IS NULL AS sem_ficha_de_material,
         COALESCE(pp.custo_maquina, 0::numeric) = 0::numeric AND NOT inteiro.servico AS sem_hora_de_maquina,
         COALESCE(pp.custo_mao_obra, 0::numeric) = 0::numeric AND NOT inteiro.servico AS sem_mao_de_obra,
         COALESCE(pp.custo_indireto, 0::numeric) = 0::numeric AND NOT inteiro.servico AS sem_rateio
    FROM public.produtos p
    JOIN public.produto_precos pr ON pr.produto_id = p.id
    LEFT JOIN public.produto_precificacao pp ON pp.produto_id = p.id
    CROSS JOIN LATERAL (SELECT p.tipo = 'servico'::tipo_item AND COALESCE(pr.custo_medio, 0::numeric) > 0::numeric
                               AND NOT (EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id)) AS servico) inteiro;
  ALTER VIEW public.produto_custo_cheio RESET (security_invoker);
END $volta$;
```

## Ensaio no banco vivo

Dois blocos, na mesma transação, na ordem: a foto de antes, o corpo da migração (sem `BEGIN` e sem `COMMIT`, e sem os comentários) e o bloco de ensaio, que termina com `RAISE EXCEPTION 'ENSAIO OK ...'`. Nada fica. Tabelas temporárias com prefixo `_p15_` guardam o estado de antes.

Notas do ensaio:

- `created_at` de `logs_auditoria` vale `now()`, que na transação é constante. Por isso o ensaio acha a linha nova de histórico pelos ids que já existiam, não por ordem de data.
- `custo_medio` é editável direto em `produtos` (o ensaio mudou 4,00 para 4,50 e voltou por rollback).

Foto de antes:

```sql
-- FOTO ANTES (roda antes do corpo da migração, na mesma transação)
CREATE TEMP TABLE _p15_cc_antes ON COMMIT DROP AS
  SELECT produto_id, max(custo_cheio) AS mx, bool_and(sem_hora_de_maquina AND sem_mao_de_obra) AS so_material, count(*) AS linhas
    FROM public.produto_custo_cheio GROUP BY produto_id;
CREATE TEMP TABLE _p15_cc_n ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM public.produto_custo_cheio) AS n_total,
         (SELECT count(*) FROM public.produto_custo_cheio c JOIN public.produtos p ON p.id = c.produto_id WHERE p.ativo) AS n_ativos,
         (SELECT count(DISTINCT produto_id) FROM public.produto_custo_cheio) AS n_dist;
CREATE TEMP TABLE _p15_produtos_antes ON COMMIT DROP AS
  SELECT id, preco_base, custo_medio, margem_minima, ativo FROM public.produtos;
CREATE TEMP TABLE _p15_ia_antes ON COMMIT DROP AS
  SELECT produto_id, ia_habilitado FROM public.produto_ficha;
CREATE TEMP TABLE _p15_itens_antes ON COMMIT DROP AS
  SELECT i.id, i.orcamento_id, o.numero AS orc, o.status::text AS status_orc, left(i.descricao, 40) AS descr, i.custo_unitario,
         i.valor_unitario, i.valor_total, i.desconto
    FROM public.orcamento_itens i JOIN public.orcamentos o ON o.id = i.orcamento_id;
CREATE TEMP TABLE _p15_3d_antes ON COMMIT DROP AS
  SELECT count(*) AS n, count(*) FILTER (WHERE preco_minimo = 0) AS zero FROM public.orcamento_3d_calculos;
```

Ensaio, que roda depois do corpo da migração:

```sql
DO $ensaio$
DECLARE
  v_rel text := '';
  v_admin uuid := '6e6693f1-ea58-42b8-acf6-46fae959566a';
  v_vend uuid;
  v_n int; v_n0 int; v_n1 int; v_n2 int;
  v_lin text; v_msg text; v_id uuid; v_id2 uuid; v_j jsonb;
  v_prod public.produtos; v_prop public.precos_propostas;
  v_item_id uuid; v_item public.orcamento_itens;
  v_cm numeric; v_ids uuid[]; v_pb_antes numeric; v_pb_depois numeric; v_esperado numeric;
  v_3d public.orcamento_3d_calculos;
BEGIN
  SELECT u.id INTO v_vend FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
   WHERE ur.role = 'vendedor' AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u.id AND x.role IN ('admin','gestor','financeiro','estoque'))
     AND u.ativo LIMIT 1;
  v_rel := v_rel || E'\nadmin de teste pode_ver_custo=' || public.pode_ver_custo(v_admin) || ' admin=' || public.has_role(v_admin, 'admin'::public.app_role)
           || ' | vendedor de teste: ' || COALESCE(v_vend::text, 'NENHUM');

  -- preco_base de TODOS os produtos: igual ao de antes da migracao?
  SELECT count(*) INTO v_n FROM public.produtos p JOIN _p15_produtos_antes a ON a.id = p.id
   WHERE p.preco_base IS DISTINCT FROM a.preco_base;
  SELECT count(*) INTO v_n0 FROM public.produtos p WHERE NOT EXISTS (SELECT 1 FROM _p15_produtos_antes a WHERE a.id = p.id);
  v_rel := v_rel || E'\n[0] produtos com preco_base diferente do de antes da migracao: ' || v_n || ' (produtos novos: ' || v_n0 || ')';

  -- ============================================================ 1. view
  SELECT n_total, n_ativos, n_dist INTO v_n, v_n0, v_n1 FROM _p15_cc_n;
  v_rel := v_rel || E'\n[1] ANTES: linhas=' || v_n || ' ativos(linhas)=' || v_n0 || ' produtos distintos=' || v_n1;
  SELECT count(*) INTO v_n FROM public.produto_custo_cheio;
  SELECT count(DISTINCT produto_id) INTO v_n1 FROM public.produto_custo_cheio;
  SELECT count(*) INTO v_n0 FROM public.produto_custo_cheio c JOIN public.produtos p ON p.id = c.produto_id WHERE p.ativo;
  SELECT count(*) INTO v_n2 FROM public.produtos p WHERE p.ativo;
  v_rel := v_rel || E'\n    DEPOIS: linhas=' || v_n || ' distintos=' || v_n1 || ' ativos(linhas)=' || v_n0 || ' produtos ativos=' || v_n2;
  IF v_n <> v_n1 OR v_n0 <> v_n2 THEN RAISE EXCEPTION 'view ainda duplica'; END IF;
  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) INTO v_msg
    FROM pg_attribute WHERE attrelid = 'public.produto_custo_cheio'::regclass AND attnum > 0 AND NOT attisdropped;
  v_rel := v_rel || E'\n    colunas: ' || (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.produto_custo_cheio'::regclass AND attnum > 0 AND NOT attisdropped) || ' (eram 14)';
  v_rel := v_rel || E'\n    opcoes=' || COALESCE((SELECT reloptions::text FROM pg_class WHERE oid = 'public.produto_custo_cheio'::regclass), 'nenhuma')
           || ' | select anon=' || has_table_privilege('anon', 'public.produto_custo_cheio', 'SELECT')
           || ' authenticated=' || has_table_privilege('authenticated', 'public.produto_custo_cheio', 'SELECT')
           || ' service_role=' || has_table_privilege('service_role', 'public.produto_custo_cheio', 'SELECT');
  -- consumidores: o que desconto_avaliar le (max e bool_and por produto) antes e depois
  SELECT count(*) INTO v_n FROM (
    SELECT produto_id, max(custo_cheio) mx, bool_and(sem_hora_de_maquina AND sem_mao_de_obra) sm FROM public.produto_custo_cheio GROUP BY produto_id) d
    JOIN _p15_cc_antes a ON a.produto_id = d.produto_id
   WHERE d.mx IS DISTINCT FROM a.mx;
  SELECT count(*) INTO v_n0 FROM (
    SELECT produto_id, max(custo_cheio) mx, bool_and(sem_hora_de_maquina AND sem_mao_de_obra) sm FROM public.produto_custo_cheio GROUP BY produto_id) d
    JOIN _p15_cc_antes a ON a.produto_id = d.produto_id
   WHERE d.sm IS DISTINCT FROM a.so_material;
  v_rel := v_rel || E'\n    consumidor desconto_avaliar (max custo_cheio por produto): produtos que mudaram=' || v_n || ' | so_material (bool_and) que mudaram=' || v_n0;
  FOR v_lin IN SELECT p.nome || ' so_material ' || a.so_material || '>' || d.sm
    FROM (SELECT produto_id, bool_and(sem_hora_de_maquina AND sem_mao_de_obra) sm FROM public.produto_custo_cheio GROUP BY produto_id) d
    JOIN _p15_cc_antes a ON a.produto_id = d.produto_id JOIN public.produtos p ON p.id = d.produto_id
   WHERE d.sm IS DISTINCT FROM a.so_material LOOP
    v_rel := v_rel || E'\n      ' || v_lin;
  END LOOP;
  -- consumidor meta_por_produto, como admin
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_j := public.meta_por_produto();
  SELECT count(*), count(DISTINCT e->>'produto_id') INTO v_n, v_n1 FROM jsonb_array_elements(v_j->'produtos') e;
  v_rel := v_rel || E'\n    meta_por_produto: linhas=' || v_n || ' produtos distintos=' || v_n1;
  IF v_n <> v_n1 THEN RAISE EXCEPTION 'meta_por_produto ainda repete produto'; END IF;

  -- ============================================================ 2. preco_proposta_criar
  SELECT p.* INTO v_prod FROM public.produtos p
   WHERE p.ativo AND p.custo_medio > 0 AND p.preco_base > 0 AND p.margem_minima IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.precos_propostas x WHERE x.produto_id = p.id AND x.status = 'pendente')
   ORDER BY p.nome LIMIT 1;
  v_pb_antes := v_prod.preco_base;
  v_esperado := round(v_prod.custo_medio / (1 - v_prod.margem_minima / 100), 2);
  v_rel := v_rel || E'\n[2] produto de teste: ' || v_prod.nome || ' preco ' || v_prod.preco_base || ' piso ' || v_esperado;
  SELECT count(*) INTO v_n0 FROM public.precos_propostas;
  -- a) sem papel
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_vend::text, ''), true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_msg := NULL;
  BEGIN v_id := public.preco_proposta_criar(v_prod.id, 99.90, 'teste'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE;
  v_rel := v_rel || E'\n    vendedor: ' || COALESCE(v_msg, 'PASSOU (ERRO)');
  IF v_msg IS NULL THEN RAISE EXCEPTION 'vendedor criou proposta'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  v_msg := NULL;
  BEGIN v_id := public.preco_proposta_criar(v_prod.id, 99.90, 'teste'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE;
  v_rel := v_rel || E'\n    anon: ' || COALESCE(v_msg, 'PASSOU (ERRO)');
  IF v_msg IS NULL THEN RAISE EXCEPTION 'anon criou proposta'; END IF;
  v_rel := v_rel || E'\n    EXECUTE public=' || has_function_privilege('public', 'public.preco_proposta_criar(uuid,numeric,text)', 'EXECUTE')
           || ' anon=' || has_function_privilege('anon', 'public.preco_proposta_criar(uuid,numeric,text)', 'EXECUTE')
           || ' authenticated=' || has_function_privilege('authenticated', 'public.preco_proposta_criar(uuid,numeric,text)', 'EXECUTE');
  -- b) admin, entradas ruins
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_msg := NULL; BEGIN v_id := public.preco_proposta_criar(v_prod.id, 0, 'teste'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n    preco 0: ' || COALESCE(v_msg, 'PASSOU (ERRO)'); IF v_msg IS NULL THEN RAISE EXCEPTION 'preco 0 passou'; END IF;
  v_msg := NULL; BEGIN v_id := public.preco_proposta_criar(v_prod.id, -5, 'teste'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n    preco negativo: ' || COALESCE(v_msg, 'PASSOU (ERRO)'); IF v_msg IS NULL THEN RAISE EXCEPTION 'preco negativo passou'; END IF;
  v_msg := NULL; BEGIN v_id := public.preco_proposta_criar(v_prod.id, NULL, 'teste'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n    preco nulo: ' || COALESCE(v_msg, 'PASSOU (ERRO)'); IF v_msg IS NULL THEN RAISE EXCEPTION 'preco nulo passou'; END IF;
  v_msg := NULL; BEGIN v_id := public.preco_proposta_criar(v_prod.id, 99.90, '  '); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n    motivo vazio: ' || COALESCE(v_msg, 'PASSOU (ERRO)'); IF v_msg IS NULL THEN RAISE EXCEPTION 'motivo vazio passou'; END IF;
  v_msg := NULL; BEGIN v_id := public.preco_proposta_criar(gen_random_uuid(), 99.90, 'teste'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n    produto inexistente: ' || COALESCE(v_msg, 'PASSOU (ERRO)'); IF v_msg IS NULL THEN RAISE EXCEPTION 'produto inexistente passou'; END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n1 FROM public.precos_propostas;
  v_rel := v_rel || E'\n    propostas depois das recusas: ' || v_n1 || ' (antes ' || v_n0 || ')';
  IF v_n1 <> v_n0 THEN RAISE EXCEPTION 'recusa gravou proposta'; END IF;
  -- c) valida
  SET LOCAL ROLE authenticated;
  v_id := public.preco_proposta_criar(v_prod.id, v_esperado + 3.333, 'Conserto manual de ensaio');
  RESET ROLE;
  SELECT * INTO v_prop FROM public.precos_propostas WHERE id = v_id;
  v_rel := v_rel || E'\n    CRIADA id ok: origem=' || v_prop.origem || ' status=' || v_prop.status || ' preco_atual=' || v_prop.preco_atual || ' proposto=' || v_prop.preco_proposto
           || ' piso=' || v_prop.piso || ' (esperado ' || v_esperado || ') margem_atual=' || v_prop.margem_atual || ' margem_proposta=' || v_prop.margem_proposta;
  IF v_prop.origem <> 'manual' OR v_prop.status <> 'pendente' OR v_prop.piso <> v_esperado
     OR v_prop.preco_proposto <> round(v_esperado + 3.333, 2)
     OR v_prop.margem_proposta <> round((v_prop.preco_proposto - v_prod.custo_medio) / v_prop.preco_proposto * 100, 2) THEN
    RAISE EXCEPTION 'proposta criada com valores errados';
  END IF;
  -- d) igual pendente: devolve a mesma
  SET LOCAL ROLE authenticated;
  v_id2 := public.preco_proposta_criar(v_prod.id, round(v_esperado + 3.333, 2), 'repetida');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.precos_propostas WHERE produto_id = v_prod.id AND status = 'pendente';
  v_rel := v_rel || E'\n    repetir o mesmo preco: mesmo id=' || (v_id2 = v_id) || ' pendentes do produto=' || v_n;
  IF v_id2 <> v_id OR v_n <> 1 THEN RAISE EXCEPTION 'repeticao criou outra'; END IF;
  -- e) outro preco com pendente
  SET LOCAL ROLE authenticated;
  v_msg := NULL; BEGIN v_id2 := public.preco_proposta_criar(v_prod.id, v_esperado + 9, 'outro'); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE;
  v_rel := v_rel || E'\n    outro preco com pendente: ' || COALESCE(v_msg, 'PASSOU (ERRO)'); IF v_msg IS NULL THEN RAISE EXCEPTION 'segunda pendente passou'; END IF;
  SELECT preco_base INTO v_pb_depois FROM public.produtos WHERE id = v_prod.id;
  v_rel := v_rel || E'\n    produtos.preco_base antes=' || v_pb_antes || ' depois=' || v_pb_depois;
  IF v_pb_antes <> v_pb_depois THEN RAISE EXCEPTION 'preco_base mudou'; END IF;
  SELECT count(*) INTO v_n FROM public.logs_auditoria WHERE acao = 'preco_proposta_criada' AND entidade_id = v_prod.id;
  v_rel := v_rel || E'\n    linha no log: ' || v_n || ' | custo no log: ' || (SELECT (detalhes::text ~* 'custo') FROM public.logs_auditoria WHERE acao = 'preco_proposta_criada' AND entidade_id = v_prod.id LIMIT 1);
  -- CHECK de origem: os tres valores
  v_rel := v_rel || E'\n    CHECK origem: ' || (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'precos_propostas_origem_check');

  -- ============================================================ 3. aviso de custo fora da faixa
  SELECT i.id INTO v_item_id FROM public.orcamento_itens i JOIN public.orcamentos o ON o.id = i.orcamento_id JOIN public.produtos p ON p.id = i.produto_id
   WHERE p.custo_medio > 0 AND i.custo_unitario > 0 ORDER BY (o.status = 'rascunho') DESC, i.created_at LIMIT 1;
  SELECT * INTO v_item FROM public.orcamento_itens WHERE id = v_item_id;
  SELECT count(*) INTO v_n0 FROM public.logs_auditoria WHERE acao = 'custo_fora_da_faixa';
  UPDATE public.orcamento_itens SET custo_unitario = 1000000 WHERE id = v_item_id;
  SELECT count(*) INTO v_n1 FROM public.logs_auditoria WHERE acao = 'custo_fora_da_faixa';
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE acao = 'custo_fora_da_faixa' AND entidade_id = v_item_id ORDER BY created_at DESC, id LIMIT 1;
  v_rel := v_rel || E'\n[3] item de teste ' || v_item_id || ' (custo gravado antes ' || v_item.custo_unitario || ' valor_unitario ' || v_item.valor_unitario || ' total ' || v_item.valor_total || ')';
  v_rel := v_rel || E'\n    avisos antes=' || v_n0 || ' depois de gravar custo absurdo=' || v_n1 || ' detalhe=' || COALESCE(v_j::text, 'sem linha nova');
  IF v_n1 <> v_n0 + 1 THEN RAISE EXCEPTION 'aviso nao gravado'; END IF;
  SELECT * INTO v_item FROM public.orcamento_itens WHERE id = v_item_id;
  v_rel := v_rel || E'\n    item depois: custo_unitario=' || v_item.custo_unitario || ' (nao alterado pelo aviso) valor_unitario=' || v_item.valor_unitario;
  IF v_item.custo_unitario <> 1000000 THEN RAISE EXCEPTION 'o aviso alterou o custo'; END IF;
  -- dentro da faixa: nao avisa
  UPDATE public.orcamento_itens SET custo_unitario = round((SELECT round(p.custo_medio * CASE WHEN lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²') AND COALESCE(oi.area_cobrada, 0) > 0 THEN oi.area_cobrada ELSE GREATEST(COALESCE(oi.quantidade, 1), 1) END, 2) FROM public.orcamento_itens oi JOIN public.produtos p ON p.id = oi.produto_id WHERE oi.id = v_item_id) / GREATEST(COALESCE(v_item.quantidade, 1), 1), 4) WHERE id = v_item_id;
  SELECT count(*) INTO v_n2 FROM public.logs_auditoria WHERE acao = 'custo_fora_da_faixa';
  v_rel := v_rel || E'\n    voltou para o esperado: avisos=' || v_n2 || ' (nao cresce)';
  IF v_n2 <> v_n1 THEN RAISE EXCEPTION 'avisou dentro da faixa'; END IF;
  -- 30 por cento exatos: sem aviso; 31: com aviso
  UPDATE public.orcamento_itens SET custo_unitario = round((SELECT round(p.custo_medio * CASE WHEN lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²') AND COALESCE(oi.area_cobrada, 0) > 0 THEN oi.area_cobrada ELSE GREATEST(COALESCE(oi.quantidade, 1), 1) END, 2) FROM public.orcamento_itens oi JOIN public.produtos p ON p.id = oi.produto_id WHERE oi.id = v_item_id) / GREATEST(COALESCE(v_item.quantidade, 1), 1) * 1.25, 6) WHERE id = v_item_id;
  SELECT count(*) INTO v_n2 FROM public.logs_auditoria WHERE acao = 'custo_fora_da_faixa';
  v_rel := v_rel || E'\n    25 por cento acima: avisos=' || v_n2 || ' (sem aviso dentro do limite de 30)';
  IF v_n2 <> v_n1 THEN RAISE EXCEPTION 'avisou a 25 por cento'; END IF;
  UPDATE public.orcamento_itens SET custo_unitario = round((SELECT round(p.custo_medio * CASE WHEN lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²') AND COALESCE(oi.area_cobrada, 0) > 0 THEN oi.area_cobrada ELSE GREATEST(COALESCE(oi.quantidade, 1), 1) END, 2) FROM public.orcamento_itens oi JOIN public.produtos p ON p.id = oi.produto_id WHERE oi.id = v_item_id) / GREATEST(COALESCE(v_item.quantidade, 1), 1) * 1.40, 6) WHERE id = v_item_id;
  SELECT count(*) INTO v_n2 FROM public.logs_auditoria WHERE acao = 'custo_fora_da_faixa';
  v_rel := v_rel || E'\n    40 por cento acima: avisos=' || v_n2 || ' (avisa)';
  IF v_n2 <> v_n1 + 1 THEN RAISE EXCEPTION 'limite errado'; END IF;
  -- quantos itens ja gravados estariam fora da faixa hoje (so conta, nao grava)
  SELECT count(*) INTO v_n FROM public.orcamento_itens i JOIN public.produtos p ON p.id = i.produto_id
   WHERE i.id <> v_item_id AND p.custo_medio > 0 AND i.custo_unitario > 0
     AND abs(round(i.custo_unitario * GREATEST(COALESCE(i.quantidade, 1), 1), 2)
             - round(p.custo_medio * CASE WHEN lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²') AND COALESCE(i.area_cobrada, 0) > 0 THEN i.area_cobrada ELSE GREATEST(COALESCE(i.quantidade, 1), 1) END, 2))
         > 0.30 * round(p.custo_medio * CASE WHEN lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²') AND COALESCE(i.area_cobrada, 0) > 0 THEN i.area_cobrada ELSE GREATEST(COALESCE(i.quantidade, 1), 1) END, 2);
  v_rel := v_rel || E'\n    itens ja gravados que o aviso pegaria se fossem editados hoje: ' || v_n;

  -- ============================================================ 4. preco_minimo 3D
  SELECT * INTO v_3d FROM public.orcamento_3d_calculos ORDER BY created_at LIMIT 1;
  SELECT n, zero INTO v_n, v_n0 FROM _p15_3d_antes;
  v_rel := v_rel || E'\n[4] registros antes=' || v_n || ' com preco_minimo 0=' || v_n0;
  INSERT INTO public.orcamento_3d_calculos (orcamento_3d_id, versao, nivel_precisao, inputs_json, resultados_json, versao_motor, custo_operacional, preco_minimo)
  VALUES (v_3d.orcamento_3d_id, 900001, v_3d.nivel_precisao, v_3d.inputs_json, v_3d.resultados_json, v_3d.versao_motor, 100, 0),
         (v_3d.orcamento_3d_id, 900002, v_3d.nivel_precisao, v_3d.inputs_json, v_3d.resultados_json, v_3d.versao_motor, 100, 250),
         (v_3d.orcamento_3d_id, 900003, v_3d.nivel_precisao, v_3d.inputs_json, v_3d.resultados_json, v_3d.versao_motor, 0, 0),
         (v_3d.orcamento_3d_id, 900004, v_3d.nivel_precisao, v_3d.inputs_json, v_3d.resultados_json, v_3d.versao_motor, 849.7566, 0);
  FOR v_lin IN SELECT 'versao ' || versao || ' custo_operacional ' || custo_operacional || ' => preco_minimo ' || preco_minimo
                 FROM public.orcamento_3d_calculos WHERE versao BETWEEN 900001 AND 900004 ORDER BY versao LOOP
    v_rel := v_rel || E'\n    ' || v_lin;
  END LOOP;
  IF (SELECT preco_minimo FROM public.orcamento_3d_calculos WHERE versao = 900001) <> 142.86
     OR (SELECT preco_minimo FROM public.orcamento_3d_calculos WHERE versao = 900002) <> 250
     OR (SELECT preco_minimo FROM public.orcamento_3d_calculos WHERE versao = 900003) <> 0
     OR (SELECT preco_minimo FROM public.orcamento_3d_calculos WHERE versao = 900004) <> 1213.94 THEN
    RAISE EXCEPTION 'preco_minimo 3D errado';
  END IF;
  SELECT count(*) INTO v_n1 FROM public.orcamento_3d_calculos WHERE versao < 900000 AND preco_minimo = 0;
  v_rel := v_rel || E'\n    registros antigos ainda com 0 (backfill nao feito): ' || v_n1;
  v_msg := NULL;
  BEGIN UPDATE public.orcamento_3d_calculos SET preco_minimo = round(custo_operacional / 0.70, 2) WHERE id = v_3d.id; EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  v_rel := v_rel || E'\n    tentar regravar um antigo: ' || COALESCE(v_msg, 'PASSOU');

  -- ============================================================ 5. historico com valores
  SELECT * INTO v_prod FROM public.produtos WHERE id = v_prod.id;
  SELECT count(*) INTO v_n0 FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update';
  v_ids := ARRAY(SELECT id FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update');
  UPDATE public.produtos SET preco_base = preco_base + 1 WHERE id = v_prod.id;
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update' AND id <> ALL (v_ids) LIMIT 1;
  v_rel := v_rel || E'\n[5] produto ' || v_prod.nome || ' preco ' || v_prod.preco_base || ' -> +1 (pessoa admin): ' || COALESCE(v_j::text, 'sem linha nova');
  IF v_j->>'autor_tipo' <> 'pessoa' OR (v_j->>'autor_id')::uuid <> v_admin OR (v_j->>'preco_de')::numeric <> v_prod.preco_base
     OR (v_j->>'preco_para')::numeric <> v_prod.preco_base + 1 OR (v_j->>'custo_mudou')::boolean THEN
    RAISE EXCEPTION 'historico de preco errado';
  END IF;
  IF (v_j->>'abaixo_do_piso_antes')::boolean IS DISTINCT FROM (v_prod.preco_base < COALESCE(public._preco_piso(v_prod.custo_medio, v_prod.margem_minima), 0))
     OR (v_j->>'abaixo_do_piso_depois')::boolean IS DISTINCT FROM (v_prod.preco_base + 1 < COALESCE(public._preco_piso(v_prod.custo_medio, v_prod.margem_minima), 0)) THEN
    RAISE EXCEPTION 'abaixo do piso errado';
  END IF;
  -- nada que, somado ao preco, devolva o custo: so booleanos e preco
  IF v_j::text ~ '(piso_antes|piso_depois|margem_antes|margem_depois|custo_medio)' THEN RAISE EXCEPTION 'custo derivavel no detalhe'; END IF;
  -- custo muda
  SELECT custo_medio INTO v_cm FROM public.produtos WHERE id = v_prod.id;
  v_ids := ARRAY(SELECT id FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update');
  UPDATE public.produtos SET custo_medio = custo_medio + 0.5 WHERE id = v_prod.id;
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update' AND id <> ALL (v_ids) LIMIT 1;
  v_rel := v_rel || E'\n    custo_medio antes=' || v_cm || ' depois de +0,50=' || (SELECT custo_medio FROM public.produtos WHERE id = v_prod.id) || ' | ultimo detalhe: ' || COALESCE(v_j::text, 'sem linha nova');
  IF v_j ? 'custo_medio' OR v_j ? 'custo_de' OR v_j ? 'custo_para' THEN RAISE EXCEPTION 'custo em reais no detalhe'; END IF;
  v_ids := ARRAY(SELECT id FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update');
  UPDATE public.produtos SET margem_minima = margem_minima + 1 WHERE id = v_prod.id;
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update' AND id <> ALL (v_ids) LIMIT 1;
  v_rel := v_rel || E'\n    margem minima +1: ' || COALESCE(v_j::text, 'sem linha nova');
  IF NOT (v_j->'campos') ? 'margem_minima' OR NOT (v_j ? 'preco_de') OR (v_j ? 'custo_medio') OR v_j::text ~ '(piso_antes|piso_depois|margem_antes|margem_depois)' THEN RAISE EXCEPTION 'historico de margem minima errado'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_ids := ARRAY(SELECT id FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update');
  UPDATE public.produtos SET preco_base = preco_base + 1 WHERE id = v_prod.id;
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update' AND id <> ALL (v_ids) LIMIT 1;
  v_rel := v_rel || E'\n    chave de servico: autor_tipo=' || (v_j->>'autor_tipo') || ' autor_id=' || COALESCE(v_j->>'autor_id', 'nulo');
  IF v_j->>'autor_tipo' <> 'chave_de_servico' THEN RAISE EXCEPTION 'autor da chave de servico errado'; END IF;
  -- sem sessao
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  v_ids := ARRAY(SELECT id FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update');
  UPDATE public.produtos SET preco_base = preco_base + 1 WHERE id = v_prod.id;
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update' AND id <> ALL (v_ids) LIMIT 1;
  v_rel := v_rel || E'\n    sem sessao: autor_tipo=' || (v_j->>'autor_tipo');
  IF v_j->>'autor_tipo' <> 'sem_sessao' THEN RAISE EXCEPTION 'autor sem sessao errado'; END IF;
  -- campo que nao e preco: detalhe curto, como antes
  v_ids := ARRAY(SELECT id FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update');
  UPDATE public.produtos SET descricao = COALESCE(descricao, '') || ' x' WHERE id = v_prod.id;
  SELECT detalhes INTO v_j FROM public.logs_auditoria WHERE entidade = 'produtos' AND entidade_id = v_prod.id AND acao = 'update' AND id <> ALL (v_ids) LIMIT 1;
  v_rel := v_rel || E'\n    so descricao: ' || COALESCE(v_j::text, 'sem linha nova');
  IF v_j ? 'preco_de' THEN RAISE EXCEPTION 'detalhe de preco em mudanca que nao e preco'; END IF;
  -- tabela da pasta (ficha) segue gravando como antes
  v_rel := v_rel || E'\n    ficha/processos: o ramo que nao e produtos nao mudou (ver desligamento de IA no item 7, que dispara produto_ficha_historico)';

  -- ============================================================ 6. custo zero
  SELECT count(*) INTO v_n FROM _custo_zero_antes;
  v_rel := v_rel || E'\n[6] itens elegiveis (custo 0, produto com custo, orcamento fora de aprovado e convertido): ' || v_n;
  FOR v_lin IN SELECT 'orc ' || x.orc || ' (' || x.status_orc || ') ' || x.descr || ' qtd ' || i.quantidade || ' custo ' || a.custo_unitario || ' => ' || i.custo_unitario
                    || ' | valor_unitario ' || a.valor_unitario || '>' || i.valor_unitario || ' valor_total ' || a.valor_total || '>' || i.valor_total
                 FROM _custo_zero_antes a JOIN public.orcamento_itens i ON i.id = a.id JOIN _p15_itens_antes x ON x.id = a.id ORDER BY x.orc LOOP
    v_rel := v_rel || E'\n    ' || v_lin;
  END LOOP;
  -- nenhum item com custo diferente de zero mudou de custo, e nenhum aprovado/convertido foi tocado
  -- (o ensaio de 3 e 5 mexeu em item e produto de proposito; aqui conta so o que a migracao fez, por log)
  SELECT count(*) INTO v_n FROM public.logs_auditoria WHERE acao = 'custo_zero_preenchido';
  v_rel := v_rel || E'\n    linhas de rastro custo_zero_preenchido: ' || v_n;
  SELECT count(*) INTO v_n FROM public.logs_auditoria l JOIN public.orcamento_itens i ON i.id = l.entidade_id JOIN public.orcamentos o ON o.id = i.orcamento_id
   WHERE l.acao = 'custo_zero_preenchido' AND o.status IN ('aprovado', 'convertido');
  v_rel := v_rel || E'\n    desses, em orcamento aprovado ou convertido: ' || v_n;
  IF v_n > 0 THEN RAISE EXCEPTION 'tocou aprovado'; END IF;
  SELECT count(*) INTO v_n FROM public.orcamento_itens i JOIN _p15_itens_antes a ON a.id = i.id JOIN public.orcamentos o ON o.id = i.orcamento_id
   WHERE o.status IN ('aprovado', 'convertido') AND i.id <> v_item_id AND (i.custo_unitario IS DISTINCT FROM a.custo_unitario OR i.valor_total IS DISTINCT FROM a.valor_total);
  v_rel := v_rel || E'\n    itens de aprovado ou convertido com custo ou valor diferente do de antes: ' || v_n;
  IF v_n > 0 THEN RAISE EXCEPTION 'aprovado mudou'; END IF;
  SELECT count(*) INTO v_n FROM public.orcamento_itens i JOIN _p15_itens_antes a ON a.id = i.id
   WHERE a.custo_unitario <> 0 AND i.id <> v_item_id AND i.custo_unitario IS DISTINCT FROM a.custo_unitario;
  v_rel := v_rel || E'\n    itens com custo diferente de zero que mudaram de custo (fora o item de teste do 3): ' || v_n;
  IF v_n > 0 THEN RAISE EXCEPTION 'custo diferente de zero mudou'; END IF;
  SELECT count(*) INTO v_n FROM public.orcamento_itens i WHERE i.custo_unitario = 0 AND i.produto_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = i.produto_id AND p.custo_medio > 0);
  v_rel := v_rel || E'\n    itens com produto de custo e custo ainda 0 depois (todos de aprovado ou convertido): ' || v_n
           || ' | em orcamento nao aprovado: ' || (SELECT count(*) FROM public.orcamento_itens i JOIN public.orcamentos o ON o.id = i.orcamento_id JOIN public.produtos p ON p.id = i.produto_id
               WHERE i.custo_unitario = 0 AND p.custo_medio > 0 AND o.status NOT IN ('aprovado', 'convertido'));
  SELECT count(*) INTO v_n FROM public.orcamentos o;
  v_rel := v_rel || E'\n    orcamentos: ' || v_n;

  -- ============================================================ 7. IA desligada
  SELECT count(*) INTO v_n FROM _p15_ia_antes WHERE ia_habilitado;
  SELECT count(*) INTO v_n0 FROM public.produto_ficha WHERE ia_habilitado;
  v_rel := v_rel || E'\n[7] produtos com IA ligada: antes=' || v_n || ' depois=' || v_n0;
  FOR v_lin IN SELECT p.id || ' | ' || p.nome || ' | preco ' || COALESCE(p.preco_base::text, 'nulo') || ' | motivos ' || (l.detalhes->>'motivos')
                 FROM public.logs_auditoria l JOIN public.produtos p ON p.id = l.entidade_id WHERE l.acao = 'ia_desligada_por_preco' ORDER BY p.nome LOOP
    v_rel := v_rel || E'\n    desligado: ' || v_lin;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.logs_auditoria WHERE acao = 'ia_desligada_por_preco';
  v_rel := v_rel || E'\n    total desligado: ' || v_n;
  SELECT count(*) INTO v_n1 FROM public.produto_ficha f JOIN _p15_ia_antes a ON a.produto_id = f.produto_id WHERE f.ia_habilitado AND NOT a.ia_habilitado;
  v_rel := v_rel || E'\n    ligados pela migracao (deve ser 0): ' || v_n1;
  IF v_n1 > 0 THEN RAISE EXCEPTION 'ligou IA'; END IF;
  SELECT count(*) INTO v_n1 FROM public.produto_ficha f JOIN public.produtos p ON p.id = f.produto_id
   WHERE p.ativo AND f.ia_habilitado AND (p.preco_base IS NULL OR p.preco_base <= 0 OR p.preco_base < COALESCE(public._preco_piso(p.custo_medio, p.margem_minima), 0)
          OR EXISTS (SELECT 1 FROM public.precos_propostas x WHERE x.produto_id = p.id AND x.status = 'pendente' AND x.origem <> 'manual'));
  v_rel := v_rel || E'\n    ativos ainda com IA ligada e problema de preco ou proposta pendente (fora a proposta manual do teste): ' || v_n1;
  IF v_n1 > 0 THEN RAISE EXCEPTION 'sobrou IA ligada com problema'; END IF;
  FOR v_lin IN SELECT p.id || ' ' || p.nome || ' preco ' || p.preco_base || ' custo ' || p.custo_medio || ' ficha=' || EXISTS (SELECT 1 FROM public.produto_ficha f WHERE f.produto_id = p.id)
                 FROM public.produtos p WHERE p.id::text LIKE '046eb529%' LOOP
    v_rel := v_rel || E'\n    nota: ' || v_lin;
  END LOOP;
  v_rel := v_rel || E'\n    estado final da ficha do Impressao 3D: ' || (SELECT ia_habilitado FROM public.produto_ficha WHERE produto_id = '1dc26b82-fefa-41a7-92c5-f880668a978f');

  -- ============================================================ preco_base de todos os produtos, no fim da migracao
  v_rel := v_rel || E'\n[fim] precos_propostas pendentes (inclui a manual de teste): ' || (SELECT count(*) FROM public.precos_propostas WHERE status = 'pendente');

  RAISE EXCEPTION E'ENSAIO OK (tudo desfeito)%', v_rel;
END $ensaio$;

```
