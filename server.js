const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode      = require('qrcode');
const express     = require('express');
const http        = require('http');
const WebSocket   = require('ws');
const path        = require('path');
const fs          = require('fs');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');

// ── Configuração ────────────────────────────────────────────────────────────
const JWT_SECRET       = process.env.JWT_SECRET || 'mcll-monitoramento-secret-2024';
const PORT             = process.env.PORT || 3000;
const WPP_SESSION_PATH = process.env.WPP_SESSION_PATH || path.join(__dirname, '.wpp-session');

// Diretório de dados persistente — usa /data (volume Railway) quando disponível,
// senão cai para __dirname (desenvolvimento local)
const DATA_DIR   = fs.existsSync('/data') ? '/data' : __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// ── Usuários ────────────────────────────────────────────────────────────────
function carregarUsuarios() {
  if (!fs.existsSync(USERS_FILE)) {
    const usuarios = [
      { id:'1', nome:'Administrador', email:'admin@mcll.com',    senha: bcrypt.hashSync('mcll@admin2024', 10), perfil:'administrador' },
      { id:'2', nome:'Usuário',       email:'usuario@mcll.com',  senha: bcrypt.hashSync('mcll@2024', 10),      perfil:'usuario' },
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), 'utf8');
    console.log('✅ Arquivo users.json criado com usuários padrão');
    return usuarios;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
let usuarios = carregarUsuarios();

// ── Middleware de autenticação ───────────────────────────────────────────────
function autenticar(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}
function autenticarPagina(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.redirect('/');
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.redirect('/');
  }
}
function apenasAdmin(req, res, next) {
  if (req.usuario?.perfil !== 'administrador') return res.status(403).json({ erro: 'Acesso restrito ao administrador' });
  next();
}

