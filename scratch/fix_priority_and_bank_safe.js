const fs = require('fs');
const htmlPath = 'd:/Localogo-Project/index.html';
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// 1. Update Bank Info
htmlContent = htmlContent.replace(/Bank BCA/g, 'Bank BCA');
htmlContent = htmlContent.replace(/123 4567 890/g, '3150915928');
htmlContent = htmlContent.replace(/a\.n\. Localogo Official/g, 'a.n. Anang Kuntoro');

fs.writeFileSync(htmlPath, htmlContent);
console.log('index.html updated');

const jsPath = 'd:/Localogo-Project/assets/js/index-app-v3.js';
let jsContent = fs.readFileSync(jsPath, 'utf8');

// 2. Adjust Priority Logic in checkUserState
const newCheckUserState = 'async function checkUserState() {\n' +
  '  const { data: { user } } = await _supabase.auth.getUser();\n' +
  '  if (!user) return showPanel(\'panel-not-logged-in\');\n' +
  '\n' +
  '  try {\n' +
  '    const configRes = await fetch(`${BACKEND_URL}/api/queue/info`);\n' +
  '    const configData = await configRes.json();\n' +
  '    const res = await fetch(`${BACKEND_URL}/api/queue/status`);\n' +
  '    const { data: slot } = await res.json();\n' +
  '\n' +
  '    if (!configData.data.is_open && (!slot || slot.status !== \'done\')) {\n' +
  '      document.getElementById(\'queue-quota-available\').textContent = \'Ditutup\';\n' +
  '      document.getElementById(\'queue-quota-total\').textContent = \'-\';\n' +
  '      const btn = document.getElementById(\'btn-claim-queue\');\n' +
  '      if (btn) {\n' +
  '        btn.disabled = true;\n' +
  '        btn.innerHTML = \'<span>Antrean Belum Dibuka</span><span>🔒</span>\';\n' +
  '      }\n' +
  '      return showPanel(\'panel-not-queued\');\n' +
  '    }\n' +
  '\n' +
  '    if (!slot) return renderNotQueuedPanel();';

jsContent = jsContent.replace(/async function checkUserState\(\) \{[\s\S]+?if \(!slot\) return renderNotQueuedPanel\(\);/, newCheckUserState);

fs.writeFileSync(jsPath, jsContent);
console.log('index-app-v3.js updated');
