-- Avisos que falam de registro apagado, e sete vínculos sem trava.
--
-- ═══ PARTE 1 — O TERCEIRO TIPO DE AVISO ÓRFÃO ═══════════════════════════════
--
-- Conferido no banco em 11/09/2026: os 7 avisos pendentes da fila têm cliente
-- que EXISTE, mas a OS ou o orçamento de que eles falam FOI APAGADO. Seis
-- dizem "sua arte está pronta" ou "seu pedido foi concluído" sobre OS que não
-- existem mais; um diz "seu orçamento foi aprovado" sobre orçamento apagado.
--
-- `cancelar_avisos_orfaos` só reconhecia dois tipos de órfão — cliente nulo e
-- cliente apagado. Este terceiro passava direto. E a tela de avisos separava
-- órfãos só por `sem_vinculo`, então os 7 apareciam como "com cliente
-- vinculado", cada um com o botão "Já avisei". Seguir a tela era mandar
-- mensagem a 7 clientes sobre serviço que não existe. O botão de limpeza nem
-- aparecia: ele contava só aviso sem cliente.
--
-- É a terceira vez que a definição de "órfão" desta função fica incompleta.
-- Por isso a definição agora mora em UM lugar — a coluna `motivo_orfao` da
-- view — e a função de limpeza cancela pelo que a view diz, em vez de repetir
-- as regras.
--
-- A ARMADILHA DO ALCANCE: a view roda com `security_invoker`, isto é, com a
-- permissão de quem olha. Deduzir "registro apagado" de um LEFT JOIN faria um
-- usuário que não enxerga certa OS ver um aviso legítimo marcado como órfão.
-- Existência é FATO DO DADO, não alcance de quem olha — então ela vem de uma
-- função SECURITY DEFINER que devolve só um booleano. Saber que um id que você
-- já tem existe não revela nada.

