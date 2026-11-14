#!/usr/bin/env node
// ============================================================
//  SERVEUR DE L'ARÈNE (Match Brawl, v16) — jeu en ligne en réseau local, sans aucune dépendance
//  1. sert le jeu (index.html du même dossier) à tous les appareils du réseau ;
//  2. relaie les messages WebSocket entre les joueurs d'une même salle (4 joueurs au plus).
//  Le serveur ne fait tourner aucune partie : c'est l'appareil qui crée la salle (l'hôte) qui calcule le combat.
//
//  Utilisation : node serveur_arene.js [port]          (port 8080 par défaut)
//  puis ouvrir l'adresse affichée (http://192.168.x.x:8080) sur chaque téléphone ou ordinateur du même Wi-Fi.
//  Il faut Node.js 16 ou plus récent (https://nodejs.org). Pour Internet, le même serveur peut tourner sur une
//  machine en ligne derrière un proxy HTTPS (le jeu se connecte alors en wss://).
// ============================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), zlib = require('zlib');

const PORT = +process.argv[2] || +process.env.PORT || 8080;
const GAME = path.join(__dirname, 'index.html');
const MAX_MSG = 512 * 1024;            // taille maximale d'un message (un instantané fait environ 2 Ko)
const MAX_ROOM = 4;                    // joueurs par salle, hôte compris

// ---------- le jeu : lu une fois, compressé une fois
let gamePlain = null, gameGz = null, gameTime = 0;
function loadGame() {
  try {
    const st = fs.statSync(GAME);
    if (gamePlain && st.mtimeMs === gameTime) return true;
    gamePlain = fs.readFileSync(GAME); gameGz = zlib.gzipSync(gamePlain, { level: 6 }); gameTime = st.mtimeMs;
    return true;
  } catch (e) { return false; }
}

