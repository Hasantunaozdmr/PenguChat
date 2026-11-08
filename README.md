# 🐧 PengusChat

Twitch ve Kick'te aynı anda yayın yapan kanallar için **iki chat'i tek pencerede** açan uygulama.
Paneller platformların resmi chat sayfalarıdır: hesabınla giriş yaptığında her şey normal sitedeki gibi çalışır.

## İndir

**https://github.com/Hasantunaozdmr/PenguChat/releases/latest**

| | Dosya |
|---|---|
| 🪟 Windows | `PenguChat-Setup.exe` |
| 🤖 Android | `PenguChat.apk` |

Kurduktan sonra güncellemeler uygulamanın içinden gelir (**⬆ Güncelle**).

## Özellikler

- Twitch + Kick chat'i yan yana / alt alta; linki yapıştırınca doğru panelde açılır
- Moderatörler için: chat'te bir ada tıkla → tek tuşla **timeout / ban** (iki platformda birden de olur), Twitch ↔ Kick **yayın gecikmesi** yazısı
- Normal izleyicilerde mod araçları görünmez; modluk verilince kendiliğinden gelir
- Turkuaz tema, otomatik güncelleme

## Klasörler

| Klasör | İçerik |
|---|---|
| [`desktop/`](desktop) | Windows uygulaması (Electron) |
| [`mobile/`](mobile) | Android / iPhone uygulaması (Expo / React Native) |
| `.github/workflows/release.yml` | `main`'e her gönderimde Windows + Android derler ve Releases'a yükler |