// ── Base de municípios / siglas ─────────────────────────────────────────────
const BASE = [
  // ── PARÁ ────────────────────────────────────────────────────────────────
  { uf:'PA', cod:'91569', muni:'ANANINDEUA',                 sigla:'AIU',  eps:'SLN' },
  { uf:'PA', cod:'91000', muni:'BELEM',                      sigla:'BLM',  eps:'SLN' },
  { uf:'PA', cod:'91349', muni:'BREJO GRANDE DO ARAGUAIA',   sigla:'BGG',  eps:'SLN' },
  { uf:'PA', cod:'91351', muni:'BREU BRANCO',                sigla:'BUBO', eps:'SLN' },
  { uf:'PA', cod:'91110', muni:'DOM ELISEU',                 sigla:'DEU',  eps:'SLN' },
  { uf:'PA', cod:'91469', muni:'GOIANESIA DO PARA',          sigla:'GOPA', eps:'SLN' },
  { uf:'PA', cod:'91043', muni:'ITUPIRANGА',                 sigla:'INK',  eps:'SLN' },
  { uf:'PA', cod:'91045', muni:'JACUNDA',                    sigla:'JUN',  eps:'SLN' },
  { uf:'PA', cod:'91049', muni:'MARABA',                     sigla:'MBA',  eps:'SLN' },
  { uf:'PA', cod:'91527', muni:'NOVA IPIXUNA',               sigla:'NPXA', eps:'SLN' },
  { uf:'PA', cod:'91103', muni:'RONDON DO PARA',             sigla:'RNP',  eps:'SLN' },
  { uf:'PA', cod:'91114', muni:'SAO DOMINGOS DO ARAGUAIA',   sigla:'SDAA', eps:'SLN' },
  { uf:'PA', cod:'91096', muni:'TUCURUI',                    sigla:'TUU',  eps:'SLN' },
  { uf:'PA', cod:'91747', muni:'CANAA DOS CARAJAS',          sigla:'CKJ',  eps:'SLN' },
  { uf:'PA', cod:'91620', muni:'ELDORADO DOS CARAJAS',       sigla:'EDRA', eps:'SLN' },
  { uf:'PA', cod:'91564', muni:'PARAUAPEBAS',                sigla:'PUP',  eps:'SLN' },
  { uf:'PA', cod:'91033', muni:'CONCEICAO DO ARAGUAIA',      sigla:'CIR',  eps:'SLN' },
  { uf:'PA', cod:'91074', muni:'REDENCAO',                   sigla:'RDO',  eps:'SLN' },
  { uf:'PA', cod:'91547', muni:'SAPUCAIA',                   sigla:'SPIA', eps:'SLN' },
  { uf:'PA', cod:'91504', muni:'XINGUARA',                   sigla:'XGA',  eps:'SLN' },
  { uf:'PA', cod:'91086', muni:'SANTAREM',                   sigla:'SRM',  eps:'SLN' },
  { uf:'PA', cod:'91004', muni:'ALENQUER',                   sigla:'ALQ',  eps:'SLN' },
  { uf:'PA', cod:'91056', muni:'MONTE ALEGRE',               sigla:'MNG',  eps:'SLN' },
  { uf:'PA', cod:'91006', muni:'ALTAMIRA',                   sigla:'ATM',  eps:'SLN' },
  { uf:'PA', cod:'91061', muni:'OBIDOS',                     sigla:'OIS',  eps:'SLN' },
  { uf:'PA', cod:'91115', muni:'TERRA SANTA',                sigla:'TESA', eps:'SLN' },
  { uf:'PA', cod:'91001', muni:'ABAETETUBA',                 sigla:'ABT',  eps:'SLN' },
  { uf:'PA', cod:'91055', muni:'MOJU',                       sigla:'MOJ',  eps:'SLN' },
  { uf:'PA', cod:'91510', muni:'TAILANDIA',                  sigla:'TLA',  eps:'SLN' },
  { uf:'PA', cod:'91095', muni:'TOME-ACU',                   sigla:'TOU',  eps:'SLN' },
  { uf:'PA', cod:'91005', muni:'ALMEIRIM',                   sigla:'AMM',  eps:'SLN' },
  { uf:'PA', cod:'91030', muni:'CASTANHAL',                  sigla:'CAH',  eps:'SLN' },
  { uf:'PA', cod:'91015', muni:'BARCARENA',                  sigla:'BCN',  eps:'SLN' },
  { uf:'PA', cod:'91018', muni:'BENEVIDES',                  sigla:'BVS',  eps:'SLN' },
  { uf:'PA', cod:'91696', muni:'MARITUBA',                   sigla:'MTUB', eps:'SLN' },
  { uf:'PA', cod:'91441', muni:'SANTA BARBARA DO PARA',      sigla:'SNBB', eps:'SLN' },
  { uf:'PA', cod:'91091', muni:'SANTA ISABEL DO PARA',       sigla:'SIP',  eps:'SLN' },
  { uf:'PA', cod:'91065', muni:'PARAGOMINAS',                sigla:'PGN',  eps:'SLN' },
  { uf:'PA', cod:'91363', muni:'ULIANOPOLIS',                sigla:'ULNS', eps:'SLN' },
  { uf:'PA', cod:'91020', muni:'BRAGANCA',                   sigla:'BGN',  eps:'SLN' },
  { uf:'PA', cod:'91028', muni:'CAPANEMA',                   sigla:'CPN',  eps:'SLN' },
  { uf:'PA', cod:'91060', muni:'NOVA TIMBOTEUA',             sigla:'NMB',  eps:'SLN' },
  { uf:'PA', cod:'91093', muni:'SANTA MARIA DO PARA',        sigla:'SID',  eps:'SLN' },
  { uf:'PA', cod:'91107', muni:'SANTA LUZIA DO PARA',        sigla:'SLPA', eps:'SLN' },
  { uf:'PA', cod:'',      muni:'MARIO COVAS',                sigla:'',     eps:'SLN' },
  { uf:'PA', cod:'',      muni:'GURUPI',                     sigla:'',     eps:'SLN' },
  // ── MARANHÃO ────────────────────────────────────────────────────────────
  { uf:'MA', cod:'98071', muni:'PACO DO LUMIAR',             sigla:'PCL',  eps:'SLN' },
  { uf:'MA', cod:'98103', muni:'SAO JOSE DE RIBAMAR',        sigla:'SJE',  eps:'SLN' },
  { uf:'MA', cod:'98000', muni:'SAO LUIS',                   sigla:'SLS',  eps:'SLN' },
  // ── AMAPÁ ───────────────────────────────────────────────────────────────
  { uf:'AP', cod:'96000', muni:'MACAPA',                     sigla:'MPA',  eps:'ADX' },
  // ── AMAZONAS ────────────────────────────────────────────────────────────
  { uf:'AM', cod:'92050', muni:'PARINTINS',                  sigla:'PAR',  eps:'ADX' },
];

