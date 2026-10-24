-- Foto e tipo do produto na tabela do parceiro (24/10/2026).
-- 1) Bucket PÚBLICO `produtos-fotos` (como `maquinas-fotos`): foto de produto de
--    catálogo não é dado de cliente e aparece em lista e card; quem grava é
--    admin ou gerência. 0 dos 45 produtos tinham foto até aqui.
-- 2) `parceiro_catalogo_extras()`: foto, tipo (produto/serviço) e descrição dos
--    produtos ativos, só para parceiro ativo. Função à parte para não mexer no
--    contrato de `parceiro_precos`/`parceiro_catalogo`, que o pedido usa.
-- Desfazer: DROP FUNCTION public.parceiro_catalogo_extras(); apagar as 4
-- políticas "foto produto %" e o bucket (vazio) produtos-fotos.
insert into storage.buckets (id, name, public) values ('produtos-fotos', 'produtos-fotos', true)
on conflict (id) do update set public = true;
drop policy if exists "foto produto leitura publica" on storage.objects;
create policy "foto produto leitura publica" on storage.objects for select using (bucket_id = 'produtos-fotos');
drop policy if exists "foto produto escrita gestao" on storage.objects;
create policy "foto produto escrita gestao" on storage.objects for insert to authenticated with check (
  bucket_id = 'produtos-fotos' and (public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor')));
drop policy if exists "foto produto troca gestao" on storage.objects;
create policy "foto produto troca gestao" on storage.objects for update to authenticated using (
  bucket_id = 'produtos-fotos' and (public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor')));
drop policy if exists "foto produto apaga gestao" on storage.objects;
create policy "foto produto apaga gestao" on storage.objects for delete to authenticated using (
  bucket_id = 'produtos-fotos' and (public.has_role((select auth.uid()), 'admin') or public.has_role((select auth.uid()), 'gestor')));

CREATE OR REPLACE FUNCTION public.parceiro_catalogo_extras()
RETURNS TABLE(produto_id uuid, imagem_url text, tipo text, descricao text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.parceiro_do_usuario() IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p.id, p.imagem_url, p.tipo::text, p.descricao FROM public.produtos p WHERE p.ativo;
END
$function$;
REVOKE ALL ON FUNCTION public.parceiro_catalogo_extras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_catalogo_extras() TO authenticated;
