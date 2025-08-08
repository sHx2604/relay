# Smart Relay Controller

Aplikasi web untuk mengontrol relay 8 channel secara remote menggunakan protokol MQTT. Dilengkapi dengan fitur timer dan monitoring real-time status relay.

## 🚀 Fitur

- **Kontrol Relay**: ON/OFF untuk 8 channel relay secara individual
- **Timer Management**: Set timer otomatis untuk setiap relay
- **Real-time Monitoring**: Status relay dan timer yang update secara real-time
- **MQTT Integration**: Komunikasi dengan perangkat IoT menggunakan protokol MQTT
- **Responsive Design**: Interface yang responsif untuk desktop dan mobile
- **Connection Status**: Monitor status koneksi Internet, MQTT, dan Device
- **Settings Panel**: Konfigurasi MQTT broker dan kredensial
- **Notification System**: Notifikasi real-time untuk setiap aksi

## 🛠️ Teknologi yang Digunakan

### Backend
- **Node.js** - Runtime JavaScript
- **Express.js** - Web framework
- **MQTT.js** - Client MQTT untuk komunikasi IoT
- **WebSocket** - Real-time communication (localhost)
- **Netlify Functions** - Serverless functions untuk deployment

### Frontend
- **HTML5** - Struktur halaman
- **CSS3** - Styling dan animations
- **Vanilla JavaScript** - Logic frontend
- **Font Awesome** - Icons
- **Responsive Design** - Mobile-friendly interface

### Deployment
- **Netlify** - Hosting dan serverless functions
- **HiveMQ Cloud** - MQTT broker cloud

## 📁 Struktur Project

```
smart-relay-controller/
├── public/                 # Frontend files
│   ├── index.html         # Main HTML file
│   ├── style.css          # Stylesheet
│   ├── script.js          # JavaScript untuk localhost
│   ├── script-netlify.js  # JavaScript untuk Netlify
│   └── tester.html        # Testing page
├── functions/             # Netlify Functions
│   └── server.js          # Serverless API handler
├── server.js              # Express server untuk localhost
├── package.json           # Dependencies dan scripts
├── netlify.toml          # Konfigurasi Netlify
├── .env                  # Environment variables
└── README.md             # Dokumentasi
```

## 💻 Instalasi Lokal

### Prasyarat
- Node.js (versi 14 atau lebih baru)
- npm atau yarn
- Akses ke MQTT broker

### Langkah Instalasi

1. **Clone atau ekstrak project**
   ```bash
   # Jika dari zip file, ekstrak terlebih dahulu
   unzip relay.zip
   cd smart-relay-controller
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment Variables**
   ```bash
   # Buat file .env atau edit yang sudah ada
   MQTT_BROKER=mqtts://4bbdfa736ca64112bb38a14789942a8a.s1.eu.hivemq.cloud
   MQTT_PORT=8883
   MQTT_USER=pepeq123
   MQTT_PASS=123098@Qwe
   PORT=3000
   ```

4. **Jalankan Server**
   ```bash
   npm start
   ```

5. **Akses Aplikasi**
   Buka browser dan kunjungi: `http://localhost:3000`

## 🌐 Deployment ke Netlify

### Metode 1: Drag & Drop (Paling Mudah)

1. **Siapkan Project**
   - Pastikan semua file sudah siap di folder project
   - File `netlify.toml` sudah dikonfigurasi dengan benar

