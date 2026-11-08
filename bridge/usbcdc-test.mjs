// 原生 USB-OTG CDC 通道冒烟：COM9 上跑 HTTP 隧道
import { SerialPort } from 'serialport';

const port = new SerialPort({ path: 'COM9', baudRate: 460800, dtr: true, rts: true, autoOpen: false });

const frames = [];
let acc = Buffer.alloc(0);
let done = 0;

function parseFrames() {
  // 日志行（[XXX] ...\n）与 HTTP 帧混流：按 HTTP 起始行切帧
  const s = acc.toString('latin1');
  const idx = s.indexOf('HTTP/1.1 ');
  if (idx === -1) { if (s.includes('\n')) { const cut = s.lastIndexOf('\n'); if (cut > 0) { frames.push({ log: s.slice(0, cut) }); acc = acc.subarray(cut + 1); } } return; }
  if (idx > 0) { frames.push({ log: s.slice(0, idx) }); acc = acc.subarray(idx); }
  const rest = acc.toString('latin1');
  const hd = rest.indexOf('\r\n\r\n');
  if (hd === -1) return;
  const head = rest.slice(0, hd);
  const m = head.match(/Content-Length:\s*(\d+)/i);
  const total = hd + 4 + (m ? +m[1] : 0);
  if (rest.length < total) return;
  frames.push({ http: rest.slice(0, total) });
  acc = acc.subarray(total);
  parseFrames();
}

port.open(e => {
  if (e) { console.log('open fail', e.message); process.exit(1); }
  console.log('opened COM9 (native USB-OTG CDC)');
  port.on('data', d => { acc = Buffer.concat([acc, d]); parseFrames(); });
});

const reqs = [
  ['v1', 'GET /api/version'],
  ['s1', 'GET /api/state'],
  ['l1', 'GET /api/led'],
  ['p1', 'PUT /api/state', JSON.stringify({ status: 'focus' })],
  ['e1', 'GET /api/events'],
];

for (const [id, line, body] of reqs) {
  setTimeout(() => {
    const b = body ? `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n` : 'Content-Length: 0\r\n';
    port.write(`${line} HTTP/1.1\r\n${b}X-Request-Id: ${id}\r\n\r\n${body || ''}`);
  }, 500 + reqs.indexOf(reqs.find(r => r[0] === id)) * 900);
}

setTimeout(() => {
  for (const f of frames) console.log(f.http ? `---HTTP---\n${f.http}\n` : (f.log.trim() ? `---log---\n${f.log.trim()}\n` : ''));
  port.close();
  process.exit(0);
}, 500 + reqs.length * 900 + 4000);
