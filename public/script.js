// Konfigurasi default
const defaultConfig = {
  mqttBroker: '4bbdfa736ca64112bb38a14789942a8a.s1.eu.hivemq.cloud',
  mqttPort: 8883,
  mqttUsername: 'pepeq123',
  mqttPassword: '123098@Qwe'
};

// DOM Elements
const relayGrid = document.getElementById('relayGrid');
const mqttStatus = document.getElementById('mqttStatus');
const deviceStatus = document.getElementById('deviceStatus');
const settingsModal = document.getElementById('settingsModal');
const notificationModal = document.getElementById('notificationModal');

// State
let config = { ...defaultConfig };
let relays = Array(8).fill().map((_, i) => ({
  id: i,
  name: `Relay ${i+1}`,
  status: 'off',
  timerRemaining: 0
}));
let ws = null;

// Initialize
init();

function init() {
  setupEventListeners();
  loadConfigFromStorage();
  renderRelays();
  setupWebSocket();
}

function setupWebSocket() {
  // Gunakan WebSocket ke server yang sama
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    updateStatusElement(mqttStatus, true, 'MQTT: Connected');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('WebSocket message received:', data);

    switch (data.type) {
      case 'init':
        // Inisialisasi state
        data.states.forEach((state, i) => {
          if (i < relays.length) {
            relays[i].status = state;
          }
        });
        renderRelays();
        updateDeviceStatus(true);
        break;

      case 'status':
        // Update status relay
        data.states.forEach((state, i) => {
          if (i < relays.length) {
            relays[i].status = state;
          }
        });
        renderRelays();
        break;

      case 'timer_added':
        // Update timer
        const relay = relays.find(r => r.id === data.timer.relayId);
        if (relay) {
          relay.timerRemaining = data.timer.remaining;
          updateTimerDisplay(relay.id, relay.timerRemaining);
        }
        break;

      case 'timer_updates':
        // Real-time timer updates dari server
        data.timers.forEach(timer => {
          const relay = relays.find(r => r.id === timer.relayId);
          if (relay) {
            relay.timerRemaining = timer.remaining;
            updateTimerDisplay(timer.relayId, timer.remaining);
          }
        });
        break;

      case 'timer_removed':
      case 'timer_completed':
        // Hapus timer
        const relayId = typeof data.relayId !== 'undefined'
          ? data.relayId
          : (data.timerId ? relays.find(r => r.timerId === data.timerId)?.id : undefined);
        if (typeof relayId !== 'undefined') {
          clearTimer(relayId);
        }
        break;
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateStatusElement(mqttStatus, false, 'MQTT: Disconnected');
    setTimeout(setupWebSocket, 5000); // Coba reconnect setelah 5 detik
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateStatusElement(mqttStatus, false, 'MQTT: Error');
  };
}

function setupEventListeners() {
  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', () => showModal(settingsModal));
  document.getElementById('closeSettings').addEventListener('click', () => hideModal(settingsModal));
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

  // Notification modal
  document.getElementById('closeModal').addEventListener('click', () => hideModal(notificationModal));
  document.getElementById('modalConfirm').addEventListener('click', () => hideModal(notificationModal));
}

function loadConfigFromStorage() {
  const savedConfig = localStorage.getItem('mqttConfig');
  if (savedConfig) {
    try {
      config = { ...defaultConfig, ...JSON.parse(savedConfig) };
      showNotification('Settings Loaded', 'Configuration loaded successfully');
    } catch (e) {
      console.error('Error loading config:', e);
    }
  }
}

function saveSettings() {
  config = {
    ...config,
    mqttBroker: document.getElementById('mqttBroker').value || defaultConfig.mqttBroker,
    mqttPort: parseInt(document.getElementById('mqttPort').value) || defaultConfig.mqttPort,
    mqttUsername: document.getElementById('mqttUsername').value || defaultConfig.mqttUsername,
    mqttPassword: document.getElementById('mqttPassword').value || defaultConfig.mqttPassword
  };

  localStorage.setItem('mqttConfig', JSON.stringify(config));
  showNotification('Settings Saved', 'MQTT configuration updated');
  hideModal(settingsModal);
}

