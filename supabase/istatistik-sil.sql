-- 📊 İstatistik kaldırma: toplanan kullanım bilgilerini siler, artık hiçbir şey kaydedilmez.
-- Supabase → SQL Editor'de bir kez çalıştır.

-- 1) Eski sürümler hâlâ bilgi gönderebilir: artık hiçbir şey kaydetmesin (hata vermeden yok saysın)
drop function if exists public.ping(text, text, text, boolean, text, text);
create function public.ping(p_id text, p_platform text, p_version text, p_mod boolean, p_twitch text, p_kick text)
returns void language plpgsql security definer set search_path = public as $$ begin end $$;
grant execute on function public.ping(text, text, text, boolean, text, text) to anon, authenticated;

-- 2) İstatistik ekranının kullandığı fonksiyonlar artık yok
drop function if exists public.get_stats(text);
drop function if exists public.role_stats(text, text);

-- 3) Toplanmış tüm kayıtları sil
drop table if exists public.clients;
