# Kesim ve Pastal Optimizasyon Mantığı

Bu belge asorti motorunun (`src/utils/asorti/`) nasıl plan ürettiğini, eski motorun
neden insan planlamacının gerisinde kaldığını ve yeni motorun ölçülen sonuçlarını anlatır.

## Problem

- **Sipariş:** renk × beden adetleri.
- **Kumaş:** toplar; her topun bir **lotu** ve bir **çekmesi** (kalıbı) var.
- **Kesim (pastal):** tek bir çekmede serilir; bir **pastal oranı** (ör. `3×33 + 3×34`)
  ve lot bazında **kat sayıları** (ör. `TEMİZ:28 LOT1:37 LOT2:15`) vardır.
- Bir renk yalnızca tahsis edildiği lot(lar)dan kesilir.

Kısıtlar: kesim başına en fazla 80 kat, pastalda en fazla 6 parça ve
`maxSizesPerMarker` (varsayılan 2) farklı beden, lot×çekme havuzunun metrajı aşılamaz,
toplam eksik ≤ %0,7, toplam fazla ≤ %2.

Amaç: **en az kesimle** siparişi tolerans içinde karşılamak.

## Eski motor neden insanın yaptığını yapamıyordu?

Eski motor (`markers.js` + `remainders.js`, hâlâ `runAsortiSearchLegacy` olarak duruyor)
şöyle çalışıyordu: her bedeni **tek başına** bir kolona koy (`m × beden`), sonra kat
sayıları neredeyse aynı çıkan kolonları ikişer ikişer birleştir; bunu rastgele
tohumlarla yüzlerce kez tekrarla.

1. **Pastal oranı ve kat birlikte seçilmiyor.** İnsan `3×33 + 3×34 → 80 kat` derken oranı
   ve katı aynı anda, iki bedenin lot bazındaki talebine bakarak belirler. Eski motor önce
   her bedenin katını tek başına sabitliyor, birleştirmeyi ancak iki kolonun lot bazındaki
   katları tesadüfen örtüşürse (en çok 4–12 adet fazla ile) yapabiliyordu. Sonuç: CLIFTON
   dosyasında 35 kesimin 30'u tek bedenli, kat başına ortalama **1,6 adet** (yeni motorda 4,5).
2. **Bir bedenin talebi kesimler arasında bilinçli bölünmüyor.** İnsan 34 bedenin bir
   kısmını `3×33+3×34`, kalanını `2×32+1×34` içinde eritir. Eski motor bedeni tek kolonda
   bitirmeye çalışır, artanı "kalan" kuyruğuna atar; kuyruk da küçük, sığ kesimlere dönüşür.
3. **Yerel iyileştirme yok.** Arama, aynı açgözlü kurucunun rastgele yeniden
   başlatılmasıydı; bulunan planı "şu iki kesimi söküp tek kesimde toplayabilir miyim"
   diye sorgulayan bir adım yoktu.
4. **Çekme havuzları açgözlü tüketiliyor.** Her kolon o an en çok adedi karşılayan çekmeyi
   alıyor; sona doğru havuzlar parçalanıp küçük kesimlere ve eksiğe yol açıyordu.
5. **Oto tahsis bölünmüş renkte tek bir kural deniyordu** (en büyük lottan başla). İnsan
   büyük renge lotları en az sayıda lotla, en iyi sığacak şekilde verir.
6. **Renk dağıtımı hatası.** Çok lotlu bir renk, aynı lotu paylaşan tek lotlu rengin
   payını alabiliyor; lot bazında dengeli plan renk bazında eksik/fazla görünüyordu.

## Yeni motor

`optimizer.js` problemi doğrudan modeller:

```
kesim k   = (çekme c_k, oran r_k[beden], kat L_k[lot])
üretim    P[lot][beden] = Σ_k L_k[lot] · r_k[beden]
maliyet   = 1000·kesim + 8·eksik + 5·fazla + (tolerans aşımına sert ceza)
```

Üç yapı taşı:

| Adım | Ne yapar |
|---|---|
| **bestCut** | Kalan talebe göre "en çok işi bitiren" tek kesimi bulur. Tüm oran desenleri (≤6 parça, ≤N beden) × tüm çekmeler taranır; her lot için en iyi kat, bedenlerin "tam bitirme" noktalarından seçilir; 80 kat bütçesi en verimli lotlara dağıtılır. |
| **polish** | İnce ayar: bir lot bloğunun katı ±1, orandaki bir beden ±1 / yeni beden, aynı lotun katını bir kesimden diğerine taşıma. Yalnızca maliyeti düşüren hamleler kalır. |
| **LNS** | 1–4 kesimi söker, bir eksiğiyle yeniden kurmayı dener (bestCut + polish). Tutarsa kesim sayısı düşer; tutmazsa aynı sayıda daha iyi bir dizilim aranır. |

`runAsortiSearch` akışı:

1. Eski motor kısa çalıştırılır; sonucu başlangıç çözümü ve emniyet ağıdır
   (yeni sonuç daha iyi değilse eskisi döner).