// Palavras-chave adicionais que indicam acionamento
const PALAVRAS_ACIONAMENTO = [
  'falha','urgente','problema','acionamento','retorno','chamado',
  'atendimento','ocorrencia','incidente','socorro','erro','pane'
];

// Identificadores do Wanderson para contagem especial
const WANDERSON_IDS = ['WANDERSON MARCELLUS PENHA COSTA', '5586994944816'];

// Padrões de chamados massivos
const MASSIVO_RE = [
  { tipo: 'BDESK',    re: /\bbdesk\b/i },
  { tipo: 'TOTAL',    re: /tipo\s+de\s+falha\s*:\s*total/i },
  { tipo: 'CONJUNTA', re: /tipo\s*:\s*conjunta/i },
  { tipo: 'RUPTURA',  re: /tipo\s*:\s*ruptura/i },
];

// ── Estado em memória ───────────────────────────────────────────────────────
let mensagens    = [];
let chatList     = [];
let chamadosHoje = {}; // chave → { msgId, atualizacoes }
let contadores   = { total:0, PA:0, MA:0, AP:0, AM:0, WANDERSON:0 };
let statusWpp    = 'desconectado';

// ── Express + HTTP + WebSocket ──────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Serve login.html na raiz, painel apenas autenticado
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/painel', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Retorna data de hoje no formato YYYY-MM-DD
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// ── Persistência diária ─────────────────────────────────────────────────────
function dataFile() {
  return path.join(DATA_DIR, `data-${hoje()}.json`);
}

function carregarMensagens() {
  console.log(`📁 Dados em: ${DATA_DIR}`);
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    const salvo = JSON.parse(raw);
    mensagens    = salvo.mensagens || [];
    chamadosHoje = salvo.chamadosHoje || {};
    // Recalcula contadores a partir das mensagens salvas
    contadores = { total:0, PA:0, MA:0, AP:0, AM:0, WANDERSON:0 };
    mensagens.forEach(m => {
      if (!m.duplicado) {
        (m.uf||[]).forEach(u => { if (contadores[u] !== undefined) contadores[u]++; });
        if (m.temWanderson) contadores.WANDERSON++;
      }
    });
    contadores.total = contadores.PA + contadores.MA + contadores.AP + contadores.AM;
    console.log(`✅ ${mensagens.length} mensagens do dia restauradas`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Aviso ao carregar mensagens:', e.message);
    // arquivo não existe ainda — começa do zero
  }
}

function salvarMensagens() {
  try {
    fs.writeFileSync(dataFile(), JSON.stringify({ mensagens, chamadosHoje }), 'utf8');
  } catch (e) {
    console.error('Erro ao salvar mensagens:', e.message);
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;
  const user = usuarios.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(senha, user.senha))
    return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  const token = jwt.sign({ id: user.id, nome: user.nome, email: user.email, perfil: user.perfil }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, nome: user.nome, perfil: user.perfil });
});

app.get('/api/auth/me', autenticar, (req, res) => {
  res.json({ nome: req.usuario.nome, email: req.usuario.email, perfil: req.usuario.perfil });
});