CREATE OR REPLACE FUNCTION public.aviso_registro_existe(p_entidade text, p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE p_entidade
    WHEN 'ordem_servico' THEN EXISTS (SELECT 1 FROM ordens_servico WHERE id = p_id)
    WHEN 'orcamento'     THEN EXISTS (SELECT 1 FROM orcamentos WHERE id = p_id)
    -- Entidade que esta função não conhece: não afirma nada. Devolver false
    -- mandaria cancelar um aviso só por ser de um tipo novo.
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.aviso_cliente_existe(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM clientes WHERE id = p_id)
$function$;

REVOKE ALL ON FUNCTION public.aviso_registro_existe(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aviso_cliente_existe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_registro_existe(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aviso_cliente_existe(uuid) TO authenticated;

-- Colunas novas SÓ no fim: CREATE OR REPLACE VIEW não reordena nem troca tipo.
CREATE OR REPLACE VIEW public.vw_avisos_pendentes
WITH (security_invoker = true) AS
SELECT
  f.id,
  f.canal,
  f.destinatario,
  f.evento,
  f.entidade,
  f.entidade_id,
  f.status,
  f.tentativas,
  f.ultimo_erro,
  f.created_at,
  f.observacao,
  COALESCE(c.nome, f.variaveis ->> 'cliente') AS cliente,
  f.cliente_id,
  f.variaveis ->> 'os_titulo' AS titulo,
  f.variaveis ->> 'os_numero' AS os_numero,
  CURRENT_DATE - f.created_at::date AS dias_parado,
  f.tentativas = 0 AS nunca_tentado,
  f.cliente_id IS NULL AS sem_vinculo,
  c.id IS NOT NULL AS cliente_visivel,
  EXISTS (SELECT 1 FROM whatsapp_instancias w WHERE w.ativa) AS whatsapp_configurado,
  -- Novas:
  public.aviso_registro_existe(f.entidade, f.entidade_id) AS entidade_existe,
  CASE
    WHEN f.cliente_id IS NULL THEN 'sem_cliente'
    WHEN NOT public.aviso_cliente_existe(f.cliente_id) THEN 'cliente_apagado'
    WHEN public.aviso_registro_existe(f.entidade, f.entidade_id) IS FALSE THEN 'registro_apagado'
    ELSE NULL
  END AS motivo_orfao
FROM notificacoes_fila f
LEFT JOIN clientes c ON c.id = f.cliente_id
WHERE f.status = ANY (ARRAY['pendente', 'falhou', 'enviando']);

COMMENT ON VIEW public.vw_avisos_pendentes IS
  'Avisos que ainda não saíram. motivo_orfao é a ÚNICA definição de aviso órfão do sistema (sem_cliente, cliente_apagado, registro_apagado) — cancelar_avisos_orfaos cancela pelo que esta coluna diz. Existência vem de função SECURITY DEFINER: é fato do dado, não alcance de quem olha.';

CREATE OR REPLACE FUNCTION public.cancelar_avisos_orfaos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sem_cliente integer := 0;
  v_cliente_apagado integer := 0;
  v_registro_apagado integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- A regra de órfão NÃO é repetida aqui: quem decide é a view. Enquanto
  -- havia duas cópias da regra, uma ficava para trás — esta função perdeu o
  -- terceiro tipo de órfão justamente assim.
  WITH alvo AS (
    SELECT id, motivo_orfao FROM public.vw_avisos_pendentes WHERE motivo_orfao IS NOT NULL
  ), feito AS (
    UPDATE public.notificacoes_fila f
       SET status = 'cancelado',
           observacao = coalesce(f.observacao || ' · ', '') || 'cancelado em lote: ' ||
             CASE a.motivo_orfao
               WHEN 'sem_cliente'      THEN 'aviso sem cliente vinculado'
               WHEN 'cliente_apagado'  THEN 'cliente apagado'
               WHEN 'registro_apagado' THEN 'a OS ou o orçamento deste aviso foi apagado'
             END,
           updated_at = now()
      FROM alvo a
     WHERE f.id = a.id
    RETURNING a.motivo_orfao
  )
  SELECT count(*) FILTER (WHERE motivo_orfao = 'sem_cliente'),
         count(*) FILTER (WHERE motivo_orfao = 'cliente_apagado'),
         count(*) FILTER (WHERE motivo_orfao = 'registro_apagado')
    INTO v_sem_cliente, v_cliente_apagado, v_registro_apagado
    FROM feito;

  RETURN jsonb_build_object(
    'cancelados', v_sem_cliente + v_cliente_apagado + v_registro_apagado,
    'sem_cliente', v_sem_cliente,
    'cliente_apagado', v_cliente_apagado,
    'registro_apagado', v_registro_apagado
  );
END;
$function$;

-- ═══ PARTE 2 — SETE VÍNCULOS SEM TRAVA ═══════════════════════════════════════
--
-- Colunas que apontam para outra tabela sem chave estrangeira: podem apontar
-- para registro apagado sem que ninguém perceba. Conferido antes de travar:
-- zero órfãos nas sete. Em base pequena, o momento é agora.
--
-- ON DELETE SET NULL nas sete, seguindo a convenção que o próprio banco já usa
-- para ponteiros de "qual arquivo", "qual tarefa" e "quem fez" (39 das 63
-- chaves para usuarios, e os irmãos diretos destas). SET NULL nunca apaga
-- dado e nunca impede um delete — só remove o ponteiro que ficaria pendurado.
--
-- eventos_negocio.os_id poderia ser CASCADE, como os outros filhos da OS. Não
-- é: evento é histórico, e esta migração não vai introduzir apagamento
-- automático de histórico. A exclusão da OS já fica registrada em
-- logs_auditoria pelo gatilho tg_auditar_os_delete.

ALTER TABLE public.itens_os
  ADD CONSTRAINT itens_os_arquivo_id_fkey
  FOREIGN KEY (arquivo_id) REFERENCES public.arquivos(id) ON DELETE SET NULL;

ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_versao_aprovada_id_fkey
  FOREIGN KEY (versao_aprovada_id) REFERENCES public.orcamento_versoes(id) ON DELETE SET NULL;

ALTER TABLE public.maquinas_agenda
  ADD CONSTRAINT maquinas_agenda_tarefa_id_fkey
  FOREIGN KEY (tarefa_id) REFERENCES public.os_tarefas(id) ON DELETE SET NULL;

ALTER TABLE public.os_perdas
  ADD CONSTRAINT os_perdas_operador_id_fkey
  FOREIGN KEY (operador_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;

ALTER TABLE public.eventos_negocio
  ADD CONSTRAINT eventos_negocio_os_id_fkey
  FOREIGN KEY (os_id) REFERENCES public.ordens_servico(id) ON DELETE SET NULL;

ALTER TABLE public.eventos_negocio
  ADD CONSTRAINT eventos_negocio_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_conversa_id_fkey
  FOREIGN KEY (conversa_id) REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL;
