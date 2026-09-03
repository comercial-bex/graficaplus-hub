-- O lead vira cliente de verdade.
--
-- `converter_lead_em_cliente` é uma boa função — checa permissão, é idempotente,
-- procura cliente já existente antes de criar outro e ainda abre o orçamento já
-- amarrado ao lead. Só que ninguém nunca a chamou: a tela de Leads só cria lead
-- e muda status. Ao ligar a tela nela, dois defeitos apareceram.

-- ---------------------------------------------------------------------------
-- 1. Converter um lead PERDIA O TELEFONE.
--
-- A tabela tem três colunas de telefone: `telefone` (o que se digita),
-- `telefone_original` (o número cru que vem do WhatsApp) e
-- `telefone_normalizado` (coluna gerada a partir de `telefone`).
--
-- A função lia `telefone_original` para preencher o cliente. Lead digitado na
-- tela preenche `telefone` — então o cliente nascia SEM TELEFONE, e ninguém
-- percebia porque a conversão respondia sucesso.
--
-- 2. A deduplicação por telefone não casava para lead vindo do WhatsApp.
--
-- O fallback usava `normalize_phone`, que não tira o código do país:
--   normalize_phone('5596991116169')          -> '5596991116169'
--   normalize_whatsapp_phone('5596991116169') -> '96991116169'
-- Como `clientes.telefone_normalizado` é gerada com `normalize_whatsapp_phone`,
-- a comparação era entre formatos diferentes e nunca dava igual. Resultado:
-- cliente que já existia era cadastrado de novo, duplicado.
-- ---------------------------------------------------------------------------
create or replace function public.converter_lead_em_cliente(
  p_lead_id uuid, p_dados jsonb, p_criar_orcamento boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE v_uid UUID; v_lead public.leads%ROWTYPE; v_cliente_id UUID; v_orcamento_id UUID; v_existing UUID;
BEGIN
  v_uid := public.require_permission('leads.convert');
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado'; END IF;

  IF v_lead.cliente_id IS NOT NULL THEN
    RETURN jsonb_build_object('lead_id', p_lead_id, 'cliente_id', v_lead.cliente_id,
                              'orcamento_id', NULL, 'idempotent', true);
  END IF;

  v_existing := NULLIF(p_dados->>'cliente_id','')::uuid;
  IF v_existing IS NULL THEN
    SELECT id INTO v_existing FROM public.clientes
    WHERE (documento_normalizado IS NOT NULL
           AND documento_normalizado = public.normalize_document(COALESCE(p_dados->>'documento', v_lead.documento)))
       -- Mesma função dos dois lados da comparação, senão nunca casa.
       OR (telefone_normalizado IS NOT NULL
           AND telefone_normalizado = COALESCE(
                 v_lead.telefone_normalizado,
                 public.normalize_whatsapp_phone(COALESCE(v_lead.telefone, v_lead.telefone_original))))
    LIMIT 1;
  END IF;

  IF v_existing IS NULL THEN
    INSERT INTO public.clientes (nome, razao_social, documento, email, telefone, vendedor_id, created_by, observacoes)
    VALUES (COALESCE(p_dados->>'nome', v_lead.nome),
            COALESCE(p_dados->>'empresa', v_lead.empresa),
            COALESCE(p_dados->>'documento', v_lead.documento),
            public.normalize_email(COALESCE(p_dados->>'email', v_lead.email)),
            -- `telefone` primeiro: é o que a tela preenche. `telefone_original`
            -- fica de reserva para o lead que nasceu de uma conversa.
            COALESCE(p_dados->>'telefone', v_lead.telefone, v_lead.telefone_original),
            v_lead.responsavel_id, v_uid,
            format('Criado por conversão de lead (origem: %s)', coalesce(v_lead.origem,'não informada')))
    RETURNING id INTO v_cliente_id;
  ELSE
    v_cliente_id := v_existing;
  END IF;

  UPDATE public.leads
     SET cliente_id = v_cliente_id, convertido_em = now(), status = 'ganho', etapa = 'convertido'
   WHERE id = p_lead_id;

  IF p_criar_orcamento THEN
    INSERT INTO public.orcamentos (cliente_id, lead_id, vendedor_id, titulo, descricao, created_by, conversa_id, valor_total)
    VALUES (v_cliente_id, p_lead_id, v_lead.responsavel_id,
            COALESCE(v_lead.interesse,'Orçamento do lead'), v_lead.interesse,
            v_uid, v_lead.conversa_id, COALESCE(v_lead.valor_potencial,0))
    RETURNING id INTO v_orcamento_id;
  END IF;

  INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id)
  VALUES ('lead', p_lead_id, v_cliente_id, 'lead_convertido', 'Lead convertido em cliente',
          jsonb_build_object('cliente_id', v_cliente_id, 'orcamento_id', v_orcamento_id,
                             'origem', v_lead.origem, 'campanha', v_lead.campanha), v_uid);

  RETURN jsonb_build_object('lead_id', p_lead_id, 'cliente_id', v_cliente_id,
                            'orcamento_id', v_orcamento_id,
                            'cliente_existente', v_existing is not null);
