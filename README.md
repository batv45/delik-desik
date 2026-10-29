# Delik Deşik 🕳️

Tarayıcıda oynanan, hole.io tarzı bir **mahalle yutma** oyunu. Deliğini sür, insanları, kedileri, arabaları, ağaçları ve binaları yutarak büyü; mahallenin en büyük deliği ol!

Tüm 3D modeller ve sesler kodla üretilir — dışarıdan hiçbir model, doku ya da ses dosyası kullanılmaz.

## Özellikler

- **Mahalle teması:** apartmanlar, kiremit çatılı evler, simitçi arabaları, çay masaları, sarı dolmuşlar, otobüsler, meydanda saat kulesi
- **Kaçan canlılar:** insanlar ve kediler yaklaşan delikten kaçar
- **Altın nesneler:** 5 kat puan
- **Kombo:** art arda hızlı yutunca puan çarpanı artar
- **Güç kristalleri:** 🧲 Mıknatıs · ⚡ Turbo · 🌀 Dev Delik
- **Rakip botlar:** küçükleri kovalar, büyüklerden kaçar; senden küçük delikleri sen de yutabilirsin
- **Ayarlar:** rakip sayısı (kapalı / 3 / 6), zorluk (kolay / normal / zor), süre (2 dk / 5 dk / süresiz)
- **Süresiz mod:** yutulan binalar ve ağaçlar zamanla yeniden çıkar
- Önüne geçen binalar saydamlaşır, mini harita, sıralama tablosu, mobil dokunmatik kontrol

## Çalıştırma

Node.js gerekir (ek paket kurulumu yok):

```bash
npm start
# http://localhost:8091
```

Farklı port için: `PORT=3000 npm start`

Herhangi bir statik sunucu da olur (ör. `python3 -m http.server`); dosyaları doğrudan `file://` ile açmak ES modülleri yüzünden çalışmaz.

## Kontroller

| | |
|---|---|
| Fare | Deliği imleç yönüne sürer |
| WASD / ok tuşları | Klavyeyle sürme |
| Dokunmatik | Ekranda parmakla sürükle (sanal joystick) |
| M | Sesi aç/kapat |

## Proje yapısı

```
index.html        Arayüz (menü, HUD, stiller)
src/main.js       Oyun motoru: delik, yutma, botlar, kamera, HUD
src/models.js     Kodla üretilen low-poly 3D modeller
src/world.js      Harita üretimi ve zemin dokusu
src/audio.js      WebAudio ile üretilen ses efektleri
server.js         Basit statik sunucu
vendor/           Three.js r170
```

## Yol haritası

- [ ] Çok oyunculu mod (WebSocket sunucusu)

## Lisans

[MIT](LICENSE). Three.js kendi MIT lisansıyla dağıtılır.
