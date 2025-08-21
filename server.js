require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');

// Setup koneksi pool MySQL
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: 'supersecret123',
  resave: false,
  saveUninitialized: true
}));

// Fungsi pembentuk topic MQTT spesifik user
function getTopic(username, path) {
  return `${username}/${path}`;
}

// REGISTER API
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length > 0) return res.status(409).json({ error: 'Username sudah terdaftar' });
    const [insertResult] = await db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
    const userId = insertResult.insertId;
    // Otomatis isi 8 relay default, nama Relay 1 dst
    const relays = Array(8).fill(0).map((_,i)=>[userId, i, `Relay ${i+1}`, 'off']);
    await db.query('INSERT INTO relays (user_id, relay_index, name, status) VALUES ?',[relays]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
  try {
    const [rows] = await db.query('SELECT id, password FROM users WHERE username = ?', [username]);
    if (!rows.length || rows[0].password !== password) return res.status(401).json({ error: 'Username/password salah' });
    req.session.userId = rows[0].id;
    req.session.username = username;
    // Subscribe ke topic status user jika belum
    subscribeUserStatusTopic(username);
    res.json({ success: true, username });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware proteksi API
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Konfigurasi MQTT
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtts://4bbdfa736ca64112bb38a14789942a8a.s1.eu.hivemq.cloud';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const MQTT_USER = process.env.MQTT_USER || 'pepeq123';
const MQTT_PASS = process.env.MQTT_PASS || '123098@Qwe';

// Koneksi ke MQTT broker
const mqttOptions = {
  port: parseInt(MQTT_PORT),
  username: MQTT_USER,
  password: MQTT_PASS,
  clientId: `backend-server_${Math.random().toString(16).substr(2, 8)}`,
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000,
};

const mqttClient = mqtt.connect(MQTT_BROKER, mqttOptions);

// Set untuk tracking topic status yang sudah di-subscribe
const subscribedStatusTopics = new Set();

function subscribeUserStatusTopic(username) {
  const topic = getTopic(username, 'relays/status');
  if (!subscribedStatusTopics.has(topic)) {
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error('Failed to subscribe to', topic, err);
      } else {
        subscribedStatusTopics.add(topic);
        console.log('Successfully subscribed to', topic);
        // Request current status dari device user saat subscribe
        const requestTopic = getTopic(username, 'relays/request_status');
        mqttClient.publish(requestTopic, JSON.stringify({
          action: 'get_status'
        }));
      }
    });
  }
}

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  // Tidak subscribe ke topic global, subscribe per user saat login
});

mqttClient.on('error', (error) => {
  console.error('MQTT Connection Error:', error);
});

mqttClient.on('offline', () => {
  console.log('MQTT Client is offline');
});

mqttClient.on('reconnect', () => {
  console.log('MQTT Client reconnecting...');
});

mqttClient.on('message', async (topic, message) => {
  try {
    // Cek apakah topic adalah status milik user tertentu
    // Format: {username}/relays/status
    const match = topic.match(/^([^/]+)\/relays\/status$/);
    if (match) {
      const username = match[1];
      const data = JSON.parse(message.toString());
      if (Array.isArray(data.states)) {
        // Update relay states di DB untuk user ini
        // Ambil userId dari username
        const [userRows] = await db.query('SELECT id FROM users WHERE username=?', [username]);
        if (userRows.length) {
          const userId = userRows[0].id;
          const states = data.states;
          // Ambil semua relay milik user, update status sesuai index
          const [userRelays] = await db.query('SELECT id, relay_index FROM relays WHERE user_id=?', [userId]);
          for (const relay of userRelays) {
            const idx = relay.relay_index;
            if (typeof states[idx] === 'string') {
              await db.query('UPDATE relays SET status=? WHERE id=?', [states[idx], relay.id]);
            }
          }
          // Broadcast ke user terkait
          broadcastToUser(userId, await getUserStatus(userId));
        }
      }
    }
  } catch (error) {
    console.error('Error processing MQTT message:', error);
  }
});

// Fungsi untuk broadcast ke semua WebSocket clients sesuai user
function broadcastToUser(userId, message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.userId === userId) {
      client.send(JSON.stringify(message));
    }
  });
}

// Fungsi untuk mengambil status user (relays dan timers)
async function getUserStatus(userId) {
  const [relays] = await db.query('SELECT id, relay_index, name, status FROM relays WHERE user_id=? ORDER BY relay_index', [userId]);
  const [timers] = await db.query(
    `SELECT t.id, t.relay_id, t.duration, t.end_time, r.relay_index
     FROM timers t JOIN relays r ON t.relay_id = r.id
     WHERE t.user_id=?`, [userId]);
  return {
    type: 'status',
    relays,
    timers: timers.map(t => ({
      id: t.id,
      relayId: t.relay_index,
      duration: t.duration,
      remaining: Math.max(0, Math.floor((t.end_time - Date.now()) / 1000))
    }))
  };
}

// Broadcast ke semua user: update status dan timer
async function broadcastAllUsers() {
  // Ambil semua userId yang sedang terkoneksi
  const userIds = new Set();
  wss.clients.forEach(client => {
    if (client.userId) userIds.add(client.userId);
  });
  for (const userId of userIds) {
    broadcastToUser(userId, await getUserStatus(userId));
  }
}