// Admin: listar e gerenciar usuários
app.get('/api/usuarios', autenticar, apenasAdmin, (_, res) => {
  res.json(usuarios.map(({ senha, ...u }) => u));
});
app.post('/api/usuarios', autenticar, apenasAdmin, (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  if (!nome || !email || !senha || !['administrador','usuario'].includes(perfil))
    return res.status(400).json({ erro: 'Dados inválidos' });
  if (usuarios.find(u => u.email === email))
    return res.status(409).json({ erro: 'E-mail já cadastrado' });
  const novo = { id: String(Date.now()), nome, email, senha: bcrypt.hashSync(senha, 10), perfil };
  usuarios.push(novo);
  fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), 'utf8');
  const { senha: _, ...novoSemSenha } = novo;
  res.json(novoSemSenha);
});
app.delete('/api/usuarios/:id', autenticar, apenasAdmin, (req, res) => {
  const idx = usuarios.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (usuarios[idx].perfil === 'administrador' && usuarios.filter(u => u.perfil === 'administrador').length === 1)
    return res.status(400).json({ erro: 'Não é possível remover o único administrador' });
  usuarios.splice(idx, 1);
  fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), 'utf8');
  res.json({ ok: true });
});

// ── API REST ─────────────────────────────────────────────────────────────────
app.get('/api/status',    autenticar, (_, res) => res.json({ status: statusWpp, contadores }));
app.get('/api/mensagens', autenticar, (_, res) => res.json(mensagens.filter(m => m.dataDia === hoje())));
app.get('/api/base',      autenticar, (_, res) => res.json(BASE));
app.get('/api/chats',     autenticar, (_, res) => res.json(chatList));

// Marcar mensagem como lida
app.post('/api/mensagens/:id/lida', autenticar, (req, res) => {
  const msg = mensagens.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ erro: 'not found' });
  msg.lida = true;
  msg.lidaEm = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  salvarMensagens();
  broadcast('lida', { id: msg.id, lidaEm: msg.lidaEm });
  res.json({ ok: true, lidaEm: msg.lidaEm });
});

// Enviar resposta via WhatsApp
app.post('/api/reply', autenticar, apenasAdmin, async (req, res) => {
  const { numero, texto } = req.body;
  if (!numero || !texto) return res.status(400).json({ erro: 'numero e texto obrigatórios' });
  if (statusWpp !== 'conectado') return res.status(503).json({ erro: 'WhatsApp não está conectado' });
  try {
    await client.sendMessage(numero, texto);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar resposta:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// Mensagens de um chat/grupo específico (POST evita problemas com @ no path)
app.post('/api/chat-messages', autenticar, async (req, res) => {
  if (statusWpp !== 'conectado') return res.status(503).json({ erro: 'WhatsApp não conectado' });
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ erro: 'chatId obrigatório' });
  try {
    const chat = await client.getChatById(chatId);
    const msgs = await chat.fetchMessages({ limit: 50 });
    const result = msgs.map(m => ({
      id:     m.id._serialized,
      de:     m.fromMe ? 'Você' : (m._data.notifyName || m.author || ''),
      texto:  m.body || '',
      hora:   new Date(m.timestamp * 1000).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
      fromMe: m.fromMe,
    }));
    res.json({ chatId, nome: chat.name, messages: result });
  } catch (err) {
    console.error('Erro ao buscar msgs do chat:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// Carrega lista de chats sob demanda (evita timeout no startup)
let carregandoChats = false;
app.post('/api/chats/refresh', autenticar, async (req, res) => {
  if (statusWpp !== 'conectado') return res.status(503).json({ erro: 'WhatsApp não conectado' });
  if (carregandoChats) return res.status(429).json({ erro: 'Carregamento já em andamento' });
  carregandoChats = true;
  res.json({ ok: true, msg: 'Carregando chats em segundo plano...' });
  try {
    const chats = await Promise.race([
      client.getChats(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000)),
    ]);
    chatList = chats.slice(0, 80).map(c => ({
      id:       c.id._serialized,
      nome:     c.name || c.id.user || '',
      grupo:    c.isGroup,
      naoLidas: c.unreadCount || 0,
    }));
    broadcast('chats', chatList);
    console.log(`${chatList.length} chats carregados via refresh`);
  } catch (e) {
    console.error('Erro ao carregar chats (refresh):', e.message);
    broadcast('chats_erro', { erro: e.message });
  } finally {
    carregandoChats = false;
  }
});

// Desconectar WhatsApp (admin) — limpa sessão e gera novo QR
app.post('/api/whatsapp/desconectar', autenticar, apenasAdmin, async (req, res) => {
  try {
    statusWpp = 'desconectado';
    broadcast('status', { status: 'desconectado' });
    broadcast('qr_limpar', {});
    try { await client.logout(); } catch (_) {}
    try { await client.destroy(); } catch (_) {}
    res.json({ ok: true });
    // Reinicia cliente para gerar novo QR
    setTimeout(async () => {
      limparLockFilesChrome(WPP_SESSION_PATH);
      client = criarCliente();
      registrarEventos();
      await iniciarWhatsApp();
    }, 1500);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Flag em mensagem (toggle)
app.post('/api/mensagens/:id/flag', autenticar, (req, res) => {
  const msg = mensagens.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ erro: 'not found' });
  msg.flagged = !msg.flagged;
  salvarMensagens();
  broadcast('flag', { id: msg.id, flagged: msg.flagged });
  res.json({ ok: true, flagged: msg.flagged });
});

// Broadcast para todos os clientes WebSocket conectados
function broadcast(tipo, dados) {
  const payload = JSON.stringify({ tipo, dados, ts: Date.now() });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  });
}

// Heartbeat — mantém conexões vivas através do proxy do Railway (fecha ociosas após ~60s)
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  try {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const token  = params.get('token') || '';
    ws.usuario = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, 'Token inválido');
    return;
  }
  ws.send(JSON.stringify({ tipo:'init', dados: { statusWpp, contadores, mensagens, chatList, usuario: { nome: ws.usuario.nome, perfil: ws.usuario.perfil } } }));
});

