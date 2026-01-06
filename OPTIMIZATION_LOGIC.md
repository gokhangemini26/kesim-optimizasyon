# Kesim Ve Pastal Optimizasyon Mantığı

Bu belge, sistemin kesim planlarını nasıl oluşturduğunu, hangi kararları nasıl verdiğini ve "Scoring (Puanlama)" algoritmasının detaylarını açıklar.

## 🎯 Temel Hedefler

Motorun öncelik sıralaması şu şekildedir:
1.  **Derinlik (Efficiency):** Kesimleri olabildiğince yüksek katlı (80 kat) yapmaya çalışır.
2.  **Bütünlük (Stability):** Sonda 1-2 adetlik "çöp" kesimler bırakmamaya çalışır.
3.  **Çeşitlilik (Balance):** Mümkünse aynı renk grubundaki bedenleri birleştirir (4'lü, 3'lü kombinasyonlar).

---

## ⚙️ Algoritma Akışı

Sistem her renk için şu adımları izler:

### 1. Kumaş Seçimi (Deepest Pile First)
Sistem eldeki kumaş lotlarını **TOPLAM METRAJINA** göre büyükten küçüğe sıralar.
*   **Amaç:** En büyük kumaş toplarını en büyük işlerde kullanmak, küçük ve parçalı topları sona bırakmaktır.

### 2. Aday Oluşturma (Candidate Generation)
Sistem, o renkteki taleplere bakarak olası **Beden Kombinasyonlarını** üretir:
*   **Tekli (Single):** Sadece `[32/32]`
*   **İkili (Pair):** `[32/32, 29/32]` vb.
*   **Üçlü (Triple):** Tüm olası 3'lü kombinasyonlar.
*   **Dörtlü (Quad):** En çok talep edilen 4 bedenin kombinasyonları (veya sıralı gelen).

### 3. Reçete Uygulama (Pattern Recipes)
Her aday kombinasyon için standart bir "asorti reçetesi" uygulanır. Dinamik (rastgele) oranlar yerine bu kararlı yapılar kullanılır:

| Tip | İçerik | Oran (Ratio) | Açıklama |
| :--- | :--- | :--- | :--- |
| **SAME** | Tek Beden | **4x** | Marker'a aynı bedenden 4 tane koyar. |
| **PAIR** | İki Beden | **2+2** | Her bedenden 2'şer tane koyar. |
| **TRIPLE** | Üç Beden | **2+1+1** | En çok istenenden 2, diğerlerinden 1. |
| **QUAD** | Dört Beden | **1+1+1+1** | Her bedenden 1 tane koyar. |

### 4. Skorlama (Deep Scoring Formula)
Her aday için bir **BAŞARI PUANI** hesaplanır. En yüksek puanı alan aday seçilir.

**Formül:**
`FinalScore = Demand + Balance + Efficiency - Risk - Bottleneck`

#### Bileşenler:

*   **🟢 1. Demand Score (Talep Puanı):**
    *   Bu kesimle toplam kaç adet iş bitiyor?
    *   Formül: `Toplam Adet * 1.0`

*   **🟢 2. Balance Score (Denge Puanı):**
    *   Kaç çeşit beden birleştirildi?
    *   Formül: `Çeşit Sayısı * 50`
    *   *Not: Bu puan, derinliği bozmamak için düşük tutulmuştur.*

*   **🟢 3. Efficiency Score (Verim Puanı - KRİTİK):**
    *   80 kat hedefine ne kadar yaklaşıldı?
    *   Formül: `(Hedef Kat / 80) * 1000`
    *   *Etkisi: 80 katlık bir kesim +1000 puan, 40 katlık bir kesim +500 puan alır.*

*   **🔴 4. Risk Penalty (Gelecek Riski):**
    *   **Look-Ahead:** "Bu kesimi yaparsam geriye ne kalıyor?"
    *   Eğer geriye **15 adetten az** (ve >0) iş kalıyorsa: **-1000 Puan Ceza**.
    *   *Amaç: Sonda 3-5 tane tek başına kalan "yetim" parçalar bırakmamak.*

*   **🔴 5. Bottleneck Penalty (Sığ Kesim Cezası - YENİ):**
    *   Eğer kumaşım yetiyor ama sadece talep dengesizliği yüzünden **30 kattan az** atıyorsam: **-1500 Puan Ceza**.
    *   *Amaç: 20-25 katlık sığ işler yapmak yerine motoru başka kombinasyonlar bulmaya zorlamak.*

---

## 🛑 Kısıtlamalar (Constraints)

*   **Max Beden:** Bir kesimde en fazla **4 çeşit** beden olabilir.
*   **Max Kat:** Bir kesim en fazla **80 Kat** olabilir.
*   **Soft Cap:** Motor genelde **65 Kat** civarını hedefler ama işi bitirmek veya verimi artırmak için 80'e kadar çıkar.
*   **Tolerans:** Kumaş çekme toleransları (`%0-5`, `%5-10` vb.) baştan gruplanır ve asla birbirine karıştırılmaz.

---

## Örnek Senaryo

**Talep:** 100 Adet `32/32`, 20 Adet `29/32`.
**Kumaş:** Bolca var.

1.  **Aday 1 (Quad):** `29` ve `32`'yi birleştir.
    *   Oran: 1+1 (Ratio)
    *   Kat: `29` beden en fazla 20 tane var. Yani Max 20 Kat atabilirim.
    *   Efficiency Score: (20/80)*1000 = **250 Puan**.
    *   Bottleneck Penalty: Kumaş var ama 20 kat atıyorum (<30). **-1500 Ceza**.
    *   **Sonuç:** Puan çok düşük. Seçilmez.

2.  **Aday 2 (Same - Deep):** Sadece `32/32`.
    *   Oran: 4x.
    *   Kat: 100 adet / 4 = 25 Kat (Eğer 4'lü asorti yaparsam).
    *   Veya 1x asorti ile 80 Kat.
    *   Sistem burada `32/32` için derin bir kesim planlar.
    *   Efficiency Score: (80/80)*1000 = **1000 Puan**.
    *   **Sonuç:** KAZANAN. Önce 32'leri bitirir, 29'lar sona kalır veya başka bir grupla birleşir.
