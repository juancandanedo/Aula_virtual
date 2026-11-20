-- =====================================================================
-- AULA VIRTUAL — Esquema de Supabase
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- Es seguro ejecutarlo más de una vez.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- PERFILES ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text default '',
  role        text not null default 'student' check (role in ('admin','student')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- CONTENIDO ----------
create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text default '',
  position    int  not null default 0,
  published   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.chapters (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  title       text not null,
  position    int  not null default 0,
  released    boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.modules (
  id          uuid primary key default gen_random_uuid(),
  chapter_id  uuid not null references public.chapters(id) on delete cascade,
  title       text not null,
  position    int  not null default 0,
  slide_w     int  not null default 1280,
  slide_h     int  not null default 720,
  slide_count int  not null default 0,
  slides      jsonb not null default '[]'::jsonb,   -- [{ "title": "...", "html": "..." }]
  created_at  timestamptz not null default now()
);

create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  chapter_id  uuid not null unique references public.chapters(id) on delete cascade,
  title       text not null default 'Quiz del capítulo',
  pass_score  int  not null default 70 check (pass_score between 0 and 100),
  created_at  timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  position    int  not null default 0,
  question    text not null,
  options     jsonb not null default '[]'::jsonb,  -- ["A","B","C","D"]
  correct     int  not null default 0,             -- índice de la opción correcta
  explanation text default ''
);

-- ---------- ESTUDIANTES ----------
create table if not exists public.enrollments (
  student_id  uuid not null references public.profiles(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (student_id, subject_id)
);

create table if not exists public.quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  score       int  not null,   -- respuestas correctas
  total       int  not null,   -- total de preguntas
  answers     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.module_progress (
  student_id   uuid not null references public.profiles(id) on delete cascade,
  module_id    uuid not null references public.modules(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (student_id, module_id)
);

create index if not exists idx_chapters_subject on public.chapters(subject_id);
create index if not exists idx_modules_chapter  on public.modules(chapter_id);
create index if not exists idx_questions_quiz   on public.quiz_questions(quiz_id);
create index if not exists idx_attempts_student on public.quiz_attempts(student_id, quiz_id);

-- ---------- FUNCIONES DE ACCESO ----------
create or replace function public.can_view_subject(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1
    from public.subjects s
    join public.enrollments e on e.subject_id = s.id
    where s.id = sid and s.published and e.student_id = auth.uid()
  );
$$;

create or replace function public.can_view_chapter(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.chapters c
    where c.id = cid and c.released and public.can_view_subject(c.subject_id)
  );
$$;

create or replace function public.can_view_quiz(qid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_chapter((select chapter_id from public.quizzes where id = qid));
$$;

-- ---------- SEGURIDAD (RLS) ----------
alter table public.profiles        enable row level security;
alter table public.subjects        enable row level security;
alter table public.chapters        enable row level security;
alter table public.modules         enable row level security;
alter table public.quizzes         enable row level security;
alter table public.quiz_questions  enable row level security;
alter table public.enrollments     enable row level security;
alter table public.quiz_attempts   enable row level security;
alter table public.module_progress enable row level security;

-- perfiles
drop policy if exists "perfil: ver propio o admin" on public.profiles;
create policy "perfil: ver propio o admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "perfil: editar propio" on public.profiles;
create policy "perfil: editar propio" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- un estudiante solo puede cambiar su nombre (nunca su rol)
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- materias / capítulos / módulos / quices / preguntas
drop policy if exists "materias: ver" on public.subjects;
create policy "materias: ver" on public.subjects
  for select to authenticated using (public.can_view_subject(id));
drop policy if exists "materias: admin" on public.subjects;
create policy "materias: admin" on public.subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "capitulos: ver" on public.chapters;
create policy "capitulos: ver" on public.chapters
  for select to authenticated using (public.can_view_subject(subject_id));
drop policy if exists "capitulos: admin" on public.chapters;
create policy "capitulos: admin" on public.chapters
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "modulos: ver" on public.modules;
create policy "modulos: ver" on public.modules
  for select to authenticated using (public.can_view_chapter(chapter_id));
drop policy if exists "modulos: admin" on public.modules;
create policy "modulos: admin" on public.modules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "quices: ver" on public.quizzes;
create policy "quices: ver" on public.quizzes
  for select to authenticated using (public.can_view_chapter(chapter_id));
drop policy if exists "quices: admin" on public.quizzes;
create policy "quices: admin" on public.quizzes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "preguntas: ver" on public.quiz_questions;
create policy "preguntas: ver" on public.quiz_questions
  for select to authenticated using (public.can_view_quiz(quiz_id));
drop policy if exists "preguntas: admin" on public.quiz_questions;
create policy "preguntas: admin" on public.quiz_questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- matrículas
drop policy if exists "matriculas: ver" on public.enrollments;
create policy "matriculas: ver" on public.enrollments
  for select to authenticated using (student_id = auth.uid() or public.is_admin());
drop policy if exists "matriculas: admin" on public.enrollments;
create policy "matriculas: admin" on public.enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- intentos de quiz
drop policy if exists "intentos: ver" on public.quiz_attempts;
create policy "intentos: ver" on public.quiz_attempts
  for select to authenticated using (student_id = auth.uid() or public.is_admin());
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
drop policy if exists "intentos: admin borrar" on public.quiz_attempts;
create policy "intentos: admin borrar" on public.quiz_attempts
  for delete to authenticated using (public.is_admin());

-- progreso de módulos
drop policy if exists "progreso: ver" on public.module_progress;
create policy "progreso: ver" on public.module_progress
  for select to authenticated using (student_id = auth.uid() or public.is_admin());
drop policy if exists "progreso: crear propio" on public.module_progress;
create policy "progreso: crear propio" on public.module_progress
  for insert to authenticated
  with check (student_id = auth.uid() and public.can_view_chapter((select chapter_id from public.modules where id = module_id)));
drop policy if exists "progreso: borrar propio" on public.module_progress;
create policy "progreso: borrar propio" on public.module_progress
  for delete to authenticated using (student_id = auth.uid());

-- ---------- ALMACENAMIENTO DE IMÁGENES DE LAS DIAPOSITIVAS ----------
insert into storage.buckets (id, name, public)
values ('class-media', 'class-media', true)
on conflict (id) do nothing;

drop policy if exists "media: admin escribe" on storage.objects;
create policy "media: admin escribe" on storage.objects
  for all to authenticated
  using (bucket_id = 'class-media' and public.is_admin())
  with check (bucket_id = 'class-media' and public.is_admin());

-- =====================================================================
-- DESPUÉS de registrarte en la app por primera vez, conviértete en admin:
--
--   update public.profiles set role = 'admin'
--   where email = 'juan.candanedo@gmail.com';
--
-- (cambia el correo por el que usaste al registrarte)
-- =====================================================================
