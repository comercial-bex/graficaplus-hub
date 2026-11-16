-- Tempo de máquina só depois do Atendimento (16/11/2026).
--
-- Achado ao conferir a TV da Oficina: a Plotter de Impressão estava "ocupada"
-- desde 10/11, 14:40 — um apontamento aberto pela agenda na OS 222 três minutos
-- depois de a OS nascer, com ela ainda no Atendimento (sem validação do gestor,
-- sem arte aprovada, sem arquivo final, sem pagamento), e nunca fechado. Com ele
-- aberto, "Começar" na Plotter recusava qualquer outra OS, e o custo de máquina
-- da 222 crescia sozinho.
--
-- 1. A porta: iniciar_apontamento (a única função que abre apontamento — a
--    tabela não aceita escrita do navegador; comecar_na_maquina passa por ela
--    depois de levar a OS à produção pelas travas) recusa OS no Atendimento ou
--    em "Atendimento validado": produção começa na fila, depois do aval do
--    gestor. Na Criação continua permitido (prova de cor, teste de material).
--    O resto é a definição viva de 16/11/2026.
-- 2. O dado: o apontamento da 222 fecha SEM tempo e SEM custo, com o motivo
--    escrito. A regra de apontamento esquecido (fechar_apontamento_interno)
--    lançaria ~9 h de Plotter numa OS que não foi produzida. A reserva da
--    agenda volta a "agendado" — a peça não saiu. Se o banner foi impresso
--    naquele dia, o tempo real se lança à mão (a reserva previa 35 min).

-- ---------------------------------------------------------------- 1
CREATE OR REPLACE FUNCTION public.iniciar_apontamento(p_os_id uuid, p_maquina_id uuid, p_etapa text DEFAULT NULL::text)
 RETURNS apontamentos_producao
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; v_maquina public.maquinas%rowtype; v_apontamento public.apontamentos_producao%rowtype;
        v_etapa text; v_os_numero integer; v_os_status public.status_os;
begin
  v_uid := public.require_permission('producao.start');
  if p_os_id is null then
    raise exception 'Informe a OS.' using detail = 'os_nao_informada';
  end if;
  select o.numero, o.status into v_os_numero, v_os_status from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  if public.os_esta_encerrada(v_os_status) then
    raise exception 'A OS #% já está encerrada (%). Não dá para apontar produção nela.', v_os_numero, v_os_status
      using detail = 'os_encerrada';
  end if;
  -- 16/11/2026: produção só depois do Atendimento (a OS 222 ocupou a Plotter
  -- por 5 dias com um apontamento aberto antes da validação do gestor).
  if public.etapa_da_os(v_os_status) in ('entrada', 'validado') then
    raise exception 'A OS #% ainda está no atendimento: a produção começa na fila, depois da validação do gestor e das travas (arte, arquivo, pagamento).', v_os_numero
      using detail = 'os_antes_da_producao';
  end if;
  select * into v_maquina from public.maquinas where id = p_maquina_id;
  if not found then raise exception 'Máquina não encontrada'; end if;
  if not v_maquina.ativa then raise exception 'A máquina % está inativa.', v_maquina.nome; end if;
  if exists (select 1 from public.apontamentos_producao a where a.maquina_id = p_maquina_id and a.finalizado_em is null) then
    raise exception 'A máquina % já está com um apontamento aberto. Finalize antes de começar outro.', v_maquina.nome;
  end if;
  -- `etapa` é NOT NULL sem default, e a tela manda null quando o campo
  -- "Opcional" fica vazio: sem este padrão a chamada caía no INSERT.
  v_etapa := coalesce(
    nullif(btrim(p_etapa), ''),
    (select t.etapa_padrao from public.tipos_de_maquina() t where t.tipo = v_maquina.tipo),
    nullif(btrim(v_maquina.setor), ''),
    'Produção');
  insert into public.apontamentos_producao (os_id, maquina_id, etapa, setor, operador_id, iniciado_em)
  values (p_os_id, p_maquina_id, v_etapa, v_maquina.setor, v_uid, now())
  returning * into v_apontamento;
  return v_apontamento;
end; $function$;

-- ---------------------------------------------------------------- 2
-- O apontamento esquecido da OS 222: fecha sem tempo e sem custo. Idempotente.
DO $os222$
DECLARE
  v_ap uuid := '324c68f4-fc12-4874-97eb-42f3a6d80b98';
  v_agenda uuid;
BEGIN
  UPDATE public.apontamentos_producao
     SET finalizado_em = iniciado_em,
         observacoes = concat_ws(' · ', nullif(btrim(observacoes), ''),
           'Fechado sem tempo e sem custo em 16/11/2026: aberto pela agenda com a OS #222 ainda no Atendimento '
           || '(sem validação, arte aprovada nem arquivo final); a Plotter ficou ocupada desde 10/11.')
   WHERE id = v_ap AND finalizado_em IS NULL
   RETURNING agenda_id INTO v_agenda;
  IF NOT FOUND THEN
    RAISE NOTICE 'apontamento da OS 222 já estava fechado: nada a fazer';
    RETURN;
  END IF;
  -- O gatilho da agenda marcou a reserva como concluída; a peça não saiu: volta a agendada.
  IF v_agenda IS NOT NULL THEN
    UPDATE public.maquinas_agenda
       SET status = 'agendado', inicio_real = NULL, fim_real = NULL, minutos_reais = 0
     WHERE id = v_agenda;
  END IF;
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (NULL, 'apontamentos_producao', v_ap, 'apontamento_fechado_sem_tempo',
          jsonb_build_object('os_numero', 222, 'maquina', 'Plotter de Impressão', 'aberto_em', '2026-11-10T17:40:43Z',
                             'motivo', 'aberto antes da validação do gestor; nunca fechado; ocupava a máquina',
                             'agenda_id', v_agenda));
END
$os222$;

-- ---------------------------------------------------------------- 3
-- Permissão: a função já existia e o navegador a chama (quem aponta); só confere o anon.
DO $fechar$
BEGIN
  REVOKE ALL ON FUNCTION public.iniciar_apontamento(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.iniciar_apontamento(uuid, uuid, text) TO authenticated, service_role;
  IF has_function_privilege('anon', 'public.iniciar_apontamento(uuid, uuid, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa iniciar_apontamento';
  END IF;
END
$fechar$;

NOTIFY pgrst, 'reload schema';