// WebSocket server
wss.on('connection', async (ws, req) => {
  // Ambil session dari cookie
  let userId = null;
  ws.userId = null;

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'auth' && data.userId) {
        ws.userId = data.userId;
        // Ambil username dari userId
        const [userRows] = await db.query('SELECT username FROM users WHERE id=?', [ws.userId]);
        if (userRows.length) {
          const username = userRows[0].username;
          subscribeUserStatusTopic(username);
        }
        // Kirim data awal
        ws.send(JSON.stringify(await getUserStatus(ws.userId)));
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    // Nothing
  });
});

// Fungsi mendapatkan semua relay milik user (filter user)
app.get('/api/relays', requireLogin, async (req, res) => {
  try {
    const [relays] = await db.query('SELECT id, relay_index, name, status FROM relays WHERE user_id=? ORDER BY relay_index', [req.session.userId]);
    res.json(relays);
  } catch (e) {
    res.status(500).json({ error: 'DB error' });
  }
});

// API kontrol relay, update DB status relay
app.post('/api/control', requireLogin, async (req, res) => {
  const { relayId, action } = req.body;
  // relayId: index relay (0-7)
  if(!['on','off'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const [relays] = await db.query('SELECT * FROM relays WHERE user_id=? AND relay_index=?', [req.session.userId, relayId]);
  if (!relays.length) return res.status(404).json({ error: 'Relay not found' });
  await db.query('UPDATE relays SET status=? WHERE id=?', [action, relays[0].id]);
  // Kirim perintah ke MQTT dengan topic user
  const command = {
    relays: [relayId],
    action: action
  };
  const userTopic = getTopic(req.session.username, 'relays/command');
  mqttClient.publish(userTopic, JSON.stringify(command), (err) => {
    if (err) {
      console.error('Failed to publish relay command:', err);
    }
  });
  // Jika relay dimatikan, hapus timer terkait
  if (action === 'off') {
    await db.query(
      `DELETE FROM timers WHERE user_id=? AND relay_id=?`,
      [req.session.userId, relays[0].id]
    );
  }
  // Broadcast ke user
  broadcastAllUsers();
  res.json({ success: true });
});

// API get all timer user
app.get('/api/timers', requireLogin, async (req, res) => {
  const [timers] = await db.query('SELECT * FROM timers WHERE user_id=?', [req.session.userId]);
  res.json(timers);
});

// Set timer
app.post('/api/timer', requireLogin, async (req, res) => {
  const { relayId, duration } = req.body;
  // relayId = index
  const [relays] = await db.query('SELECT * FROM relays WHERE user_id=? AND relay_index=?', [req.session.userId, relayId]);
  if (!relays.length) return res.status(404).json({ error: 'Relay not found' });
  const relay_id = relays[0].id;
  const end_time = Date.now() + duration * 1000;
  const [insert] = await db.query('INSERT INTO timers (user_id, relay_id, duration, end_time) VALUES (?, ?, ?, ?)', [req.session.userId, relay_id, duration, end_time]);
  // Set relay ON juga
  await db.query('UPDATE relays SET status=? WHERE id=?', ['on', relay_id]);
  // Kirim perintah ke MQTT dengan topic user untuk timer set
  const userTimerTopic = getTopic(req.session.username, 'timer/set');
  mqttClient.publish(userTimerTopic, JSON.stringify({ relayId, duration }), (err) => {
    if (err) {
      console.error('Failed to publish timer set:', err);
    }
  });
  // Broadcast ke user
  broadcastAllUsers();
  res.json({ success: true, timerId: insert.insertId });
});

// Cancel timer
app.delete('/api/timer/:id', requireLogin, async (req,res)=>{
  const timerId = req.params.id;
  const [timers] = await db.query('SELECT * FROM timers WHERE id=? AND user_id=?', [timerId, req.session.userId]);
  if (!timers.length) return res.status(404).json({ error: 'Timer not found' });
  await db.query('DELETE FROM timers WHERE id=?', [timerId]);
  // Broadcast ke user
  broadcastAllUsers();
  res.json({success:true});
});

// Jalankan timer check
setInterval(async () => {
  const now = Date.now();
  // Ambil semua timer yang sudah selesai
  const [timers] = await db.query('SELECT t.id, t.user_id, t.relay_id, t.end_time, r.relay_index FROM timers t JOIN relays r ON t.relay_id = r.id WHERE t.end_time <= ?', [now]);
  for (const timer of timers) {
    // Matikan relay
    await db.query('UPDATE relays SET status=? WHERE id=?', ['off', timer.relay_id]);
    // Ambil username dari user_id
    const [userRows] = await db.query('SELECT username FROM users WHERE id=?', [timer.user_id]);
    if (userRows.length) {
      const username = userRows[0].username;
      // Kirim perintah ke MQTT dengan topic user
      const offTopic = getTopic(username, 'relays/command');
      mqttClient.publish(offTopic, JSON.stringify({
        relays: [timer.relay_index],
        action: 'off'
      }), (err) => {
        if (err) {
          console.error('Failed to publish relay off:', err);
        }
      });
    }
    // Hapus timer
    await db.query('DELETE FROM timers WHERE id=?', [timer.id]);
  }
  if (timers.length > 0) {
    broadcastAllUsers();
  }
}, 1000);

// Semua request lainnya akan mengirim file index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Jalankan server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`MQTT connected to ${MQTT_BROKER}:${MQTT_PORT}`);
});