// Detecta número de chamado: Bdesk (6 dígitos) ou Atrix (DDMMYYYY-NNNNN)
function extrairChamado(texto) {
  const atrix = texto.match(/\b(\d{6,8}-\d{4,6})\b/);
  if (atrix) return { tipo: 'atrix', numero: atrix[1] };
  const bdesk = texto.match(/\b(\d{6})\b/);
  if (bdesk) return { tipo: 'bdesk', numero: bdesk[1] };
  return null;
}

// ── Filtro de mensagem ──────────────────────────────────────────────────────
function analisarMensagem(texto) {
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const escRe = s => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const upper = norm(texto);
  // Remove códigos técnicos dot-separated (ex: br.ce.qxa.mob.gp.09) antes de correlacionar
  const cleaned = upper.replace(/[A-Z0-9]+(?:\.[A-Z0-9]+){2,}/g, ' ');

  const candidatos = [];

  for (const r of BASE) {
    const muniN = norm(r.muni);
    let melhorPos = Infinity;

    // 1. Padrão explícito "MUNICIPIO/UF", "MUNICIPIO-UF", "MUNICIPIO UF"
    for (const sep of ['/', '-', ' ']) {
      const pat = muniN + sep + r.uf;
      const idx = cleaned.indexOf(pat);
      if (idx !== -1 && idx < melhorPos) melhorPos = idx;
    }

    // 2. Nome do município com limite de palavra
    try {
      const muniRe = new RegExp('\\b' + escRe(muniN).replace(/\s+/g, '\\s+') + '\\b');
      const m = cleaned.match(muniRe);
      if (m) {
        const idx = cleaned.indexOf(m[0]);
        if (idx < melhorPos) melhorPos = idx;
      }
    } catch (_) {}

    // 3. Sigla com limite de palavra
    if (r.sigla) {
      try {
        const siglaRe = new RegExp('\\b' + escRe(r.sigla) + '\\b');
        const sm = cleaned.match(siglaRe);
        if (sm) {
          const idx = cleaned.indexOf(sm[0]);
          if (idx < melhorPos) melhorPos = idx;
        }
      } catch (_) {}
    }

    if (melhorPos !== Infinity) {
      candidatos.push({ r, pos: melhorPos });
    }
  }

  // Ordena pela posição na mensagem (primeiro endereço mencionado tem prioridade)
  candidatos.sort((a, b) => a.pos - b.pos);

  // Deduplica por município mantendo primeira ocorrência
  const vistos = new Set();
  const detectados = [];
  for (const { r } of candidatos) {
    if (!vistos.has(r.muni)) {
      vistos.add(r.muni);
      detectados.push(r);
    }
  }

  const temAcionamento = PALAVRAS_ACIONAMENTO.some(p => upper.includes(norm(p)));

  return { detectados, temAcionamento };
}

