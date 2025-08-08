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

let isPolling = false;
let pollingInterval = null;

// API base URL - akan otomatis detect apakah localhost atau Netlify
const getAPIBaseURL = () => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return '/api';
  } else {
    return '/.netlify/functions/server';
  }
};

// Initialize
init();

function init() {
  setupEventListeners();
  loadConfigFromStorage();
  renderRelays();
  setupPolling();
  checkConnectionStatus();
}

function setupPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  isPolling = true;

  // Polling setiap 2 detik untuk status update
  pollingInterval = setInterval(async () => {
    if (isPolling) {
      await fetchStatus();
    }
  }, 2000);

  // Fetch status immediately
  fetchStatus();
}

async function fetchStatus() {
  try {
    const apiURL = getAPIBaseURL();
    const response = await fetch(`${apiURL}/status`);

    if (response.ok) {
      const data = await response.json();
      console.log('Status fetched:', data);

      // Update relay states
      if (data.relayStates) {
        data.relayStates.forEach((status, index) => {
          if (relays[index]) {
            relays[index].status = status;
          }
        });
      }

      // Update timers
      if (data.activeTimers) {
        relays.forEach(relay => relay.timerRemaining = 0);
        data.activeTimers.forEach(timer => {
          const relayIndex = timer.relayId - 1;
          if (relays[relayIndex]) {
            relays[relayIndex].timerRemaining = timer.remaining;
          }
        });
      }

      // Update connection status
      updateStatusElement(mqttStatus, data.mqttConnected,
        data.mqttConnected ? 'MQTT: Connected' : 'MQTT: Disconnected');
      updateStatusElement(deviceStatus, data.mqttConnected,
        data.mqttConnected ? 'Device: Online' : 'Device: Offline');

      renderRelays();
    } else {
      console.error('Failed to fetch status:', response.status);
      updateStatusElement(mqttStatus, false, 'MQTT: Error');
      updateStatusElement(deviceStatus, false, 'Device: Error');
    }
  } catch (error) {
    console.error('Error fetching status:', error);
    updateStatusElement(mqttStatus, false, 'MQTT: Connection Error');
    updateStatusElement(deviceStatus, false, 'Device: Connection Error');
  }
}

async function checkConnectionStatus() {
  try {
    const apiURL = getAPIBaseURL();
    const response = await fetch(`${apiURL}/health`);

    if (response.ok) {
      const data = await response.json();
      console.log('Health check:', data);
      updateStatusElement(document.getElementById('wifiStatus'), true, 'Internet: Connected');
    } else {
      updateStatusElement(document.getElementById('wifiStatus'), false, 'Internet: Error');
    }
  } catch (error) {
    console.error('Health check error:', error);
    updateStatusElement(document.getElementById('wifiStatus'), false, 'Internet: Offline');
  }
}

function setupEventListeners() {
  // Settings modal
  document.getElementById('settingsBtn').addEventListener('click', () => {
    loadSettingsToModal();
    settingsModal.style.display = 'block';
  });

  document.getElementById('closeSettings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  document.getElementById('saveSettings').addEventListener('click', saveSettings);

  // Close modals when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
    if (e.target === notificationModal) {
      notificationModal.style.display = 'none';
    }
  });

  // Notification modal
  document.getElementById('closeNotification').addEventListener('click', () => {
    notificationModal.style.display = 'none';
  });
}

function renderRelays() {
  relayGrid.innerHTML = '';

  relays.forEach(relay => {
    const relayCard = createRelayCard(relay);
    relayGrid.appendChild(relayCard);
  });
}

function createRelayCard(relay) {
  const card = document.createElement('div');
  card.className = `relay-card ${relay.status}`;

  const timerDisplay = relay.timerRemaining > 0 ?
    `<div class="timer-display">
      <i class="fas fa-clock"></i>
      <span>${formatTime(relay.timerRemaining)}</span>
    </div>` : '';

  card.innerHTML = `
    <div class="relay-header">
      <h3>${relay.name}</h3>
      <div class="relay-status ${relay.status}">
        <i class="fas ${relay.status === 'on' ? 'fa-power-off' : 'fa-power-off'}"></i>
        <span>${relay.status.toUpperCase()}</span>
      </div>
    </div>
    ${timerDisplay}
    <div class="relay-controls">
      <button class="btn btn-${relay.status === 'on' ? 'danger' : 'success'}"
              onclick="toggleRelay(${relay.id + 1})">
        <i class="fas fa-power-off"></i>
        ${relay.status === 'on' ? 'OFF' : 'ON'}
      </button>
      <button class="btn btn-secondary" onclick="openTimerModal(${relay.id + 1})">
        <i class="fas fa-clock"></i>
        Timer
      </button>
    </div>
  `;

  return card;
}