async function toggleRelay(relayId) {
  const relay = relays.find(r => r.id === relayId);
  if (!relay) return;

  const newStatus = relay.status === 'off' ? 'on' : 'off';

  console.log(`Toggling relay ${relayId} to ${newStatus}`);

  try {
    const response = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId, action: newStatus })
    });

    if (response.ok) {
      // Optimistic update
      relay.status = newStatus;
      renderRelays();
      showNotification('Success', `${relay.name} turned ${newStatus.toUpperCase()}`);
      console.log(`Relay ${relayId} toggled successfully to ${newStatus}`);
    } else {
      const errorData = await response.json();
      console.error('Failed to toggle relay:', errorData);
      showNotification('Error', `Failed to control relay: ${errorData.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error controlling relay:', error);
    showNotification('Error', 'Failed to control relay');
  }
}

async function setTimerForRelay(relayId, duration) {
  console.log(`Setting timer for relay ${relayId}, duration: ${duration} seconds`);

  try {
    const response = await fetch('/api/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId, duration })
    });

    if (response.ok) {
      const data = await response.json();
      showNotification('Timer Set', `Timer set for ${formatTime(duration)}`);
      console.log(`Timer set successfully for relay ${relayId}`);
    } else {
      const errorData = await response.json();
      console.error('Failed to set timer:', errorData);
      showNotification('Error', `Failed to set timer: ${errorData.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error setting timer:', error);
    showNotification('Error', 'Failed to set timer');
  }
}

function renderRelays() {
  relayGrid.innerHTML = '';

  relays.forEach((relay, index) => {
    const relayCard = document.createElement('div');
    relayCard.className = 'relay-card';
    relayCard.style.setProperty('--index', index);

    relayCard.innerHTML = `
      <h3>${relay.name}</h3>
      <div class="status-container">
        <div class="status-indicator ${relay.status}">
          <i class="fas fa-power-off"></i>
        </div>
        <div class="status-text">${relay.status.toUpperCase()}</div>
      </div>

      <button class="btn toggle-btn ${relay.status === 'on' ? 'on' : ''}" data-relay-id="${relay.id}">
        <i class="fas fa-power-off"></i> ${relay.status === 'off' ? 'TURN ON' : 'TURN OFF'}
      </button>

      <div class="timer-controls">
        <h4><i class="fas fa-clock"></i> SET TIMER</h4>
        <div class="timer-options">
          <button class="timer-btn" data-relay-id="${relay.id}" data-duration="3600">1 HOUR</button>
          <button class="timer-btn" data-relay-id="${relay.id}" data-duration="7200">2 HOURS</button>
          <button class="timer-btn" data-relay-id="${relay.id}" data-duration="10800">3 HOURS</button>
          <button class="timer-btn" data-relay-id="${relay.id}" data-duration="18000">5 HOURS</button>
        </div>
        <div class="custom-timer">
          <input type="number" id="custom-${relay.id}" placeholder="Seconds" min="1">
          <button class="set-custom-timer" data-relay-id="${relay.id}">SET</button>
        </div>
        <div class="timer-display" id="timer-${relay.id}">
          <i class="fas fa-stopwatch"></i> Timer active: <span class="timer-value">00:00:00</span>
        </div>
      </div>
    `;

    // Add event listeners
    relayCard.querySelector('.toggle-btn').addEventListener('click', (e) => {
      const relayId = parseInt(e.target.closest('button').dataset.relayId);
      toggleRelay(relayId);
    });

    relayCard.querySelectorAll('.timer-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const relayId = parseInt(e.target.dataset.relayId);
        const duration = parseInt(e.target.dataset.duration);
        setTimerForRelay(relayId, duration);
      });
    });

    relayCard.querySelector('.set-custom-timer').addEventListener('click', (e) => {
      const relayId = parseInt(e.target.dataset.relayId);
      const input = relayCard.querySelector(`#custom-${relayId}`);
      const duration = parseInt(input.value);

      if (duration > 0) {
        setTimerForRelay(relayId, duration);
      } else {
        showNotification('Invalid Duration', 'Please enter a valid duration in seconds');
      }
    });

    relayGrid.appendChild(relayCard);

    // Update timer display if active
    if (relay.timerRemaining > 0) {
      updateTimerDisplay(relay.id, relay.timerRemaining);
    }
  });
}

function updateTimerDisplay(relayId, seconds) {
  const timerDisplay = document.getElementById(`timer-${relayId}`);
  if (!timerDisplay) return;

  timerDisplay.classList.add('active');
  timerDisplay.querySelector('.timer-value').textContent = formatTime(seconds);
}

function clearTimer(relayId) {
  const relay = relays.find(r => r.id === relayId);
  if (relay) {
    relay.timerRemaining = 0;
    const timerDisplay = document.getElementById(`timer-${relayId}`);
    if (timerDisplay) {
      timerDisplay.classList.remove('active');
    }
  }
}

function updateStatusElement(element, isGood, text) {
  const icon = element.querySelector('i');
  const textSpan = element.querySelector('span');

  textSpan.textContent = text;
  element.style.background = isGood ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255, 61, 0, 0.1)';
  element.style.borderColor = isGood ? 'rgba(0, 200, 83, 0.2)' : 'rgba(255, 61, 0, 0.2)';
  icon.style.color = isGood ? '#00c853' : '#ff3d00';
}

function updateDeviceStatus(online) {
  updateStatusElement(deviceStatus, online, online ? 'Device: Online' : 'Device: Offline');
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function showModal(modal) {
  if (modal === settingsModal) {
    document.getElementById('mqttBroker').value = config.mqttBroker;
    document.getElementById('mqttPort').value = config.mqttPort;
    document.getElementById('mqttUsername').value = config.mqttUsername;
    document.getElementById('mqttPassword').value = config.mqttPassword;
  }
  modal.classList.add('active');
}

function hideModal(modal) {
  modal.classList.remove('active');
}

function showNotification(title, message) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  notificationModal.classList.add('active');
}