2. Renk→lot **tahsis adayları** üretilir (`proposeAllocation`: en az lotla, en iyi sığan
   lot kümesi; rastgele çeşitlemeler). Kısa ön elemeden sonra en iyi iki aday tam aranır.
   Kullanıcı tahsisi verdiyse (`allocationOverride`) yalnızca o kullanılır.
3. Seçilen kesimler toplara atanır, adetler renklere **maksimum akışla** dağıtılır.

Aynı tohum her zaman aynı planı verir (zaman bütçesi değil, iterasyon sayısı kullanılır).

### Parametreler (`engineParams`)

| Parametre | Varsayılan | Anlamı |
|---|---:|---|
| `maxLayers` | 80 | Kesim başına en fazla kat |
| `maxPiecesPerMarker` | 6 | Pastaldaki en fazla parça |
| `maxSizesPerMarker` | 2 | Pastaldaki en fazla farklı beden |
| `undercutFreeRatio` | 0.007 | İzin verilen toplam eksik oranı. `0` → "sıfır eksik" modu |
| `overcutFreeRatio` | 0.02 | İzin verilen toplam fazla oranı |

## Ölçülen sonuçlar

Tüm sayılar `test/validate.mjs` ile motordan bağımsız yeniden hesaplanmıştır.

### Gerçek kesim dosyaları (`npm run benchmark`)

Kesim sayısı (parantez içinde fazla/eksik adet):

| Dosya | İnsan | Eski · insan tahsisi | Yeni · insan tahsisi | Yeni · oto tahsis | Yeni · oto · sıfır eksik |
|---|---:|---:|---:|---:|---:|
| 1SA100 40687 (2055 ad.) | 12 (+15) | 13 (+22/−11) | 9 (+16/−4) | 9 (+23/−11) | 11 (+22/−0) |
| 11S188 90936 (704 ad.) | 11 (+10) | 11 (+7/−9) ⚠ | 8 (+6/−11) ⚠ | 7 (+14/−4) | 10 (+10/−0) |
| 18S100 9664C (1997 ad.) | 23 (+26) | 20 (+32/−5) | 15 (+31/−13) | 14 (+36/−13) | 18 (+36/−0) |
| 18S100 9809A (484 ad.) | 7 (+5) | 5 (+8/−0) | 5 (+4/−1) | 5 (+4/−1) | 5 (+7/−0) |
| C31300-30Q CLIFTON (2082 ad.) | 31 (+14) | 35 (+27/−9) | 23 (+27/−14) | 19 (+34/−14) | 24 (+30/−4) |
| **Toplam kesim** | **84** | **84** | **60 (−%29)** | **54 (−%36)** | **68 (−%19)** |
| Toplam serilen kat | – | 3544 | 1909 | 1827 | 2195 |

⚠ 11S188'de insan tahsisiyle LOT1'in kumaşı (745,5 m), kendisine tahsis edilen 547 adedin
1,38 m/adet ile ihtiyacından (754,9 m) az; bu tahsiste %0,7 eksik sınırı hiçbir planla
tutulamaz. Oto tahsis sorunu çözer.

CLIFTON'da "sıfır eksik" modunda kalan 4 adet, ilgili lotların kumaşı bittiği içindir.

### Rastgele senaryolar (`npm run simulate -- 40 1`)

40 senaryo, toplam 78 221 adet; 3–16 renk, 7–12 beden, 1–8 lot, 1–3 çekme, kumaş payı %5–15.

| Motor | Toplam kesim | Toplam kat | Fazla | Eksik | Tüm kriterleri tutan | Ort. süre |
|---|---:|---:|---:|---:|---:|---:|
| Eski | 481 | 24 410 | %1,14 | %0,44 | 35/40 | 1,5 sn |
| Yeni | 361 | 18 573 | %0,90 | %0,40 | 40/40 | 1,1 sn |

Kesim sayısı %24,9, serilen kat %23,9 azaldı. Yeni motor 34 senaryoda daha iyi,
6'sında eşit, hiçbirinde daha kötü değil. İki motorda da fiziksel ihlal (kat, parça,
metraj, tahsis dışı lot) yok.

## Bilinen sınırlar

- Kumaş kontrolü lot×çekme **havuzu** düzeyindedir; top sonu firesi ayrıca modellenmez
  (birim tüketim değerinin bunu içerdiği varsayılır). Eski motorda da böyleydi.
- Kumaşın parçalı olduğu dosyalarda (CLIFTON) birkaç kesim 1–4 kat kalabiliyor.
- İnsan planlarının yalnızca kesim sayısı ve toplam adedi elimizde; kesim kesim
  yerleşimleri fixture'larda yok.

## Çalıştırma

```
npm test                    # golden + gerçek dosya + regresyon testleri
npm run benchmark           # insan / eski / yeni karşılaştırması  (--detay: kesim listesi)
npm run simulate -- 40 1    # rastgele senaryolar (adet, tohum)
```
