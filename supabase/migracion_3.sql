-- Migración 3: candado por capítulo ("Liberado"). Ejecutar una vez en Supabase → SQL Editor. Es seguro repetirla.
-- Un capítulo no liberado se ve con su título y un 🔒, pero sus módulos, quiz y preguntas no se pueden leer (lo impone la base de datos).

alter table public.chapters add column if not exists released boolean not null default true;

create or replace function public.can_view_chapter(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.chapters c
    where c.id = cid and c.released and public.can_view_subject(c.subject_id)
  );
$$;