2. **Login ke Netlify**
   - Kunjungi [netlify.com](https://netlify.com)
   - Login atau buat akun baru

3. **Deploy Project**
   - Drag & drop folder project ke area deploy di Netlify dashboard
   - Tunggu proses build selesai

### Metode 2: Git Repository

1. **Push ke Git Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Connect Repository di Netlify**
   - Login ke Netlify dashboard
   - Klik "New site from Git"
   - Pilih provider Git (GitHub, GitLab, Bitbucket)
   - Pilih repository
   - Konfigurasi build settings:
     - Build command: `npm install`
     - Publish directory: `public`
     - Functions directory: `functions`

3. **Deploy**
   - Klik "Deploy site"
   - Tunggu proses deployment selesai

### Konfigurasi Environment Variables di Netlify

1. **Akses Site Settings**
   - Buka dashboard Netlify
   - Pilih site yang sudah di-deploy
   - Klik "Site settings"

2. **Tambahkan Environment Variables**
   - Klik "Environment variables" di sidebar
   - Tambahkan variabel berikut:
     ```
     MQTT_BROKER = mqtts://4bbdfa736ca64112bb38a14789942a8a.s1.eu.hivemq.cloud
     MQTT_PORT = 8883
     MQTT_USER = pepeq123
     MQTT_PASS = 123098@Qwe
     ```

3. **Redeploy**
   - Klik "Deploys" tab
   - Klik "Trigger deploy" → "Deploy site"

## 🔧 Konfigurasi MQTT

### Broker Settings
- **Broker**: HiveMQ Cloud (atau broker MQTT lainnya)
- **Protocol**: MQTT over SSL (mqtts://)
- **Port**: 8883
- **Authentication**: Username & Password

### Topics MQTT
- **Command Topic**: `home/relays/command`
  ```json
  {
    "relay": 1,
    "action": "on"
  }
  ```

- **Status Topic**: `home/relays/status`
  ```json
  {
    "states": ["off", "on", "off", "off", "off", "off", "off", "off"]
  }
  ```

- **Timer Topic**: `home/timer/set`
  ```json
  {
    "id": "timer_1_1234567890",
    "relayId": 1,
    "duration": 60,
    "endTime": 1234567950000
  }
  ```

## 📡 API Endpoints

### POST `/api/relay/:relayId/:action`
Mengontrol relay ON/OFF
- **Parameters**:
  - `relayId`: 1-8
  - `action`: "on" atau "off"

### POST `/api/timer`
Set timer untuk relay
- **Body**:
  ```json
  {
    "relayId": 1,
    "duration": 60
  }
  ```

### GET `/api/status`
Mendapatkan status semua relay dan timer aktif

### GET `/api/health`
Health check endpoint

## 🔍 Troubleshooting

### Masalah Umum

#### 1. MQTT Tidak Terhubung di Netlify
**Penyebab**: Netlify Functions tidak support persistent connections
**Solusi**:
- Aplikasi sudah dikonfigurasi untuk menggunakan one-time MQTT connections di Netlify
- Pastikan environment variables sudah di-set dengan benar di Netlify

#### 2. Relay Tidak Merespon
**Kemungkinan Penyebab**:
- Device IoT tidak terhubung ke MQTT broker
- Topic MQTT salah
- Kredensial MQTT tidak valid

**Solusi**:
- Cek koneksi device ke MQTT broker
- Verifikasi konfigurasi MQTT di Settings
- Test dengan MQTT client (MQTT Explorer, mqttx)

#### 3. Timer Tidak Berfungsi
**Penyebab**: Timer management berbeda antara localhost dan Netlify
**Solusi**:
- Di localhost: Timer dijalankan di server
- Di Netlify: Timer dikirim ke device untuk diproses

#### 4. Real-time Updates Tidak Berfungsi
**Penyebab**: WebSocket tidak tersedia di Netlify
**Solusi**:
- Aplikasi menggunakan HTTP polling untuk Netlify
- Update setiap 2 detik secara otomatis

### Debug Mode

Untuk debugging, buka Developer Tools di browser dan monitor:
- Console logs untuk error messages
- Network tab untuk melihat API calls
- Application tab untuk melihat localStorage

## 🔐 Keamanan

- Gunakan MQTT over SSL (mqtts://)
- Simpan kredensial MQTT di environment variables
- Jangan commit file `.env` ke repository
- Gunakan strong password untuk MQTT broker

## 📱 Penggunaan

1. **Dashboard Utama**
   - Lihat status 8 relay dalam grid layout
   - Setiap relay menampilkan nama, status (ON/OFF), dan timer aktif

2. **Kontrol Relay**
   - Klik tombol ON/OFF untuk mengubah status relay
   - Status akan update secara real-time

3. **Set Timer**
   - Klik tombol "Timer" pada relay yang diinginkan
   - Masukkan durasi dalam detik
   - Timer akan mulai berjalan dan menampilkan countdown

4. **Monitor Status**
   - Cek status koneksi di header (Internet, MQTT, Device)
   - Green = Connected, Red = Disconnected

5. **Settings**
   - Klik ikon gear untuk membuka panel settings
   - Konfigurasi MQTT broker, port, username, password
   - Klik "Save Settings" untuk menyimpan

## 🤝 Support

Jika mengalami masalah:
1. Cek troubleshooting guide di atas
2. Verifikasi konfigurasi MQTT
3. Test koneksi dengan MQTT client tools
4. Cek logs di browser console (F12)

## 📄 Lisensi

Project ini dibuat untuk keperluan kontrol IoT relay system. Silakan dimodifikasi sesuai kebutuhan.

---

**Happy Controlling! 🎛️**