END;
$$;

comment on function public.converter_lead_em_cliente is
  'Lead vira cliente (e, opcionalmente, orçamento já amarrado ao lead). Idempotente; deduplica por documento ou telefone normalizados.';

-- ---------------------------------------------------------------------------
-- 3. `documento_normalizado` nunca foi preenchida.
--
-- Os dois clientes cadastrados têm `documento`; nenhum tem
-- `documento_normalizado`. A coluna existe, tem índice, é lida na deduplicação —
-- e nada a escrevia. Ou seja: cadastrar o mesmo CNPJ com pontuação diferente
-- criava dois clientes, sempre.
--
-- Vira coluna gerada, como `telefone_normalizado` já é. `normalize_document` é
-- IMMUTABLE, então serve. Assim não depende de ninguém lembrar de preencher.
-- ---------------------------------------------------------------------------
drop index if exists public.idx_clientes_documento_normalizado;
alter table public.clientes drop column if exists documento_normalizado;
alter table public.clientes
  add column documento_normalizado text
  generated always as (public.normalize_document(documento)) stored;
create index idx_clientes_documento_normalizado
  on public.clientes (documento_normalizado)
  where documento_normalizado is not null;

comment on column public.clientes.documento_normalizado is
  'CPF/CNPJ só com dígitos, gerado a partir de `documento`. Serve para não cadastrar o mesmo cliente duas vezes.';

-- A coluna nova precisa do grant e da entrada na view operacional, senão o
-- PostgREST derruba a consulta inteira sem erro visível.
grant select (documento_normalizado) on public.clientes to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Marcar lead como perdido registrando o motivo.
--
-- `motivo_perda` existe na tabela e nenhuma tela grava. Perder venda sem anotar
-- por quê é jogar fora a única informação que faria a próxima não se perder.
-- ---------------------------------------------------------------------------
create or replace function public.marcar_lead_perdido(p_lead_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid; v_lead public.leads%rowtype;
begin
  v_uid := public.require_permission('leads.update');
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Diga por que o lead foi perdido — é o dado que evita perder o próximo pelo mesmo motivo.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead não encontrado'; end if;
  if v_lead.cliente_id is not null then
    raise exception 'Este lead já virou cliente; não dá para marcar como perdido.';
  end if;

  update public.leads
     set status = 'perdido', etapa = 'perdido', motivo_perda = trim(p_motivo)
   where id = p_lead_id;

  insert into public.eventos_negocio(entidade, entidade_id, tipo, titulo, dados_posteriores, usuario_id)
  values ('lead', p_lead_id, 'lead_perdido', 'Lead perdido',
          jsonb_build_object('motivo', trim(p_motivo), 'origem', v_lead.origem), v_uid);

  return jsonb_build_object('lead_id', p_lead_id, 'status', 'perdido');
end;
$$;

comment on function public.marcar_lead_perdido is
  'Fecha o lead como perdido exigindo o motivo. `motivo_perda` existia e nenhuma tela gravava.';

grant execute on function public.marcar_lead_perdido(uuid, text) to authenticated;
