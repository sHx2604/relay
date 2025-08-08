const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const serverless = require('serverless-http');

const app = express();

app.use(cors());
app.use(express.json());

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

// Koneksi MQTT
let mqttClient;

function connectMQTT() {
  try {
    mqttClient = mqtt.connect(MQTT_BROKER, {
      port: MQTT_PORT,
      username: MQTT_USER,
      password: MQTT_PASS,
      protocol: 'mqtts',
      rejectUnauthorized: false
    });

    mqttClient.on('connect', () => {
      console.log('Connected to MQTT broker');
      mqttClient.subscribe([RELAY_STATUS_TOPIC]);
    });

    mqttClient.on('message', (topic, message) => {
      try {
        if (topic === RELAY_STATUS_TOPIC) {
          const data = JSON.parse(message.toString());
          console.log('Received relay status:', data);
          relayStates = data.states;
        }
      } catch (error) {
        console.error('Error processing MQTT message:', error);
      }
    });

    mqttClient.on('error', (error) => {
      console.error('MQTT connection error:', error);
    });

  } catch (error) {
    console.error('Failed to connect to MQTT broker:', error);
  }
}

// API Endpoints
app.post('/api/relay/:relayId/:action', (req, res) => {
  const { relayId, action } = req.params;
  const relayIndex = parseInt(relayId) - 1;

  if (relayIndex < 0 || relayIndex >= 8) {
    return res.status(400).json({ error: 'Invalid relay ID' });
  }

  if (!['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const command = {
    relay: parseInt(relayId),
    action: action
  };

  try {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(RELAY_COMMAND_TOPIC, JSON.stringify(command));
      relayStates[relayIndex] = action;
      res.json({ success: true, relay: relayId, action: action });
    } else {
      res.status(503).json({ error: 'MQTT not connected' });
    }
  } catch (error) {
    console.error('Error publishing MQTT message:', error);
    res.status(500).json({ error: 'Failed to send command' });
  }
});

app.post('/api/timer', (req, res) => {
  const { relayId, duration } = req.body;
  const relayIndex = parseInt(relayId) - 1;

  if (relayIndex < 0 || relayIndex >= 8) {
    return res.status(400).json({ error: 'Invalid relay ID' });
  }

  if (!duration || duration <= 0) {
    return res.status(400).json({ error: 'Invalid duration' });
  }

  const timerId = `timer_${relayId}_${Date.now()}`;
  const timerData = {
    id: timerId,
    relayId: parseInt(relayId),
    duration: parseInt(duration),
    endTime: Date.now() + (parseInt(duration) * 1000)
  };

  try {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(TIMER_SET_TOPIC, JSON.stringify(timerData));
      activeTimers[timerId] = timerData;
      res.json({ success: true, timerId: timerId, timer: timerData });
    } else {
      res.status(503).json({ error: 'MQTT not connected' });
    }
  } catch (error) {
    console.error('Error setting timer:', error);
    res.status(500).json({ error: 'Failed to set timer' });
  }
});

app.get('/api/status', (req, res) => {
  const activeTimersList = Object.values(activeTimers).map(t => ({
    id: t.id,
    relayId: t.relayId,
    duration: t.duration,
    remaining: Math.max(0, Math.floor((t.endTime - Date.now()) / 1000))
  }));

  res.json({
    relayStates: relayStates,
    activeTimers: activeTimersList,
    mqttConnected: mqttClient ? mqttClient.connected : false
  });
});

// Initialize MQTT connection
connectMQTT();

module.exports.handler = serverless(app);
