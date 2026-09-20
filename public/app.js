/* ==========================================================
   CRM Luca Ternes — painel
   ========================================================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let TOKEN = localStorage.getItem('crm_token') || '';
let EU = null, PLANOS = [], TELA = 'home', CACHE = {};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2600);
}

async function api(rota, opt = {}) {
  const r = await fetch('/api' + rota, {
    ...opt,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(opt.headers || {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && TELA !== 'login') { sair(true); throw new Error('sessão expirada'); }
  if (!r.ok) throw new Error(j.error || 'Erro inesperado');
  return j;
}

/* ---------- formatação ---------- */
const SIMB = { BRL: 'R$', USD: 'US$', GBP: '£', EUR: '€' };
const money = (v, m = 'BRL') =>
  (SIMB[m] || m) + ' ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (d) => (!d ? '—' : String(d).slice(0, 10).split('-').reverse().join('/'));
const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
function horaBR(iso) { return iso && iso.length > 10 ? iso.slice(11, 16) : ''; }
const nomeCompleto = (p) =>
  `${p.cod ? `<span class="cod">${esc(p.cod)}</span> ` : ''}<b>${esc(p.nome)}</b>` +
  (p.apelido ? ` <span class="apelido">“${esc(p.apelido)}”</span>` : '');
const zap = (tel, msg = '') => {
  if (!tel) return toast('Paciente sem telefone cadastrado');
  const n = String(tel).replace(/\D/g, '');
  window.open(`https://wa.me/${n}${msg ? '?text=' + encodeURIComponent(msg) : ''}`, '_blank');
};

// laranja = marcado · verde = realizado · vermelho = cancelado
const CORES_COMPROMISSO = {
  marcado:   { bg: '#FDF0DC', txt: '#8A5A00', borda: '#E09112' },
  feito:     { bg: '#E3F3EA', txt: '#14653C', borda: '#1E8E5A' },
  cancelado: { bg: '#FCECE9', txt: '#93261A', borda: '#C0392B' },
};
const ROTULO_COMPROMISSO = { marcado: 'Marcado', feito: 'Realizado', cancelado: 'Cancelado' };

const OBJETIVOS = ['Emagrecimento', 'Definição muscular', 'Ganho de massa muscular', 'Manutenção do peso'];
// base real do Luca: 8 países. Lista cresce sozinha com o que estiver cadastrado.
const PAISES_BASE = ['Brasil', 'US', 'Portugal', 'Inglaterra', 'Canadá', 'Colômbia', 'Luxemburgo', 'Tchéquia'];
let PAISES = [...PAISES_BASE];
const STATUS = ['ativo', 'devendo', 'encerrado', 'parceria', 'lead'];
const FORMAS = ['pix', 'asaas', 'infinity', 'zelle', 'paypal', 'outro'];
const MOEDAS = ['BRL', 'USD', 'GBP', 'EUR'];

/* ==========================================================
   LOGIN
   ========================================================== */
async function bootLogin() {
  try {
    const s = await fetch('/api/setup').then((r) => r.json());
    if (s.precisa_setup) {
      $('#setupAviso').classList.remove('hide');
      $('#wrapNome').classList.remove('hide');
      $('#btnEntrar').textContent = 'Criar acesso';
      $('#btnEntrar').dataset.setup = '1';
    }
  } catch { /* segue no login normal */ }
}

$('#btnEntrar').onclick = async () => {
  const email = $('#inEmail').value.trim(), senha = $('#inSenha').value;
  const erro = $('#loginErro'); erro.textContent = '';
  if (!email || !senha) { erro.textContent = 'Preencha e-mail e senha.'; return; }
  try {
    if ($('#btnEntrar').dataset.setup) {
      await fetch('/api/setup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: $('#inNome').value, email, senha }),
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); });
    }
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    TOKEN = j.token; EU = j.usuario;
    localStorage.setItem('crm_token', TOKEN);
    entrarApp();
  } catch (e) { erro.textContent = e.message; }
};
$('#inSenha').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnEntrar').click(); });

function sair(expirou) {
  if (!expirou) api('/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('crm_token'); TOKEN = ''; EU = null;
  $('#app').classList.add('hide'); $('#login').classList.remove('hide');
  if (expirou) $('#loginErro').textContent = 'Sessão expirada. Entre novamente.';
}
$('#btnSair').onclick = () => sair(false);

async function entrarApp() {
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  PLANOS = (await api('/planos')).planos;
  irPara('home');
}

$$('#nav button').forEach((b) => { b.onclick = () => irPara(b.dataset.tela); });
function irPara(t) {
  TELA = t;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tela === t));
  ({ home: telaHome, funil: telaFunil, pacientes: telaPacientes, agenda: telaAgenda,
     financeiro: telaFinanceiro, planos: telaPlanos, config: telaConfig }[t])();
}

/* ==========================================================
   HOME — o dia do Luca
   ========================================================== */
async function telaHome() {
  $('#tela').innerHTML = '<p class="vazio">Carregando…</p>';
  await api('/funil/sincronizar', { method: 'POST', body: {} }).catch(() => {});
  const d = await api('/home');
  CACHE.home = d;

  const h = d.hoje;
  const atrasadas = d.cobrancas.filter((c) => c.situacao === 'atrasada');
  const deHoje = d.cobrancas.filter((c) => c.situacao === 'hoje');
  const proximas = d.cobrancas.filter((c) => c.situacao === 'proxima');
  const callsHoje = d.calls.filter((c) => c.dias <= 0);

  // o contador do menu é só o que precisa de ação HOJE
  const agir = callsHoje.length + d.follow_venda.length + atrasadas.length + deHoje.length;
  const bd = $('#bdHome');
  if (agir) { bd.textContent = agir; bd.classList.remove('hide'); } else bd.classList.add('hide');
  const bdF = $('#bdFunil');
  const noFunil = d.calls.length + d.follow_venda.length + d.renovacoes.length;
  if (noFunil) { bdF.textContent = noFunil; bdF.classList.remove('hide'); } else bdF.classList.add('hide');

  const cont = (s) => (d.status.find((x) => x.status === s) || {}).c || 0;
  const fm = d.funil_mes || {};
  const decididas = Number(fm.fechou || 0) + Number(fm.perdeu || 0);
  const taxa = decididas ? Math.round((Number(fm.fechou || 0) / decididas) * 100) : null;

  const recMes = d.recebido_mes.reduce((s, r) => s + Number(r.total_brl || 0), 0);
  const recAnt = Number(d.recebido_mes_anterior || 0);
  const varMes = recAnt ? Math.round(((recMes - recAnt) / recAnt) * 100) : null;
  const receberLinhas = d.a_receber.map((r) => `${money(r.total, r.moeda)}`).join(' · ') || '—';

  const prim = (n) => esc((n || '').split(' ')[0]);

  const linhaCall = (c) => `
    <div class="linha-aviso">
      <span class="tag ${c.dias < 0 ? 'atrasada' : c.dias === 0 ? 'hoje' : 'proxima'}">
        ${c.dias < 0 ? 'atrasada' : c.dias === 0 ? horaBR(c.call_em) || 'hoje' : dataBR(c.call_em)}</span>
      <div class="txt"><b>${nomeCompleto(c)}</b>
        <small>${esc(c.origem || 'Direct')}${c.objetivo ? ' · ' + esc(c.objetivo) : ''}${c.valor_previsto ? ' · ' + money(c.valor_previsto, c.moeda) : ''}</small></div>
      <button class="btn zap mini" onclick="zap('${esc(c.telefone || '')}','Oi ${prim(c.nome)}! Tudo certo pra nossa call?')">WhatsApp</button>
      <button class="btn mini" onclick="resultadoCall(${c.id})">Resultado</button>
    </div>`;

  const linhaFollow = (f) => `
    <div class="linha-aviso">
      <span class="tag ${f.dias < 0 ? 'atrasada' : 'hoje'}">${f.dias < 0 ? Math.abs(f.dias) + 'd atraso' : 'hoje'}</span>
      <div class="txt"><b>${nomeCompleto(f)}</b>
        <small>${f.tipo === 'renovacao' ? 'Renovação' : 'Não fechou na call'}${f.motivo ? ' · ' + esc(f.motivo) : ''}${f.obs ? ' · ' + esc(f.obs.slice(0, 50)) : ''}</small></div>
      <button class="btn zap mini" onclick="zap('${esc(f.telefone || '')}','Oi ${prim(f.nome)}! Como combinamos, estou passando pra retomar nossa conversa.')">WhatsApp</button>
      <button class="btn mini" onclick="resultadoCall(${f.id})">Resultado</button>
    </div>`;

  const linhaCob = (c) => `
    <div class="linha-aviso">
      <span class="tag ${c.situacao}">${c.situacao === 'atrasada' ? Math.abs(c.dias) + 'd atraso' : c.situacao === 'hoje' ? 'hoje' : 'em ' + c.dias + 'd'}</span>
      <div class="txt"><b>${nomeCompleto(c)}</b>
        <small>Parcela ${c.numero}/${c.total} · ${money(c.valor - c.pago, c.moeda)} · vence ${dataBR(c.vencimento)}</small></div>
      <button class="btn zap mini" onclick="zap('${esc(c.telefone || '')}','Oi ${prim(c.nome)}! Passando pra lembrar da parcela ${c.numero}/${c.total} (${money(c.valor - c.pago, c.moeda)}), vencimento ${dataBR(c.vencimento)}.')">WhatsApp</button>
      <button class="btn mini" onclick="abrirPagamento(${c.paciente_id},${c.id},${c.valor - c.pago},'${c.moeda}')">Receber</button>
    </div>`;

  const linhaRen = (r) => `
    <div class="linha-aviso">
      <span class="tag ${r.dias != null && r.dias <= 7 ? 'atrasada' : 'hoje'}">${r.dias != null ? r.dias + 'd' : '—'}</span>
      <div class="txt"><b>${nomeCompleto(r)}</b>
        <small>${esc(r.codigo_plano || 'Plano')} termina ${dataBR(r.data_final)} · ${ROTULO_ETAPA[r.etapa] || r.etapa}</small></div>
      <button class="btn zap mini" onclick="zap('${esc(r.telefone || '')}','Oi ${prim(r.nome)}! Seu plano termina ${dataBR(r.data_final)}. Vamos falar da renovação?')">WhatsApp</button>
      <button class="btn mini" onclick="resultadoCall(${r.id})">Resultado</button>
    </div>`;

  const linhaAg = (a) => {
    const cor = CORES_COMPROMISSO[a.status] || CORES_COMPROMISSO.marcado;
    const quem = a.paciente_apelido || a.paciente_nome;
    return `<div class="linha-aviso">
      <span class="tag" style="background:${cor.bg};color:${cor.txt}">${horaBR(a.inicio) || 'dia todo'}</span>
      <div class="txt"><b>${esc(a.titulo)}${quem ? ` · ${esc(quem)}` : ''}</b>
        <small>${dataBR(a.inicio)}${a.local ? ' · ' + esc(a.local) : ''}</small></div>
      ${a.paciente_id ? `<button class="btn mini ghost" onclick="abrirPaciente(${a.paciente_id})">Ficha</button>` : ''}
    </div>`;
  };

  const bloco = (titulo, itens, render, vazio, destaque) => `
    <div class="card"${destaque && itens.length ? ' style="border-color:var(--ouro);border-width:2px"' : ''}>
      <h3>${titulo} ${itens.length ? `<span class="tag" style="margin-left:6px">${itens.length}</span>` : ''}</h3>
      ${itens.length ? itens.map(render).join('') : `<p class="vazio">${vazio}</p>`}
    </div>`;

  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Início</h1><p>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}</p></div>
      <div class="dir">
        <button class="btn ghost" onclick="abrirCalculadora()">Calculadora</button>
        <button class="btn ghost" onclick="abrirCompromisso()">+ Compromisso</button>
        <button class="btn ghost" onclick="novoLead()">+ Lead</button>
        <button class="btn ouro" onclick="abrirPaciente()">+ Paciente</button>
      </div>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><span>Fechamento do mês</span>
        <b>${taxa != null ? taxa + '%' : '—'}</b>
        <small style="color:var(--txt-2)">${fm.fechou || 0} de ${decididas || 0} calls decididas</small></div>
      <div class="kpi"><span>Recebido no mês</span>
        <b style="font-size:21px">${money(recMes, 'BRL')}</b>
        <small style="color:${varMes == null ? 'var(--txt-2)' : varMes >= 0 ? 'var(--ok)' : 'var(--erro)'}">
          ${varMes == null ? 'sem base anterior' : `${varMes >= 0 ? '+' : ''}${varMes}% vs mês passado`}</small></div>
      <div class="kpi"><span>A receber</span>
        <b style="font-size:17px;line-height:1.4">${receberLinhas}</b>
        <small style="color:var(--txt-2)">${d.a_receber.reduce((s, r) => s + Number(r.qtd || 0), 0)} parcelas</small></div>
      <div class="kpi"><span>Pacientes ativos</span>
        <b>${cont('ativo')}</b>
        <small style="color:${d.renovacoes.length ? 'var(--alerta)' : 'var(--txt-2)'}">
          ${d.renovacoes.length} em renovação</small></div>
    </div>

    <div class="grid g2">
      ${bloco('Calls', [...callsHoje, ...d.calls.filter((c) => c.dias > 0)], linhaCall,
        'Nenhuma call agendada. Hora de prospectar.', true)}
      ${bloco('Follow-ups combinados para hoje', d.follow_venda, linhaFollow,
        'Nenhum follow-up para hoje.', true)}
      ${bloco('Cobranças', [...atrasadas, ...deHoje, ...proximas], linhaCob,
        'Nada a cobrar nos próximos 7 dias.')}
      ${bloco('Renovações em aberto', d.renovacoes, linhaRen,
        'Nenhum plano terminando nos próximos 30 dias.')}
      ${bloco('Agenda dos próximos 7 dias', d.agenda, linhaAg, 'Nenhum compromisso marcado.')}
      ${bloco('Pacientes sem consulta recente', d.followups, (f) => `
        <div class="linha-aviso">
          <span class="tag ${f.dias_sem_registro > 30 ? 'atrasada' : 'hoje'}">${f.dias_sem_registro}d</span>
          <div class="txt"><b>${nomeCompleto(f)}</b>
            <small>Última consulta em ${dataBR(f.ultima)}</small></div>
          <button class="btn mini" onclick="abrirConsulta(${f.id})">Nova ficha</button>
        </div>`, 'Acompanhamento em dia.')}
    </div>`;
}

/* ==========================================================
   FUNIL — leads novos e renovações
   ========================================================== */
const ROTULO_ETAPA = {
  novo: 'Chegou no direct', call_agendada: 'Call agendada', follow_up: 'Follow-up',
  fechou: 'Fechou', perdido: 'Perdido',
  a_abordar: 'A abordar', abordado: 'Abordado', renovou: 'Renovou', saiu: 'Não renovou',
};
const COR_ETAPA = {
  novo: 'lead', call_agendada: 'hoje', follow_up: 'parceria', fechou: 'ativo', perdido: 'devendo',
  a_abordar: 'lead', abordado: 'hoje', renovou: 'ativo', saiu: 'devendo',
};
let FUNIL_TIPO = 'novo';

async function telaFunil() {
  $('#tela').innerHTML = '<p class="vazio">Carregando…</p>';
  await api('/funil/sincronizar', { method: 'POST', body: {} }).catch(() => {});
  const d = await api('/funil?tipo=' + FUNIL_TIPO);
  CACHE.motivos = d.motivos;
  const h = hojeISO();

  const abertas = d.etapas.filter((e) => !['fechou', 'perdido', 'renovou', 'saiu'].includes(e));
  const porEtapa = {};
  d.etapas.forEach((e) => { porEtapa[e] = []; });
  d.negociacoes.forEach((n) => { (porEtapa[n.etapa] = porEtapa[n.etapa] || []).push(n); });

  const ganhou = FUNIL_TIPO === 'novo' ? 'fechou' : 'renovou';
  const perdeu = FUNIL_TIPO === 'novo' ? 'perdido' : 'saiu';
  const emAberto = abertas.reduce((s, e) => s + porEtapa[e].length, 0);
  const valorAberto = abertas.reduce((s, e) =>
    s + porEtapa[e].reduce((a, n) => a + Number(n.valor_previsto || 0), 0), 0);
  const decididas = porEtapa[ganhou].length + porEtapa[perdeu].length;
  const taxa = decididas ? Math.round((porEtapa[ganhou].length / decididas) * 100) : null;
  const atrasados = d.negociacoes.filter((n) => n.atrasado).length;

  const card = (n) => `
    <div class="card" style="padding:11px;margin-bottom:8px;${n.atrasado ? 'border-color:var(--erro)' : ''}"
         onclick="abrirNegociacao(${n.id})">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${n.cod ? `<span class="cod">${esc(n.cod)}</span>` : ''}
        <b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.nome)}</b>
        ${n.valor_previsto ? `<span style="font-size:12.5px;font-weight:650">${money(n.valor_previsto, n.moeda)}</span>` : ''}
      </div>
      ${n.apelido ? `<div class="apelido" style="margin-bottom:3px">“${esc(n.apelido)}”</div>` : ''}
      <div style="font-size:12px;color:var(--txt-2);line-height:1.5">
        ${n.call_em && n.etapa === 'call_agendada' ? `Call ${dataBR(n.call_em)} ${horaBR(n.call_em)}<br>` : ''}
        ${n.proximo_contato ? `<span style="color:${n.atrasado ? 'var(--erro)' : 'var(--alerta)'};font-weight:650">
          Retomar ${dataBR(n.proximo_contato)}${n.atrasado ? ` (${Math.abs(n.dias_contato)}d atraso)` : ''}</span><br>` : ''}
        ${n.data_final ? `Plano ${esc(n.plano_anterior || '')} termina ${dataBR(n.data_final)}<br>` : ''}
        ${n.origem ? esc(n.origem) : ''}${n.objetivo ? ' · ' + esc(n.objetivo) : ''}
        ${n.motivo ? `<br><span style="color:var(--erro)">${esc(n.motivo)}</span>` : ''}
      </div>
    </div>`;

  const coluna = (e) => `
    <div style="min-width:0">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;padding-bottom:7px;
                  border-bottom:2px solid var(--linha)">
        <b style="font-size:13px">${ROTULO_ETAPA[e]}</b>
        <span class="tag ${COR_ETAPA[e]}">${porEtapa[e].length}</span>
      </div>
      ${porEtapa[e].length ? porEtapa[e].map(card).join('')
        : '<p style="font-size:12.5px;color:var(--txt-2);padding:10px 0">—</p>'}
    </div>`;

  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Funil</h1><p>${emAberto} em aberto${valorAberto ? ' · ' + money(valorAberto, 'BRL') + ' previstos' : ''}${atrasados ? ` · <b style="color:var(--erro)">${atrasados} com follow-up atrasado</b>` : ''}</p></div>
      <div class="dir">
        <button class="btn ghost" onclick="relatorioFunil()">Por que perde</button>
        <button class="btn ouro" onclick="novoLead()">+ Lead</button>
      </div>
    </div>

    <div class="abas" id="abasFunil">
      <button class="${FUNIL_TIPO === 'novo' ? 'on' : ''}" onclick="FUNIL_TIPO='novo';telaFunil()">Leads novos</button>
      <button class="${FUNIL_TIPO === 'renovacao' ? 'on' : ''}" onclick="FUNIL_TIPO='renovacao';telaFunil()">Renovações</button>
    </div>

    <div class="grid g3" style="margin-bottom:16px">
      <div class="kpi"><span>Em aberto</span><b>${emAberto}</b>
        <small style="color:var(--txt-2)">${money(valorAberto, 'BRL')} previstos</small></div>
      <div class="kpi"><span>Taxa de fechamento</span><b>${taxa != null ? taxa + '%' : '—'}</b>
        <small style="color:var(--txt-2)">${porEtapa[ganhou].length} ganhas · ${porEtapa[perdeu].length} perdidas</small></div>
      <div class="kpi"><span>Follow-up atrasado</span>
        <b style="color:${atrasados ? 'var(--erro)' : 'var(--txt)'}">${atrasados}</b>
        <small style="color:var(--txt-2)">passou da data combinada</small></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(${abertas.length},minmax(210px,1fr));gap:14px;overflow-x:auto;padding-bottom:8px">
      ${abertas.map(coluna).join('')}
    </div>

    <div class="grid g2" style="margin-top:20px">
      <div class="card"><h3>${ROTULO_ETAPA[ganhou]} <span class="tag ativo">${porEtapa[ganhou].length}</span></h3>
        ${porEtapa[ganhou].slice(0, 12).map((n) => `<div class="linha-aviso">
          <div class="txt"><b>${nomeCompleto(n)}</b>
            <small>${n.fechado_em ? dataBR(n.fechado_em) : ''}${n.valor_previsto ? ' · ' + money(n.valor_previsto, n.moeda) : ''}</small></div>
          <button class="btn mini ghost" onclick="abrirPaciente(${n.paciente_id})">Ficha</button>
        </div>`).join('') || '<p class="vazio">—</p>'}</div>
      <div class="card"><h3>${ROTULO_ETAPA[perdeu]} <span class="tag devendo">${porEtapa[perdeu].length}</span></h3>
        ${porEtapa[perdeu].slice(0, 12).map((n) => `<div class="linha-aviso">
          <div class="txt"><b>${nomeCompleto(n)}</b>
            <small>${n.fechado_em ? dataBR(n.fechado_em) : ''}${n.motivo ? ' · ' + esc(n.motivo) : ''}</small></div>
          <button class="btn mini ghost" onclick="abrirNegociacao(${n.id})">Reabrir</button>
        </div>`).join('') || '<p class="vazio">—</p>'}</div>
    </div>`;
}

