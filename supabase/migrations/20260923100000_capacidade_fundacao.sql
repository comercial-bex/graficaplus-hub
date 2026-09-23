-- Fundação para capacidade, agenda de máquina e "onde o trabalho para".
--
-- Três buracos que impediam qualquer conta de capacidade:
--
-- 1. HORAS PRODUTIVAS POR MÊS estava NULA nas 5 máquinas. É o denominador de
--    toda ocupação: sem ele não existe "% da máquina vendida", nem alerta de
--    sobrecarga, nem teto de faturamento. O padrão 160 h/mês (8 h × 20 dias) é
--    o mesmo número com que o custo/hora da plotter foi calculado
--    (R$ 2.309 de parcela ÷ R$ 14,4313/h = 160 h), então adotá-lo mantém a
--    coerência do que já está cadastrado. É editável por máquina.
--
-- 2. AGENDA SEM TRAVA DE SOBREPOSIÇÃO. Duas reservas da MESMA máquina no mesmo
--    horário entravam em silêncio, e o conflito só aparecia no dia da entrega —
--    exatamente o caso "dois revendedores querem a mesma hora e só existe uma
--    plotter". A extensão btree_gist já estava instalada; faltava a trava.
--    Reserva cancelada ou concluída não conflita com nada.
--
-- 3. NÃO HAVIA COMO MEDIR TEMPO PARADO. A OS guarda só o status atual, e
--    `updated_at` é sujo por qualquer edição. Sem o carimbo de quando a OS
--    entrou na etapa, "parada há 7 dias" é impossível. Agora cada mudança de
--    status grava uma linha, seja pela RPC avancar_os_status, seja por update
--    direto na tabela.
--
-- COMO DESFAZER:
--   alter table public.maquinas_agenda drop constraint maquinas_agenda_sem_sobreposicao;
--   drop trigger tg_os_status_historico on public.ordens_servico;
--   drop function public.tg_os_status_historico();
--   drop table public.os_status_historico;
--   alter table public.maquinas alter column horas_produtivas_mensais drop default;

-- ------------------------------------------------- 1. horas produtivas do mês
ALTER TABLE public.maquinas
  ALTER COLUMN horas_produtivas_mensais SET DEFAULT 160;

UPDATE public.maquinas
   SET horas_produtivas_mensais = 160, updated_at = now()
 WHERE horas_produtivas_mensais IS NULL;

COMMENT ON COLUMN public.maquinas.horas_produtivas_mensais IS
  'Horas que a máquina realmente produz por mês, já descontando setup, troca de bobina e manutenção. É o denominador da ocupação. Padrão 160 h = 8 h × 20 dias.';

-- ------------------------------------------ 2. uma máquina, um horário, uma OS
-- Só reserva viva ocupa a máquina: cancelada e concluída saem da trava.
-- A faixa usa o previsto quando existe e cai no inicio/fim digitado quando não.
-- '[)' deixa uma reserva terminar 14:00 e a seguinte começar 14:00 sem colidir.
ALTER TABLE public.maquinas_agenda
  ADD CONSTRAINT maquinas_agenda_sem_sobreposicao
  EXCLUDE USING gist (
    maquina_id WITH =,
    tstzrange(COALESCE(inicio_previsto, inicio), COALESCE(fim_previsto, fim), '[)') WITH &&
  )
  WHERE (status IN ('agendado', 'em_producao'));

COMMENT ON CONSTRAINT maquinas_agenda_sem_sobreposicao ON public.maquinas_agenda IS
  'Impede duas reservas vivas da mesma máquina no mesmo horário. O erro 23P01 é traduzido na tela como conflito de agenda.';

-- Consulta da semana por máquina é a leitura mais frequente das telas novas.
CREATE INDEX IF NOT EXISTS idx_maquinas_agenda_janela
  ON public.maquinas_agenda (maquina_id, COALESCE(inicio_previsto, inicio));

CREATE INDEX IF NOT EXISTS idx_maquinas_agenda_status
  ON public.maquinas_agenda (status) WHERE status IN ('agendado', 'em_producao');

-- --------------------------------------------- 3. quando a OS entrou na etapa
CREATE TABLE IF NOT EXISTS public.os_status_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  status_anterior public.status_os,
  status_novo public.status_os NOT NULL,
  mudou_em timestamptz NOT NULL DEFAULT now(),
  mudou_por uuid
);

CREATE INDEX IF NOT EXISTS idx_os_status_historico_os ON public.os_status_historico (os_id, mudou_em DESC);
CREATE INDEX IF NOT EXISTS idx_os_status_historico_quando ON public.os_status_historico (mudou_em DESC);

ALTER TABLE public.os_status_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "historico staff read" ON public.os_status_historico;
CREATE POLICY "historico staff read" ON public.os_status_historico
  FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));

REVOKE ALL ON public.os_status_historico FROM PUBLIC, anon;
GRANT SELECT ON public.os_status_historico TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_os_status_historico()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.os_status_historico (os_id, status_anterior, status_novo, mudou_por)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.os_status_historico (os_id, status_anterior, status_novo, mudou_por)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NULL;  -- trigger AFTER: o retorno é ignorado de qualquer forma
END $function$;

DROP TRIGGER IF EXISTS tg_os_status_historico ON public.ordens_servico;
CREATE TRIGGER tg_os_status_historico
  AFTER INSERT OR UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_status_historico();

-- As OS que já existem entram com o status atual carimbado na criação: é o
-- melhor palpite honesto, e é o que faz "parada há X dias" ter resposta no
-- primeiro dia de uso em vez de ficar em branco.
INSERT INTO public.os_status_historico (os_id, status_anterior, status_novo, mudou_em, mudou_por)
SELECT os.id, NULL, os.status, os.created_at, os.created_by
FROM public.ordens_servico os
WHERE NOT EXISTS (SELECT 1 FROM public.os_status_historico h WHERE h.os_id = os.id);
