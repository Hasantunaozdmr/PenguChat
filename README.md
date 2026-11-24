# 🐧 PenguLive

Twitch ve Kick'te aynı anda yayın yapan kanallar için **iki chat'i tek pencerede** açan ve Android'den **iki platforma birden yayın** yapan uygulama.
Paneller platformların resmi chat sayfalarıdır: hesabınla giriş yaptığında her şey normal sitedeki gibi çalışır.

## İndir

**https://github.com/pengulivedestek-cmd/PenguChat/releases/latest**

| | Dosya |
|---|---|
| 🪟 Windows | `PenguChat-Setup.exe` |
| 🤖 Android | `PenguChat.apk` |

Kurduktan sonra güncellemeler uygulamanın içinden gelir (**⬆ Güncelle**).

## Özellikler

- Twitch + Kick chat'i yan yana / alt alta; linki yapıştırınca doğru panelde açılır
- Moderatörler için: chat'te bir ada tıkla → tek tuşla **timeout / ban / mesaj silme** (iki platformda birden de olur), mod log, kişi sicili
- Normal izleyicilerde mod araçları görünmez; modluk verilince kendiliğinden gelir
- Telefondan (Android) Twitch + Kick'e aynı anda yayın; logo, resim ve donate bar (uyarı sesleriyle) eklenebilir
- Renk teması, uygulama içinden güncelleme, sahibine özel web yönetim paneli (`docs/yonetim`)

## Klasörler

| Klasör | İçerik |
|---|---|
| [`desktop/`](desktop) | Windows uygulaması (Electron) |
| [`mobile/`](mobile) | Android / iPhone uygulaması (Expo / React Native) |
| `.github/workflows/release.yml` | `main`'e her gönderimde Windows + Android derler ve Releases'a yükler |