/* ---------- novo lead ---------- */
async function novoLead() {
  if (!PLANOS.length) PLANOS = (await api('/planos')).planos;
  const origens = ['Direct', 'Indicação', 'Formulário', 'Anúncio', 'Outro'];
  const corpo = `
    <div class="grid g2">
      <div><label>Nome *</label><input id="nlNome"></div>
      <div><label>Apelido interno</label><input id="nlApelido"></div>
      <div><label>WhatsApp (com DDI)</label><input id="nlTel" placeholder="+55 51 99999-9999"></div>
      <div><label>Instagram</label><input id="nlInsta"></div>
      <div><label>País</label><select id="nlPais">
        <option>Brasil</option><option value="US">Estados Unidos</option><option value="Outro">Outro</option></select></div>
      <div><label>Como chegou</label><select id="nlOrigem">${origens.map((o) => `<option>${o}</option>`).join('')}</select></div>
      <div><label>Plano de interesse</label><select id="nlPlano">
        <option value="">—</option>
        ${PLANOS.filter((p) => p.ativo).map((p) => `<option value="${p.id}" data-brl="${p.preco_brl}" data-usd="${p.preco_usd}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join('')}
      </select></div>
      <div><label>Valor previsto</label><input id="nlValor" type="number" step="0.01"></div>
      <div><label>Call agendada para</label><input id="nlCall" type="datetime-local"></div>
      <div><label>Objetivo</label><select id="nlObj">
        <option value="">—</option>${OBJETIVOS.map((o) => `<option>${o}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:10px"><label>Observações da conversa</label><textarea id="nlObs"></textarea></div>
    <p style="font-size:12.5px;color:var(--txt-2);margin:10px 0 0">
      Com data de call preenchida o lead já entra em "Call agendada". Sem data, fica em "Chegou no direct".</p>`;

  modal('Novo lead', corpo, `
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarLead">Criar</button>`);

  $('#nlPlano').onchange = () => {
    const op = $('#nlPlano').selectedOptions[0];
    if (!op || !op.value) return;
    const usd = $('#nlPais').value === 'US';
    const v = usd ? op.dataset.usd : op.dataset.brl;
    if (Number(v) > 0) $('#nlValor').value = v;
  };

  $('#salvarLead').onclick = async () => {
    const nome = $('#nlNome').value.trim();
    if (!nome) return toast('Informe o nome.');
    try {
      await api('/funil', { method: 'POST', body: {
        nome, apelido: $('#nlApelido').value.trim(), telefone: $('#nlTel').value.trim(),
        instagram: $('#nlInsta').value.trim(), pais: $('#nlPais').value,
        objetivo: $('#nlObj').value, origem: $('#nlOrigem').value,
        plano_id: $('#nlPlano').value || null, valor_previsto: $('#nlValor').value,
        moeda: $('#nlPais').value === 'US' ? 'USD' : 'BRL',
        call_em: $('#nlCall').value || null, obs: $('#nlObs').value.trim(),
      } });
      fecharModal(); toast('Lead criado');
      CACHE.pacientes = null;
      TELA === 'funil' ? telaFunil() : telaHome();
    } catch (e) { toast(e.message); }
  };
}

/* ---------- abrir / mover uma negociação ---------- */
async function abrirNegociacao(id) {
  const d = await api('/funil?tipo=' + FUNIL_TIPO);
  const n = d.negociacoes.find((x) => x.id === id);
  if (!n) return toast('Negociação não encontrada.');
  CACHE.motivos = d.motivos;

  const corpo = `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <span class="tag ${COR_ETAPA[n.etapa]}">${ROTULO_ETAPA[n.etapa]}</span>
        ${n.valor_previsto ? `<b>${money(n.valor_previsto, n.moeda)}</b>` : ''}
        ${n.origem ? `<span class="tag">${esc(n.origem)}</span>` : ''}
        ${n.telefone ? `<button class="btn zap mini" style="margin-left:auto"
          onclick="zap('${esc(n.telefone)}')">WhatsApp</button>` : ''}
      </div>
      ${n.objetivo ? `<div style="margin-top:8px"><label>Objetivo</label><div>${esc(n.objetivo)}</div></div>` : ''}
      ${n.data_final ? `<div style="margin-top:8px"><label>Plano atual</label>
        <div>${esc(n.plano_anterior || '—')} · termina ${dataBR(n.data_final)}</div></div>` : ''}
      ${n.obs ? `<div style="margin-top:8px"><label>Observações</label><div>${esc(n.obs)}</div></div>` : ''}
    </div>
    <div class="grid g2">
      <div><label>Etapa</label><select id="ngEtapa">
        ${d.etapas.map((e) => `<option value="${e}"${n.etapa === e ? ' selected' : ''}>${ROTULO_ETAPA[e]}</option>`).join('')}
      </select></div>
      <div id="wrapCall"><label>Call em</label>
        <input id="ngCall" type="datetime-local" value="${esc((n.call_em || '').slice(0, 16))}"></div>
      <div id="wrapProx"><label>Retomar em</label>
        <input id="ngProx" type="date" value="${esc(n.proximo_contato || '')}"></div>
      <div id="wrapMotivo"><label>Motivo</label><select id="ngMotivo">
        <option value="">—</option>
        ${d.motivos.map((m) => `<option${n.motivo === m.nome ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}
      </select></div>
      <div><label>Valor previsto</label>
        <input id="ngValor" type="number" step="0.01" value="${n.valor_previsto || ''}"></div>
      <div><label>Moeda</label><select id="ngMoeda">
        ${MOEDAS.map((m) => `<option${n.moeda === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:10px"><label>Anotação desta conversa</label>
      <textarea id="ngNota" placeholder="o que ficou combinado"></textarea></div>`;

  modal(nomeCompleto(n), corpo, `
    <button class="btn perigo" onclick="excluirNegociacao(${n.id})">Excluir</button>
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn" id="ngSalvar">Salvar</button>
    <button class="btn ouro" id="ngFechar">Fechou a venda</button>`);

  const ajusta = () => {
    const e = $('#ngEtapa').value;
    $('#wrapCall').style.display = e === 'call_agendada' ? '' : 'none';
    $('#wrapProx').style.display = e === 'follow_up' ? '' : 'none';
    $('#wrapMotivo').style.display = ['perdido', 'saiu'].includes(e) ? '' : 'none';
  };
  $('#ngEtapa').onchange = ajusta; ajusta();

  $('#ngSalvar').onclick = async () => {
    const etapa = $('#ngEtapa').value;
    if (etapa === 'follow_up' && !$('#ngProx').value)
      return toast('Informe a data combinada para retomar.');
    if (['perdido', 'saiu'].includes(etapa) && !$('#ngMotivo').value)
      return toast('Escolha o motivo.');
    try {
      await api('/funil/' + n.id, { method: 'PUT', body: {
        etapa, call_em: $('#ngCall').value || null, proximo_contato: $('#ngProx').value || null,
        motivo: $('#ngMotivo').value || null, valor_previsto: $('#ngValor').value,
        moeda: $('#ngMoeda').value,
        interacao: $('#ngNota').value.trim()
          ? { tipo: 'call', obs: $('#ngNota').value.trim(), resultado: etapa } : null,
      } });
      fecharModal(); toast('Atualizado');
      CACHE.pacientes = null;
      TELA === 'funil' ? telaFunil() : telaHome();
    } catch (e) { toast(e.message); }
  };

  $('#ngFechar').onclick = () => fecharVenda(n);
}

/* ---------- atalho da Home: resultado da call ---------- */
async function resultadoCall(id) {
  const tipos = ['novo', 'renovacao'];
  for (const t of tipos) {
    const d = await api('/funil?tipo=' + t);
    if (d.negociacoes.some((x) => x.id === id)) { FUNIL_TIPO = t; break; }
  }
  abrirNegociacao(id);
}

/* ---------- fechar a venda vira contrato ---------- */
async function fecharVenda(n) {
  if (!PLANOS.length) PLANOS = (await api('/planos')).planos;
  const corpo = `
    <p style="margin:0 0 14px;color:var(--txt-2);font-size:13.5px">
      Isso cria o contrato de <b>${esc(n.nome)}</b>, gera as parcelas e move para
      ${n.tipo === 'renovacao' ? 'renovado' : 'cliente ativo'}.</p>
    <div class="grid g2">
      <div><label>Plano</label><select id="fvPlano">
        <option value="">— escolher —</option>
        ${PLANOS.filter((p) => p.ativo).map((p) => `<option value="${p.id}" data-dias="${p.dias}" data-brl="${p.preco_brl}" data-usd="${p.preco_usd}"${n.plano_id === p.id ? ' selected' : ''}>${esc(p.codigo)} — ${esc(p.nome)}</option>`).join('')}
      </select></div>
      <div><label>Forma de pagamento</label><select id="fvForma">
        ${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select></div>
      <div><label>Início</label><input id="fvIni" type="date" value="${hojeISO()}"></div>
      <div><label>Término</label><input id="fvFim" type="date"></div>
      <div><label>Moeda</label><select id="fvMoeda">
        ${MOEDAS.map((m) => `<option${n.moeda === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
      <div><label>Valor total</label>
        <input id="fvValor" type="number" step="0.01" value="${n.valor_previsto || ''}"></div>
      <div><label>Parcelas</label><input id="fvParc" type="number" min="1" value="1"></div>
    </div>`;

  modal('Fechar venda', corpo, `
    <button class="btn ghost" onclick="abrirNegociacao(${n.id})">Voltar</button>
    <button class="btn ouro" id="fvOk">Criar contrato</button>`);

  const sinc = () => {
    const op = $('#fvPlano').selectedOptions[0];
    if (!op || !op.value) return;
    const ini = $('#fvIni').value || hojeISO();
    const dd = new Date(ini + 'T12:00:00Z');
    dd.setUTCDate(dd.getUTCDate() + Number(op.dataset.dias || 30));
    $('#fvFim').value = dd.toISOString().slice(0, 10);
    const v = $('#fvMoeda').value === 'USD' ? op.dataset.usd : op.dataset.brl;
    if (Number(v) > 0 && !$('#fvValor').value) $('#fvValor').value = v;
  };
  $('#fvPlano').onchange = sinc; $('#fvIni').onchange = sinc; $('#fvMoeda').onchange = sinc;
  $('#fvForma').onchange = () => {
    const m = { pix: 'BRL', asaas: 'BRL', infinity: 'BRL', zelle: 'USD', paypal: 'USD' }[$('#fvForma').value];
    if (m) { $('#fvMoeda').value = m; sinc(); }
  };
  sinc();

  $('#fvOk').onclick = async () => {
    try {
      await api(`/funil/${n.id}/fechar`, { method: 'POST', body: {
        plano_id: $('#fvPlano').value || null, data_inicial: $('#fvIni').value,
        data_final: $('#fvFim').value, valor_cobrado: $('#fvValor').value,
        moeda: $('#fvMoeda').value, forma: $('#fvForma').value, qtd_parcelas: $('#fvParc').value,
      } });
      fecharModal(); toast('Contrato criado');
      CACHE.pacientes = null;
      TELA === 'funil' ? telaFunil() : telaHome();
    } catch (e) { toast(e.message); }
  };
}

async function excluirNegociacao(id) {
  if (!confirm('Excluir esta negociação? O cadastro da pessoa continua.')) return;
  await api('/funil/' + id, { method: 'DELETE' });
  fecharModal(); toast('Excluída'); telaFunil();
}

/* ---------- relatório de perdas ---------- */
async function relatorioFunil() {
  const r = await api('/funil/relatorio');
  const tot = r.por_motivo.reduce((s, x) => s + x.qtd, 0);
  const corpo = `
    <p style="margin:0 0 14px;color:var(--txt-2);font-size:13.5px">
      Desde ${dataBR(r.de)}.</p>
    <h3 style="margin-bottom:8px">Por que perde</h3>
    ${!tot ? '<p class="vazio">Nenhuma perda registrada ainda.</p>' :
      r.por_motivo.map((m) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:13.5px">
            <b>${esc(m.motivo || 'sem motivo')}</b>
            <span>${m.qtd} · ${Math.round((m.qtd / tot) * 100)}%</span></div>
          <div class="barra-peso"><i style="width:${(m.qtd / tot) * 100}%;background:var(--erro)"></i></div>
          <small style="color:var(--txt-2)">${m.tipo === 'renovacao' ? 'renovação' : 'lead novo'}${m.valor ? ' · ' + money(m.valor, 'BRL') + ' perdidos' : ''}</small>
        </div>`).join('')}

    <h3 style="margin:20px 0 8px">Conversão</h3>
    ${!r.conversao.length ? '<p class="vazio">—</p>' : `<table><thead><tr>
      <th>Tipo</th><th>Ganhou</th><th>Perdeu</th><th>Taxa</th><th>Valor ganho</th></tr></thead><tbody>
      ${r.conversao.map((c) => {
        const t = c.ganhou + c.perdeu;
        return `<tr><td>${c.tipo === 'renovacao' ? 'Renovação' : 'Lead novo'}</td>
          <td>${c.ganhou}</td><td>${c.perdeu}</td>
          <td><b>${t ? Math.round((c.ganhou / t) * 100) : 0}%</b></td>
          <td>${money(c.valor_ganho, 'BRL')}</td></tr>`;
      }).join('')}</tbody></table>`}

    <h3 style="margin:20px 0 8px">De onde vêm os leads</h3>
    ${!r.por_origem.length ? '<p class="vazio">—</p>' : `<table><thead><tr>
      <th>Origem</th><th>Leads</th><th>Fechou</th><th>Taxa</th></tr></thead><tbody>
      ${r.por_origem.map((o) => `<tr><td>${esc(o.origem || '—')}</td><td>${o.qtd}</td>
        <td>${o.fechou}</td><td><b>${o.qtd ? Math.round((o.fechou / o.qtd) * 100) : 0}%</b></td></tr>`).join('')}
      </tbody></table>`}`;
  modal('Por que perde', corpo);
}

/* ==========================================================
   PACIENTES
   ========================================================== */
let FILTRO = { q: '', status: '', objetivo: '', pais: '' };

async function telaPacientes() {
  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Pacientes</h1><p id="pacContagem">Carregando…</p></div>
      <div class="dir">
        <button class="btn ghost" onclick="abrirCalculadora()">Calculadora</button>
        <button class="btn ghost" onclick="carregarPacientes(true)">Atualizar</button>
        <button class="btn ouro" onclick="abrirPaciente()">+ Paciente</button>
      </div>
    </div>
    <div class="filtros">
      <div class="busca"><label>Buscar por código, nome ou apelido</label>
        <input id="fQ" placeholder="ex.: 142, Mariana, Mari do Jonas" value="${esc(FILTRO.q)}"></div>
      <div><label>Situação</label><select id="fStatus">
        <option value="">Todas</option>
        ${STATUS.map((s) => `<option value="${s}"${FILTRO.status === s ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
      </select></div>
      <div><label>Objetivo</label><select id="fObj">
        <option value="">Todos</option>
        ${OBJETIVOS.map((o) => `<option${FILTRO.objetivo === o ? ' selected' : ''}>${o}</option>`).join('')}
      </select></div>
      <div><label>País</label><select id="fPais">
        <option value="">Todos</option>
        ${PAISES.map((x) => `<option${FILTRO.pais === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}
      </select></div>
      <button class="btn ghost" onclick="FILTRO={q:'',status:'',objetivo:'',pais:''};telaPacientes()">Limpar</button>
    </div>
    <div class="card" style="padding:0;overflow:auto"><div id="tabelaPac"></div></div>`;

  // filtro roda no navegador: sem ida ao servidor a cada tecla
  $('#fQ').oninput = () => { FILTRO.q = $('#fQ').value; pintarPacientes(); };
  $('#fStatus').onchange = () => { FILTRO.status = $('#fStatus').value; pintarPacientes(); };
  $('#fObj').onchange = () => { FILTRO.objetivo = $('#fObj').value; pintarPacientes(); };
  $('#fPais').onchange = () => { FILTRO.pais = $('#fPais').value; pintarPacientes(); };
  carregarPacientes();
}

// busca no servidor só quando precisa (primeira vez ou depois de salvar)
async function carregarPacientes(forcar) {
  if (!CACHE.pacientes || forcar) {
    if ($('#tabelaPac')) $('#tabelaPac').innerHTML = '<p class="vazio">Carregando…</p>';
    CACHE.pacientes = (await api('/pacientes')).pacientes;
    // a lista de países vem do que existe de verdade na base
    PAISES = [...new Set([...PAISES_BASE, ...CACHE.pacientes.map((x) => x.pais).filter(Boolean)])].sort();
  }
  pintarPacientes();
}

function pintarPacientes() {
  if (!$('#tabelaPac')) return;
  const f = FILTRO;
  const q = f.q.trim().toLowerCase();
  const pacientes = (CACHE.pacientes || []).filter((x) => {
    if (f.status && x.status !== f.status) return false;
    if (f.pais && x.pais !== f.pais) return false;
    if (f.objetivo && !(x.objetivo || '').includes(f.objetivo)) return false;
    if (!q) return true;
    return [x.nome, x.apelido, x.cod, x.email, x.telefone]
      .some((v) => (v || '').toString().toLowerCase().includes(q));
  });

  const total = (CACHE.pacientes || []).length;
  $('#pacContagem').textContent = pacientes.length === total
    ? `${total} paciente${total === 1 ? '' : 's'}`
    : `${pacientes.length} de ${total} pacientes`;

  $('#tabelaPac').innerHTML = !pacientes.length
    ? '<p class="vazio">Nenhum paciente com esses filtros.</p>'
    : `<table><thead><tr>
        <th>Paciente</th><th>Situação</th><th>Objetivo</th><th>Plano</th>
        <th>Termina</th><th>Última ficha</th><th>Cobrança</th><th></th></tr></thead><tbody>
      ${pacientes.map((x) => `<tr>
        <td>${nomeCompleto(x)}<br><small style="color:var(--txt-2)">${esc(x.pais || '')}${x.telefone ? ' · ' + esc(x.telefone) : ''}</small></td>
        <td><span class="tag ${x.status}">${x.status}</span></td>
        <td><small>${esc(x.objetivo || '—')}</small></td>
        <td>${x.plano_atual ? `<span class="cod">${esc(x.plano_atual)}</span>` : '—'}</td>
        <td>${dataBR(x.data_final)}</td>
        <td>${x.ultima_consulta ? dataBR(x.ultima_consulta) : '<small style="color:var(--erro)">nenhuma</small>'}</td>
        <td>${x.parcelas_abertas ? `<span class="tag devendo">${x.parcelas_abertas} aberta(s)</span>` : '<span class="tag ativo">em dia</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn mini ghost" onclick="abrirPaciente(${x.id})">Ficha</button>
          <button class="btn mini" onclick="abrirConsulta(${x.id})">+ Consulta</button>
        </td></tr>`).join('')}
      </tbody></table>`;
}

/* ---------- modal genérico ---------- */
function modal(titulo, corpo, pe = '') {
  fecharModal();
  const el = document.createElement('div');
  el.className = 'modal'; el.id = 'modalAtual';
  el.innerHTML = `<div class="modal-box">
      <div class="modal-topo"><h3>${titulo}</h3><button class="x" onclick="fecharModal()">×</button></div>
      <div class="modal-corpo">${corpo}</div>
      ${pe ? `<div class="modal-pe">${pe}</div>` : ''}
    </div>`;
  el.onclick = (e) => { if (e.target === el) fecharModal(); };
  document.body.appendChild(el);
  return el;
}
const fecharModal = () => { const m = $('#modalAtual'); if (m) m.remove(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

/* ---------- ficha do paciente ---------- */
async function abrirPaciente(id) {
  if (!id) return formPaciente(null);
  const d = await api('/pacientes/' + id);
  const p = d.paciente;
  const pesos = d.consultas.filter((c) => c.peso_kg).reverse();
  const primeiro = pesos[0]?.peso_kg, ultimo = pesos[pesos.length - 1]?.peso_kg;
  const dif = primeiro && ultimo ? (ultimo - primeiro) : null;

  const corpo = `
    <div class="abas" id="abasPac">
      <button class="on" data-a="visao">Visão geral</button>
      <button data-a="consultas">Consultas (${d.consultas.length})</button>
      <button data-a="financeiro">Financeiro</button>
      <button data-a="anamnese">Anamnese</button>
    </div>

    <div data-p="visao">
      <div class="grid g2" style="margin-bottom:12px">
        <div class="kpi"><span>Situação</span><b style="font-size:19px"><span class="tag ${p.status}">${p.status}</span></b></div>
        <div class="kpi"><span>Evolução de peso</span>
          <b style="font-size:19px">${ultimo ? ultimo + ' kg' : '—'}
            ${dif != null ? `<small style="color:${dif < 0 ? 'var(--ok)' : 'var(--alerta)'};font-size:13px"> ${dif > 0 ? '+' : ''}${dif.toFixed(1)} kg</small>` : ''}</b></div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="grid g2" style="gap:8px">
          ${[['Código', p.cod], ['Apelido', p.apelido], ['País', p.pais], ['Telefone', p.telefone],
             ['E-mail', p.email], ['Instagram', p.instagram], ['Objetivo', p.objetivo],
             ['Indicado por', p.indicacao],
             ['Nascimento', p.nascimento ? `${dataBR(p.nascimento)} (${idadePor(p.nascimento) || '?'} anos)` : ''],
             ['Sexo', p.sexo === 'M' ? 'Masculino' : p.sexo === 'F' ? 'Feminino' : ''],
             ['Altura', p.altura_cm ? p.altura_cm + ' cm' : ''],
             ['Profissão', p.profissao]]
            .map(([k, v]) => `<div><label>${k}</label><div>${esc(v || '—')}</div></div>`).join('')}
        </div>
        ${p.obs ? `<div style="margin-top:10px"><label>Observações</label><div>${esc(p.obs)}</div></div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="abrirConsulta(${p.id})">+ Ficha de consulta</button>
        <button class="btn ouro" onclick="abrirCalculadora(${p.id})">Calcular metabolismo</button>
        <button class="btn ghost" onclick="formPaciente(${p.id})">Editar cadastro</button>
        <button class="btn ghost" onclick="abrirContrato(${p.id})">+ Contrato</button>
        <button class="btn zap" onclick="zap('${esc(p.telefone || '')}')">WhatsApp</button>
      </div>
    </div>

    <div data-p="consultas" class="hide">
      ${!d.consultas.length ? '<p class="vazio">Nenhuma ficha registrada ainda.</p>' :
        `<table><thead><tr><th>Data</th><th>Peso</th><th>Observações</th><th></th></tr></thead><tbody>
        ${d.consultas.map((c) => `<tr>
          <td><b>${dataBR(c.data)}</b></td>
          <td>${c.peso_kg ? c.peso_kg + ' kg' : '—'}${c.peso_lbs ? ` <small style="color:var(--txt-2)">/ ${c.peso_lbs} lbs</small>` : ''}</td>
          <td><small>${esc((c.observacoes || '').slice(0, 90))}</small></td>
          <td><button class="btn mini ghost" onclick="abrirConsulta(${p.id},${c.id})">Abrir</button></td>
        </tr>`).join('')}</tbody></table>`}
      <button class="btn" style="margin-top:12px" onclick="abrirConsulta(${p.id})">+ Nova ficha</button>
    </div>

    <div data-p="financeiro" class="hide">
      ${!d.contratos.length ? '<p class="vazio">Nenhum contrato cadastrado.</p>' :
        d.contratos.map((c) => `<div class="card" style="margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="cod">${esc(c.codigo_plano || '—')}</span>
            <b>${money(c.valor_cobrado, c.moeda)}</b>
            <span class="tag">${esc(c.forma || '—')} ${c.qtd_parcelas}x</span>
            <span class="tag ${c.status === 'ativo' ? 'ativo' : 'encerrado'}">${c.status}</span>
            <small style="color:var(--txt-2);margin-left:auto">${dataBR(c.data_inicial)} → ${dataBR(c.data_final)}</small>
          </div></div>`).join('')}
      ${!d.parcelas.length ? '' : `<table style="margin-top:8px"><thead><tr>
          <th>Parcela</th><th>Valor</th><th>Vence</th><th>Situação</th><th></th></tr></thead><tbody>
        ${d.parcelas.map((x) => `<tr>
          <td>${x.numero}/${x.total}</td>
          <td>${money(x.valor, x.moeda)}${x.pago ? ` <small style="color:var(--ok)">pago ${money(x.pago, x.moeda)}</small>` : ''}</td>
          <td>${dataBR(x.vencimento)}</td>
          <td><span class="tag ${x.status === 'paga' ? 'ativo' : x.vencimento < hojeISO() ? 'devendo' : ''}">${x.status}</span></td>
          <td>${x.status !== 'paga' ? `<button class="btn mini" onclick="abrirPagamento(${p.id},${x.id},${x.valor - x.pago},'${x.moeda}')">Receber</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>`}
      <button class="btn ghost" style="margin-top:12px" onclick="abrirContrato(${p.id})">+ Contrato</button>
    </div>

    <div data-p="anamnese" class="hide">
      ${!d.anamnese ? '<p class="vazio">Nenhuma anamnese vinculada a este paciente.</p>' :
        `<div class="card"><small style="color:var(--txt-2)">Respondido em ${dataBR(d.anamnese.respondido_em)} · origem ${esc(d.anamnese.origem)}</small>
        <div style="margin-top:10px">${Object.entries(JSON.parse(d.anamnese.dados || '{}'))
          .filter(([, v]) => v !== null && v !== '' && String(v) !== 'nan')
          .map(([k, v]) => `<div style="padding:7px 0;border-bottom:1px solid var(--linha)">
            <label style="margin:0">${esc(k)}</label><div>${esc(v)}</div></div>`).join('')}</div></div>`}
    </div>`;

  modal(nomeCompleto(p), corpo);
  $$('#abasPac button').forEach((b) => {
    b.onclick = () => {
      $$('#abasPac button').forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-p]').forEach((x) => x.classList.toggle('hide', x.dataset.p !== b.dataset.a));
    };
  });
}

/* ---------- cadastro / edição de paciente ---------- */
async function formPaciente(id) {
  let p = { status: 'ativo', pais: 'Brasil' };
  if (id) p = (await api('/pacientes/' + id)).paciente;
  const objs = String(p.objetivo || '').split(',').map((s) => s.trim());

  const corpo = `
    <div class="grid g2">
      <div><label>Código (COD do formulário)</label><input id="pCod" value="${esc(p.cod || '')}"></div>
      <div><label>Situação</label><select id="pStatus">
        ${STATUS.map((s) => `<option value="${s}"${p.status === s ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
      <div><label>Nome completo *</label><input id="pNome" value="${esc(p.nome || '')}"></div>
      <div><label>Apelido interno</label><input id="pApelido" placeholder="como o Luca lembra dele" value="${esc(p.apelido || '')}"></div>
      <div><label>País</label><input id="pPais" list="listaPaises" value="${esc(p.pais || 'Brasil')}">
        <datalist id="listaPaises">${PAISES.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div><label>Sexo</label><select id="pSexo">
        <option value=""${!p.sexo ? ' selected' : ''}>—</option>
        <option value="F"${p.sexo === 'F' ? ' selected' : ''}>Feminino</option>
        <option value="M"${p.sexo === 'M' ? ' selected' : ''}>Masculino</option></select></div>
      ${campoAltura('pAltura', 'pAltPes', 'pAltPol', p.altura_cm || null)}
      <div><label>WhatsApp (com DDI)</label><input id="pTel" placeholder="+55 51 99999-9999" value="${esc(p.telefone || '')}"></div>
      <div><label>E-mail</label><input id="pEmail" type="email" value="${esc(p.email || '')}"></div>
      <div><label>Instagram</label><input id="pInsta" value="${esc(p.instagram || '')}"></div>
      <div><label>Data de nascimento</label><input id="pNasc" type="date" value="${esc(p.nascimento || '')}"></div>
      <div><label>Profissão</label><input id="pProf" value="${esc(p.profissao || '')}"></div>
    </div>
    <div style="margin-top:10px"><label>Objetivo</label>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${OBJETIVOS.map((o) => `<label style="display:flex;gap:6px;align-items:center;font-weight:500;color:var(--txt)">
          <input type="checkbox" class="objChk" value="${o}" style="width:auto"${objs.includes(o) ? ' checked' : ''}> ${o}</label>`).join('')}
      </div></div>
    <div class="grid g2" style="margin-top:10px">
      <div><label>Indicado por</label><input id="pInd" value="${esc(p.indicacao || '')}"></div>
      <div><label>CPF</label><input id="pCpf" value="${esc(p.cpf || '')}"></div>
    </div>
    <div style="margin-top:10px"><label>Endereço</label><input id="pEnd" value="${esc(p.endereco || '')}"></div>
    <div style="margin-top:10px"><label>Observações</label><textarea id="pObs">${esc(p.obs || '')}</textarea></div>`;

  modal(id ? 'Editar paciente' : 'Novo paciente', corpo, `
    ${id ? `<button class="btn perigo" onclick="excluirPaciente(${id})">Excluir</button>` : ''}
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarPac">Salvar</button>`);

  ligarAltura('pAltura', 'pAltPes', 'pAltPol');

  $('#salvarPac').onclick = async () => {
    const body = {
      cod: $('#pCod').value.trim(), nome: $('#pNome').value.trim(), apelido: $('#pApelido').value.trim(),
      pais: $('#pPais').value, telefone: $('#pTel').value.trim(), email: $('#pEmail').value.trim(),
      instagram: $('#pInsta').value.trim(), nascimento: $('#pNasc').value, profissao: $('#pProf').value.trim(),
      objetivo: $$('.objChk').filter((c) => c.checked).map((c) => c.value).join(', '),
      indicacao: $('#pInd').value.trim(), cpf: $('#pCpf').value.trim(),
      endereco: $('#pEnd').value.trim(), obs: $('#pObs').value.trim(), status: $('#pStatus').value,
      sexo: $('#pSexo').value || null, altura_cm: $('#pAltura').value || null,
    };
    if (!body.nome) return toast('Informe o nome.');
    try {
      if (id) await api('/pacientes/' + id, { method: 'PUT', body });
      else await api('/pacientes', { method: 'POST', body });
      fecharModal(); toast('Paciente salvo'); if (TELA === 'pacientes') carregarPacientes(true); else telaHome();
    } catch (e) { toast(e.message); }
  };
}

async function excluirPaciente(id) {
  if (!confirm('Excluir este paciente e todo o histórico dele? Não dá para desfazer.')) return;
  await api('/pacientes/' + id, { method: 'DELETE' });
  fecharModal(); toast('Paciente excluído'); carregarPacientes(true);
}

/* ==========================================================
   FICHA DE CONSULTA — o caderno
   ========================================================== */
async function abrirConsulta(pacienteId, consultaId) {
  const d = await api('/pacientes/' + pacienteId);
  const p = d.paciente;
  const c = consultaId ? d.consultas.find((x) => x.id === consultaId) || {} : {};
  const anterior = d.consultas.filter((x) => x.peso_kg && x.id !== consultaId)[0];

  const ref = (id, rot, val) => `
    <div class="refeicao">
      <div class="rot"><b>${rot}</b></div>
      <textarea id="${id}">${esc(val || '')}</textarea>
    </div>`;

  const corpo = `
    <div class="caderno">
      <div class="cab">
        <div><label>Nome</label>
          <div style="font-size:17px;font-weight:650">${esc(p.nome)}
            ${p.apelido ? `<span class="apelido">“${esc(p.apelido)}”</span>` : ''}</div>
          <div style="margin-top:4px">${p.cod ? `<span class="cod">COD ${esc(p.cod)}</span>` : ''}</div>
        </div>
        <div><label>Data</label><input id="cData" type="date" value="${esc(c.data || hojeISO())}"></div>
      </div>
      <div class="grid g2" style="margin:12px 0">
        ${campoPeso('cKg', 'cLbs', c.peso_kg ?? null)}
      </div>
      ${anterior ? `<p style="margin:-4px 0 12px;font-size:13px;color:var(--txt-2)">
        Última medição: <b>${anterior.peso_kg} kg</b> em ${dataBR(anterior.data)}
        <span id="cDelta"></span></p>` : ''}
      ${ref('cTreino', 'Treino', c.treino)}
      ${ref('cCafe', 'Café da manhã', c.cafe)}
      ${ref('cLancheM', 'Lanche (manhã)', c.lanche_manha)}
      ${ref('cAlmoco', 'Almoço', c.almoco)}
      ${ref('cLancheT', 'Lanche (tarde)', c.lanche_tarde)}
      ${ref('cJantar', 'Jantar', c.jantar)}
      ${ref('cCeia', 'Ceia', c.ceia)}
      <div style="padding-top:12px"><label>Observações</label>
        <textarea id="cObs" style="min-height:80px">${esc(c.observacoes || '')}</textarea></div>
    </div>`;

  modal(consultaId ? 'Ficha de consulta' : 'Nova ficha de consulta', corpo, `
    ${consultaId ? `<button class="btn perigo" onclick="excluirConsulta(${consultaId},${pacienteId})">Excluir</button>` : ''}
    <button class="btn ghost" onclick="abrirCalculadora(${pacienteId})">Metabolismo</button>
    <button class="btn ghost" onclick="window.print()">Imprimir</button>
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarCons">Salvar ficha</button>`);

  // kg <-> lbs ao vivo + variação
  const kg = $('#cKg'), lbs = $('#cLbs');
  const delta = () => {
    if (!anterior || !$('#cDelta')) return;
    const v = Number(kg.value);
    if (!v) { $('#cDelta').textContent = ''; return; }
    const dd = v - anterior.peso_kg;
    $('#cDelta').innerHTML = ` · <b style="color:${dd < 0 ? 'var(--ok)' : dd > 0 ? 'var(--alerta)' : 'var(--txt-2)'}">
      ${dd > 0 ? '+' : ''}${dd.toFixed(1)} kg</b>`;
  };
  ligarPeso('cKg', 'cLbs', delta);
  delta();

  $('#salvarCons').onclick = async () => {
    const body = {
      paciente_id: pacienteId, data: $('#cData').value || hojeISO(),
      peso_kg: kg.value, peso_lbs: lbs.value,
      treino: $('#cTreino').value, cafe: $('#cCafe').value, lanche_manha: $('#cLancheM').value,
      almoco: $('#cAlmoco').value, lanche_tarde: $('#cLancheT').value, jantar: $('#cJantar').value,
      ceia: $('#cCeia').value, observacoes: $('#cObs').value,
    };
    try {
      if (consultaId) await api('/consultas/' + consultaId, { method: 'PUT', body });
      else await api('/consultas', { method: 'POST', body });
      fecharModal(); toast('Ficha salva');
      if (TELA === 'pacientes') carregarPacientes(true); else if (TELA === 'home') telaHome();
    } catch (e) { toast(e.message); }
  };
}

async function excluirConsulta(id, pid) {
  if (!confirm('Excluir esta ficha?')) return;
  await api('/consultas/' + id, { method: 'DELETE' });
  fecharModal(); toast('Ficha excluída'); abrirPaciente(pid);
}

/* ==========================================================
   CONTRATO e PAGAMENTO
   ========================================================== */
async function abrirContrato(pacienteId) {
  const corpo = `
    <div class="grid g2">
      <div><label>Plano</label><select id="kPlano">
        <option value="">— escolher —</option>
        ${PLANOS.filter((p) => p.ativo).map((p) => `<option value="${p.id}" data-dias="${p.dias}" data-brl="${p.preco_brl}" data-usd="${p.preco_usd}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join('')}
      </select></div>
      <div><label>Forma de pagamento</label><select id="kForma">
        ${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select></div>
      <div><label>Início</label><input id="kIni" type="date" value="${hojeISO()}"></div>
      <div><label>Término</label><input id="kFim" type="date"></div>
      <div><label>Moeda</label><select id="kMoeda">${MOEDAS.map((m) => `<option>${m}</option>`).join('')}</select></div>
      <div><label>Valor total cobrado</label><input id="kValor" type="number" step="0.01"></div>
      <div><label>Parcelas</label><input id="kParc" type="number" min="1" value="1"></div>
    </div>
    <div style="margin-top:10px"><label>Observações</label><input id="kObs"></div>
    <p style="font-size:12.5px;color:var(--txt-2);margin:10px 0 0">
      As parcelas são geradas automaticamente com vencimento a cada 30 dias a partir do início.</p>`;

  modal('Novo contrato', corpo, `
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarCon">Criar contrato</button>`);

  const sincroniza = () => {
    const op = $('#kPlano').selectedOptions[0];
    if (!op || !op.value) return;
    const ini = $('#kIni').value || hojeISO();
    const d = new Date(ini + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(op.dataset.dias || 30));
    $('#kFim').value = d.toISOString().slice(0, 10);
    const m = $('#kMoeda').value;
    const preco = m === 'USD' ? op.dataset.usd : op.dataset.brl;
    if (Number(preco) > 0) $('#kValor').value = preco;
  };
  $('#kPlano').onchange = sincroniza;
  $('#kIni').onchange = sincroniza;
  $('#kForma').onchange = () => {
    const m = { pix: 'BRL', asaas: 'BRL', infinity: 'BRL', zelle: 'USD', paypal: 'USD' }[$('#kForma').value];
    if (m) { $('#kMoeda').value = m; sincroniza(); }
  };
  $('#kMoeda').onchange = sincroniza;

  $('#salvarCon').onclick = async () => {
    try {
      await api('/contratos', { method: 'POST', body: {
        paciente_id: pacienteId, plano_id: $('#kPlano').value || null,
        data_inicial: $('#kIni').value, data_final: $('#kFim').value,
        valor_cobrado: $('#kValor').value, moeda: $('#kMoeda').value, forma: $('#kForma').value,
        qtd_parcelas: $('#kParc').value, obs: $('#kObs').value } });
      fecharModal(); toast('Contrato criado'); abrirPaciente(pacienteId);
    } catch (e) { toast(e.message); }
  };
}

async function abrirPagamento(pacienteId, parcelaId, valor, moeda) {
  const corpo = `
    <div class="grid g2">
      <div><label>Data do recebimento</label><input id="gData" type="date" value="${hojeISO()}"></div>
      <div><label>Forma</label><select id="gForma">${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select></div>
      <div><label>Valor recebido</label><input id="gValor" type="number" step="0.01" value="${Number(valor || 0).toFixed(2)}"></div>
      <div><label>Moeda</label><select id="gMoeda">${MOEDAS.map((m) => `<option${m === moeda ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
      <div><label>Cotação usada (R$)</label><input id="gCot" type="number" step="0.0001"></div>
      <div><label>Equivale a</label><div id="gBrl" style="padding:9px 0;font-weight:650">—</div></div>
    </div>
    <p style="font-size:12.5px;color:var(--txt-2);margin:8px 0 0">
      A cotação vem do câmbio do dia. Se a plataforma converteu com outra taxa, corrija aqui —
      o painel passa a bater com o extrato.</p>
    <div style="margin-top:10px"><label>Observação</label><input id="gObs"></div>`;

  modal('Registrar pagamento', corpo, `
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarPg">Registrar</button>`);

  async function buscarCotacao() {
    const m = $('#gMoeda').value;
    if (m === 'BRL') { $('#gCot').value = 1; calc(); return; }
    $('#gCot').value = ''; $('#gBrl').textContent = 'buscando câmbio…';
    try {
      const r = await api(`/cotacao?moeda=${m}&dia=${$('#gData').value}`);
      $('#gCot').value = Number(r.taxa || 0).toFixed(4);
    } catch { $('#gCot').value = ''; }
    calc();
  }
  const calc = () => {
    const v = Number($('#gValor').value || 0) * Number($('#gCot').value || 0);
    $('#gBrl').textContent = v ? money(v, 'BRL') : '—';
  };
  $('#gMoeda').onchange = buscarCotacao;
  $('#gData').onchange = buscarCotacao;
  $('#gValor').oninput = calc; $('#gCot').oninput = calc;
  buscarCotacao();

  $('#salvarPg').onclick = async () => {
    try {
      await api('/pagamentos', { method: 'POST', body: {
        paciente_id: pacienteId, parcela_id: parcelaId, data: $('#gData').value,
        valor: $('#gValor').value, moeda: $('#gMoeda').value, cotacao: $('#gCot').value,
        forma: $('#gForma').value, obs: $('#gObs').value } });
      fecharModal(); toast('Pagamento registrado');
      if (TELA === 'home') telaHome(); else if (TELA === 'financeiro') telaFinanceiro(); else carregarPacientes(true);
    } catch (e) { toast(e.message); }
  };
}

/* ==========================================================
   AGENDA
   ========================================================== */
let MES = new Date();
async function telaAgenda() {
  const ini = new Date(MES.getFullYear(), MES.getMonth(), 1);
  const fim = new Date(MES.getFullYear(), MES.getMonth() + 1, 0);
  const iso = (d) => d.toLocaleDateString('sv-SE');
  const { compromissos } = await api(`/compromissos?de=${iso(ini)}&ate=${iso(fim)}`);

  const porDia = {};
  compromissos.forEach((c) => { (porDia[c.inicio.slice(0, 10)] ||= []).push(c); });

  const primeiroDiaSemana = ini.getDay();
  const cels = [];
  for (let i = 0; i < primeiroDiaSemana; i++) cels.push('<div></div>');
  for (let d = 1; d <= fim.getDate(); d++) {
    const dia = iso(new Date(MES.getFullYear(), MES.getMonth(), d));
    const evs = porDia[dia] || [];
    const eHoje = dia === hojeISO();
    cels.push(`<div class="card" style="padding:8px;min-height:96px;${eHoje ? 'border-color:var(--ouro);border-width:2px' : ''}"
        ondblclick="abrirCompromisso(null,'${dia}')">
      <div style="font-size:12px;font-weight:700;color:${eHoje ? 'var(--ouro)' : 'var(--txt-2)'};margin-bottom:5px">${d}</div>
      ${evs.map((e) => {
        const cor = CORES_COMPROMISSO[e.status] || CORES_COMPROMISSO.marcado;
        const quem = e.paciente_apelido || e.paciente_nome;
        return `<div onclick="abrirCompromisso(${e.id})" title="${esc(e.titulo)}${quem ? ' · ' + esc(quem) : ''}"
          style="cursor:pointer;font-size:11.5px;background:${cor.bg};color:${cor.txt};
                 border-left:3px solid ${cor.borda};padding:3px 6px;border-radius:5px;margin-bottom:3px;
                 overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <b>${horaBR(e.inicio)}</b> ${esc(e.titulo)}${quem ? ` · <b>${esc(quem)}</b>` : ''}</div>`;
      }).join('')}
    </div>`);
  }

  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Agenda</h1>
        <p style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          ${['marcado', 'feito', 'cancelado'].map((s) => `<span style="display:inline-flex;align-items:center;gap:5px">
            <i style="width:10px;height:10px;border-radius:3px;background:${CORES_COMPROMISSO[s].borda};display:inline-block"></i>
            ${ROTULO_COMPROMISSO[s]}</span>`).join('')}
          <span style="color:var(--txt-2)">· dois cliques num dia criam um compromisso</span>
        </p></div>
      <div class="dir">
        <button class="btn ghost" onclick="MES=new Date(MES.getFullYear(),MES.getMonth()-1,1);telaAgenda()">←</button>
        <b style="align-self:center;min-width:150px;text-align:center;text-transform:capitalize">
          ${MES.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</b>
        <button class="btn ghost" onclick="MES=new Date(MES.getFullYear(),MES.getMonth()+1,1);telaAgenda()">→</button>
        <button class="btn ouro" onclick="abrirCompromisso()">+ Compromisso</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px">
      ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => `<div style="font-size:11px;font-weight:700;color:var(--txt-2);text-transform:uppercase;text-align:center;padding:4px">${d}</div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cels.join('')}</div>`;
}

async function abrirCompromisso(id, dia) {
  if (!CACHE.pacientes) CACHE.pacientes = (await api('/pacientes')).pacientes;
  const pacientes = CACHE.pacientes;
  let c = { tipo: 'consulta', inicio: (dia || hojeISO()) + 'T09:00' };
  if (id) {
    const { compromissos } = await api('/compromissos?de=1900-01-01&ate=2999-12-31');
    c = compromissos.find((x) => x.id === id) || c;
  }
  const corpo = `
    <div class="grid g2">
      <div><label>Título *</label><input id="mTit" value="${esc(c.titulo || '')}"></div>
      <div><label>Tipo</label><select id="mTipo">
        ${['consulta', 'followup', 'cobranca', 'pessoal'].map((t) => `<option value="${t}"${c.tipo === t ? ' selected' : ''}>${{ consulta: 'Consulta', followup: 'Follow-up', cobranca: 'Cobrança', pessoal: 'Pessoal' }[t]}</option>`).join('')}
      </select></div>
      <div><label>Paciente</label><select id="mPac">
        <option value="">— sem paciente —</option>
        ${pacientes.map((p) => `<option value="${p.id}"${c.paciente_id === p.id ? ' selected' : ''}>${p.cod ? p.cod + ' · ' : ''}${esc(p.nome)}${p.apelido ? ' (' + esc(p.apelido) + ')' : ''}</option>`).join('')}
      </select></div>
      <div><label>Data e hora</label><input id="mIni" type="datetime-local" value="${esc((c.inicio || '').slice(0, 16))}"></div>
      <div><label>Local / link</label><input id="mLocal" value="${esc(c.local || '')}"></div>
      <div><label>Situação</label><select id="mSt">
        ${['marcado', 'feito', 'cancelado'].map((s) => `<option value="${s}"${c.status === s ? ' selected' : ''}>${ROTULO_COMPROMISSO[s]}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:10px"><label>Observações</label><textarea id="mObs">${esc(c.obs || '')}</textarea></div>`;

  modal(id ? 'Compromisso' : 'Novo compromisso', corpo, `
    ${id ? `<button class="btn perigo" onclick="excluirCompromisso(${id})">Excluir</button>` : ''}
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarComp">Salvar</button>`);

  $('#salvarComp').onclick = async () => {
    const body = { titulo: $('#mTit').value.trim(), tipo: $('#mTipo').value,
      paciente_id: $('#mPac').value || null, inicio: $('#mIni').value,
      local: $('#mLocal').value, obs: $('#mObs').value, status: $('#mSt').value };
    if (!body.titulo || !body.inicio) return toast('Informe título e data.');
    try {
      if (id) await api('/compromissos/' + id, { method: 'PUT', body });
      else await api('/compromissos', { method: 'POST', body });
      fecharModal(); toast('Compromisso salvo');
      TELA === 'agenda' ? telaAgenda() : telaHome();
    } catch (e) { toast(e.message); }
  };
}
async function excluirCompromisso(id) {
  if (!confirm('Excluir este compromisso?')) return;
  await api('/compromissos/' + id, { method: 'DELETE' });
  fecharModal(); toast('Excluído'); telaAgenda();
}

/* ==========================================================
   CALCULADORA — TMB, gasto energético e conversões
   Harris-Benedict, as mesmas constantes da planilha do Luca:
     mulher: 655 + 9,6×peso + 1,9×altura − 4,7×idade
     homem:   66 + 13,7×peso + 5×altura   − 6,8×idade
   ========================================================== */
const KG_POR_LB = 0.45359237;

function tmbHarrisBenedict(sexo, pesoKg, alturaCm, idade) {
  if (!(pesoKg > 0) || !(alturaCm > 0) || !(idade > 0)) return null;
  return sexo === 'M'
    ? 66 + (13.7 * pesoKg) + (5 * alturaCm) - (6.8 * idade)
    : 655 + (9.6 * pesoKg) + (1.9 * alturaCm) - (4.7 * idade);
}

function idadePor(nascimento, ref) {
  if (!nascimento) return null;
  const n = new Date(nascimento + 'T12:00:00Z');
  const r = new Date((ref || hojeISO()) + 'T12:00:00Z');
  if (isNaN(n)) return null;
  let a = r.getUTCFullYear() - n.getUTCFullYear();
  const m = r.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < n.getUTCDate())) a--;
  return a > 0 ? a : null;
}

function fatores(sexo) {
  const cru = (CACHE.settings || {})[sexo === 'M' ? 'fatores_m' : 'fatores_f']
    || (sexo === 'M' ? 'Sedentário:1.40|Leve:1.56|Moderado:1.78|Intenso:2.10'
                     : 'Sedentário:1.40|Leve:1.55|Moderado:1.70|Intenso:2.00');
  return cru.split('|').map((p) => {
    const [nome, v] = p.split(':');
    return { nome: (nome || '').trim(), fator: Number(v) || 1 };
  }).filter((f) => f.nome);
}

/* ---------- conversores reaproveitados em todas as telas ----------
   Ele atende em países com unidades diferentes: onde houver peso ou
   altura, os dois sistemas aparecem lado a lado e um preenche o outro. */
function campoPeso(idKg, idLb, valorKg, rot = 'Peso') {
  const lb = valorKg ? (Number(valorKg) / KG_POR_LB).toFixed(2) : '';
  return `<div><label>${rot} (kg)</label><input id="${idKg}" type="number" step="0.01" value="${valorKg ?? ''}"></div>
          <div><label>${rot} (lb)</label><input id="${idLb}" type="number" step="0.01" value="${lb}"></div>`;
}
function campoAltura(idCm, idPes, idPol, valorCm, rot = 'Altura') {
  let pes = '', pol = '';
  if (valorCm) { const t = Number(valorCm) / 2.54; pes = Math.floor(t / 12); pol = (t - pes * 12).toFixed(1); }
  return `<div><label>${rot} (cm)</label><input id="${idCm}" type="number" step="0.1" value="${valorCm ?? ''}"></div>
          <div><label>${rot} (pés / polegadas)</label>
            <div style="display:flex;gap:6px">
              <input id="${idPes}" type="number" step="1" placeholder="pés" value="${pes}">
              <input id="${idPol}" type="number" step="0.1" placeholder="pol" value="${pol}">
            </div></div>`;
}
function ligarPeso(idKg, idLb, aoMudar) {
  const kg = $('#' + idKg), lb = $('#' + idLb);
  if (!kg || !lb) return;
  kg.oninput = () => { const v = Number(kg.value); lb.value = v ? (v / KG_POR_LB).toFixed(2) : ''; aoMudar && aoMudar(); };
  lb.oninput = () => { const v = Number(lb.value); kg.value = v ? (v * KG_POR_LB).toFixed(2) : ''; aoMudar && aoMudar(); };
}
function ligarAltura(idCm, idPes, idPol, aoMudar) {
  const cm = $('#' + idCm), pes = $('#' + idPes), pol = $('#' + idPol);
  if (!cm || !pes || !pol) return;
  cm.oninput = () => {
    const v = Number(cm.value);
    if (v) { const t = v / 2.54; pes.value = Math.floor(t / 12); pol.value = (t - Math.floor(t / 12) * 12).toFixed(1); }
    else { pes.value = ''; pol.value = ''; }
    aoMudar && aoMudar();
  };
  const daImperial = () => {
    const p = Number(pes.value) || 0, i = Number(pol.value) || 0;
    cm.value = (p || i) ? ((p * 12 + i) * 2.54).toFixed(1) : '';
    aoMudar && aoMudar();
  };
  pes.oninput = daImperial; pol.oninput = daImperial;
}

const kcal = (v) => Math.round(v * 100) / 100;
const fmtKcal = (v) => v == null ? '—'
  : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kcal';

async function abrirCalculadora(pacienteId) {
  if (!CACHE.settings) CACHE.settings = (await api('/settings')).settings;

  let p = null, ultima = null;
  if (pacienteId) {
    const d = await api('/pacientes/' + pacienteId);
    p = d.paciente;
    ultima = (d.consultas || []).find((c) => c.peso_kg);
  }
  const sexo0 = (p && p.sexo) || 'F';
  const idade0 = p ? idadePor(p.nascimento) : null;
  const peso0 = ultima ? ultima.peso_kg : null;
  const alt0 = p && p.altura_cm ? p.altura_cm : null;

  const corpo = `
    ${p ? `<div class="card" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:0"><b>${esc(p.nome)}</b>${p.apelido ? ` <span class="apelido">“${esc(p.apelido)}”</span>` : ''}
        <div style="font-size:12.5px;color:var(--txt-2)">
          ${idade0 ? idade0 + ' anos' : '<b style="color:var(--erro)">sem data de nascimento</b>'} ·
          ${alt0 ? alt0 + ' cm' : '<b style="color:var(--erro)">sem altura</b>'} ·
          ${peso0 ? peso0 + ' kg (ficha de ' + dataBR(ultima.data) + ')' : '<b style="color:var(--erro)">sem peso registrado</b>'}
        </div></div>
      <button class="btn ghost mini" onclick="fecharModal();formPaciente(${p.id})">Completar cadastro</button>
    </div>` : ''}

    <div class="grid g2">
      <div><label>Sexo</label><select id="cSexo">
        <option value="F"${sexo0 === 'F' ? ' selected' : ''}>Feminino</option>
        <option value="M"${sexo0 === 'M' ? ' selected' : ''}>Masculino</option></select></div>
      <div><label>Idade (anos)</label><input id="cIdade" type="number" min="1" max="120" value="${idade0 || ''}"></div>
      ${campoPeso('cKg', 'cLb', peso0)}
      ${campoAltura('cCm', 'cPes', 'cPol', alt0)}
      <div style="grid-column:1/-1"><label>Nível de atividade</label>
        <select id="cNivel"></select></div>
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="kpi"><span>Taxa de metabolismo basal</span>
        <b id="cTmb" style="font-size:25px">—</b>
        <small style="color:var(--txt-2)">energia em repouso absoluto</small></div>
      <div class="kpi" style="border-color:var(--ouro);border-width:2px">
        <span>Gasto energético total</span>
        <b id="cGet" style="font-size:25px">—</b>
        <small id="cGetSub" style="color:var(--txt-2)">TMB × fator de atividade</small></div>
    </div>

    <div id="cAjuste" class="card hide" style="margin-top:12px">
      <label>Ajuste para o objetivo</label>
      <div class="viz-barras" style="margin-top:6px"></div>
    </div>

    <p style="font-size:12px;color:var(--txt-2);margin:14px 0 0;line-height:1.6">
      Harris-Benedict, as mesmas constantes da planilha.
      Mulher: 655 + 9,6×peso + 1,9×altura − 4,7×idade ·
      Homem: 66 + 13,7×peso + 5×altura − 6,8×idade.
      Os fatores de atividade ficam em Configurações.
    </p>`;

  modal('Calculadora de metabolismo', corpo, `
    ${p ? `<button class="btn ghost" id="cSalvar">Salvar no cadastro</button>` : ''}
    <button class="btn ghost" onclick="fecharModal()">Fechar</button>`);

  const el = (id) => $('#' + id);

  function montaNiveis() {
    const fs = fatores(el('cSexo').value);
    const atual = el('cNivel').value;
    el('cNivel').innerHTML = fs.map((f) =>
      `<option value="${f.fator}"${String(f.fator) === atual ? ' selected' : ''}>${esc(f.nome)} (${f.fator})</option>`).join('');
    if (!atual) el('cNivel').selectedIndex = Math.min(1, fs.length - 1);
  }

  function calcular() {
    const sexo = el('cSexo').value;
    const tmb = tmbHarrisBenedict(sexo, Number(el('cKg').value), Number(el('cCm').value), Number(el('cIdade').value));
    const fator = Number(el('cNivel').value) || 0;
    el('cTmb').textContent = tmb == null ? '—' : fmtKcal(kcal(tmb));
    const get = tmb != null && fator ? kcal(tmb * fator) : null;
    el('cGet').textContent = get == null ? '—' : fmtKcal(get);
    el('cGetSub').textContent = get == null ? 'TMB × fator de atividade'
      : `${fmtKcal(kcal(tmb))} × ${fator}`;

    const box = $('#cAjuste');
    if (get == null) { box.classList.add('hide'); return; }
    box.classList.remove('hide');
    const linhas = [
      ['Déficit 20% (emagrecimento)', get * 0.8],
      ['Déficit 10%', get * 0.9],
      ['Manutenção', get],
      ['Superávit 10%', get * 1.1],
      ['Superávit 20% (ganho)', get * 1.2],
    ];
    box.querySelector('.viz-barras').innerHTML = linhas.map(([rot, v], i) => `
      <div class="viz-linha">
        <span class="viz-rot">${rot}</span>
        <span class="viz-trilho"><i style="width:${(v / (get * 1.2)) * 100}%;
          background:${i === 2 ? '#C9A227' : '#1E4062'}"></i></span>
        <b class="viz-val">${fmtKcal(kcal(v))}</b>
      </div>`).join('');
  }

  ligarPeso('cKg', 'cLb', calcular);
  ligarAltura('cCm', 'cPes', 'cPol', calcular);
  el('cIdade').oninput = calcular;
  el('cNivel').onchange = calcular;
  el('cSexo').onchange = () => { montaNiveis(); calcular(); };

  montaNiveis();
  calcular();

  if (p) $('#cSalvar').onclick = async () => {
    try {
      await api('/pacientes/' + p.id, { method: 'PUT', body: {
        ...p, sexo: el('cSexo').value, altura_cm: el('cCm').value || null } });
      toast('Sexo e altura salvos na ficha');
      CACHE.pacientes = null;
    } catch (e) { toast(e.message); }
  };
}

/* ==========================================================
   FINANCEIRO
   ========================================================== */
let PERIODO = { chave: '30d', de: null, ate: null };

function faixaPeriodo(chave) {
  const h = hojeISO();
  const d = new Date(h + 'T12:00:00Z');
  const iso = (x) => x.toISOString().slice(0, 10);
  const menos = (n) => { const y = new Date(h + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - n); return iso(y); };
  if (chave === 'hoje') return { de: h, ate: h, rotulo: 'Hoje' };
  if (chave === 'semana') {
    const dia = d.getUTCDay();               // 0=domingo
    const ini = new Date(d); ini.setUTCDate(d.getUTCDate() - dia);
    return { de: iso(ini), ate: h, rotulo: 'Esta semana' };
  }
  if (chave === 'mes') return { de: h.slice(0, 8) + '01', ate: h, rotulo: 'Este mês' };
  if (chave === '30d') return { de: menos(29), ate: h, rotulo: 'Últimos 30 dias' };
  return { de: PERIODO.de || menos(29), ate: PERIODO.ate || h, rotulo: 'Personalizado' };
}

/* ---------- gráficos em SVG, sem biblioteca ---------- */
const VIZ = { serie: '#1E4062', destaque: '#C9A227', grade: '#E2E7EE', eixo: '#5A6B7D' };

// colunas ao longo do tempo. Uma série só: sem legenda, rótulo direto no maior.
function colunas(dados, { altura = 190, formato = (v) => money(v, 'BRL') } = {}) {
  if (!dados.length || dados.every((d) => !d.valor))
    return '<p class="vazio">Nenhuma entrada neste período.</p>';
  const L = 52, R = 10, T = 22, B = 30;
  const larg = 640, alt = altura;
  const iw = larg - L - R, ih = alt - T - B;
  const max = Math.max(...dados.map((d) => d.valor));
  const passo = Math.pow(10, Math.floor(Math.log10(max || 1)));
  const topo = Math.ceil(max / passo) * passo || 1;
  const banda = iw / dados.length;
  const gl = 24 > banda ? banda * 0.72 : Math.min(24, banda * 0.72);  // marca fina, nunca preenche a banda
  const iMax = dados.findIndex((d) => d.valor === max);
  const ticks = [0, topo / 2, topo];

  return `<svg viewBox="0 0 ${larg} ${alt}" class="viz" role="img"
      aria-label="Entradas por período" preserveAspectRatio="xMidYMid meet">
    ${ticks.map((t) => {
      const y = T + ih - (t / topo) * ih;
      return `<line x1="${L}" y1="${y}" x2="${larg - R}" y2="${y}" stroke="${VIZ.grade}" stroke-width="1"/>
        <text x="${L - 7}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="${VIZ.eixo}">${
          t >= 1000 ? (t / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : Math.round(t)}</text>`;
    }).join('')}
    ${dados.map((d, i) => {
      const hgt = topo ? (d.valor / topo) * ih : 0;
      const x = L + i * banda + (banda - gl) / 2;
      const y = T + ih - hgt;
      const cor = i === iMax ? VIZ.destaque : VIZ.serie;
      return `<g class="viz-col"><title>${esc(d.rotuloLongo || d.rotulo)}: ${formato(d.valor)}</title>
        <rect x="${L + i * banda}" y="${T}" width="${banda}" height="${ih}" fill="transparent"/>
        <rect x="${x}" y="${y}" width="${gl}" height="${Math.max(hgt, d.valor ? 2 : 0)}"
              rx="4" fill="${cor}"/>
        ${hgt > 0 ? `<rect x="${x}" y="${T + ih - Math.min(hgt, 4)}" width="${gl}" height="${Math.min(hgt, 4)}" fill="${cor}"/>` : ''}
      </g>`;
    }).join('')}
    ${max ? (() => {
      const hgt = (max / topo) * ih;
      const x = L + iMax * banda + banda / 2;
      return `<text x="${x}" y="${T + ih - hgt - 7}" text-anchor="middle" font-size="11"
        font-weight="700" fill="var(--txt)">${formato(max)}</text>`;
    })() : ''}
    <line x1="${L}" y1="${T + ih}" x2="${larg - R}" y2="${T + ih}" stroke="${VIZ.grade}" stroke-width="1"/>
    ${(() => {
      const pular = dados.length > 16 ? Math.ceil(dados.length / 8) : 1;
      const ult = dados.length - 1;
      return dados.map((d, i) => {
        // mostra o último só se não encostar no anterior já rotulado
        const rotulado = i % pular === 0;
        const ultimoCabe = i === ult && (ult % pular !== 0) && (ult - Math.floor(ult / pular) * pular) >= pular / 2;
        if (!rotulado && !ultimoCabe) return '';
        return `<text x="${L + i * banda + banda / 2}" y="${alt - 10}" text-anchor="middle"
          font-size="10.5" fill="${VIZ.eixo}">${esc(d.rotulo)}</text>`;
      }).join('');
    })()}
  </svg>`;
}

// barras horizontais: magnitude com nomes longos
function barras(dados, { formato = (v) => money(v, 'BRL'), max: maxIn } = {}) {
  if (!dados.length) return '<p class="vazio">Sem dados no período.</p>';
  const max = maxIn || Math.max(...dados.map((d) => d.valor), 1);
  return `<div class="viz-barras">${dados.map((d, i) => `
    <div class="viz-linha" title="${esc(d.rotulo)}: ${formato(d.valor)}">
      <span class="viz-rot">${esc(d.rotulo)}</span>
      <span class="viz-trilho"><i style="width:${Math.max((d.valor / max) * 100, d.valor ? 1.5 : 0)}%;
        background:${i === 0 ? VIZ.destaque : VIZ.serie}"></i></span>
      <b class="viz-val">${formato(d.valor)}</b>
    </div>`).join('')}</div>`;
}

async function telaFinanceiro() {
  const f = faixaPeriodo(PERIODO.chave);
  $('#tela').innerHTML = '<p class="vazio">Carregando…</p>';
  const d = await api(`/financeiro?de=${f.de}&ate=${f.ate}`);

  const total = Number(d.total.total || 0);
  const ant = Number(d.anterior.total || 0);
  const varia = ant ? Math.round(((total - ant) / ant) * 100) : null;
  const receber = d.a_receber.reduce((s, r) => s + Number(r.total || 0) * (r.moeda === 'BRL' ? 1 : 0), 0);
  const ticket = d.total.qtd ? total / d.total.qtd : 0;

  // série: rótulo curto no eixo, completo no tooltip
  const serie = d.serie.map((s) => ({
    rotulo: d.granularidade === 'dia' ? s.rotulo.slice(8, 10) : s.rotulo.slice(5, 7) + '/' + s.rotulo.slice(2, 4),
    rotuloLongo: d.granularidade === 'dia' ? dataBR(s.rotulo) : s.rotulo.split('-').reverse().join('/'),
    valor: Number(s.total_brl || 0),
  }));

  // tendência longa, sempre mensal
  const tend = d.por_mes.map((m) => ({
    rotulo: m.mes.slice(5, 7) + '/' + m.mes.slice(2, 4),
    rotuloLongo: m.mes.split('-').reverse().join('/'),
    valor: Number(m.total_brl || 0),
  }));

  const chips = [['hoje', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês'],
    ['30d', 'Últimos 30 dias'], ['custom', 'Personalizado']];

  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Financeiro</h1>
        <p>${f.rotulo} · ${dataBR(f.de)} a ${dataBR(f.ate)} · valores convertidos pela cotação do dia de cada entrada</p></div>
    </div>

    <div class="filtros" style="align-items:center">
      ${chips.map(([k, r]) => `<button class="btn ${PERIODO.chave === k ? '' : 'ghost'} mini"
        onclick="trocarPeriodo('${k}')">${r}</button>`).join('')}
      <span id="wrapCustom" class="${PERIODO.chave === 'custom' ? '' : 'hide'}"
            style="display:flex;gap:8px;align-items:flex-end;margin-left:6px">
        <span><label>De</label><input id="pDe" type="date" value="${f.de}"></span>
        <span><label>Até</label><input id="pAte" type="date" value="${f.ate}"></span>
        <button class="btn mini" onclick="aplicarCustom()">Aplicar</button>
      </span>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><span>Recebido no período</span>
        <b style="font-size:27px">${money(total, 'BRL')}</b>
        <small style="color:${varia == null ? 'var(--txt-2)' : varia >= 0 ? 'var(--ok)' : 'var(--erro)'}">
          ${varia == null ? 'sem base para comparar' : `${varia >= 0 ? '+' : ''}${varia}% vs período anterior`}</small></div>
      <div class="kpi"><span>Entradas</span><b>${d.total.qtd || 0}</b>
        <small style="color:var(--txt-2)">${d.total.pessoas || 0} pessoas · média ${money(ticket, 'BRL')}</small></div>
      <div class="kpi"><span>A receber</span>
        <b style="font-size:17px;line-height:1.4">${d.a_receber.map((r) => money(r.total, r.moeda)).join('<br>') || '—'}</b>
        <small style="color:var(--txt-2)">${d.a_receber.reduce((s, r) => s + r.qtd, 0)} parcelas em aberto</small></div>
      <div class="kpi"><span>Vencido</span>
        <b style="color:${d.atrasado.qtd ? 'var(--erro)' : 'var(--txt)'}">${d.atrasado.qtd || 0}</b>
        <small style="color:var(--txt-2)">parcelas passaram da data</small></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>Entradas ${d.granularidade === 'dia' ? 'por dia' : 'por mês'}</h3>
      <p style="font-size:12.5px;color:var(--txt-2);margin:2px 0 10px">
        Em reais, somando todas as moedas. Passe o mouse para ver cada barra.</p>
      ${colunas(serie)}
    </div>

    <div class="grid g2" style="margin-bottom:14px">
      <div class="card"><h3>Por moeda</h3>
        <p style="font-size:12.5px;color:var(--txt-2);margin:2px 0 10px">No período escolhido.</p>
        ${!d.por_moeda.length ? '<p class="vazio">Sem entradas.</p>' :
          d.por_moeda.map((m) => `<div class="linha-aviso">
            <span class="tag">${m.moeda}</span>
            <div class="txt"><b>${money(m.total, m.moeda)}</b>
              <small>${m.qtd} entrada${m.qtd === 1 ? '' : 's'}${m.moeda !== 'BRL' ? ' · ' + money(m.total_brl, 'BRL') + ' convertidos' : ''}</small></div>
          </div>`).join('')}
      </div>
      <div class="card"><h3>Por forma de pagamento</h3>
        <p style="font-size:12.5px;color:var(--txt-2);margin:2px 0 10px">Em reais convertidos.</p>
        ${barras(d.por_forma.map((x) => ({ rotulo: x.forma, valor: Number(x.total_brl || 0) })))}
      </div>
    </div>

    <div class="grid g2" style="margin-bottom:14px">
      <div class="card"><h3>Por plano</h3>
        <p style="font-size:12.5px;color:var(--txt-2);margin:2px 0 10px">O que cada plano trouxe no período.</p>
        ${barras(d.por_plano.map((x) => ({ rotulo: x.plano, valor: Number(x.total_brl || 0) })))}
      </div>
      <div class="card"><h3>Por país</h3>
        <p style="font-size:12.5px;color:var(--txt-2);margin:2px 0 10px">Onde está o faturamento.</p>
        ${barras(d.por_pais.map((x) => ({ rotulo: x.pais, valor: Number(x.total_brl || 0) })))}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>Tendência dos últimos ${tend.length} meses</h3>
      <p style="font-size:12.5px;color:var(--txt-2);margin:2px 0 10px">
        Independe do filtro acima — serve para ver o movimento do negócio.</p>
      ${colunas(tend, { altura: 200 })}
    </div>

    <div class="card" style="padding:0;overflow:auto">
      <h3 style="padding:16px 16px 4px">Tabela do período</h3>
      <p style="font-size:12.5px;color:var(--txt-2);margin:0;padding:0 16px 10px">
        Os mesmos números dos gráficos, para conferir.</p>
      ${!serie.length ? '<p class="vazio">Sem entradas no período.</p>' :
        `<table><thead><tr><th>${d.granularidade === 'dia' ? 'Dia' : 'Mês'}</th>
          <th>Entradas</th><th>Total em reais</th></tr></thead><tbody>
        ${d.serie.map((s) => `<tr><td>${d.granularidade === 'dia' ? dataBR(s.rotulo) : s.rotulo.split('-').reverse().join('/')}</td>
          <td>${s.qtd}</td><td><b>${money(s.total_brl, 'BRL')}</b></td></tr>`).join('')}
        </tbody><tfoot><tr style="border-top:2px solid var(--linha)">
          <td><b>Total</b></td><td><b>${d.total.qtd}</b></td><td><b>${money(total, 'BRL')}</b></td>
        </tr></tfoot></table>`}
    </div>`;
}

function trocarPeriodo(k) {
  PERIODO.chave = k;
  if (k === 'custom') {
    const f = faixaPeriodo('30d');
    PERIODO.de = PERIODO.de || f.de; PERIODO.ate = PERIODO.ate || f.ate;
  }
  telaFinanceiro();
}
function aplicarCustom() {
  PERIODO.de = $('#pDe').value; PERIODO.ate = $('#pAte').value;
  if (!PERIODO.de || !PERIODO.ate) return toast('Escolha as duas datas.');
  if (PERIODO.de > PERIODO.ate) return toast('A data inicial tem que vir antes da final.');
  telaFinanceiro();
}

/* ==========================================================
   PLANOS
   ========================================================== */
async function telaPlanos() {
  PLANOS = (await api('/planos')).planos;
  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Planos</h1><p>Valores e regras de cada plano de consultoria</p></div>
      <div class="dir"><button class="btn ouro" onclick="formPlano()">+ Plano</button></div>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table><thead><tr>
        <th>Código</th><th>Nome</th><th>Tipo</th><th>Duração</th>
        <th>Preço BRL</th><th>Preço USD</th><th>Consultas</th><th>Follow-up</th><th></th></tr></thead><tbody>
      ${PLANOS.map((p) => `<tr style="${p.ativo ? '' : 'opacity:.5'}">
        <td><span class="cod">${esc(p.codigo)}</span></td>
        <td><b>${esc(p.nome)}</b>${p.regras ? `<br><small style="color:var(--txt-2)">${esc(p.regras.slice(0, 70))}</small>` : ''}</td>
        <td><small>${{ dieta: 'Dieta', treino: 'Treino', dieta_treino: 'Dieta + Treino', le: 'Low Energy', outro: 'Outro' }[p.tipo] || p.tipo}</small></td>
        <td>${p.dias} dias</td>
        <td>${p.preco_brl ? money(p.preco_brl, 'BRL') : '<small style="color:var(--erro)">definir</small>'}</td>
        <td>${p.preco_usd ? money(p.preco_usd, 'USD') : '<small style="color:var(--erro)">definir</small>'}</td>
        <td>${p.consultas || '—'}</td>
        <td>${p.follow_up_dias ? 'a cada ' + p.follow_up_dias + 'd' : '—'}</td>
        <td><button class="btn mini ghost" onclick="formPlano(${p.id})">Editar</button></td>
      </tr>`).join('')}</tbody></table>
    </div>
    <p style="font-size:13px;color:var(--txt-2);margin-top:12px">
      Os preços em vermelho ainda não foram preenchidos. Ao criar um contrato, o valor do plano
      entra automaticamente e continua editável caso a caso.</p>`;
}

function formPlano(id) {
  const p = id ? PLANOS.find((x) => x.id === id) : { tipo: 'dieta', dias: 30, ativo: 1 };
  const corpo = `
    <div class="grid g2">
      <div><label>Código *</label><input id="lCod" value="${esc(p.codigo || '')}" placeholder="90DT"></div>
      <div><label>Nome *</label><input id="lNome" value="${esc(p.nome || '')}" placeholder="Dieta + Treino 90 dias"></div>
      <div><label>Tipo</label><select id="lTipo">
        ${[['dieta', 'Dieta'], ['treino', 'Treino'], ['dieta_treino', 'Dieta + Treino'], ['le', 'Low Energy'], ['outro', 'Outro']]
          .map(([v, r]) => `<option value="${v}"${p.tipo === v ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label>Duração (dias)</label><input id="lDias" type="number" value="${p.dias || 30}"></div>
      <div><label>Preço Brasil (R$)</label><input id="lBrl" type="number" step="0.01" value="${p.preco_brl || ''}"></div>
      <div><label>Preço EUA (US$)</label><input id="lUsd" type="number" step="0.01" value="${p.preco_usd || ''}"></div>
      <div><label>Consultas incluídas</label><input id="lCons" type="number" value="${p.consultas || 0}"></div>
      <div><label>Follow-up a cada (dias)</label><input id="lFu" type="number" value="${p.follow_up_dias || 0}"></div>
    </div>
    <div style="margin-top:10px"><label>Regras do plano</label>
      <textarea id="lRegras" placeholder="O que está incluído, como funciona o acompanhamento, condições de renovação…">${esc(p.regras || '')}</textarea></div>
    <div style="margin-top:10px;display:flex;gap:18px">
      <label style="display:flex;gap:6px;align-items:center;font-weight:500;color:var(--txt)">
        <input type="checkbox" id="lRenova" style="width:auto"${p.renova_auto ? ' checked' : ''}> Renova automático</label>
      <label style="display:flex;gap:6px;align-items:center;font-weight:500;color:var(--txt)">
        <input type="checkbox" id="lAtivo" style="width:auto"${p.ativo !== 0 ? ' checked' : ''}> Ativo</label>
    </div>`;

  modal(id ? 'Editar plano' : 'Novo plano', corpo, `
    ${id ? `<button class="btn perigo" onclick="excluirPlano(${id})">Excluir</button>` : ''}
    <button class="btn ghost" onclick="fecharModal()">Cancelar</button>
    <button class="btn ouro" id="salvarPl">Salvar</button>`);

  $('#salvarPl').onclick = async () => {
    const body = { codigo: $('#lCod').value.trim(), nome: $('#lNome').value.trim(), tipo: $('#lTipo').value,
      dias: $('#lDias').value, preco_brl: $('#lBrl').value, preco_usd: $('#lUsd').value,
      consultas: $('#lCons').value, follow_up_dias: $('#lFu').value,
      renova_auto: $('#lRenova').checked ? 1 : 0, ativo: $('#lAtivo').checked ? 1 : 0,
      regras: $('#lRegras').value };
    if (!body.codigo || !body.nome) return toast('Informe código e nome.');
    try {
      if (id) await api('/planos/' + id, { method: 'PUT', body });
      else await api('/planos', { method: 'POST', body });
      fecharModal(); toast('Plano salvo'); telaPlanos();
    } catch (e) { toast(e.message); }
  };
}
async function excluirPlano(id) {
  if (!confirm('Excluir este plano? Contratos já criados não são afetados.')) return;
  await api('/planos/' + id, { method: 'DELETE' });
  fecharModal(); toast('Plano excluído'); telaPlanos();
}

/* ==========================================================
   CONFIGURAÇÕES + IMPORTAÇÃO
   ========================================================== */
async function telaConfig() {
  const { settings } = await api('/settings');
  $('#tela').innerHTML = `
    <div class="topo"><div><h1>Configurações</h1><p>Ajustes gerais e importação de dados</p></div></div>

    <div class="grid g2">
      <div class="card">
        <h3>Alertas</h3>
        <div style="margin-top:10px"><label>Avisar follow-up depois de (dias sem ficha)</label>
          <input id="sFu" type="number" value="${esc(settings.followup_dias_alerta || 10)}"></div>
        <div style="margin-top:10px"><label>Avisar plano vencendo com (dias de antecedência)</label>
          <input id="sVenc" type="number" value="${esc(settings.vencimento_alerta_dias || 30)}"></div>
        <button class="btn ouro" style="margin-top:12px" id="salvarCfg">Salvar</button>

        <hr style="border:0;border-top:1px solid var(--linha);margin:18px 0">
        <h3>Câmbio</h3>
        <p style="font-size:13px;color:var(--txt-2);margin:6px 0 10px">
          Baixa a cotação de fechamento de cada dia dos últimos 2 anos (USD, GBP e EUR).
          Cada pagamento passa a usar a taxa da data em que entrou.</p>
        <button class="btn" id="btnCambio">Atualizar histórico de câmbio</button>
        <div id="cambioRes" style="margin-top:10px;font-size:13px"></div>

        <hr style="border:0;border-top:1px solid var(--linha);margin:18px 0">
        <h3>Fatores de atividade</h3>
        <p style="font-size:13px;color:var(--txt-2);margin:6px 0 10px">
          Multiplicam a TMB para chegar ao gasto energético total.
          Um por linha, no formato <code>Nome:fator</code>.</p>
        <div style="margin-bottom:10px"><label>Feminino</label>
          <textarea id="sFatF" style="min-height:92px;font-family:ui-monospace,monospace;font-size:12.5px">${
            esc((settings.fatores_f || 'Sedentário:1.40|Leve:1.55|Moderado:1.70|Intenso:2.00').split('|').join('\n'))}</textarea></div>
        <div><label>Masculino</label>
          <textarea id="sFatM" style="min-height:92px;font-family:ui-monospace,monospace;font-size:12.5px">${
            esc((settings.fatores_m || 'Sedentário:1.40|Leve:1.56|Moderado:1.78|Intenso:2.10').split('|').join('\n'))}</textarea></div>
        <button class="btn ouro" style="margin-top:12px" id="salvarFat">Salvar fatores</button>
      </div>

      <div class="card">
        <h3>Importar dados</h3>
        <p style="font-size:13px;color:var(--txt-2);margin:6px 0 12px">
          Escolha o arquivo JSON da planilha atual ou das respostas do formulário.
          Arquivos grandes são enviados em blocos automaticamente.</p>
        <div style="background:#FBF0D6;color:#8A6D12;padding:10px 12px;border-radius:9px;font-size:13px;margin-bottom:12px">
          Antes de importar a planilha pela primeira vez, clique em
          <b>Atualizar histórico de câmbio</b> abaixo. Sem isso a conversão dos
          pagamentos antigos em dólar fica errada e a importação demora muito.
        </div>
        <label>Tipo</label>
        <select id="impTipo" style="margin-bottom:10px">
          <option value="pacientes">Pacientes e contratos (planilha)</option>
          <option value="anamneses">Anamneses (formulário)</option>
        </select>
        <label>Arquivo .json</label>
        <input type="file" id="impArquivo" accept=".json,application/json" style="margin-bottom:10px">
        <details style="margin-bottom:10px">
          <summary style="font-size:13px;color:var(--txt-2);cursor:pointer">ou colar o conteúdo</summary>
          <textarea id="impJson" style="min-height:100px;margin-top:8px;font-family:ui-monospace,monospace;font-size:12px"
            placeholder='{"linhas":[ … ]}'></textarea>
        </details>
        <button class="btn" id="btnImportar">Importar</button>
        <div id="impBarra" class="barra-peso hide" style="margin-top:10px"><i style="width:0"></i></div>
        <div id="impResultado" style="margin-top:10px;font-size:13px"></div>
      </div>
    </div>`;

  $('#salvarCfg').onclick = async () => {
    await api('/settings', { method: 'PUT', body: {
      followup_dias_alerta: $('#sFu').value, vencimento_alerta_dias: $('#sVenc').value } });
    toast('Configurações salvas');
  };

  $('#salvarFat').onclick = async () => {
    const junta = (id) => $('#' + id).value.split('\n').map((l) => l.trim()).filter(Boolean).join('|');
    const f = junta('sFatF'), m = junta('sFatM');
    const valido = (s) => s.split('|').every((p) => /^[^:]+:\s*\d+([.,]\d+)?$/.test(p));
    if (!valido(f) || !valido(m)) return toast('Use o formato Nome:fator, um por linha.');
    await api('/settings', { method: 'PUT', body: { fatores_f: f.replace(/,/g, '.'), fatores_m: m.replace(/,/g, '.') } });
    CACHE.settings = null; toast('Fatores salvos');
  };

  $('#btnCambio').onclick = async () => {
    const r = $('#cambioRes'), b = $('#btnCambio');
    b.disabled = true; r.textContent = 'Baixando as séries… pode levar 1 minuto.';
    try {
      const j = await api('/cotacoes/sincronizar', { method: 'POST', body: {} });
      r.innerHTML = `<b style="color:var(--ok)">Pronto.</b> ` +
        Object.entries(j.gravadas).map(([m, q]) => `${m}: ${q} dias`).join(' · ');
    } catch (e) { r.innerHTML = `<b style="color:var(--erro)">Erro:</b> ${esc(e.message)}`; }
    finally { b.disabled = false; }
  };

  $('#btnImportar').onclick = async () => {
    const res = $('#impResultado');
    const barra = $('#impBarra');
    const btn = $('#btnImportar');
    try {
      const arq = $('#impArquivo').files[0];
      const texto = arq ? await arq.text() : $('#impJson').value;
      if (!texto.trim()) return toast('Escolha um arquivo ou cole o conteúdo.');
      const dados = JSON.parse(texto);
      const linhas = Array.isArray(dados) ? dados : (dados.linhas || []);
      if (!linhas.length) throw new Error('Nenhuma linha encontrada no arquivo.');

      btn.disabled = true;
      barra.classList.remove('hide');
      const BLOCO = 40, totais = {};
      for (let i = 0; i < linhas.length; i += BLOCO) {
        res.textContent = `Enviando ${Math.min(i + BLOCO, linhas.length)} de ${linhas.length}…`;
        barra.firstElementChild.style.width = ((i / linhas.length) * 100) + '%';
        const r = await api('/importar/' + $('#impTipo').value,
          { method: 'POST', body: { linhas: linhas.slice(i, i + BLOCO) } });
        Object.entries(r).forEach(([k, v]) => {
          if (k !== 'ok') totais[k] = (totais[k] || 0) + Number(v || 0);
        });
      }
      barra.firstElementChild.style.width = '100%';
      res.innerHTML = `<b style="color:var(--ok)">Pronto.</b> ${linhas.length} linhas · ` +
        Object.entries(totais).map(([k, v]) => `${k}: ${v}`).join(' · ');
      CACHE.pacientes = null;   // lista precisa ser relida depois de importar
      PLANOS = (await api('/planos')).planos;
    } catch (e) {
      res.innerHTML = `<b style="color:var(--erro)">Erro:</b> ${esc(e.message)}`;
    } finally { btn.disabled = false; }
  };
}

/* ---------- boot ---------- */
if (TOKEN) {
  api('/me').then(({ usuario }) => { EU = usuario; entrarApp(); })
    .catch(() => { localStorage.removeItem('crm_token'); TOKEN = ''; bootLogin(); });
} else bootLogin();
