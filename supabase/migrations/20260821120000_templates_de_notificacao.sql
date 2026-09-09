-- Texto das mensagens automáticas do WhatsApp.
--
-- Diagnóstico: os gatilhos de orçamento e OS já enfileiram em notificacoes_fila,
-- mas `template` guarda só o NOME do evento ('os_em_producao') e não existia
-- lugar nenhum com o texto correspondente. Sem esta tabela, a mensagem teria que
-- morar dentro da edge function — e trocar uma palavra exigiria redeploy, que
-- neste projeto depende do agente Lovable.

create table if not exists public.notificacao_templates (
  evento text primary key,
  canal text not null default 'whatsapp',
  descricao text not null,
  corpo text not null,
  ativo boolean not null default true,
  atualizado_por uuid references public.usuarios(id),
  updated_at timestamptz not null default now()
);

comment on table public.notificacao_templates is
  'Texto das mensagens automáticas por evento. O worker só envia evento com template ativo.';
comment on column public.notificacao_templates.corpo is
  'Aceita {{variavel}} — as variáveis vêm do jsonb gravado por enfileirar_notificacao.';

alter table public.notificacao_templates enable row level security;

create policy "templates staff read" on public.notificacao_templates
  for select using (is_staff((select auth.uid())));

create policy "templates manage" on public.notificacao_templates
  for all using (has_permission((select auth.uid()), 'templates.manage'))
  with check (has_permission((select auth.uid()), 'templates.manage'));

-- Textos iniciais. Curtos de propósito: WhatsApp de gráfica é aviso, não carta.
-- As variáveis são exatamente as que os gatilhos gravam em `variaveis`.
insert into public.notificacao_templates (evento, descricao, corpo) values
  ('orcamento_aprovado',
   'Orçamento aprovado pelo cliente',
   'Olá, {{cliente}}! Recebemos a aprovação do orçamento nº {{orcamento_numero}}. Já vamos abrir a ordem de serviço e te avisamos quando a produção começar.'),
  ('os_arte_para_aprovar',
   'Arte pronta, aguardando aprovação do cliente',
   'Oi, {{cliente}}! A arte do pedido {{os_numero}} ({{os_titulo}}) está pronta para sua aprovação. Assim que você aprovar, entra na fila de produção.'),
  ('os_em_producao',
   'OS entrou em produção',
   'Boa notícia, {{cliente}}: o pedido {{os_numero}} ({{os_titulo}}) entrou em produção. Previsão de entrega: {{prazo}}.'),
  ('os_pronta_retirada',
   'Pedido pronto para retirada',
   '{{cliente}}, seu pedido {{os_numero}} está pronto e à sua espera aqui na gráfica. Nosso horário de atendimento é de segunda a sexta.'),
  ('os_saiu_entrega',
   'Pedido saiu para entrega',
   '{{cliente}}, o pedido {{os_numero}} saiu para entrega hoje. Qualquer coisa é só responder por aqui.'),
  ('os_concluida',
   'Pedido concluído',
   'Pedido {{os_numero}} concluído, {{cliente}}. Obrigado pela preferência! Se puder responder como foi a experiência, ajuda muito a gente.')
on conflict (evento) do nothing;

-- Gatilho de updated_at no padrão das outras tabelas do schema.
create or replace function public.tg_notificacao_templates_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tg_touch_notificacao_templates on public.notificacao_templates;
create trigger tg_touch_notificacao_templates
  before update on public.notificacao_templates
  for each row execute function public.tg_notificacao_templates_touch();
