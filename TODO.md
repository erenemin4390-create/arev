# AREV — Yapılacaklar

- [ ] **AREV mobil kimliği:** Uygulama adı AREV; simgesi yüzü olan bir avokado. Aynı kimlik uygulama simgesi, açılış ekranı ve favicon’da kullanılacak; mevcut Expo kimlikleri korunacak.
- [ ] **Bağlantı alma:** Mobil paylaşım menüsünden AREV’e gönderilen bağlantıları doğrudan kabul etme; uygulama içindeki alana web bağlantısı yapıştırma ve bağlantıyı doğrulama.
- [ ] **Medya bulma:** Bağlantıdaki indirilebilir medya içeriğini bulma ve temel bilgileriyle önizleme. Geçersiz bağlantı, desteklenmeyen kaynak, bulunamayan medya ve indirme hataları için anlaşılır Türkçe geri bildirim. Oturum gerektiren, canlı ve DRM korumalı içerik reddedilir.
- [ ] **Kalite/format seçimi:** Kaynakta birden fazla seçenek varsa medya kalitesi ve formatını seçme; var olmayan kalite/format seçenekleri gösterilmez.
- [ ] **Gerçek indirme:** Seçilen medya dosyasını ilerleme ve durum bilgisiyle telefona indirme; hazırlama, indirme, tamamlanma, iptal ve hata durumlarını gösterme.
- [ ] **Cihaz dosyaları:** İndirilen dosyayı cihazın uygun medya veya indirmeler klasörüne kaydetme ve tamamlandığında açma/paylaşma. Yerel indirme geçmişini saklama; ön plandaki indirme sınırını açıklama.
- [ ] **GitHub ve paket teslimi:** Kaynak kodunu GitHub’da yayımlama ve GitHub Releases üzerinden indirilebilir mobil kurulum paketi sağlama. Manus Mobile canonical deposu Manus yönetiminde kalmak zorundadır; ayrı GitHub kaynak kopyası ancak etkin GitHub bağlantısı ve doğrulanmış yetki ile oluşturulabilir. APK/AAB/iOS derlemesi Sandbox’tan çalıştırılmaz; Dashboard native build sonucu olmadan kurulum paketi varmış gibi teslim edilmez.
- [ ] **Bağlı parça incelemesi:** Tamamlanan uygulamada istemci, sunucu, simge, paylaşım yapılandırması, dosya kaydı ve yayın ayarlarını bir salt-okunur inceleme ajanıyla kontrol etme; doğrulanan kusurları düzeltme.
