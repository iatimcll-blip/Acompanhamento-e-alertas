const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode      = require('qrcode');
const express     = require('express');
const http        = require('http');
const WebSocket   = require('ws');
const path        = require('path');
const fs          = require('fs');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');

// ── Configuração ────────────────────────────────────────────────────────────
const JWT_SECRET       = process.env.JWT_SECRET || 'mcll-monitoramento-secret-2024';
const PORT             = process.env.PORT || 3000;
const WPP_SESSION_PATH = process.env.WPP_SESSION_PATH || path.join(__dirname, '.wpp-session');

// Diretório de dados persistente — usa /data (volume Railway) quando disponível,
// senão cai para __dirname (desenvolvimento local)
const DATA_DIR   = fs.existsSync('/data') ? '/data' : __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@mcll.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mcll@admin2024';
const TZ = process.env.TZ_APP || 'America/Fortaleza';
const CMO_REPARO_FILTRO = process.env.CMO_REPARO_FILTRO || 'Carimbo Transferência - CMO REPARO';
const CMO_ATIVACAO_FILTRO = process.env.CMO_ATIVACAO_FILTRO || '';

// ── Usuários ────────────────────────────────────────────────────────────────
function carregarUsuarios() {
  if (!fs.existsSync(USERS_FILE)) {
    const usuarios = [
      { id:'1', nome:'Administrador', email:ADMIN_EMAIL,         senha: bcrypt.hashSync(ADMIN_PASSWORD, 10), senhaTexto: ADMIN_PASSWORD, perfil:'administrador' },
      { id:'2', nome:'Usuário',       email:'usuario@mcll.com',  senha: bcrypt.hashSync('mcll@2024', 10),      senhaTexto: 'mcll@2024',    perfil:'usuario' },
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), 'utf8');
    console.log('✅ Arquivo users.json criado com usuários padrão');
    return usuarios;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
let usuarios = carregarUsuarios();

function salvarUsuarios() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), 'utf8');
}

function garantirAdminPadrao() {
  const admin = usuarios.find(u => u.email === ADMIN_EMAIL);
  if (!admin) {
    usuarios.unshift({
      id: '1',
      nome: 'Administrador',
      email: ADMIN_EMAIL,
      senha: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      perfil: 'administrador',
    });
    salvarUsuarios();
    console.log('Usuario administrador padrao criado');
  }
  // Não reseta senha já existente — preserva mudanças feitas via interface
}
garantirAdminPadrao();

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
const WANDERSON_IDS = [
  'WANDERSON MARCELLUS PENHA COSTA',
  'MARCELLUS PENHA COSTA',
  '@WANDERSON',
  '5586994944816',
  '555586994944816',
  '+5586994944816',
  '86994944816',
];

// Padrões de chamados massivos
const MASSIVO_RE = [
  { tipo: 'BDESK',    re: /\bbdesk\b/i },
  { tipo: 'TOTAL',    re: /tipo\s+de\s+falha\s*:\s*total/i },
  { tipo: 'CONJUNTA', re: /tipo\s*:\s*conjunta/i },
  { tipo: 'RUPTURA',  re: /tipo\s*:\s*ruptura/i },
  { tipo: 'INFRA',    re: /tipo\s*:\s*infra(?:estrutura)?\b|\binfra(?:estrutura)?\b/i },
];

// ── Estado em memória ───────────────────────────────────────────────────────
let mensagens       = [];
let chatList        = [];
let chamadosHoje    = {}; // chave → { msgId, atualizacoes }
let chamadosStatus  = {}; // chave → { chamado, titulo, localidade, status, cmo, origem, timeline, criadoEm }
let contadores      = { total:0, PA:0, MA:0, AP:0, AM:0, WANDERSON:0, totalWhatsapp:0, cmoReparo:0, cmoAtivacao:0, fechado:0 };
let statusWpp       = 'desconectado';

const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL || '';