// ── Cliente WhatsApp ────────────────────────────────────────────────────────
function criarCliente() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: WPP_SESSION_PATH }),
    webVersionCache: { type: 'none' },
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 180000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees,IsolateOrigins,site-per-process',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off',
        '--disable-session-crashed-bubble',
        '--disable-crash-reporter',
      ],
    }
  });
}

let client = criarCliente();

function registrarEventos() {
  client.on('qr', async (qr) => {
    console.log('QR gerado — acesse http://localhost:3000 para escanear');
    statusWpp = 'aguardando_qr';
    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      broadcast('qr', { qrDataUrl });
    } catch (e) {
      console.error('Erro ao gerar QR:', e.message);
    }
  });

  client.on('ready', async () => {
    console.log('WhatsApp conectado!');
    statusWpp = 'conectado';
    broadcast('status', { status: 'conectado' });
    // Chats são carregados sob demanda via POST /api/chats/refresh para não sobrecarregar o container
  });

  client.on('disconnected', reason => {
    console.log('WhatsApp desconectado:', reason);
    statusWpp = 'desconectado';
    broadcast('status', { status: 'desconectado' });
    if (!reiniciando) {
      reiniciando = true;
      console.log('Reconectando em 10 segundos...');
      setTimeout(async () => {
        try { await client.destroy(); } catch (_) {}
        client = criarCliente();
        registrarEventos();
        reiniciando = false;
        iniciarWhatsApp();
      }, 10000);
    }
  });

  client.on('auth_failure', () => {
    statusWpp = 'erro_auth';
    broadcast('status', { status: 'erro_auth' });
  });

  // ── Recebimento de mensagens ──────────────────────────────────────────────
  client.on('message', async msg => {
  try {
    const texto = msg.body;

    // Log de diagnóstico — toda mensagem recebida (visível nos logs do Railway)
    console.log(`[MSG] de=${msg.from} grupo=${msg.from.includes('@g.us')} quoted=${!!msg.hasQuotedMsg} texto="${(texto||'').substring(0,80)}"`);

    if (!texto || texto.trim() === '') return;

    // item 12: ignora respostas citadas
    if (msg.hasQuotedMsg) return;

    const { detectados, temAcionamento } = analisarMensagem(texto);
    const temWanderson = WANDERSON_IDS.some(id =>
      texto.toUpperCase().includes(id.toUpperCase())
    );

    // Somente mensagens com município/UF reconhecido OU menção ao Wanderson
    if (detectados.length === 0 && !temWanderson) {
      console.log(`[FILTRADO] de=${msg.from} — nenhum município/Wanderson detectado`);
      return;
    }

    // item 12: ignora conteúdo repetido da mesma fonte no mesmo dia
    const jaDuplicada = mensagens.some(m =>
      m.numero === msg.from && m.texto === texto && m.dataDia === hoje()
    );
    if (jaDuplicada) {
      console.log(`[DUPLICADO] de=${msg.from}`);
      return;
    }

    // item 10: detecta RUPTURA
    const temRuptura = /\bRUPTURA\b/i.test(texto);

    // chamados massivos
    let temMassivo = false, tipoMassivo = null;
    for (const { tipo, re } of MASSIVO_RE) {
      if (re.test(texto)) { temMassivo = true; tipoMassivo = tipoMassivo || tipo; }
    }

    // item 6: deduplicação por chamado + UF
    const chamado = extrairChamado(texto);
    let duplicado = false;
    if (chamado) {
      const ufStr = [...new Set(detectados.map(d => d.uf))].sort().join('-');
      const chave = chamado.tipo + ':' + chamado.numero + (ufStr ? ':' + ufStr : '');
      if (chamadosHoje[chave]) {
        duplicado = true;
        chamadosHoje[chave].atualizacoes = (chamadosHoje[chave].atualizacoes || 0) + 1;
      } else {
        chamadosHoje[chave] = { atualizacoes: 0 };
      }
    }

    const chat    = await msg.getChat();
    const contact = await msg.getContact();

    const entrada = {
      id:        msg.id._serialized,
      de:        contact.pushname || contact.number || msg.from,
      numero:    msg.from,
      grupo:     chat.isGroup,
      nomeGrupo: chat.isGroup ? chat.name : null,
      texto,
      detectados,
      temAcionamento,
      uf:        [...new Set(detectados.map(d => d.uf))],
      siglas:    [...new Set(detectados.filter(d => d.sigla).map(d => d.sigla))],
      municipios:[...new Set(detectados.map(d => d.muni))],
      hora:      new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
      dataDia:   hoje(),
      ts:        Date.now(),
      lida:         false,
      lidaEm:       null,
      flagged:      false,
      temWanderson,
      temRuptura,
      temMassivo,
      tipoMassivo,
      chamado,
      duplicado,
    };

    mensagens.unshift(entrada);
    if (mensagens.length > 200) mensagens.pop();

    // item 11: total = PA + MA + AP + AM
    if (!duplicado) {
      if (detectados.length > 0) {
        entrada.uf.forEach(u => { if (contadores[u] !== undefined) contadores[u]++; });
        contadores.total = contadores.PA + contadores.MA + contadores.AP + contadores.AM;
      }
      if (temWanderson) contadores.WANDERSON++;
    }

    salvarMensagens();
    console.log(`[ACEITO] ${entrada.hora} | ${entrada.de} | munis=${entrada.municipios.join(',')} | ${texto.substring(0,60)}`);
    broadcast('mensagem', entrada);
    broadcast('contadores', contadores);
  } catch (err) {
    console.error('[ERRO msg] ao processar mensagem de', msg?.from, ':', err.message);
  }
  }); // fim client.on('message')
} // fim registrarEventos()

