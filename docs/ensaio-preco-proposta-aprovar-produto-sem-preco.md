# Ensaio: aprovar proposta de produto sem preço (17/11/2026)

Migração: `supabase/migrations/20261117214000_preco_proposta_aprovar_produto_sem_preco.sql`. Não aplicada.

## O defeito

`preco_proposta_criar` grava `preco_atual = COALESCE(preco_base, 0)`. `preco_proposta_aprovar` compara
`preco_base IS DISTINCT FROM preco_atual`. Com `preco_base` nulo contra 0 isso dá verdadeiro, e a função recusa com
"O preço do produto mudou depois da proposta". O produto ativo Impressão 3D (serviço) está nesse estado.

## A correção

`COALESCE(..., 0)` nos dois lados da comparação. Nada mais muda.

## Como ensaiar

Rode no banco vivo, numa transação só. Cole a migração inteira **sem a linha `COMMIT;`**, depois o bloco abaixo.
Ele termina em `RAISE EXCEPTION`, então nada fica gravado. Lembrete: sequências não voltam com o rollback, mas
este ensaio só usa `precos_propostas`, cujo id é uuid.

```sql
DO $ensaio$
DECLARE
  v_admin uuid;
  v_prod  uuid := '1dc26b82-fefa-41a7-92c5-f880668a978f';  -- Impressão 3D (serviço), preço de balcão nulo
  v_id    uuid;
  v_id2   uuid;
  v_res   jsonb;
  v_preco numeric;
  v_msg   text;
  v_saida text := '';
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin'::public.app_role LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'sem admin para o ensaio'; END IF;
  IF (SELECT preco_base FROM public.produtos WHERE id = v_prod) IS NOT NULL THEN
    RAISE EXCEPTION 'o produto do ensaio já tem preço: escolha outro produto ativo com preco_base nulo';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Caso 1: produto sem preço, propor e aprovar. Antes da correção levantava "O preço do produto mudou".
  v_id := public.preco_proposta_criar(v_prod, 50.00, 'ensaio: produto sem preço de balcão');
  v_res := public.preco_proposta_aprovar(v_id);
  SELECT preco_base INTO v_preco FROM public.produtos WHERE id = v_prod;
  v_saida := v_saida || format('caso 1 aprovou=%s preco_base=%s | ', v_res->>'ok', v_preco);
  IF v_preco IS DISTINCT FROM 50.00 THEN RAISE EXCEPTION 'caso 1: o preço não foi gravado (%).', v_preco; END IF;

  -- Caso 2: a trava continua valendo. Propor, mudar o preço do produto por fora, aprovar: tem de recusar.
  v_id2 := public.preco_proposta_criar(v_prod, 60.00, 'ensaio: a trava de preço mudado continua');
  RESET ROLE;
  UPDATE public.produtos SET preco_base = 55.00 WHERE id = v_prod;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.preco_proposta_aprovar(v_id2);
    RAISE EXCEPTION 'caso 2: aprovou com o preço do produto mudado';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_saida := v_saida || format('caso 2 recusou: %s | ', v_msg);
  END;
  RESET ROLE;

  -- Caso 3: GRANTs iguais.
  v_saida := v_saida || format('grants authenticated=%s anon=%s',
    has_function_privilege('authenticated', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE'));

  RAISE EXCEPTION 'ENSAIO OK, DESFEITO: %', v_saida;
END
$ensaio$;
```

O `WHEN SQLSTATE '22023'` do caso 2 captura só a recusa de preço mudado. Qualquer outro erro sobe e o ensaio falha.
Não use `WHEN OTHERS` aqui: ele engoliria o `RAISE EXCEPTION` do próprio caso.

## O que esperar

| Caso | Esperado |
| --- | --- |
| 1. Propor 50,00 e aprovar produto sem preço | aprova, `preco_base` vira 50,00 |
| 2. Propor, mudar o preço por fora, aprovar | recusa com "O preço do produto mudou depois da proposta" |
| 3. GRANTs | `authenticated` sim, `anon` não |

## Depois do ensaio

Confira que nada ficou: `SELECT count(*) FROM precos_propostas WHERE status = 'pendente'` continua 0 e
`preco_base` do produto continua nulo.

## Como desfazer a migração

O bloco comentado no fim do cabeçalho da migração volta a comparação original.
