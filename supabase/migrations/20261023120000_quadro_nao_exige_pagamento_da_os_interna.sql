-- O quadro de produção não pede pagamento nem aprovação do cliente à OS interna
-- (23/10/2026). Achado ao olhar o quadro depois da OS interna (#172): uma OS de
-- mostruário, uso interno ou reposição tem valor 0, não tem pagamento e não tem
-- cliente para aprovar a arte, então `os_bloqueios_para` a prendia na Entrada
-- ("Nenhum pagamento registrado", "Arte ainda não aprovada"). Ensaiado com
-- rollback: bloqueios para entrar em impressão = sem_pagamento, arte_nao_aprovada,
-- sem_arquivo_final. Fica só o layout (decisão do dono: a prova é o layout e as
-- medidas), o material em falta e a responsabilidade — o que vale sem cliente.
-- A margem mínima também não vale para OS sem venda (não há preço a defender).

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.os_bloqueios_para'::regproc);
  v_de text;
  v_para text;
  n int;
BEGIN
  v_de := 'IF v_total_pago <= 0 THEN';
  v_para := 'IF v_total_pago <= 0 AND v_os.finalidade = ''venda'' THEN';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'os_bloqueios_para (pagamento): âncora % vezes (esperado 1)', n; END IF;
  v_def := replace(v_def, v_de, v_para);

  v_de := 'IF NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id)';
  v_para := 'IF v_os.finalidade = ''venda'' AND NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id)';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'os_bloqueios_para (arte): âncora % vezes (esperado 1)', n; END IF;
  v_def := replace(v_def, v_de, v_para);

  v_de := 'IF v_margem IS NOT NULL AND v_margem < v_margem_minima AND NOT EXISTS (';
  v_para := 'IF v_os.finalidade = ''venda'' AND v_margem IS NOT NULL AND v_margem < v_margem_minima AND NOT EXISTS (';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN RAISE EXCEPTION 'os_bloqueios_para (margem): âncora % vezes (esperado 1)', n; END IF;
  v_def := replace(v_def, v_de, v_para);

  EXECUTE v_def;
END $m$;
