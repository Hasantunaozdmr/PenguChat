// 🔒 Gizlilik metni (PC ve telefon uygulamasının içinde gösterilir). Sitedeki docs/gizlilik sayfası ile aynı içerik.
// Bu dosya mobile/src/privacy.js'e aynen kopyalanır.
(function (root) {
  const UPDATED = '19 Kasım 2026';
  const SECTIONS = [
    { p: ["PenguLive; Twitch ve Kick chat'lerini tek yerde göstermek, modlamayı kolaylaştırmak ve telefondan yayın yapmak için yapılmış bağımsız bir uygulamadır. Twitch ya da Kick'in resmî uygulaması değildir. Uygulamanın çalışması için gereken en az veriyi toplarız. Şifreni, Twitch / Kick oturumunu, yayın anahtarlarını ve kamera görüntünü biz görmeyiz ve saklamayız."] },
    { h: '1. Veri sorumlusu ve iletişim', p: ["Veri sorumlusu PenguLive geliştiricisidir. Verilerinle ilgili her türlü soru ve talep için uygulamadaki 🐞 Sorun bildir bölümünden bize yazabilirsin."] },
    { h: '2. Hangi verileri topluyoruz?', list: [
      'Rastgele cihaz numarası: sadece bir mod işlemi kaydedilirken, işlemin hangi cihazdan yapıldığını ayırt etmek için. Uygulamayı kimin, ne zaman açtığını takip etmeyiz.',
      'Giriş yaptığın Twitch / Kick kullanıcı adı: yetkilerini (mod log, yayın tuşu vb.) ve Pro durumunu kontrol etmek için.',
      'Sorun bildirimi (yazdığın mesaj, kullanıcı adın, sürüm, cihaz): sen gönderdiğinde, sorunu çözmek ve sana cevap vermek için.',
      'Otomatik hata kayıtları (hatanın türü ve kısa açıklaması, sürüm, cihaz, kullanıcı adı): hataları fark edip düzeltmek için.',
      'Mod işlemleri (işlemi yapan mod, işlem yapılan kişi, işlem, süre, platform, zaman, nereden yapıldığı): yayıncı ve yetkili modlar için mod geçmişi.',
      'Yetki listesi (hangi kullanıcı adına hangi yetkinin verildiği): yetkileri uygulamak için.',
    ] },
    { h: '3. Neleri toplamıyoruz?', list: [
      "Twitch / Kick şifren ve oturumun: giriş doğrudan Twitch'in ve Kick'in kendi sayfasında yapılır. Oturum sadece senin cihazında kalır; bize gönderilmez.",
      "Yayın anahtarların: sadece telefonunda saklanır ve sadece Twitch'e / Kick'e gönderilir.",
      'Donate linklerin ve yayına eklediğin resimler: sadece telefonunda saklanır; donate linki sadece ilgili bağış sitesine bağlanmak için kullanılır, bize gönderilmez.',
      "Kamera ve mikrofon görüntün: telefonundan doğrudan Twitch'e / Kick'e gider; bizim sunucumuzdan geçmez, kaydedilmez.",
      "Chat mesajları: chat'te yazılanları kaydetmeyiz (sadece yukarıdaki mod işlemleri kaydedilir).",
      'Etkinlikler (abone, bağış, bit, Kicks, takip) ve Streamlabs anahtarın: sadece cihazında saklanır. Streamlabs bağlantısı doğrudan Streamlabs\'e yapılır; bize gönderilmez.',
      'Konum, rehber, fotoğraflar, reklam kimliği gibi veriler toplanmaz; uygulamada reklam ve takip aracı yoktur.',
    ] },
    { h: '4. Veriler nerede saklanıyor, kimlerle paylaşılıyor?', list: [
      "Veriler bulut veritabanı hizmeti Supabase üzerinde saklanır. Supabase'in sunucuları yurt dışında olabilir; bu nedenle verilerin yurt dışına aktarılması söz konusudur.",
      'Uygulama dosyaları GitHub üzerinden dağıtılır; indirme sırasında GitHub kendi kurallarına göre teknik kayıt tutabilir.',
      "Uygulama, chat'leri ve yayını göstermek için Twitch ve Kick ile doğrudan bağlantı kurar; bu platformların kendi gizlilik politikaları geçerlidir.",
      'Verilerini satmıyoruz, reklam için kullanmıyoruz ve bu amaçla kimseyle paylaşmıyoruz.',
      'Mod log ve sorunlar gibi bilgileri sadece uygulamanın yöneticisi ve yöneticinin yetki verdiği kişiler (örneğin yayıncı) görebilir.',
    ] },
    { h: '5. Ne kadar süre saklıyoruz?', list: [
      'Sorun bildirimleri, hata kayıtları ve mod log: hizmet sürdüğü ve amaç için gerektiği sürece. Yönetici bunları her zaman silebilir.',
      'Talep edersen sana ait kayıtları sileriz.',
    ] },
    { h: '6. Hukuki sebep', p: ['Verilerin, KVKK madde 5 kapsamında uygulamanın sunulması ve çalışması için zorunlu olması (sözleşmenin ifası) ve uygulamayı güvenli ve hatasız tutmak için meşru menfaatimiz kapsamında işlenir. Sorun bildirimi ve mod işlemleri gibi veriler, bu işlemleri senin başlatmanla oluşur.'] },
    { h: '7. Hakların', p: ['KVKK madde 11 kapsamında; verilerinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltilmesini veya silinmesini isteme, yurt dışına aktarıldığı yerleri öğrenme ve itiraz etme hakların vardır. Talebini uygulamadaki 🐞 Sorun bildir bölümünden, Twitch / Kick kullanıcı adınla birlikte iletebilirsin; en geç 30 gün içinde cevaplarız.'] },
    { h: '8. Çocuklar', p: ["PenguLive, Twitch ve Kick'in yaş sınırlarına uygun olarak 13 yaşın altındaki çocuklara yönelik değildir."] },
    { h: '9. Değişiklikler', p: ['Bu metni zaman zaman güncelleyebiliriz. Önemli bir değişiklik olursa uygulamadaki duyuru ile haber veririz.'] },
  ];
  const api = { UPDATED, SECTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PenguPrivacy = api;
})(typeof window !== 'undefined' ? window : globalThis);
