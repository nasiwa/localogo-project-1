const fs = require('fs');
const path = 'd:/Localogo-Project/assets/js/index-app-v3.js';
let content = fs.readFileSync(path, 'utf8');

const replacements = [
  {
    target: /function setupRealtime\(\) \{[\s\S]+?\.subscribe\(\);/g,
    replacement: 'function setupRealtime() {\n  // Listen for batch changes\n  _supabase.channel(\'public-batches\')\n    .on(\'postgres_changes\', { event: \'*\', schema: \'public\', table: \'batches\' }, (payload) => {\n      console.log(\'Batch update:\', payload);\n      debouncedLoadBatches();\n    })\n    .subscribe();\n\n  // Listen for queue config changes (Master Switch)\n  _supabase.channel(\'public-config\')\n    .on(\'postgres_changes\', { event: \'UPDATE\', schema: \'public\', table: \'batch_config\' }, (payload) => {\n      console.log(\'Queue Config update:\', payload);\n      checkUserState(); // Full state refresh\n    })\n    .subscribe();\n\n  // Listen for order status changes\n  _supabase.channel(\'orders-channel\')\n    .on(\'postgres_changes\', { event: \'*\', schema: \'public\', table: \'orders\' }, (payload) => {\n      console.log(\'Order update:\', payload);\n      debouncedLoadBatches();\n    })\n    .subscribe();\n}'
  },
  {
    target: /let activeGateway = 'manual';/,
    replacement: 'let activeGateway = \'manual\';\nlet countdownInterval;\n\nfunction startCountdown(durationMinutes, displayId, onEnd) {\n  clearInterval(countdownInterval);\n  let timer = durationMinutes * 60;\n  const display = document.getElementById(displayId);\n  if (!display) return;\n\n  function update() {\n    let minutes = parseInt(timer / 60, 10);\n    let seconds = parseInt(timer % 60, 10);\n    minutes = minutes < 10 ? "0" + minutes : minutes;\n    seconds = seconds < 10 ? "0" + seconds : seconds;\n    display.textContent = minutes + ":" + seconds;\n\n    if (--timer < 0) {\n      clearInterval(countdownInterval);\n      if (onEnd) onEnd();\n    }\n  }\n  update();\n  countdownInterval = setInterval(update, 1000);\n}'
  },
  {
    target: /function onWaInput\(\) \{[\s\S]+?\}/,
    replacement: 'function onWaInput() {\n  const waField = document.getElementById(\'f-wa\');\n  if (!waField) return;\n\n  waField.value = waField.value.replace(/\\D/g, \'\');\n  const wa = waField.value;\n  \n  if (activeGateway === \'manual\') {\n    const totalEl = document.getElementById(\'sidebar-total\');\n    const headPrice = document.querySelector(\'.order-price\');\n    const formNominal = document.getElementById(\'display-unique-nominal\');\n    \n    let displayTotal = \'Rp100.---\';\n    if (wa.length >= 3) {\n      const suffix = wa.slice(-3);\n      displayTotal = \'Rp100.\' + suffix;\n    }\n    \n    if (totalEl) totalEl.textContent = displayTotal;\n    if (headPrice) headPrice.textContent = displayTotal;\n    if (formNominal) formNominal.textContent = displayTotal;\n  }\n}'
  },
  {
    target: /if \(slot\.status === 'waiting'\) \{[\s\S]+?\} else if \(slot\.status === 'active'\) \{/,
    replacement: 'if (slot.status === \'waiting\') {\n      showPanel(\'panel-waiting\');\n      document.getElementById(\'display-queue-number\').textContent = slot.queue_number.toString().padStart(3, \'0\');\n      document.getElementById(\'display-queue-session\').textContent = slot.session;\n      \n      const timerEl = document.getElementById(\'queue-timer\');\n      if (timerEl) {\n        timerEl.style.display = \'block\';\n        startCountdown(10, \'timer-countdown\');\n      }\n    } else if (slot.status === \'active\') {'
  },
  {
    target: /showPanel\('panel-active'\);/,
    replacement: 'showPanel(\'panel-active\');\n      startCountdown(10, \'active-countdown-timer\', () => {\n        showPanel(\'panel-expired\');\n      });'
  }
];

replacements.forEach(r => {
  content = content.replace(r.target, r.replacement);
});

if (!content.includes('function resetQueue')) {
  content += '\nfunction resetQueue() {\n  _supabase.auth.signOut().then(() => {\n    window.location.reload();\n  });\n}\n';
}

fs.writeFileSync(path, content);
console.log('index-app-v3.js updated successfully');
