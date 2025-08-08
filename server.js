require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi MQTT
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtts://4bbdfa736ca64112bb38a14789942a8a.s1.eu.hivemq.cloud';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const MQTT_USER = process.env.MQTT_USER || 'pepeq123';
const MQTT_PASS = process.env.MQTT_PASS || '123098@Qwe';

const RELAY_COMMAND_TOPIC = 'home/relays/command';
const RELAY_STATUS_TOPIC = 'home/relays/status';
const TIMER_SET_TOPIC = 'home/timer/set';

// Simpan state relay dan timer
let relayStates = Array(8).fill('off');
let activeTimers = {};

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

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  console.log(`Subscribing to topics: ${RELAY_STATUS_TOPIC}`);
  mqttClient.subscribe(RELAY_STATUS_TOPIC, (err) => {
    if (err) {
      console.error('Failed to subscribe to', RELAY_STATUS_TOPIC, err);
    } else {
      console.log('Successfully subscribed to', RELAY_STATUS_TOPIC);

      // Request current status dari device saat startup
      console.log('Requesting current relay status...');
      mqttClient.publish('home/relays/request_status', JSON.stringify({
        action: 'get_status'
      }));
    }
  });
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

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    if (topic === RELAY_STATUS_TOPIC && Array.isArray(data.states)) {
      // Update relay states
      relayStates = data.states;

      // Broadcast ke semua client WebSocket
      broadcast({ type: 'status', states: relayStates });
    }
  } catch (error) {
    console.error('Error processing MQTT message:', error);
  }
});

// Fungsi untuk broadcast ke semua WebSocket clients
function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// WebSocket server
wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  // Kirim status saat ini ke client baru
  const initData = {
    type: 'init',
    states: relayStates,
    timers: Object.values(activeTimers).map(t => ({
      id: t.id,
      relayId: t.relayId,
      duration: t.duration,
      remaining: Math.max(0, Math.floor((t.endTime - Date.now()) / 1000))
    }))
  };

  console.log('Sending init data to new client:', initData);
  ws.send(JSON.stringify(initData));

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// API untuk mengontrol relay
app.post('/api/control', (req, res) => {
  const { relayId, action } = req.body;

  if (typeof relayId !== 'number' || relayId < 0 || relayId > 7) {
    return res.status(400).json({ error: 'Invalid relay ID' });
  }

  if (!['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  // Kirim perintah ke MQTT
  const command = {
    relays: [relayId],
    action: action
  };

  console.log(`Publishing to ${RELAY_COMMAND_TOPIC}:`, command);
  mqttClient.publish(RELAY_COMMAND_TOPIC, JSON.stringify(command), (err) => {
    if (err) {
      console.error('Failed to publish relay command:', err);
    } else {
      console.log('Relay command published successfully');

      // Optimistic update - langsung update state di server
      relayStates[relayId] = action;
      console.log(`Optimistic update: relay ${relayId} = ${action}`);
      console.log('Current relay states:', relayStates);

      // Broadcast ke semua client
      broadcast({
        type: 'status',
        states: relayStates
      });
    }
  });

  res.json({ success: true });
});

// API untuk mengatur timer
app.post('/api/timer', (req, res) => {
  const { relayId, duration } = req.body;

  if (typeof relayId !== 'number' || relayId < 0 || relayId > 7) {
    return res.status(400).json({ error: 'Invalid relay ID' });
  }

  if (typeof duration !== 'number' || duration < 1) {
    return res.status(400).json({ error: 'Invalid duration' });
  }

  // Kirim perintah timer ke MQTT
  const timerCommand = {
    relayId,
    duration
  };

  console.log(`Publishing timer to ${TIMER_SET_TOPIC}:`, timerCommand);
  mqttClient.publish(TIMER_SET_TOPIC, JSON.stringify(timerCommand), (err) => {
    if (err) {
      console.error('Failed to publish timer command:', err);
    } else {
      console.log('Timer command published successfully');
    }
  });

  // Auto turn ON relay ketika timer diset
  console.log(`Auto turning ON relay ${relayId} for timer`);
  mqttClient.publish(RELAY_COMMAND_TOPIC, JSON.stringify({
    relays: [relayId],
    action: 'on'
  }));

  // Update state di server
  relayStates[relayId] = 'on';
  console.log(`Timer set: relay ${relayId} turned ON`);

  // Broadcast status update
  broadcast({
    type: 'status',
    states: relayStates
  });

  // Simpan timer di server
  const timerId = `timer_${Date.now()}`;
  activeTimers[timerId] = {
    id: timerId,
    relayId,
    duration,
    startTime: Date.now(),
    endTime: Date.now() + duration * 1000
  };

  // Broadcast timer baru
  broadcast({
    type: 'timer_added',
    timer: {
      ...activeTimers[timerId],
      remaining: duration
    }
  });

  res.json({ success: true, timerId });
});

// API untuk membatalkan timer
app.delete('/api/timer/:id', (req, res) => {
  const timerId = req.params.id;

  if (activeTimers[timerId]) {
    delete activeTimers[timerId];

    // Broadcast pembatalan timer
    broadcast({ type: 'timer_removed', timerId });

    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Timer not found' });
});

// Jalankan timer check
setInterval(() => {
  const now = Date.now();
  const completedTimers = [];
  const timerUpdates = [];

  // Periksa semua timer
  for (const [timerId, timer] of Object.entries(activeTimers)) {
    if (now >= timer.endTime) {
      // Kirim perintah mati ke relay
      console.log(`Timer completed for relay ${timer.relayId}, sending OFF command`);
      mqttClient.publish(RELAY_COMMAND_TOPIC, JSON.stringify({
        relays: [timer.relayId],
        action: 'off'
      }));

      // Update state relay di server
      relayStates[timer.relayId] = 'off';
      console.log(`Timer completed: relay ${timer.relayId} set to OFF`);

      // Tandai timer untuk dihapus
      completedTimers.push(timerId);
    } else {
      // Siapkan update sisa waktu untuk client
      const remaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
      timerUpdates.push({
        timerId: timerId,
        relayId: timer.relayId,
        remaining: remaining
      });
    }
  }

  // Hapus timer yang sudah selesai
  completedTimers.forEach(timerId => {
    delete activeTimers[timerId];
    broadcast({ type: 'timer_completed', timerId });
  });

  // Broadcast status update jika ada timer yang selesai (relay mati)
  if (completedTimers.length > 0) {
    broadcast({
      type: 'status',
      states: relayStates
    });
  }

  // Kirim update timer yang masih aktif ke semua client
  if (timerUpdates.length > 0) {
    broadcast({ type: 'timer_updates', timers: timerUpdates });
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
