const fs = require('fs');
const path = 'd:/Localogo-Project/index.html';
let content = fs.readFileSync(path, 'utf8');

// 1. Update Bank Info
content = content.replace(/Bank BCA/g, 'Bank BCA');
content = content.replace(/123 4567 890/g, '3150915928');
content = content.replace(/a\.n\. Localogo Official/g, 'a.n. Anang Kuntoro');

fs.writeFileSync(path, content);
console.log('index.html bank info updated');

const jsPath = 'd:/Localogo-Project/assets/js/index-app-v3.js';
let jsContent = fs.readFileSync(jsPath, 'utf8');

// 2. Adjust Priority Logic in checkUserState
// We want to check global gate status BEFORE checking user status
jsContent = jsContent.replace(
  /async function checkUserState\(\) \{[\s\S]+?const \{ data: slot \} = await res\.json\(\);/g,
  \`async function checkUserState() {
  const { data: { user } } = await _supabase.auth.getUser();
  if (!user) return showPanel('panel-not-logged-in');

  try {
    // 1. CEK STATUS GLOBAL DULU (GATE)
    const configRes = await fetch(\\\`\\\${BACKEND_URL}/api/queue/info\\\`);
    const configData = await configRes.json();
    
    // Jika gerbang utama ditutup, TAMPILKAN PANEL TUTUP (kecuali user sudah DONE)
    const res = await fetch(\\\`\\\${BACKEND_URL}/api/queue/status\\\`);
    const { data: slot } = await res.json();

    if (!configData.data.is_open && (!slot || slot.status !== 'done')) {
      document.getElementById('queue-quota-available').textContent = 'Ditutup';
      document.getElementById('queue-quota-total').textContent = '-';
      document.getElementById('btn-claim-queue').disabled = true;
      document.getElementById('btn-claim-queue').innerHTML = '<span>Antrean Belum Dibuka</span><span>🔒</span>';
      return showPanel('panel-not-queued');
    }

    // 2. CEK STATUS USER
    if (!slot) return renderNotQueuedPanel();\`
);

fs.writeFileSync(jsPath, jsContent);
console.log('JS priority logic updated');