async function toggleRelay(relayId) {
  const relay = relays[relayId - 1];
  const newAction = relay.status === 'on' ? 'off' : 'on';

  try {
    showNotification('Sending command...', 'info');

    const apiURL = getAPIBaseURL();
    const response = await fetch(`${apiURL}/relay/${relayId}/${newAction}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Relay toggle response:', data);

      // Update local state immediately for better UX
      relay.status = newAction;
      renderRelays();

      showNotification(`Relay ${relayId} turned ${newAction.toUpperCase()}`, 'success');
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error || 'Failed to toggle relay'}`, 'error');
    }
  } catch (error) {
    console.error('Error toggling relay:', error);
    showNotification('Connection error. Please try again.', 'error');
  }
}

function openTimerModal(relayId) {
  const duration = prompt('Enter timer duration in seconds:');
  if (duration && !isNaN(duration) && duration > 0) {
    setTimer(relayId, parseInt(duration));
  }
}

async function setTimer(relayId, duration) {
  try {
    showNotification('Setting timer...', 'info');

    const apiURL = getAPIBaseURL();
    const response = await fetch(`${apiURL}/timer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        relayId: relayId,
        duration: duration
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Timer set response:', data);

      showNotification(`Timer set for Relay ${relayId}: ${duration} seconds`, 'success');

      // Immediately fetch new status
      await fetchStatus();
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error || 'Failed to set timer'}`, 'error');
    }
  } catch (error) {
    console.error('Error setting timer:', error);
    showNotification('Connection error. Please try again.', 'error');
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateStatusElement(element, isConnected, text) {
  if (!element) return;

  element.className = `status-item ${isConnected ? 'connected' : 'disconnected'}`;
  element.querySelector('span').textContent = text;
}

function showNotification(message, type = 'info') {
  const messageElement = document.getElementById('notificationMessage');
  const iconElement = document.getElementById('notificationIcon');

  messageElement.textContent = message;

  // Set icon based on type
  let iconClass = 'fas fa-info-circle';
  if (type === 'success') iconClass = 'fas fa-check-circle';
  else if (type === 'error') iconClass = 'fas fa-exclamation-circle';
  else if (type === 'warning') iconClass = 'fas fa-exclamation-triangle';

  iconElement.className = iconClass;
  notificationModal.className = `modal notification-${type}`;
  notificationModal.style.display = 'block';

  // Auto close after 3 seconds for success/info messages
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      notificationModal.style.display = 'none';
    }, 3000);
  }
}

function loadConfigFromStorage() {
  const stored = localStorage.getItem('relayConfig');
  if (stored) {
    try {
      config = { ...defaultConfig, ...JSON.parse(stored) };
    } catch (e) {
      console.error('Error loading config from storage:', e);
    }
  }
}

function saveConfigToStorage() {
  localStorage.setItem('relayConfig', JSON.stringify(config));
}

function loadSettingsToModal() {
  document.getElementById('mqttBroker').value = config.mqttBroker;
  document.getElementById('mqttPort').value = config.mqttPort;
  document.getElementById('mqttUsername').value = config.mqttUsername;
  document.getElementById('mqttPassword').value = config.mqttPassword;
}

function saveSettings() {
  const newConfig = {
    mqttBroker: document.getElementById('mqttBroker').value,
    mqttPort: parseInt(document.getElementById('mqttPort').value),
    mqttUsername: document.getElementById('mqttUsername').value,
    mqttPassword: document.getElementById('mqttPassword').value
  };

  config = { ...config, ...newConfig };
  saveConfigToStorage();
  settingsModal.style.display = 'none';

  showNotification('Settings saved! Reconnecting...', 'success');

  // Restart polling with new config
  setTimeout(() => {
    setupPolling();
  }, 1000);
}

// Cleanup when page is unloaded
window.addEventListener('beforeunload', () => {
  isPolling = false;
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
});

// Handle visibility change to pause/resume polling
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isPolling = false;
  } else {
    isPolling = true;
    fetchStatus(); // Immediate update when page becomes visible
  }
});
