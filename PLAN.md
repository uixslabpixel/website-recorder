# Plan: Website Screen Recorder untuk Preview Dribbble

Web app untuk merekam interaksi di sebuah website, lalu membungkus rekamannya dengan background dan mengekspornya sebagai video rasio Dribbble.

## Keputusan yang sudah diambil

| Topik | Keputusan |
|---|---|
| Cara capture | Tab capture: website dibuka di popup, direkam via Screen Capture API |
| Scope | Tool pribadi/internal: tanpa login, tanpa backend, tanpa cloud storage |
| Output | MP4 (H.264), 1600×1200, 60fps; ukuran canvas bisa diubah |
| Custom cursor + visualisasi click | P2 |
| Compress ke resolusi lebih kecil | P2 |
| Browser yang didukung | Chrome/Edge desktop |

## Arsitektur

Semua jalan di browser dan bisa di-host sebagai static site.

- **Stack:** Vite + React + TypeScript, state di Zustand, preview dan render di Canvas 2D.
- **Capture:** `window.open` (popup seukuran viewport) + `getDisplayMedia` + `MediaRecorder`.
- **Render:** rekaman di-decode, di-composite per frame ke canvas, di-encode ke H.264 dengan WebCodecs, lalu di-mux ke MP4 (Mediabunny atau mp4-muxer).
- **Penyimpanan:** rekaman dan asset background disimpan lokal di IndexedDB/OPFS supaya tidak hilang saat refresh.

## User flow

### 1. Setup
- Input URL (divalidasi).
- Viewport, default 1680×900.
- Durasi rekam, default 5 detik.

### 2. Record
- User klik Record.
- App membuka popup seukuran viewport berisi website tujuan.
- Browser menampilkan dialog izin; user memilih tab popup tersebut.
- Countdown 3-2-1 tampil di app, lalu fokus pindah ke popup dan rekaman dimulai.

### 3. Interact
- User berinteraksi dengan website di popup.
- Rekaman berhenti otomatis saat durasi habis.
- Popup ditutup, user kembali ke editor.

### 4. Editor
- Canvas rasio Dribbble (default 1600×1200, bisa diubah).
- Background: warna solid, gradient, atau gambar upload.
- Rekaman: skala, posisi, corner radius, shadow.
- Gambar pendukung sebagai layer tambahan (posisi, skala, urutan).

### 5. Trim dan opsi
- Timeline dengan handle awal/akhir; hanya menyimpan in/out point, file asli tidak dipotong.
- Toggle include/hide cursor (lihat Batasan).
- P2: custom cursor, visualisasi click.

### 6. Render dan export
- Render dengan progress bar.
- Export "raw": MP4 resolusi penuh, bitrate tinggi.
- P2: compress ke resolusi lebih kecil, export GIF.

## Milestone

1. **Spike capture** (paling berisiko, dikerjakan pertama): popup + izin + rekam 5 detik + putar ulang hasilnya. Sekaligus menguji opsi hide cursor dan perilaku fokus.
2. **Editor:** canvas, background, transform rekaman, layer gambar.
3. **Trim + render MP4.**
4. **Polish:** simpan project lokal, preset canvas, error state (izin ditolak, popup diblokir, viewport melebihi layar).
5. **P2:** compress, GIF, custom cursor + visualisasi click.

## Status

Milestone 1–4 sudah diimplementasikan, plus bagian "compress" dari P2 (pilihan ukuran export 75/50/25% dan bitrate). GIF dan custom cursor + visualisasi click belum.

Temuan spike capture (Chromium, diuji otomatis lewat Playwright):

- Popup + tab capture + rekam + render MP4 berjalan end-to-end; tab terekam pada ukuran aslinya (viewport × device pixel ratio).
- Constraint `width`/`height` di `getDisplayMedia` membuat Chrome mengubah skala hasil capture, jadi tidak dipakai.
- Opsi hide cursor (`cursor: 'never'`) **tidak dihormati** Chromium untuk tab capture: track melaporkan `cursor: 'motion'`. Toggle tetap ada, dan app memberi peringatan kalau permintaannya diabaikan.
- Flow dibuat dua langkah (Open website, lalu Record) karena popup yang baru dibuka mengambil fokus dan menutupi dialog pilih tab. Ini juga memberi kesempatan menyiapkan halaman sebelum merekam.
- `setFocusBehavior('no-focus-change')` dipakai supaya app tetap di depan selama countdown; popup difokuskan saat rekaman mulai.

## Batasan

- **Izin tiap record:** dialog pilih tab dari browser selalu muncul dan tidak bisa dilewati.
- **Countdown:** popup berisi website orang lain, jadi 3-2-1 tidak bisa ditampilkan di dalamnya. Countdown tampil di app; trim menutupi sisa detik awal.
- **Viewport vs layar:** popup tidak bisa lebih besar dari layar user. 1680×900 tidak muat di laptop 1440px; viewport harus diturunkan di kasus itu.
- **Cursor di P1:** toggle include/hide bergantung pada opsi capture browser; dukungannya untuk tab capture harus dibuktikan di spike.
- **Cursor di P2:** custom cursor dan click butuh data posisi cursor, yang tidak tersedia dari tab capture. Perlu extension kecil pendamping.
- **Pilihan user di dialog:** kalau user memilih window atau screen (bukan tab), rekaman ikut memuat address bar. App perlu mendeteksi dan memberi peringatan.

## Pertanyaan terbuka

- Perlu audio dari tab atau video saja? Asumsi saat ini: video saja.
