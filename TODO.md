# AREV — Yapılacaklar

- [x] **AREV mobil kimliği:** Uygulama adı AREV; simgesi yüzü olan bir avokado. Aynı kimlik uygulama simgesi, açılış ekranı ve favicon’da kullanılacak; mevcut Expo kimlikleri korunacak.
- [x] **Bağlantı alma:** Mobil paylaşım menüsünden AREV’e gönderilen bağlantıları doğrudan kabul etme; uygulama içindeki alana web bağlantısı yapıştırma ve bağlantıyı doğrulama.
- [x] **Medya bulma:** Bağlantıdaki indirilebilir medya içeriğini bulma ve temel bilgileriyle önizleme. Geçersiz bağlantı, desteklenmeyen kaynak, bulunamayan medya ve indirme hataları için anlaşılır Türkçe geri bildirim. Oturum gerektiren, canlı ve DRM korumalı içerik reddedilir.
- [x] **Kalite/format seçimi:** Kaynakta birden fazla seçenek varsa medya kalitesi ve formatını seçme; var olmayan kalite/format seçenekleri gösterilmez.
- [x] **Gerçek indirme:** Seçilen medya dosyasını ilerleme ve durum bilgisiyle telefona indirme; hazırlama, indirme, tamamlanma, iptal ve hata durumlarını gösterme.
- [x] **Cihaz dosyaları:** İndirilen dosyayı cihazın uygun medya veya indirmeler klasörüne kaydetme ve tamamlandığında açma/paylaşma. Yerel indirme geçmişini saklama; ön plandaki indirme sınırını açıklama.
- [ ] **GitHub ve native paket teslimi:** Kaynak kodunu GitHub’da yayımlama ve GitHub Releases üzerinden indirilebilir mobil kurulum paketi sağlama. Manus Mobile canonical deposu Manus yönetiminde kalmak zorunda; ayrı GitHub kaynak kopyası oluşturuldu: https://github.com/erenemin4390-create/arev. APK/AAB/iOS derlemesi Sandbox’tan çalıştırılmaz; Dashboard native build sonucu ve gerçek indirme linki henüz bekleniyor.
- [x] **GitHub Pages PWA teslimi:** Önceki harita sitesindeki gibi GitHub Pages web çıktısı, manifest, service worker ve tarayıcı `beforeinstallprompt` olayını kullanan “AREV’yi yükle” butonu eklendi. GitHub Pages workflow’u `main` push’unda `/arev/` alt yoluna web çıktısını dağıtacak şekilde hazırlandı.
- [x] **Bağlı parça incelemesi:** Tamamlanan uygulama istemci, sunucu, simge, paylaşım yapılandırması, dosya kaydı ve yayın ayarlarını salt-okunur inceleme ajanıyla kontrol edildi; bulgulara göre PWA ve paket adı düzeltmeleri yapıldı.
