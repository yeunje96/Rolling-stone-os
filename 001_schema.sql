
-- Rolling Stone OS Supabase schema + RLS
-- 이미 있는 테이블/컬럼은 유지하고 없는 것만 추가합니다.

create extension if not exists "pgcrypto";

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department text,
  position text,
  photo text,
  status text default '대기',
  projects text,
  prompt text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table employees add column if not exists position text;
alter table employees add column if not exists photo text;
alter table employees add column if not exists status text default '대기';
alter table employees add column if not exists projects text;
alter table employees add column if not exists prompt text;
alter table employees add column if not exists is_active boolean default true;
alter table employees add column if not exists updated_at timestamptz default now();

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text,
  status text default '대기',
  assigned_employee_id text,
  assigned_employee_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text,
  sender text,
  text text not null,
  created_at timestamptz default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  requester text,
  memo text,
  status text default '승인대기',
  reject_reason text,
  processed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  departments text,
  status text default '진행중',
  latest_log text,
  token_usage text default '0K',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists outputs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project text,
  department text,
  tag text,
  file_url text,
  owner text,
  approval_line jsonb default '[]'::jsonb,
  feedbacks jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists sops (
  id uuid primary key default gen_random_uuid(),
  project text,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists gcal_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date text,
  time text,
  place text,
  is_done boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  headline text not null,
  news_time text,
  url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  level text,
  created_at timestamptz default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  is_resolved boolean default false,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists weekly_todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_done boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists year_checklist (
  id uuid primary key default gen_random_uuid(),
  year integer,
  title text not null,
  is_done boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists settings (
  id text primary key,
  value integer
);
insert into settings (id, value)
values ('checklist_year', extract(year from now())::int)
on conflict (id) do nothing;

create table if not exists revenues (
  id uuid primary key default gen_random_uuid(),
  year integer,
  month integer,
  amount numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists system_logs (
  id uuid primary key default gen_random_uuid(),
  type text,
  message text,
  created_at timestamptz default now()
);

create table if not exists social_metrics (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  views numeric default 0,
  followers numeric default 0,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table employees enable row level security;
alter table tasks enable row level security;
alter table messages enable row level security;
alter table approvals enable row level security;
alter table projects enable row level security;
alter table outputs enable row level security;
alter table sops enable row level security;
alter table gcal_events enable row level security;
alter table news_items enable row level security;
alter table reports enable row level security;
alter table alerts enable row level security;
alter table weekly_todos enable row level security;
alter table year_checklist enable row level security;
alter table settings enable row level security;
alter table revenues enable row level security;
alter table system_logs enable row level security;
alter table social_metrics enable row level security;

-- 개발/단독 사용용 공개 정책. 실제 외부 배포 후에는 반드시 로그인 기반 auth.uid() 정책으로 교체하세요.
do $$
declare t text;
begin
  foreach t in array array[
    'employees','tasks','messages','approvals','projects','outputs','sops',
    'gcal_events','news_items','reports','alerts','weekly_todos','year_checklist',
    'settings','revenues','system_logs','social_metrics'
  ]
  loop
    execute format('drop policy if exists "public select %1$s" on %1$I', t);
    execute format('drop policy if exists "public insert %1$s" on %1$I', t);
    execute format('drop policy if exists "public update %1$s" on %1$I', t);
    execute format('drop policy if exists "public delete %1$s" on %1$I', t);

    execute format('create policy "public select %1$s" on %1$I for select to anon using (true)', t);
    execute format('create policy "public insert %1$s" on %1$I for insert to anon with check (true)', t);
    execute format('create policy "public update %1$s" on %1$I for update to anon using (true) with check (true)', t);
    execute format('create policy "public delete %1$s" on %1$I for delete to anon using (true)', t);
  end loop;
end $$;
