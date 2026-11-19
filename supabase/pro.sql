-- ⭐ PenguLive Pro: Supabase → SQL Editor'da bir kere çalıştırılır.
-- Tablolara doğrudan erişim yok (RLS açık, kural yok); her şey aşağıdaki fonksiyonlardan geçer.

create table if not exists pro_users (
  platform  text not null check (platform in ('twitch', 'kick')),
  username  text not null,
  until     timestamptz,                 -- boş = süresiz
  note      text,
  source    text not null default 'elle', -- elle / shopier / iyzico ...
  added_at  timestamptz not null default now(),
  primary key (platform, username)
);
alter table pro_users enable row level security;

-- "Herkese açık" anahtarı: açıkken herkes Pro özelliklerini ücretsiz kullanır (test dönemi)
create table if not exists pro_config (
  id   int primary key default 1 check (id = 1),
  open boolean not null default true
);
alter table pro_config enable row level security;
insert into pro_config (id, open) values (1, true) on conflict (id) do nothing;

-- Uygulama: bu hesap Pro mu?
create or replace function my_pro(p_twitch text, p_kick text)
returns json language sql security definer set search_path = public as $$
  with mine as (
    select until from pro_users
    where ((platform = 'twitch' and username = lower(coalesce(p_twitch, '')))
        or (platform = 'kick'   and username = lower(coalesce(p_kick, ''))))
      and (until is null or until > now())
  )
  select json_build_object(
    'open',    coalesce((select open from pro_config where id = 1), true),
    'pro',     exists (select 1 from mine),
    'forever', exists (select 1 from mine where until is null),
    'until',   (select max(until) from mine)
  );
$$;

-- Yönetim: liste
create or replace function list_pro(p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin(p_password) then raise exception 'yetkisiz'; end if;
  return json_build_object(
    'open', coalesce((select open from pro_config where id = 1), true),
    'users', coalesce((select json_agg(p order by p.until nulls first, p.username)
                       from (select platform, username, until, note, source, added_at from pro_users) p), '[]'::json)
  );
end $$;

-- Yönetim: Pro ver / süre ekle. p_months = 0 → süresiz; > 0 → bugünden (ya da mevcut bitişten) itibaren o kadar ay eklenir
create or replace function set_pro(p_password text, p_platform text, p_username text, p_months int, p_note text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  u text := lower(trim(coalesce(p_username, '')));
  cur timestamptz;
  had boolean;
begin
  if not is_admin(p_password) then raise exception 'yetkisiz'; end if;
  if p_platform not in ('twitch', 'kick') or u !~ '^[a-z0-9_]{2,25}$' then raise exception 'kullanıcı adı hatalı'; end if;
  select until, true into cur, had from pro_users where platform = p_platform and username = u;
  insert into pro_users (platform, username, until, note, source)
  values (p_platform, u,
          case when coalesce(p_months, 0) <= 0 then null
               else greatest(coalesce(cur, now()), now()) + make_interval(months => p_months) end,
          nullif(trim(coalesce(p_note, '')), ''), 'elle')
  on conflict (platform, username) do update
    set until = excluded.until,
        note  = coalesce(excluded.note, pro_users.note);
end $$;

-- Yönetim: Pro'yu kaldır
create or replace function remove_pro(p_password text, p_platform text, p_username text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin(p_password) then raise exception 'yetkisiz'; end if;
  delete from pro_users where platform = p_platform and username = lower(trim(p_username));
end $$;

-- Yönetim: "Herkese açık" anahtarı
create or replace function set_pro_open(p_password text, p_open boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin(p_password) then raise exception 'yetkisiz'; end if;
  update pro_config set open = coalesce(p_open, true) where id = 1;
end $$;

-- Kendi yayıncın: süresiz ücretsiz Pro
insert into pro_users (platform, username, until, note) values
  ('twitch', 'feyzask', null, 'kendi yayıncım'),
  ('kick', 'feyzaskk', null, 'kendi yayıncım')
on conflict (platform, username) do nothing;