carregarMensagens(); // restaura mensagens do dia ao reiniciar
registrarEventos();

// ── Remove lock files do Chrome (evita trava após redeploy) ─────────────────
function limparLockFilesChrome(dir) {
  if (!fs.existsSync(dir)) return;
  const LOCKS = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (LOCKS.includes(e.name)) {
        try { fs.unlinkSync(p); console.log('Lock removido:', p); } catch (_) {}
      }
    }
  }
  walk(dir);
}

// ── Inicia servidor ─────────────────────────────────────────────────────────
let reiniciando = false;

async function iniciarWhatsApp() {
  if (reiniciando) return;
  limparLockFilesChrome(WPP_SESSION_PATH);
  try {
    await client.initialize();
  } catch (err) {
    console.error('Erro ao iniciar WhatsApp:', err.message);
    reiniciando = true;
    console.log('Reiniciando cliente em 8 segundos...');
    try { await client.destroy(); } catch (_) {}
    limparLockFilesChrome(WPP_SESSION_PATH);
    client = criarCliente();
    registrarEventos();
    setTimeout(() => { reiniciando = false; iniciarWhatsApp(); }, 8000);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('Erro não tratado:', reason?.message || reason);
});

// ── Reset diário à meia-noite ───────────────────────────────────────────────
function agendarResetMeiaNoite() {
  const agora   = new Date();
  const amanha  = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(0, 0, 0, 0);
  const ms = amanha - agora;
  setTimeout(() => {
    contadores   = { total:0, PA:0, MA:0, AP:0, AM:0, WANDERSON:0 };
    chatList     = [];
    chamadosHoje = {};
    mensagens    = [];
    salvarMensagens(); // cria o arquivo vazio do novo dia
    console.log('Reset diário realizado —', new Date().toLocaleString('pt-BR'));
    broadcast('reset_diario', { contadores });
    agendarResetMeiaNoite();
  }, ms);
  console.log(`Reset diário agendado para ${amanha.toLocaleTimeString('pt-BR')}`);
}

server.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`);
  console.log('Iniciando conexão com WhatsApp...\n');
  agendarResetMeiaNoite();
  iniciarWhatsApp();
});
