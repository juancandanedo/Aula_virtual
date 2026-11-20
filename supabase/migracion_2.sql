-- Migración 2: el quiz solo se puede enviar si el estudiante completó todos los módulos del capítulo.
-- Ejecutar una vez en Supabase → SQL Editor. Es seguro repetirla.

create or replace function public.chapter_modules_done(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from public.modules m
    where m.chapter_id = cid
      and not exists (
        select 1 from public.module_progress p
        where p.module_id = m.id and p.student_id = auth.uid()
      )
  );
$$;

drop policy if exists "intentos: crear propio" on public.quiz_attempts;
create policy "intentos: crear propio" on public.quiz_attempts
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.can_view_quiz(quiz_id)
    and (public.is_admin()
         or public.chapter_modules_done((select chapter_id from public.quizzes where id = quiz_id)))
  );
