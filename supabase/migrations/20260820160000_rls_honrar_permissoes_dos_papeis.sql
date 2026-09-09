-- RLS: fazer as policies honrarem as permissões que role_permission_matrix já concede.
--
-- Diagnóstico: has_permission() lê role_permission_matrix, mas várias policies exigem
-- uma permissão que o papel dono do trabalho não tem. O resultado é papel inoperante:
-- o designer tem 5 permissões de arquivo e não consegue ler um único arquivo, o
-- instalador tem 4 permissões de entrega/instalação e nenhuma delas abre a tabela.
--
-- Nenhuma concessão nova é criada aqui. As policies passam a aceitar as permissões que
-- o banco já distribuiu. A exceção está marcada caso a caso.

-- ---------------------------------------------------------------------------
-- arquivos: a policy única exigia 'arquivos.approve' (só admin e gestor têm).
-- O designer — que recebe read/upload/version/finalize/request_approval — ficava
-- de fora do próprio acervo. Separado por verbo.
-- ---------------------------------------------------------------------------
drop policy if exists "arquivos permission all" on public.arquivos;

create policy "arquivos read" on public.arquivos
  for select using (
    has_permission((select auth.uid()), 'arquivos.read')
    or has_permission((select auth.uid()), 'arquivos.approve')
  );

create policy "arquivos upload" on public.arquivos
  for insert with check (has_permission((select auth.uid()), 'arquivos.upload'));

create policy "arquivos update" on public.arquivos
  for update using (
    has_permission((select auth.uid()), 'arquivos.version')
    or has_permission((select auth.uid()), 'arquivos.finalize')
    or has_permission((select auth.uid()), 'arquivos.request_approval')
    or has_permission((select auth.uid()), 'arquivos.approve')
  );

create policy "arquivos delete" on public.arquivos
  for delete using (has_permission((select auth.uid()), 'arquivos.delete'));

-- ---------------------------------------------------------------------------
-- aprovacoes: exigia arquivos.approve OR orcamentos.create. O designer pede a
-- aprovação (arquivos.request_approval) e não conseguia enxergar o pedido dele.
-- ---------------------------------------------------------------------------
drop policy if exists "aprov permission read" on public.aprovacoes;

create policy "aprov permission read" on public.aprovacoes
  for select using (
    has_permission((select auth.uid()), 'arquivos.approve')
    or has_permission((select auth.uid()), 'arquivos.request_approval')
    or has_permission((select auth.uid()), 'orcamentos.create')
  );

-- ---------------------------------------------------------------------------
-- entregas_instalacoes: exigia 'instalacao.update' (admin e gestor). O papel
-- instalador tem entregas.read/manage e instalacoes.read/manage — quatro
-- permissões que não abriam tabela nenhuma.
-- ---------------------------------------------------------------------------
drop policy if exists "ent instalacao permission read" on public.entregas_instalacoes;
drop policy if exists "ent instalacao permission write" on public.entregas_instalacoes;

create policy "ent instalacao read" on public.entregas_instalacoes
  for select using (
    has_permission((select auth.uid()), 'entregas.read')
    or has_permission((select auth.uid()), 'instalacoes.read')
    or has_permission((select auth.uid()), 'instalacao.update')
    or has_permission((select auth.uid()), 'os.read')
  );

create policy "ent instalacao write" on public.entregas_instalacoes
  for all using (
    has_permission((select auth.uid()), 'entregas.manage')
    or has_permission((select auth.uid()), 'instalacoes.manage')
    or has_permission((select auth.uid()), 'instalacao.update')
  ) with check (
    has_permission((select auth.uid()), 'entregas.manage')
    or has_permission((select auth.uid()), 'instalacoes.manage')
    or has_permission((select auth.uid()), 'instalacao.update')
  );

-- ---------------------------------------------------------------------------
-- maquinas: a leitura exigia 'kanban.move' (admin e gestor). Quem opera a
-- máquina não conseguia listar máquina, e a tela /maquinas abria vazia.
-- ESCOLHA: alinhar com as tabelas irmãs maquinas_agenda e manutencoes, que já
-- são is_staff. O parque de máquinas não é dado sensível; a escrita segue restrita.
-- ---------------------------------------------------------------------------
drop policy if exists "maq permission read" on public.maquinas;

create policy "maq staff read" on public.maquinas
  for select using (is_staff((select auth.uid())));

-- ---------------------------------------------------------------------------
-- movimentacoes_estoque: a leitura exigia 'estoque.cost.read', ou seja, era
-- preciso poder ver custo para ver que houve movimento. Passa a aceitar
-- 'estoque.read'; o custo continua protegido pelas colunas/espelho.
-- ---------------------------------------------------------------------------
drop policy if exists "mov estoque permission read" on public.movimentacoes_estoque;

create policy "mov estoque read" on public.movimentacoes_estoque
  for select using (
    has_permission((select auth.uid()), 'estoque.read')
    or has_permission((select auth.uid()), 'estoque.cost.read')
  );

-- ---------------------------------------------------------------------------
-- ocorrencias: exigia kanban.move OR instalacao.update (admin e gestor), mas
-- quem registra ocorrência é quem está na produção. Leitura para quem lê OS,
-- escrita para quem mexe em OS.
-- ---------------------------------------------------------------------------
drop policy if exists "oco permission all" on public.ocorrencias;

create policy "oco read" on public.ocorrencias
  for select using (has_permission((select auth.uid()), 'os.read'));

create policy "oco write" on public.ocorrencias
  for all using (
    has_permission((select auth.uid()), 'os.update')
    or has_permission((select auth.uid()), 'kanban.move')
    or has_permission((select auth.uid()), 'instalacao.update')
  ) with check (
    has_permission((select auth.uid()), 'os.update')
    or has_permission((select auth.uid()), 'kanban.move')
    or has_permission((select auth.uid()), 'instalacao.update')
  );

-- ---------------------------------------------------------------------------
-- os_perdas: a policy era ALL USING (true). Qualquer sessão autenticada —
-- inclusive o papel cliente — lia e escrevia perda de produção.
-- ---------------------------------------------------------------------------
drop policy if exists "os_perdas_all" on public.os_perdas;

create policy "os_perdas read" on public.os_perdas
  for select using (has_permission((select auth.uid()), 'os.read'));

create policy "os_perdas write" on public.os_perdas
  for all using (
    has_permission((select auth.uid()), 'os.update')
    or has_permission((select auth.uid()), 'custos.create')
  ) with check (
    has_permission((select auth.uid()), 'os.update')
    or has_permission((select auth.uid()), 'custos.create')
  );