// ---------- salles
const rooms = new Map();               // code -> { code, name, host, peers: Set, started }
let nextId = 1;
const clean = s => String(s || '').replace(/[^\p{L}\p{N} '\-_.]/gu, '').slice(0, 20).trim();
function roomList() { return [...rooms.values()].map(r => ({ code: r.code, name: r.name, n: 1 + r.peers.size, started: r.started })); }
function newCode() { for (let i = 0; i < 1000; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return String(Date.now() % 100000); }
function leave(c) {
  const r = c.room; if (!r) return;
  c.room = null;
  if (r.host === c) {
    for (const p of r.peers) { p.room = null; send(p, { t: 'closed' }); }
    rooms.delete(r.code);
    log(`salle ${r.code} fermée`);
  } else {
    r.peers.delete(c);
    send(r.host, { t: 'peer-', id: c.id });
  }
}
function onMessage(c, m) {
  switch (m.t) {
    case 'list': send(c, { t: 'rooms', rooms: roomList() }); break;
    case 'create': {
      leave(c);
      const code = newCode(), name = clean(m.name) || 'Joueur';
      const r = { code, name: 'Salle de ' + name, host: c, peers: new Set(), started: false };
      rooms.set(code, r); c.room = r; c.name = name;
      send(c, { t: 'joined', code, host: true, you: c.id, hostId: c.id });
      log(`salle ${code} créée par ${name}`);
      break;
    }
    case 'join': {
      const r = rooms.get(String(m.code));
      if (!r) { send(c, { t: 'error', msg: 'Salle introuvable' }); break; }
      if (r.started) { send(c, { t: 'error', msg: 'Partie en cours' }); break; }
      if (1 + r.peers.size >= MAX_ROOM) { send(c, { t: 'error', msg: 'La salle est pleine' }); break; }
      leave(c);
      r.peers.add(c); c.room = r; c.name = clean(m.name) || 'Joueur';
      send(c, { t: 'joined', code: r.code, host: false, you: c.id, hostId: r.host.id });
      send(r.host, { t: 'peer+', id: c.id, name: c.name });
      log(`${c.name} rejoint la salle ${r.code}`);
      break;
    }
    case 'leave': leave(c); break;
    case 'state': if (c.room && c.room.host === c) c.room.started = !!m.started; break;
    case 'msg': {
      const r = c.room; if (!r) break;
      const out = JSON.stringify({ t: 'msg', from: c.id, d: m.d });
      const all = [r.host, ...r.peers];
      if (m.to === 'host') { if (r.host !== c) sendRaw(r.host, out); }
      else if (m.to === 'all') { for (const p of all) if (p !== c) sendRaw(p, out); }
      else { const p = all.find(p => p.id === m.to); if (p) sendRaw(p, out); }
      break;
    }
  }
}

// ---------- WebSocket minimal (RFC 6455) : poignée de main, trames texte, ping / pong, fermeture
function send(c, obj) { sendRaw(c, JSON.stringify(obj)); }
function sendRaw(c, str) {
  if (!c || c.closed) return;
  const data = Buffer.from(str, 'utf8'), n = data.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x81;
  try { c.sock.write(Buffer.concat([head, data])); } catch (e) { close(c); }
}
function sendCtl(c, op, payload = Buffer.alloc(0)) { if (c.closed) return; try { c.sock.write(Buffer.concat([Buffer.from([0x80 | op, payload.length]), payload])); } catch (e) { } }
function close(c) {
  if (c.closed) return;
  c.closed = true; clearInterval(c.ping);
  leave(c);
  try { c.sock.end(); c.sock.destroy(); } catch (e) { }
}
function onData(c, chunk) {
  c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
  c.seen = Date.now();
  while (c.buf.length >= 2) {
    const b0 = c.buf[0], b1 = c.buf[1], fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > MAX_MSG) { close(c); return; }
    const need = off + (masked ? 4 : 0) + len;
    if (c.buf.length < need) return;
    let payload = c.buf.subarray(off + (masked ? 4 : 0), need);
    if (masked) { const k = c.buf.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= k[i & 3]; }
    c.buf = c.buf.subarray(need);
    if (op === 8) { sendCtl(c, 8); close(c); return; }
    if (op === 9) { sendCtl(c, 10, payload.subarray(0, 125)); continue; }
    if (op === 10) continue;
    if (op === 1 || op === 2) c.frag = [payload];
    else if (op === 0 && c.frag) c.frag.push(payload);
    else continue;
    if (!fin) { if (c.frag.reduce((t, b) => t + b.length, 0) > MAX_MSG) { close(c); return; } continue; }
    const text = Buffer.concat(c.frag).toString('utf8'); c.frag = null;
    let m; try { m = JSON.parse(text); } catch (e) { continue; }
    if (m && typeof m === 'object') try { onMessage(c, m); } catch (e) { log('erreur : ' + e.message); }
  }
}

// ---------- HTTP
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    if (!loadGame()) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Serveur de l\'Arène Match Brawl : en ligne. ' + rooms.size + ' salle(s) ouverte(s).'); return; }
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': gz ? gameGz.length : gamePlain.length });
    res.end(gz ? gameGz : gamePlain);
    return;
  }
  if (url === '/rooms') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(roomList())); return; }
  if (url === '/sante') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Introuvable');
});
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!(req.url || '').startsWith('/ws') || !key) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: nextId++, sock, buf: Buffer.alloc(0), frag: null, room: null, closed: false, seen: Date.now(), name: '' };
  sock.on('data', d => onData(c, d));
  sock.on('close', () => close(c));
  sock.on('error', () => close(c));
  c.ping = setInterval(() => { if (Date.now() - c.seen > 45000) close(c); else sendCtl(c, 9); }, 15000);
});
function log(s) { console.log(new Date().toLocaleTimeString('fr-FR') + '  ' + s); }
server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) ips.push(a.address);
  console.log('\n  Serveur de l\'Arène prêt.' + (loadGame() ? '' : '  (attention : index.html introuvable dans ce dossier)'));
  console.log('  Sur chaque appareil du même Wi-Fi, ouvre :');
  for (const ip of ips.length ? ips : ['localhost']) console.log('     http://' + ip + ':' + PORT);
  console.log('  Sur cet ordinateur : http://localhost:' + PORT + '\n  (Ctrl + C pour arrêter)\n');
});
