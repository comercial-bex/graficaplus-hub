-- Recibo de retirada de material.
--
-- A saída de estoque já registra tudo que um recibo precisa (material, quantidade,
-- OS, quem retirou, quando) — falta o papel assinável e a permissão para emiti-lo.
--
-- documentos_gerados só aceitava escrita de quem tem 'orcamentos.create'. Recibo de
-- material é documento de estoque: o papel `estoque`, que é justamente quem entrega
-- o material, não conseguiria gerar nem reler o próprio recibo.

drop policy if exists "docs permission insert" on public.documentos_gerados;
drop policy if exists "docs permission read" on public.documentos_gerados;

create policy "docs insert" on public.documentos_gerados
  for insert with check (
    has_permission((select auth.uid()), 'orcamentos.create')
    -- quem dá baixa emite o recibo daquela baixa, e só esse tipo de documento
    or (tipo = 'recibo_material' and has_permission((select auth.uid()), 'estoque.exit'))
  );

create policy "docs read" on public.documentos_gerados
  for select using (
    has_permission((select auth.uid()), 'orcamentos.create')
    or (tipo = 'recibo_material' and has_permission((select auth.uid()), 'estoque.read'))
  );

-- Numeração: o recibo usa o número da própria OS. baixar_estoque_os recusa uma
-- segunda baixa para a mesma OS, então existe uma retirada por OS e o número não
-- é ambíguo. Um contador daria número novo a cada reimpressão — reimprimir tem
-- que devolver o mesmo documento, senão duas vias do mesmo papel discordam.
