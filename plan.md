# AREV uygulama planı

## Kapsam

AREV, mevcut Nashi uygulamasındaki yalnızca açık web bağlantısından medya bulma, kaynaktaki gerçek kalite/format seçeneklerini gösterme ve seçilen dosyayı cihaza indirme akışını mobil uygulamaya taşır. Bağlantı uygulamaya yapıştırılabilir veya Android/iOS paylaşım menüsünden gönderilebilir. AREV; oturum, DRM, canlı/yaklaşan ve özel içerikleri indirmeyi vaat etmez.

## Uygulama yaklaşımı

Mobil istemci Expo Router / React Native / TypeScript starter’ı üzerinde kalır. İstemci `x-arev-client` ile kurulum bazlı bir anahtar gönderir. Express API, URL sözdizimini ve SSRF riskini doğrular; Python worker doğrudan dosya medya türlerini ve desteklenen açık web kaynaklarını inceler. Worker gerçek kaynak formatlarını döndürür; sunucu kalite seçeneklerini uydurmaz. İndirme işleri sahiplik anahtarına bağlanır, geçici olarak kuyruklanır, en fazla iki eşzamanlı iş çalıştırır, ilerleme sağlar ve tamamlanan dosyayı aralık destekli güvenli bir endpoint’ten sunar. Native istemci dosyayı AREV klasörüne kaydeder; fotoğraf/video için isteğe bağlı AREV galerisi ve dosya paylaşımı sunar. Web, gerçek tarayıcı indirmesini başlatır.

Sunucu tarafında maksimum dosya boyutu 512 MB, süre 30 dakika ve geçici iş ömrü 30 dakikadır. DNS cevapları public IP ile sınırlandırılır, özel ağ/loopback/link-local/multicast/credential/non-standard port erişimi reddedilir. Cookie, tarayıcı oturumu veya koruma aşma kullanılmaz.

## Proje yapısı

- `app/(tabs)/index.tsx`: Türkçe linkten dosyaya ana ekranı; paste, gerçek format seçimi, ilerleme ve iptal.
- `app/(tabs)/files.tsx`: başarılı indirme geçmişi, yerel dosya paylaşımı ve fotoğraf/video galerisine kaydetme.
- `app/(tabs)/settings.tsx`: native HTTPS API adresi, bağlantı testi, kapsam ve gizlilik açıklaması.
- `app/+native-intent.ts`: Expo paylaşım payload’larını ana sekmeye yönlendirme.
- `components/arev/`, `hooks/arev/`, `lib/media/`: marka bileşenleri, akış durumu, istemci ve cihaz dosya işlemleri.
- `server/media/`: güvenlik, Express route’ları, Python worker köprüsü ve medya worker’ı.
- `shared/media.ts`: istemci/sunucu medya ve indirme sözleşmesi.
- `assets/images/`: yüzlü avokado launcher/splash/favicon ve Android adaptive icon kaynakları.

## Tasarım sistemi

AREV, açık web medyasını sakin bir dosya aracına dönüştüren **editorial utilitarian** hareketini izler. Alternatif yönler: neşeli meyve karakteri (0.08), koyu geliştirici konsolu (0.06), minimal açık medya arşivi (0.06). Seçilen yön editorial utilitarian’dır.

- **İlkeler:** tek elle kullanılabilen dikey akış; kaynak verisine sadakat; büyük tipografiyle hızlı karar; durum ve sınırları açıkça söyleme.
- **Renk felsefesi:** sıcak krem yüzey güvenli ve hafif bir zemin; orman yeşili markanın güvenilirliğini; avokado lime eylemi; kakao ikincil uyarı/etiket tonunu taşır.
- **Yerleşim:** merkezi dashboard yerine üstten aşağı editoryal akış; önce kısa marka/başlık, sonra link alanı, sonra yalnızca inceleme sonrası ortaya çıkan format kartı.
- **İmza öğeleri:** yüzlü avokado launcher, lime eylem düğmesi, küçük “özel akış” ve public medya notu.
- **Etkileşim:** gerçek iş başlamadan kalite veya indirme sonucu gösterilmez; inceleme/aktarım/iptal/hata durumları ayrı ve Türkçe görünür.
- **Animasyon:** mevcut Expo düğme basış ölçeği/opaklık geri bildirimi ve ölçülü native activity göstergesi; dikkat dağıtan sürekli hareket yok.
- **Tipografi:** sistem sans-serif; 39px koyu başlık, 16px eylem, 12px yardımcı metin; başlık ve CTA ağırlığıyla hiyerarşi.
- **Marka özü:** “Bir linki, kaynağına sadık bir dosyaya dönüştüren küçük mobil araç.” Kişilik: sakin, dürüst, pratik.
- **Ses:** başlıklar kısa ve doğrudan; CTA’lar fiil odaklı. Örnek: “Bağlantıyı incele”, “Cihaza aktarılıyor”.
- **Logo/simge:** yeşil avokado gövdesi, yüz ve çekirdek; küçük launcher boyutunda tanınacak yüksek kontrastlı kare kaynak.
- **İmza renk:** `#C6E884` lime; yalnızca ana eylemi ve başarılı akışı işaretler.

## Teslim notu

Manus Mobile canonical deposu Manus yönetiminde kalır. Kullanıcının onayıyla ayrı, özel GitHub deposu kaynak kodu yedeği olarak oluşturulabilir. Android APK/AAB ve native paylaşım menüsü desteği Dashboard native build üzerinden üretilir; Web/Expo Go önizlemesi native paylaşım veya cihaz dosya izinlerini kanıtlamaz.
