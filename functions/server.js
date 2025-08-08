const mqtt = require('mqtt');

// In-memory state (akan reset setiap function call di Netlify)
let relayStates = Array(8).fill('off');
let activeTimers = {};

// MQTT configuration
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtts://4bbdfa736ca64112bb38a14789942a8a.s1.eu.hivemq.cloud';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const MQTT_USER = process.env.MQTT_USER || 'pepeq123';
const MQTT_PASS = process.env.MQTT_PASS || '123098@Qwe';

const RELAY_COMMAND_TOPIC = 'home/relays/command';
const RELAY_STATUS_TOPIC = 'home/relays/status';
const TIMER_SET_TOPIC = 'home/timer/set';

// Helper function untuk MQTT operations (one-time connection)
async function sendMQTTCommand(topic, message) {
  return new Promise((resolve, reject) => {
    try {
      const client = mqtt.connect(MQTT_BROKER, {
        port: MQTT_PORT,
        username: MQTT_USER,
        password: MQTT_PASS,
        protocol: 'mqtts',
        rejectUnauthorized: false,
        connectTimeout: 30000,
        reconnectPeriod: 0 // Disable auto-reconnect for one-time use
      });

      client.on('connect', () => {
        console.log('Connected to MQTT broker for command');
        client.publish(topic, JSON.stringify(message), (err) => {
          client.end(); // Close connection immediately
          if (err) {
            reject(err);
          } else {
            resolve(true);
          }
        });
      });

      client.on('error', (error) => {
        console.error('MQTT connection error:', error);
        client.end();
        reject(error);
      });

      // Timeout fallback
      setTimeout(() => {
        client.end();
        reject(new Error('MQTT connection timeout'));
      }, 10000);

    } catch (error) {
      reject(error);
    }
  });
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    console.log(`${method} ${path}`);

    // Parse path segments
    const pathSegments = path.split('/').filter(segment => segment);

    if (pathSegments[0] !== 'api') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Not found' })
      };
    }

    // Handle relay control: POST /api/relay/:relayId/:action
    if (method === 'POST' && pathSegments[1] === 'relay' && pathSegments.length === 4) {
      const relayId = pathSegments[2];
      const action = pathSegments[3];
      const relayIndex = parseInt(relayId) - 1;

      if (relayIndex < 0 || relayIndex >= 8) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid relay ID' })
        };
      }

      if (!['on', 'off'].includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
      }

      const command = {
        relay: parseInt(relayId),
        action: action
      };

      try {
        await sendMQTTCommand(RELAY_COMMAND_TOPIC, command);
        relayStates[relayIndex] = action;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            relay: relayId,
            action: action,
            timestamp: new Date().toISOString()
          })
        };
      } catch (error) {
        console.error('Error sending MQTT command:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to send command to device' })
        };
      }
    }

    // Handle timer setting: POST /api/timer
    if (method === 'POST' && pathSegments[1] === 'timer') {
      const body = JSON.parse(event.body || '{}');
      const { relayId, duration } = body;
      const relayIndex = parseInt(relayId) - 1;

      if (relayIndex < 0 || relayIndex >= 8) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid relay ID' })
        };
      }

      if (!duration || duration <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid duration' })
        };
      }

      const timerId = `timer_${relayId}_${Date.now()}`;
      const timerData = {
        id: timerId,
        relayId: parseInt(relayId),
        duration: parseInt(duration),
        endTime: Date.now() + (parseInt(duration) * 1000)
      };

      try {
        await sendMQTTCommand(TIMER_SET_TOPIC, timerData);
        activeTimers[timerId] = timerData;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            timerId: timerId,
            timer: timerData
          })
        };
      } catch (error) {
        console.error('Error setting timer:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to set timer' })
        };
      }
    }

    // Handle status request: GET /api/status
    if (method === 'GET' && pathSegments[1] === 'status') {
      const activeTimersList = Object.values(activeTimers).map(t => ({
        id: t.id,
        relayId: t.relayId,
        duration: t.duration,
        remaining: Math.max(0, Math.floor((t.endTime - Date.now()) / 1000))
      }));

      // Filter out expired timers
      activeTimers = Object.fromEntries(
        Object.entries(activeTimers).filter(([_, timer]) => timer.endTime > Date.now())
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          relayStates: relayStates,
          activeTimers: activeTimersList.filter(t => t.remaining > 0),
          mqttConnected: true, // Assume connected since we use one-time connections
          timestamp: new Date().toISOString()
        })
      };
    }

    // Handle health check: GET /api/health
    if (method === 'GET' && pathSegments[1] === 'health') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        })
      };
    }

    // Default 404 response
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Endpoint not found' })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