// ── Express + HTTP + WebSocket ──────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Serve login.html na raiz, painel apenas autenticado
app.get('/', (_, res) => { res.setHeader('Cache-Control','no-store'); res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/painel', (_, res) => { res.setHeader('Cache-Control','no-store'); res.sendFile(path.join(__dirname, 'index.html')); });
app.use(express.static(path.join(__dirname), { etag: false, lastModified: false }));
app.use(express.json());

// Retorna data de hoje no formato YYYY-MM-DD
function hoje() {
  return dataLocalKey();
}

function dataLocalKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dataHoraLocal(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function horaLocal(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function contemFiltro(texto, filtro) {
  if (!filtro) return false;
  return texto.toUpperCase().includes(filtro.toUpperCase());
}

function hashMensagem(texto, remetente, dataDia) {
  return crypto
    .createHash('sha1')
    .update(`${texto || ''}|${remetente || ''}|${dataDia || hoje()}`)
    .digest('hex')
    .slice(0, 16);
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

    // Re-executa detecção em cada mensagem para corrigir campos de versões antigas
    mensagens.forEach(m => {
      if (m.texto) {
        // Re-detecta município/UF
        const { detectados } = analisarMensagem(m.texto);
        m.detectados = detectados;
        m.uf         = [...new Set(detectados.map(d => d.uf))];
        m.municipios = [...new Set(detectados.map(d => d.muni))];
        m.siglas     = [...new Set(detectados.filter(d => d.sigla).map(d => d.sigla))];
        // Re-detecta tipo massivo (MASSIVO_RE pode ter ganho novas entradas como INFRA)
        let temMassivo = false, tipoMassivo = null;
        for (const { tipo, re } of MASSIVO_RE) {
          if (re.test(m.texto)) { temMassivo = true; tipoMassivo = tipoMassivo || tipo; }
        }
        m.temMassivo  = temMassivo;
        m.tipoMassivo = tipoMassivo;
      }
    });

    // Recalcula contadores a partir das mensagens salvas
    contadores = { total:0, PA:0, MA:0, AP:0, AM:0, WANDERSON:0, totalWhatsapp:0, cmoReparo:0, cmoAtivacao:0, fechado:0 };
    const _FECH_RE = /\bvalidad[oa]\b|\bnormalizad[oa]\b|\benvi(?:ar?|e|ou)\s+(?:a\s+)?rfo\b|\bmand(?:ar?|e|ou)\s+(?:a\s+)?rfo\b|\bcancelad[oa]\b|\bcancelamento\b/i;
    mensagens.forEach(m => {
      // Re-detecta temFechado para mensagens salvas antes do campo existir
      if (m.temFechado === undefined) {
        const t = (m.texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
        m.temFechado = _FECH_RE.test(t);
      }
      if (!m.duplicado) {
        // Fechado conta se: tem município OU (tem Bdesk/Atrix — histórico implícito pois foi salvo)
        if (m.temFechado && ((m.uf||[]).length > 0 || m.bdesk || m.atrix)) {
          contadores.fechado++;
        } else if (!m.temFechado && (m.uf||[]).length > 0) {
          (m.uf||[]).forEach(u => { if (contadores[u] !== undefined) contadores[u]++; });
          contadores.total++;
        }
        if (m.temWanderson)   contadores.WANDERSON++;
        if (m.temCmoReparo)   contadores.cmoReparo++;
        if (m.temCmoAtivacao) contadores.cmoAtivacao++;
      }
    });
    contadores.totalWhatsapp = salvo.totalWhatsapp || 0;
    chamadosStatus = salvo.chamadosStatus || {};
    console.log(`✅ ${mensagens.length} mensagens do dia restauradas`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Aviso ao carregar mensagens:', e.message);
    // arquivo não existe ainda — começa do zero
  }
}

function salvarMensagens() {
  try {
    fs.writeFileSync(dataFile(), JSON.stringify({ mensagens, chamadosHoje, totalWhatsapp: contadores.totalWhatsapp, chamadosStatus }), 'utf8');
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
  if (senha.length < 4)
    return res.status(400).json({ erro: 'Senha muito curta (mín. 4 caracteres)' });
  if (usuarios.find(u => u.email === email))
    return res.status(409).json({ erro: 'E-mail já cadastrado' });
  const novo = { id: String(Date.now()), nome, email, senha: bcrypt.hashSync(senha, 10), perfil };
  usuarios.push(novo);
  salvarUsuarios();
  const { senha: _, ...novoSemSenha } = novo;
  res.json(novoSemSenha);
});
app.delete('/api/usuarios/:id', autenticar, apenasAdmin, (req, res) => {
  const idx = usuarios.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (usuarios[idx].perfil === 'administrador' && usuarios.filter(u => u.perfil === 'administrador').length === 1)
    return res.status(400).json({ erro: 'Não é possível remover o único administrador' });
  usuarios.splice(idx, 1);
  salvarUsuarios();
  res.json({ ok: true });
});
app.put('/api/usuarios/:id/senha', autenticar, apenasAdmin, (req, res) => {
  const { novaSenha } = req.body;
  if (!novaSenha || novaSenha.length < 4) return res.status(400).json({ erro: 'Senha muito curta (mín. 4 caracteres)' });
  const user = usuarios.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });
  user.senha = bcrypt.hashSync(novaSenha, 10);
  delete user.senhaTexto;
  salvarUsuarios();
  res.json({ ok: true });
});

// ── Chamados Status (Atualização / Status) ────────────────────────────────────
app.get('/api/chamados', autenticar, (_, res) => res.json(chamadosStatus));

app.post('/api/chamados/:chave/atualizar', autenticar, (req, res) => {
  const { chave } = req.params;
  const { texto, status, autor } = req.body;
  if (!chave) return res.status(400).json({ erro: 'chave obrigatória' });
  if (!chamadosStatus[chave]) return res.status(404).json({ erro: 'Chamado não encontrado' });
  const ch = chamadosStatus[chave];
  const statusAnterior = ch.status;
  if (texto && texto.trim()) {
    ch.timeline.push({ ts: Date.now(), texto: texto.trim(), autor: autor || req.usuario.nome, auto: false });
  }
  if (status) ch.status = status;
  ch.atualizadoEm = Date.now();
  salvarMensagens();
  broadcast('chamado_update', { chave, dados: ch });

  // Push automático para Google Sheets (TIMELINE_STATUS)
  if (texto && texto.trim() && SHEETS_WEBHOOK) {
    enviarParaSheets('TIMELINE_STATUS', {
      data_hora:           dataHoraLocal(),
      chave_unica:         chave,
      atrix:               ch.atrix || '',
      bdesk:               ch.bdesk || '',
      localidade:          ch.localidade || '',
      status_anterior:     statusAnterior || '',
      status_novo:         status || statusAnterior || '',
      texto_atualizacao:   texto.trim(),
      responsavel:         autor || req.usuario.nome,
      origem:              'Painel Web',
      data_registro:       dataHoraLocal(),
    }).catch(() => {});
  }

  res.json({ ok: true });
});

app.delete('/api/chamados/:chave', autenticar, apenasAdmin, (req, res) => {
  delete chamadosStatus[req.params.chave];
  salvarMensagens();
  broadcast('chamado_removido', { chave: req.params.chave });
  res.json({ ok: true });
});

// ── Google Sheets: push interno (não bloqueia o fluxo principal) ─────────────
async function enviarParaSheets(aba, dados) {
  if (!SHEETS_WEBHOOK) return;
  try {
    const https = require('https');
    const http  = require('http');
    const payload = JSON.stringify({ aba, dados });
    const url = new URL(SHEETS_WEBHOOK);
    const mod = url.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const r = mod.request(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, resp => { resp.resume(); resolve(); });
      r.on('error', reject);
      r.setTimeout(8000, () => r.destroy());
      r.write(payload);
      r.end();
    });
  } catch (e) {
    console.error('[SHEETS] Erro ao enviar para', aba, ':', e.message);
  }
}

// ── Google Sheets Webhook ─────────────────────────────────────────────────────
app.post('/api/sheets/push', autenticar, async (req, res) => {
  if (!SHEETS_WEBHOOK) return res.status(503).json({ erro: 'SHEETS_WEBHOOK_URL não configurado' });
  try {
    const https = require('https');
    const http  = require('http');
    const payload = JSON.stringify(req.body);
    const url = new URL(SHEETS_WEBHOOK);
    const mod = url.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const r = mod.request(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, resp => {
        resp.resume();
        resolve();
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ── API REST ─────────────────────────────────────────────────────────────────
app.get('/api/status',    autenticar, (_, res) => res.json({ status: statusWpp, contadores }));
app.get('/api/mensagens', autenticar, (_, res) => res.json(mensagens.filter(m => m.dataDia === hoje())));
app.get('/api/base',      autenticar, (_, res) => res.json(BASE));
app.get('/api/chats',     autenticar, (_, res) => res.json(chatList));

app.post('/api/sync/mensagens', autenticar, async (_, res) => {
  if (statusWpp !== 'conectado') return res.status(503).json({ erro: 'WhatsApp nao conectado' });
  if (sincronizandoMensagens) return res.status(202).json({ ok: true, msg: 'Sincronizacao ja em andamento' });

  res.json({ ok: true, msg: 'Sincronizacao iniciada em segundo plano' });
  sincronizarMensagensRecentes().catch(e => {
    console.error('Erro ao sincronizar mensagens:', e.message);
  });
});

// Marcar todas as mensagens como lidas
app.post('/api/mensagens/todas-lidas', autenticar, (req, res) => {
  const agora = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const atualizadas = [];
  mensagens.forEach(m => {
    if (!m.lida) {
      m.lida = true;
      m.lidaEm = agora;
      atualizadas.push({ id: m.id, lidaEm: agora });
    }
  });
  if (atualizadas.length > 0) {
    salvarMensagens();
    atualizadas.forEach(a => broadcast('lida', a));
  }
  res.json({ ok: true, total: atualizadas.length });
});

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

// Carrega lista de chats sob demanda (disponível para todos os usuários autenticados)
let carregandoChats = false;
app.post('/api/chats/refresh', autenticar, async (req, res) => {
  if (statusWpp !== 'conectado') return res.status(503).json({ erro: 'WhatsApp não conectado' });
  if (carregandoChats) return res.status(429).json({ erro: 'Carregamento já em andamento' });
  carregandoChats = true;
  res.json({ ok: true, msg: 'Carregando chats em segundo plano...' });
  try {
    const chats = await Promise.race([
      client.getChats(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000)),
    ]);
    chatList = chats.slice(0, 80).map(c => ({
      id:       c.id._serialized,
      nome:     c.name || c.id.user || '',
      grupo:    c.isGroup,
      naoLidas: c.unreadCount || 0,
    }));
    contadores.totalWhatsapp = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    broadcast('chats', chatList);
    broadcast('contadores', contadores);
    sincronizarMensagensRecentes(chats).catch(e => {
      console.error('Erro ao sincronizar mensagens apos refresh:', e.message);
    });
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
  const comTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  try {
    statusWpp = 'desconectado';
    broadcast('status', { status: 'desconectado' });
    broadcast('qr_limpar', {});
    try { await comTimeout(client.logout(),  5000); } catch (_) {}
    try { await comTimeout(client.destroy(), 5000); } catch (_) {}
    res.json({ ok: true });
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
  ws.send(JSON.stringify({ tipo:'init', dados: { statusWpp, contadores, mensagens, chatList, chamadosStatus, usuario: { nome: ws.usuario.nome, perfil: ws.usuario.perfil } } }));
});

// Detecta número de chamado: Bdesk (6 dígitos) ou Atrix (DDMMYYYY-NNNNN)
function extrairChamado(texto) {
  const chamados = extrairChamados(texto);
  if (chamados.atrix) return { tipo: 'atrix', numero: chamados.atrix };
  if (chamados.bdesk) return { tipo: 'bdesk', numero: chamados.bdesk };
  return null;
}

function extrairChamados(texto) {
  const raw = texto || '';
  const atrix = raw.match(/\b(?:ATRIX|ATRX)\s*[:#-]?\s*(\d{5,10}(?:-\d{3,8})?)\b/i)
    || raw.match(/\b(\d{6,8}-\d{4,6})\b/);
  const bdesk = raw.match(/\bBDESK\s*[:#-]?\s*(\d{5,8})\b/i);
  return {
    atrix: atrix ? atrix[1] : null,
    bdesk: bdesk ? bdesk[1] : null,
  };
}

function chaveUnicaChamado(chamados, texto, remetente, dataDia) {
  if (chamados.atrix) return `atrix:${chamados.atrix}`;
  if (chamados.bdesk) return `bdesk:${chamados.bdesk}`;
  return `hash:${hashMensagem(texto, remetente, dataDia)}`;
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

    // 3. Sigla com limite de palavra (mín. 4 chars — evita falsos positivos com palavras comuns: PAR, MBA, ATM…)
    if (r.sigla && r.sigla.length >= 4) {
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

  // 4. Código técnico BR-UF-SIGLA-... (ex: BR-PA-BLM-PIE-TP-01 100GE0/0/3)
  const techRe = /\bBR[-]([A-Z]{2})[-]([A-Z]{2,6})[-]/g;
  let tm;
  while ((tm = techRe.exec(upper)) !== null) {
    const ufCode = tm[1];
    const sigla  = tm[2];
    const found  = BASE.find(r => r.uf === ufCode && norm(r.sigla) === sigla);
    if (found) candidatos.push({ r: found, pos: tm.index });
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
let sincronizandoMensagens = false;

async function processarMensagemWhatsApp(msg, origem = 'ao vivo') {
  // Conta todas as mensagens do WhatsApp antes de qualquer filtro
  if (origem === 'ao vivo') {
    contadores.totalWhatsapp = (contadores.totalWhatsapp || 0) + 1;
    broadcast('contadores', contadores);
  }

  const texto = msg.body;

  console.log(`[MSG:${origem}] de=${msg.from} grupo=${msg.from.includes('@g.us')} quoted=${!!msg.hasQuotedMsg} texto="${(texto||'').substring(0,80)}"`);

  if (!texto || texto.trim() === '') return false;

  const msgDate = msg.timestamp
    ? new Date(msg.timestamp * 1000)
    : new Date();
  const dataMsg = dataLocalKey(msgDate);
  if (dataMsg !== hoje()) return false;

  const { detectados, temAcionamento } = analisarMensagem(texto);
  // Detecta Wanderson: pelo texto (menção) OU pelo número do remetente (msg enviada por ele)
  const _wSenderNum = ((msg.author || msg.from || '')).replace(/\D/g, '');
  const temWanderson = WANDERSON_IDS.some(id => {
    const n = id.replace(/\D/g, '');
    if (n.length >= 8) return _wSenderNum.includes(n) || texto.toUpperCase().includes(id.toUpperCase());
    return texto.toUpperCase().includes(id.toUpperCase());
  });
  // Detecta chamado e fechado ANTES do filtro
  const chamados = extrairChamados(texto);
  const _textoFech = texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const temFechado = /\bvalidad[oa]\b|\bnormalizad[oa]\b|\benvi(?:ar?|e|ou)\s+(?:a\s+)?rfo\b|\bmand(?:ar?|e|ou)\s+(?:a\s+)?rfo\b|\bcancelad[oa]\b|\bcancelamento\b/i.test(_textoFech);
  const temChamado = !!(chamados.bdesk || chamados.atrix);
  // Chave antecipada para consultar histórico antes do filtro
  const _chavePreFiltro = chamados.atrix ? `atrix:${chamados.atrix}`
    : chamados.bdesk ? `bdesk:${chamados.bdesk}` : null;
  const temHistoricoDoDia = _chavePreFiltro
    ? !!(chamadosHoje[_chavePreFiltro] || mensagens.some(m => m.chaveUnica === _chavePreFiltro && m.dataDia === hoje()))
    : false;

  // Passa se: tem município OU Wanderson OU (fechado + Bdesk/Atrix + histórico do dia)
  if (detectados.length === 0 && !temWanderson && !(temFechado && temChamado && temHistoricoDoDia)) {
    console.log(`[FILTRADO:${origem}] de=${msg.from} - sem municipio/Wanderson/Fechado+historico`);
    return false;
  }

  const temRuptura    = /\bRUPTURA\b/i.test(texto);
  const cmoReparoConfigurado = contemFiltro(texto, CMO_REPARO_FILTRO);
  const cmoAtivacaoConfigurado = contemFiltro(texto, CMO_ATIVACAO_FILTRO);
  const temCmoReparo  = /CMO\s*REPARO|CARIMBO\s+TRANSFER[EÊ]NCIA\s*[-–]?\s*CMO\s*REPARO/i.test(texto);
  const temCmoAtivacao= /CMO\s*ATIVA[CÇ][AÃ]O|IMPLANTA[CÇ][AÃ]O\s*(DE\s+PROJETO)?|INSTALA[CÇ][AÃ]O\s+DE\s+EQUIPAMENTO|VISTORIA(\s+DE\s+REDE)?|LAN[CÇ]AMENTO/i.test(texto);

  let temMassivo = false, tipoMassivo = null;
  for (const { tipo, re } of MASSIVO_RE) {
    if (re.test(texto)) { temMassivo = true; tipoMassivo = tipoMassivo || tipo; }
  }

  const chamado = extrairChamado(texto);
  const chaveUnica = chaveUnicaChamado(chamados, texto, msg.from, dataMsg);
  const duplicado = mensagens.some(m =>
    (m.id === msg.id._serialized) ||
    (m.chaveUnica === chaveUnica && m.dataDia === hoje())
  );

  chamadosHoje[chaveUnica] = chamadosHoje[chaveUnica] || { msgId: msg.id._serialized, atualizacoes: 0 };
  if (duplicado) {
    chamadosHoje[chaveUnica].atualizacoes = (chamadosHoje[chaveUnica].atualizacoes || 0) + 1;
    console.log(`[DUPLICADO:${origem}] chave=${chaveUnica} de=${msg.from}`);
  }

  // Fechamento de ciclo: chamado ativo que chegou agora com status fechado
  // Move o chamado original de ativo (total/UF) para fechado sem precisar de novo contador
  let fechouChamadoAtivo = false;
  if (duplicado && temFechado && temChamado) {
    const original = mensagens.find(m =>
      m.chaveUnica === chaveUnica && m.dataDia === hoje() && !m.temFechado && !m.duplicado
    );
    if (original) {
      original.temFechado = true;
      fechouChamadoAtivo = true;
      (original.uf || []).forEach(u => { if (contadores[u] !== undefined && contadores[u] > 0) contadores[u]--; });
      if (contadores.total > 0) contadores.total--;
      contadores.fechado++;
      console.log(`[FECHAMENTO] chave=${chaveUnica} movido de ativo para fechado`);
      broadcast('atualizar-mensagem', { id: original.id, temFechado: true });
      salvarMensagens();
    }
  }

  let chat = null, contact = null;
  try { chat = await msg.getChat(); } catch (_) {}
  try { contact = await msg.getContact(); } catch (_) {}

  // Baixa mídia quando disponível (imagens, arquivos, vídeos)
  let mediaData = null, mediaMime = null, mediaFilename = null;
  if (msg.hasMedia) {
    try {
      const media = await Promise.race([
        msg.downloadMedia(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]);
      if (media && media.data) {
        mediaMime     = media.mimetype || '';
        mediaFilename = media.filename || null;
        if (mediaMime.startsWith('image/')) {
          const sz = Buffer.from(media.data, 'base64').length;
          if (sz < 2 * 1024 * 1024) mediaData = media.data; // máx 2 MB
        }
      }
    } catch (_) {}
  }

  const entrada = {
    id:        msg.id._serialized,
    de:        contact?.pushname || contact?.number || msg._data?.notifyName || msg.author || msg.from,
    numero:    msg.from,
    grupo:     Boolean(chat?.isGroup || msg.from.includes('@g.us')),
    nomeGrupo: chat?.isGroup ? chat.name : null,
    texto,
    detectados,
    temAcionamento,
    uf:        [...new Set(detectados.map(d => d.uf))],
    siglas:    [...new Set(detectados.filter(d => d.sigla).map(d => d.sigla))],
    municipios:[...new Set(detectados.map(d => d.muni))],
    hora:      horaLocal(msgDate),
    recebidoEm: dataHoraLocal(msgDate),
    dataDia:   dataMsg,
    ts:        msgDate.getTime(),
    lida:         false,
    lidaEm:       null,
    flagged:      false,
    temWanderson,
    temRuptura,
    temFechado,
    temCmoReparo: cmoReparoConfigurado || temCmoReparo,
    temCmoAtivacao: cmoAtivacaoConfigurado || temCmoAtivacao,
    temMassivo,
    tipoMassivo,
    chamado,
    atrix: chamados.atrix,
    bdesk: chamados.bdesk,
    chaveUnica,
    duplicado,
    mediaData,
    mediaMime,
    mediaFilename,
  };

  mensagens.unshift(entrada);
  if (mensagens.length > 200) mensagens.pop();

  if (!duplicado) {
    if (temFechado && (detectados.length > 0 || (temChamado && temHistoricoDoDia))) {
      contadores.fechado++;
    } else if (!temFechado && detectados.length > 0) {
      entrada.uf.forEach(u => { if (contadores[u] !== undefined) contadores[u]++; });
      contadores.total++;
    }
    if (temWanderson)   contadores.WANDERSON++;
    if (cmoReparoConfigurado || temCmoReparo)   contadores.cmoReparo++;
    if (cmoAtivacaoConfigurado || temCmoAtivacao) contadores.cmoAtivacao++;
  }

  // Registra chamado no chamadosStatus para timeline
  if (entrada.chamado) {
    const chave = entrada.chaveUnica;
    if (!chamadosStatus[chave]) {
      const loc = (entrada.municipios || [])[0] || '';
      chamadosStatus[chave] = {
        chamado: entrada.chamado,
        atrix: entrada.atrix,
        bdesk: entrada.bdesk,
        titulo:  texto.substring(0, 80),
        localidade: loc,
        status:  'aguardando',
        cmo:     (cmoReparoConfigurado || temCmoReparo) ? 'reparo' : ((cmoAtivacaoConfigurado || temCmoAtivacao) ? 'ativacao' : 'nenhum'),
        origem:  'WhatsApp',
        chatId:  entrada.numero,
        nomeGrupo: entrada.nomeGrupo || null,
        timeline: [{ ts: entrada.ts, texto: `Mensagem recebida de ${entrada.de}`, auto: true }],
        criadoEm: entrada.ts,
        primeiraMensagemRecebida: entrada.ts,
        ultimaMensagemRecebida: entrada.ts,
        quantidadeMensagens: 1,
      };
    } else {
      chamadosStatus[chave].ultimaMensagemRecebida = entrada.ts;
      chamadosStatus[chave].quantidadeMensagens = (chamadosStatus[chave].quantidadeMensagens || 1) + 1;
      chamadosStatus[chave].timeline.push({ ts: entrada.ts, texto: `Mensagem atualizada de ${entrada.de}`, auto: true });
    }
  }

  salvarMensagens();
  console.log(`[ACEITO:${origem}] ${entrada.hora} | ${entrada.de} | munis=${entrada.municipios.join(',')} | ${texto.substring(0,60)}`);
  broadcast('mensagem', entrada);
  broadcast('contadores', contadores);

  // Push automático para Google Sheets (BASE_MENSAGENS)
  if (!duplicado && SHEETS_WEBHOOK) {
    const localidade = (entrada.municipios || [])[0] || '';
    enviarParaSheets('BASE_MENSAGENS', {
      id: entrada.id,
      data_recebimento: dataMsg,
      hora_recebimento: entrada.hora,
      origem,
      remetente: entrada.de,
      grupo: entrada.nomeGrupo || '',
      mensagem_original: texto,
      atrix: entrada.atrix || '',
      bdesk: entrada.bdesk || '',
      titulo: texto.substring(0, 80),
      localidade,
      classificacao: entrada.temRuptura ? 'RUPTURA' : (entrada.temAcionamento ? 'URGENTE' : 'NORMAL'),
      cmo_reparo:    entrada.temCmoReparo   ? 'SIM' : 'NAO',
      cmo_ativacao:  entrada.temCmoAtivacao ? 'SIM' : 'NAO',
      nao_lida:      'SIM',
      duplicada:     duplicado ? 'SIM' : 'NAO',
      chave_unica:   entrada.chaveUnica,
      data_processamento: dataHoraLocal(),
    }).catch(() => {});

    // Push BASE_CHAMADOS quando chamado é criado pela primeira vez
    if (entrada.chamado && chamadosStatus[entrada.chaveUnica] && chamadosStatus[entrada.chaveUnica].quantidadeMensagens === 1) {
      const ch = chamadosStatus[entrada.chaveUnica];
      enviarParaSheets('BASE_CHAMADOS', {
        chave_unica:             entrada.chaveUnica,
        atrix:                   entrada.atrix || '',
        bdesk:                   entrada.bdesk || '',
        titulo:                  texto.substring(0, 80),
        localidade,
        primeira_mensagem:       dataHoraLocal(new Date(ch.criadoEm)),
        ultima_mensagem:         dataHoraLocal(new Date(ch.ultimaMensagemRecebida)),
        quantidade_mensagens:    ch.quantidadeMensagens,
        status_atual:            ch.status,
        cmo_reparo:              ch.cmo === 'reparo'   ? 'SIM' : 'NAO',
        cmo_ativacao:            ch.cmo === 'ativacao' ? 'SIM' : 'NAO',
        tempo_iniciado:          '',
        tempo_decorrido:         '',
        responsavel:             '',
        ultima_atualizacao:      dataHoraLocal(),
      }).catch(() => {});
    }
  }

  return true;
}

async function sincronizarMensagensRecentes(chatsOrigem = null) {
  if (statusWpp !== 'conectado') return { ok: false, erro: 'WhatsApp nao conectado' };
  if (sincronizandoMensagens) return { ok: false, erro: 'Sincronizacao ja em andamento' };

  sincronizandoMensagens = true;
  let analisadas = 0, aceitas = 0, erros = 0;
  broadcast('sync_status', { em_andamento: true, analisadas: 0, aceitas: 0 });
  try {
    const chats = chatsOrigem || await Promise.race([
      client.getChats(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ao carregar chats')), 90000)),
    ]);
    // Popula e transmite lista de grupos/contatos automaticamente (sem precisar clicar em 🔄)
    if (!chatsOrigem && chats.length > 0) {
      chatList = chats.slice(0, 80).map(c => ({
        id:       c.id._serialized,
        nome:     c.name || c.id.user || '',
        grupo:    c.isGroup,
        naoLidas: c.unreadCount || 0,
      }));
      contadores.totalWhatsapp = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
      broadcast('chats', chatList);
    }
    // Ordena por mensagem mais recente (inclui chats sem não-lidas mas com msgs de hoje)
    const agora = Date.now() / 1000;
    // Início do dia no timezone configurado (evita usar timezone do SO que pode ser UTC no Railway)
    const _hojeParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()).split('-').map(Number);
    const tsHoje = new Date(`${_hojeParts[0]}-${String(_hojeParts[1]).padStart(2,'0')}-${String(_hojeParts[2]).padStart(2,'0')}T00:00:00`).getTime() / 1000;
    const ordenados = chats
      .slice()
      .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0))
      .filter(c => (c.lastMessage?.timestamp || 0) >= tsHoje) // apenas chats com msgs hoje
      .slice(0, 120);

    for (const chat of ordenados) {
      try {
        const msgs = await Promise.race([
          chat.fetchMessages({ limit: 40 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
        ]);
        for (const msg of msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))) {
          analisadas++;
          if (await processarMensagemWhatsApp(msg, 'sync')) aceitas++;
        }
      } catch (e) {
        erros++;
        console.error(`[SYNC] Erro no chat ${chat.name || chat.id?._serialized || ''}:`, e.message);
        // Aguarda brevemente antes de continuar (evita sobrecarregar API)
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (aceitas > 0) {
      salvarMensagens();
      broadcast('contadores', contadores);
    }
    broadcast('sync_status', { em_andamento: false, analisadas, aceitas, erros });
    console.log(`[SYNC] analisadas=${analisadas} aceitas=${aceitas} erros=${erros}`);
    return { ok: true, analisadas, aceitas, erros };
  } catch (e) {
    broadcast('sync_status', { em_andamento: false, erro: e.message });
    throw e;
  } finally {
    sincronizandoMensagens = false;
  }
}

// Rotina de sincronização periódica automática (a cada 5 min)
let _syncPeriodico = null;
function iniciarSyncPeriodico() {
  if (_syncPeriodico) clearInterval(_syncPeriodico);
  _syncPeriodico = setInterval(() => {
    if (statusWpp === 'conectado' && !sincronizandoMensagens) {
      console.log('[SYNC PERIÓDICO] Iniciando sincronização automática...');
      sincronizarMensagensRecentes().catch(e =>
        console.error('[SYNC PERIÓDICO] Erro:', e.message)
      );
    }
  }, 5 * 60 * 1000);
}

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
    setTimeout(() => {
      sincronizarMensagensRecentes().catch(e => {
        console.error('Erro ao sincronizar mensagens no ready:', e.message);
      });
    }, 5000);
    iniciarSyncPeriodico();
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
      await processarMensagemWhatsApp(msg, 'ao vivo');
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
  // Calcula meia-noite no timezone configurado (TZ_APP), não do SO
  const agora  = new Date();
  const agoraLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(agora);
  const [y, m, d] = agoraLocal.split('-').map(Number);
  // Meia-noite de amanhã em TZ_APP convertida para UTC
  const amanhaTZ   = new Date(Date.UTC(y, m - 1, d + 1)); // aproximação inicial
  // Ajusta para meia-noite exata no TZ
  const offsetMs   = amanhaTZ - new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false }).format(amanhaTZ).replace(/(\d{4}-\d{2}-\d{2}), (\d{2}:\d{2}:\d{2})/, '$1T$2'));
  const meiaNoite  = new Date(amanhaTZ.getTime() + offsetMs);
  const ms         = meiaNoite - agora;
  const msAjustado = ms > 0 ? ms : ms + 86400000; // fallback: nunca negativo
  setTimeout(() => {
    contadores      = { total:0, PA:0, MA:0, AP:0, AM:0, WANDERSON:0, totalWhatsapp:0, cmoReparo:0, cmoAtivacao:0, fechado:0 };
    chatList        = [];
    chamadosHoje    = {};
    chamadosStatus  = {};
    mensagens       = [];
    salvarMensagens();
    console.log('Reset diário realizado —', dataHoraLocal());
    broadcast('reset_diario', { contadores });
    agendarResetMeiaNoite();
  }, msAjustado);
  const proxima = new Date(agora.getTime() + msAjustado);
  console.log(`Reset diário agendado para ${proxima.toLocaleString('pt-BR', { timeZone: TZ })}`);
}

server.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`);
  console.log('Iniciando conexão com WhatsApp...\n');
  agendarResetMeiaNoite();
  iniciarWhatsApp();
});
