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
- **Online mod:** gerçek oyuncularla aynı mahallede 3 dakikalık turlar; boş yerleri botlar doldurur (oda başına 10 oyuncu)

## Çalıştırma

Node.js 18+ gerekir:

```bash
npm install
npm start
# http://localhost:8091
```

Ortam değişkenleri: `PORT` (varsayılan 8091), `ROUND_TIME` (online tur süresi, sn, varsayılan 180).

Online mod `/ws` adresinde WebSocket kullanır. Önde Nginx gibi bir ters vekil varsa WebSocket yükseltmesine izin verilmeli:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Oyun durumu sunucu belleğinde tutulduğu için uygulama **tek süreç** çalışmalı (PM2'de `instances: 1`, cluster modu değil).

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
src/sim.js        Oyun mantığı (delik, yutma, botlar) — tarayıcıda ve sunucuda aynı kod
src/main.js       Çizim, kamera, HUD, menü ve oyun akışı
src/net.js        Online mod istemcisi
src/models.js     Kodla üretilen low-poly 3D modeller
src/world.js      Harita üretimi ve zemin dokusu
src/audio.js      WebAudio ile üretilen ses efektleri
server.js         Web sunucusu (dosyalar + /api/stats)
game-server.mjs   Online oyun sunucusu: odalar, turlar, botlar (WebSocket)
vendor/           Three.js r170
```

## Yol haritası

- [x] Çok oyunculu mod (WebSocket sunucusu)
- [ ] Arkadaşla özel oda (davet kodu)

## Lisans

[MIT](LICENSE). Three.js kendi MIT lisansıyla dağıtılır.
