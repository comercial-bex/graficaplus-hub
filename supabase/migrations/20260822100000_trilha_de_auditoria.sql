-- Trilha de auditoria: fazer existir o que a tela já fingia mostrar.
--
-- Diagnóstico: `logs_auditoria` existe, tem policies e está pronta há tempo — e
-- NADA escreve nela. Zero funções, zero gatilhos. A tela /logs renderiza um array
-- fixo no código ("Bruno mudou status", "Ana criou orçamento"), então o admin
-- olhava para um histórico inventado e concluía que havia rastro.
--
-- O que passa a ser registrado são as ações que mudam quem pode o quê e quem
-- mexe em dinheiro — não todo UPDATE do sistema. Log que registra tudo vira
-- ruído e ninguém lê; log de ação sensível é consultado quando algo dá errado.

create or replace function public.tg_auditar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_anterior jsonb;
  v_novo jsonb;
begin
  if TG_OP = 'DELETE' then
    v_anterior := to_jsonb(OLD);
    v_novo := null;
    v_id := (v_anterior ->> 'id')::uuid;
  elsif TG_OP = 'INSERT' then
    v_anterior := null;
    v_novo := to_jsonb(NEW);
    v_id := (v_novo ->> 'id')::uuid;
  else
    v_anterior := to_jsonb(OLD);
    v_novo := to_jsonb(NEW);
    v_id := (v_novo ->> 'id')::uuid;
    -- UPDATE que não mudou nada não vira linha de log.
    if v_anterior = v_novo then
      return NEW;
    end if;
  end if;

  insert into public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  values (
    (select auth.uid()),
    TG_TABLE_NAME,
    v_id,
    lower(TG_OP),
    jsonb_strip_nulls(jsonb_build_object('antes', v_anterior, 'depois', v_novo))
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

comment on function public.tg_auditar is
  'Gatilho genérico de auditoria: grava antes/depois em logs_auditoria.';

-- Papéis: é o registro mais importante do sistema. Quem ganhou acesso a quê, e
-- quando — inclusive a remoção que tranca alguém para fora.
drop trigger if exists tg_auditar_user_roles on public.user_roles;
create trigger tg_auditar_user_roles
  after insert or update or delete on public.user_roles
  for each row execute function public.tg_auditar();

-- Acesso de cliente ao portal: dá a uma pessoa de fora a visão dos pedidos,
-- documentos e valores de um cliente.
drop trigger if exists tg_auditar_portal_acessos on public.portal_cliente_acessos;
create trigger tg_auditar_portal_acessos
  after insert or update or delete on public.portal_cliente_acessos
  for each row execute function public.tg_auditar();

-- Dinheiro.
drop trigger if exists tg_auditar_pagamentos on public.pagamentos;
create trigger tg_auditar_pagamentos
  after insert or update or delete on public.pagamentos
  for each row execute function public.tg_auditar();

drop trigger if exists tg_auditar_caixa on public.caixa_movimentos;
create trigger tg_auditar_caixa
  after insert or update or delete on public.caixa_movimentos
  for each row execute function public.tg_auditar();

-- Exclusões que apagam histórico comercial.
drop trigger if exists tg_auditar_clientes_delete on public.clientes;
create trigger tg_auditar_clientes_delete
  after delete on public.clientes
  for each row execute function public.tg_auditar();

drop trigger if exists tg_auditar_orcamentos_delete on public.orcamentos;
create trigger tg_auditar_orcamentos_delete
  after delete on public.orcamentos
  for each row execute function public.tg_auditar();

drop trigger if exists tg_auditar_os_delete on public.ordens_servico;
create trigger tg_auditar_os_delete
  after delete on public.ordens_servico
  for each row execute function public.tg_auditar();

-- O texto das mensagens automáticas: muda o que o cliente recebe em nome da
-- gráfica, e mudar isso sem rastro é o tipo de coisa que ninguém consegue
-- reconstituir depois.
drop trigger if exists tg_auditar_templates on public.notificacao_templates;
create trigger tg_auditar_templates
  after insert or update or delete on public.notificacao_templates
  for each row execute function public.tg_auditar();

-- A tela precisa listar do mais recente para o mais antigo, filtrando por
-- entidade. Sem índice isso vira varredura assim que o log crescer.
create index if not exists idx_logs_auditoria_recentes
  on public.logs_auditoria (created_at desc);
create index if not exists idx_logs_auditoria_entidade
  on public.logs_auditoria (entidade, created_at desc);
