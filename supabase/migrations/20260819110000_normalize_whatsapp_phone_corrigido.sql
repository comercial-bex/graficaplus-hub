-- normalize_whatsapp_phone não normalizava nada.
--
-- A função era:
--     regexp_replace(COALESCE(_phone,''), '\\D', '', 'g')
--
-- O padrão está com escape duplo. Em SQL, '\\D' é a sequência LITERAL
-- barra-invertida + D, não a classe de regex \D (não-dígito). Como esse par de
-- caracteres nunca aparece num telefone, a função devolvia o texto exatamente
-- como recebeu. Comprovado no banco: o cliente gravado com "(96) 99111-2233"
-- tinha telefone_normalizado = "(96) 99111-2233".
--
-- Isso vaza para QUATRO colunas geradas, todas guardando telefone cru:
--   clientes.telefone_normalizado
--   leads.telefone_normalizado
--   whatsapp_conversas.telefone_normalizado
--   whatsapp_instancias.numero_normalizado
--
-- São exatamente as chaves usadas para reconhecer quem está falando quando chega
-- mensagem no WhatsApp, e para não duplicar cliente. Do jeito que estava, o
-- mesmo número escrito de dois jeitos era tratado como duas pessoas — e o
-- índice único de whatsapp_conversas não protegia nada.
--
-- Além do regex, a função passa a produzir uma chave canônica de verdade:
--   1. só dígitos (usando [^0-9], sem ambiguidade de escape);
--   2. tira o código do país 55 quando o número tem 12 ou 13 dígitos;
--   3. acrescenta o nono dígito em celular com 10 dígitos (o primeiro dígito
--      após o DDD entre 6 e 9 indica celular; 2 a 5 é fixo e não recebe o 9).
--
-- Assim "(96) 99111-2233", "96991112233", "5596991112233" e "9691112233" caem
-- todos em 96991112233, e o fixo "(96) 3222-1010" continua 9632221010.

CREATE OR REPLACE FUNCTION public.normalize_whatsapp_phone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH so_digitos AS (
    SELECT NULLIF(regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g'), '') AS d
  ), sem_pais AS (
    SELECT CASE
             WHEN d IS NULL THEN NULL
             WHEN length(d) IN (12, 13) AND left(d, 2) = '55' THEN substring(d FROM 3)
             ELSE d
           END AS d
    FROM so_digitos
  )
  SELECT CASE
           WHEN d IS NULL THEN NULL
           WHEN length(d) = 10 AND substring(d, 3, 1) BETWEEN '6' AND '9'
             THEN substring(d, 1, 2) || '9' || substring(d, 3)
           ELSE d
         END
  FROM sem_pais
$function$;

-- CREATE OR REPLACE não recalcula coluna gerada: os valores gravados continuam
-- com o resultado antigo. Recriar a coluna força o recálculo de todas as linhas.
-- Os índices caem junto com a coluna e são recriados com a mesma definição.

ALTER TABLE public.clientes DROP COLUMN IF EXISTS telefone_normalizado;
ALTER TABLE public.clientes ADD COLUMN telefone_normalizado text
  GENERATED ALWAYS AS (normalize_whatsapp_phone(telefone)) STORED;
CREATE INDEX IF NOT EXISTS clientes_telefone_normalizado_idx
  ON public.clientes USING btree (telefone_normalizado);

ALTER TABLE public.leads DROP COLUMN IF EXISTS telefone_normalizado;
ALTER TABLE public.leads ADD COLUMN telefone_normalizado text
  GENERATED ALWAYS AS (normalize_whatsapp_phone(telefone)) STORED;
CREATE INDEX IF NOT EXISTS idx_leads_telefone_normalizado
  ON public.leads USING btree (telefone_normalizado);
CREATE UNIQUE INDEX IF NOT EXISTS leads_telefone_temporario_unique
  ON public.leads USING btree (telefone_normalizado)
  WHERE ((temporario IS TRUE) AND (telefone_normalizado IS NOT NULL));

ALTER TABLE public.whatsapp_conversas DROP COLUMN IF EXISTS telefone_normalizado;
ALTER TABLE public.whatsapp_conversas ADD COLUMN telefone_normalizado text
  GENERATED ALWAYS AS (normalize_whatsapp_phone(telefone)) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversas_instancia_id_telefone_normalizado_key
  ON public.whatsapp_conversas USING btree (instancia_id, telefone_normalizado);

ALTER TABLE public.whatsapp_instancias DROP COLUMN IF EXISTS numero_normalizado;
ALTER TABLE public.whatsapp_instancias ADD COLUMN numero_normalizado text
  GENERATED ALWAYS AS (normalize_whatsapp_phone(numero)) STORED;
