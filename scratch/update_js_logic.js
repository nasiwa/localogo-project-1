const fs = require('fs');
const path = 'd:/Localogo-Project/assets/js/index-app-v3.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix setupRealtime
content = content.replace(
  /function setupRealtime\(\) \{[\s\S]+?\.subscribe\(\);/g,
  \`function setupRealtime() {
  // Listen for batch changes
  _supabase.channel('public-batches')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batches' }, (payload) => {
      console.log('Batch update:', payload);
      debouncedLoadBatches();
    })
    .subscribe();

  // Listen for queue config changes (Master Switch)
  _supabase.channel('public-config')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'batch_config' }, (payload) => {
      console.log('Queue Config update:', payload);
      checkUserState(); // Full state refresh
    })
    .subscribe();

  // Listen for order status changes
  _supabase.channel('orders-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
      console.log('Order update:', payload);
      debouncedLoadBatches();
    })
    .subscribe();
}\`
);

// 2. Add Countdown Timer Logic
content = content.replace(
  /let activeGateway = 'manual';/g,
  \`let activeGateway = 'manual';
let countdownInterval;

function startCountdown(durationMinutes, displayId, onEnd) {
  clearInterval(countdownInterval);
  let timer = durationMinutes * 60;
  const display = document.getElementById(displayId);
  if (!display) return;

  function update() {
    let minutes = parseInt(timer / 60, 10);
    let seconds = parseInt(timer % 60, 10);
    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;
    display.textContent = minutes + ":" + seconds;

    if (--timer < 0) {
      clearInterval(countdownInterval);
      if (onEnd) onEnd();
    }
  }
  update();
  countdownInterval = setInterval(update, 1000);
}\`
);

// 3. Update onWaInput
content = content.replace(
  /function onWaInput\(\) \{[\s\S]+?\}/g,
  \`function onWaInput() {
  const waField = document.getElementById('f-wa');
  if (!waField) return;

  waField.value = waField.value.replace(/\\D/g, '');
  const wa = waField.value;
  
  if (activeGateway === 'manual') {
    const totalEl = document.getElementById('sidebar-total');
    const headPrice = document.querySelector('.order-price');
    const formNominal = document.getElementById('display-unique-nominal');
    
    let displayTotal = 'Rp100.---';
    if (wa.length >= 3) {
      const suffix = wa.slice(-3);
      displayTotal = 'Rp100.' + suffix;
    }
    
    if (totalEl) totalEl.textContent = displayTotal;
    if (headPrice) headPrice.textContent = displayTotal;
    if (formNominal) formNominal.textContent = displayTotal;
  }
}\`
);

// 4. Update checkUserState to include Timer
content = content.replace(
  /if \(slot\.status === 'waiting'\) \{[\s\S]+?\} else if \(slot\.status === 'active'\) \{/,
  \`if (slot.status === 'waiting') {
      showPanel('panel-waiting');
      document.getElementById('display-queue-number').textContent = slot.queue_number.toString().padStart(3, '0');
      document.getElementById('display-queue-session').textContent = slot.session;
      
      // Add Countdown logic for waiting
      const timerEl = document.getElementById('queue-timer');
      if (timerEl) {
        timerEl.style.display = 'block';
        // Assume session changes every wave_duration_minutes
        // This is an estimation
        startCountdown(10, 'timer-countdown');
      }
    } else if (slot.status === 'active') {\`
);

// 5. Update Active Panel Timer
content = content.replace(
  /showPanel\('panel-active'\);/,
  \`showPanel('panel-active');
      startCountdown(10, 'active-countdown-timer', () => {
        showPanel('panel-expired');
      });\`
);

// 6. Add resetQueue
content += \`\\nfunction resetQueue() {
  // Clear local state and reload to allow re-claiming
  _supabase.auth.signOut().then(() => {
    window.location.reload();
  });
}\\n\`;

fs.writeFileSync(path, content);
console.log('index-app-v3.js updated successfully');
