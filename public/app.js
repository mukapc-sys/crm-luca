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

const OBJETIVOS = ['Emagrecimento', 'Definição muscular', 'Ganho de massa muscular', 'Manutenção do peso'];
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
  ({ home: telaHome, pacientes: telaPacientes, agenda: telaAgenda,
     financeiro: telaFinanceiro, planos: telaPlanos, config: telaConfig }[t])();
}

/* ==========================================================
   HOME
   ========================================================== */
async function telaHome() {
  $('#tela').innerHTML = '<p class="vazio">Carregando…</p>';
  const d = await api('/home');
  CACHE.home = d;

  const atrasadas = d.cobrancas.filter((c) => c.situacao === 'atrasada');
  const deHoje = d.cobrancas.filter((c) => c.situacao === 'hoje');
  const proximas = d.cobrancas.filter((c) => c.situacao === 'proxima');
  const total = d.cobrancas.length + d.followups.length;
  const bd = $('#bdHome');
  if (total) { bd.textContent = total; bd.classList.remove('hide'); } else bd.classList.add('hide');

  const cont = (s) => (d.status.find((x) => x.status === s) || {}).c || 0;
  const receber = d.a_receber.map((r) => `<div>${money(r.total, r.moeda)} <small style="color:var(--txt-2)">· ${r.qtd} parcelas</small></div>`).join('') || '—';
  const recebido = d.recebido_mes.map((r) => `<div>${money(r.total, r.moeda)}</div>`).join('') || money(0);

  const linhaCob = (c) => `
    <div class="linha-aviso">
      <span class="tag ${c.situacao}">${c.situacao === 'atrasada' ? Math.abs(c.dias) + 'd atraso' : c.situacao === 'hoje' ? 'hoje' : 'em ' + c.dias + 'd'}</span>
      <div class="txt">
        <b>${nomeCompleto(c)}</b>
        <small>Parcela ${c.numero}/${c.total} · ${money(c.valor - c.pago, c.moeda)} · vence ${dataBR(c.vencimento)}</small>
      </div>
      <button class="btn zap mini" onclick="zap('${esc(c.telefone || '')}','Oi ${esc((c.nome || '').split(' ')[0])}! Passando pra lembrar da parcela ${c.numero}/${c.total} (${money(c.valor - c.pago, c.moeda)}), vencimento ${dataBR(c.vencimento)}.')">WhatsApp</button>
      <button class="btn mini" onclick="abrirPagamento(${c.paciente_id},${c.id},${c.valor - c.pago},'${c.moeda}')">Receber</button>
    </div>`;

  const linhaAg = (a) => `
    <div class="linha-aviso">
      <span class="tag">${horaBR(a.inicio) || 'dia todo'}</span>
      <div class="txt"><b>${esc(a.titulo)}</b>
        <small>${dataBR(a.inicio)}${a.paciente_nome ? ' · ' + esc(a.paciente_nome) : ''}${a.local ? ' · ' + esc(a.local) : ''}</small></div>
      ${a.paciente_id ? `<button class="btn mini ghost" onclick="abrirPaciente(${a.paciente_id})">Abrir ficha</button>` : ''}
    </div>`;

  const linhaFu = (f) => `
    <div class="linha-aviso">
      <span class="tag ${f.dias_sem_registro == null ? 'devendo' : 'hoje'}">${f.dias_sem_registro == null ? 'sem ficha' : f.dias_sem_registro + 'd'}</span>
      <div class="txt"><b>${nomeCompleto(f)}</b>
        <small>${f.dias_sem_registro == null ? 'Nenhuma consulta registrada' : 'Última consulta em ' + dataBR(f.ultima)}</small></div>
      <button class="btn zap mini" onclick="zap('${esc(f.telefone || '')}','Oi ${esc((f.nome || '').split(' ')[0])}! Como está indo a rotina essa semana?')">WhatsApp</button>
      <button class="btn mini" onclick="abrirConsulta(${f.id})">Nova ficha</button>
    </div>`;

  const linhaVc = (v) => `
    <div class="linha-aviso">
      <span class="tag ${v.dias <= 7 ? 'atrasada' : 'hoje'}">${v.dias}d</span>
      <div class="txt"><b>${nomeCompleto(v)}</b>
        <small>Plano ${esc(v.codigo_plano || '—')} termina em ${dataBR(v.data_final)}</small></div>
      <button class="btn zap mini" onclick="zap('${esc(v.telefone || '')}','Oi ${esc((v.nome || '').split(' ')[0])}! Seu plano termina em ${dataBR(v.data_final)}. Vamos falar da renovação?')">WhatsApp</button>
    </div>`;

  const bloco = (titulo, itens, render, vazio) => `
    <div class="card">
      <h3>${titulo} ${itens.length ? `<span class="tag" style="margin-left:6px">${itens.length}</span>` : ''}</h3>
      ${itens.length ? itens.map(render).join('') : `<p class="vazio">${vazio}</p>`}
    </div>`;

  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Início</h1><p>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}</p></div>
      <div class="dir">
        <button class="btn ghost" onclick="abrirCompromisso()">+ Compromisso</button>
        <button class="btn ouro" onclick="abrirPaciente()">+ Paciente</button>
      </div>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><span>Ativos</span><b>${cont('ativo')}</b></div>
      <div class="kpi"><span>Devendo</span><b style="color:var(--erro)">${cont('devendo')}</b></div>
      <div class="kpi"><span>A receber</span><b style="font-size:17px;line-height:1.5">${receber}</b></div>
      <div class="kpi"><span>Recebido no mês</span><b style="font-size:17px;line-height:1.5">${recebido}</b></div>
    </div>

    <div class="grid g2">
      ${bloco('Cobranças', [...atrasadas, ...deHoje, ...proximas], linhaCob, 'Nada a cobrar nos próximos 7 dias.')}
      ${bloco('Agenda dos próximos 7 dias', d.agenda, linhaAg, 'Nenhum compromisso marcado.')}
      ${bloco('Follow-up — sem registro recente', d.followups, linhaFu, 'Todos os pacientes em dia.')}
      ${bloco('Planos vencendo em 30 dias', d.vencendo, linhaVc, 'Nenhum plano vencendo.')}
    </div>`;
}

/* ==========================================================
   PACIENTES
   ========================================================== */
let FILTRO = { q: '', status: '', objetivo: '', pais: '' };

async function telaPacientes() {
  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Pacientes</h1><p id="pacContagem">Carregando…</p></div>
      <div class="dir"><button class="btn ouro" onclick="abrirPaciente()">+ Paciente</button></div>
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
        <option value="">Todos</option><option${FILTRO.pais === 'Brasil' ? ' selected' : ''}>Brasil</option>
        <option value="US"${FILTRO.pais === 'US' ? ' selected' : ''}>Estados Unidos</option>
      </select></div>
      <button class="btn ghost" onclick="FILTRO={q:'',status:'',objetivo:'',pais:''};telaPacientes()">Limpar</button>
    </div>
    <div class="card" style="padding:0;overflow:auto"><div id="tabelaPac"></div></div>`;

  const deb = (fn, ms = 300) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  $('#fQ').oninput = deb(() => { FILTRO.q = $('#fQ').value; carregarPacientes(); });
  $('#fStatus').onchange = () => { FILTRO.status = $('#fStatus').value; carregarPacientes(); };
  $('#fObj').onchange = () => { FILTRO.objetivo = $('#fObj').value; carregarPacientes(); };
  $('#fPais').onchange = () => { FILTRO.pais = $('#fPais').value; carregarPacientes(); };
  carregarPacientes();
}

async function carregarPacientes() {
  const p = new URLSearchParams(Object.entries(FILTRO).filter(([, v]) => v));
  const { pacientes } = await api('/pacientes?' + p);
  $('#pacContagem').textContent = `${pacientes.length} paciente${pacientes.length === 1 ? '' : 's'}`;
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
             ['Indicado por', p.indicacao], ['Nascimento', p.nascimento ? dataBR(p.nascimento) : ''],
             ['Profissão', p.profissao]]
            .map(([k, v]) => `<div><label>${k}</label><div>${esc(v || '—')}</div></div>`).join('')}
        </div>
        ${p.obs ? `<div style="margin-top:10px"><label>Observações</label><div>${esc(p.obs)}</div></div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="abrirConsulta(${p.id})">+ Ficha de consulta</button>
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
      <div><label>País</label><select id="pPais">
        <option${p.pais === 'Brasil' ? ' selected' : ''}>Brasil</option>
        <option value="US"${p.pais === 'US' ? ' selected' : ''}>Estados Unidos</option>
        <option value="Outro"${p.pais === 'Outro' ? ' selected' : ''}>Outro</option></select></div>
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

  $('#salvarPac').onclick = async () => {
    const body = {
      cod: $('#pCod').value.trim(), nome: $('#pNome').value.trim(), apelido: $('#pApelido').value.trim(),
      pais: $('#pPais').value, telefone: $('#pTel').value.trim(), email: $('#pEmail').value.trim(),
      instagram: $('#pInsta').value.trim(), nascimento: $('#pNasc').value, profissao: $('#pProf').value.trim(),
      objetivo: $$('.objChk').filter((c) => c.checked).map((c) => c.value).join(', '),
      indicacao: $('#pInd').value.trim(), cpf: $('#pCpf').value.trim(),
      endereco: $('#pEnd').value.trim(), obs: $('#pObs').value.trim(), status: $('#pStatus').value,
    };
    if (!body.nome) return toast('Informe o nome.');
    try {
      if (id) await api('/pacientes/' + id, { method: 'PUT', body });
      else await api('/pacientes', { method: 'POST', body });
      fecharModal(); toast('Paciente salvo'); if (TELA === 'pacientes') carregarPacientes(); else telaHome();
    } catch (e) { toast(e.message); }
  };
}

async function excluirPaciente(id) {
  if (!confirm('Excluir este paciente e todo o histórico dele? Não dá para desfazer.')) return;
  await api('/pacientes/' + id, { method: 'DELETE' });
  fecharModal(); toast('Paciente excluído'); carregarPacientes();
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
        <div><label>Peso (kg)</label><input id="cKg" type="number" step="0.1" value="${c.peso_kg ?? ''}"></div>
        <div><label>Peso (lbs)</label><input id="cLbs" type="number" step="0.1" value="${c.peso_lbs ?? ''}"></div>
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
  kg.oninput = () => { if (kg.value) lbs.value = (Number(kg.value) * 2.20462).toFixed(1); delta(); };
  lbs.oninput = () => { if (lbs.value) { kg.value = (Number(lbs.value) / 2.20462).toFixed(1); delta(); } };
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
      if (TELA === 'pacientes') carregarPacientes(); else if (TELA === 'home') telaHome();
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
      if (TELA === 'home') telaHome(); else if (TELA === 'financeiro') telaFinanceiro(); else carregarPacientes();
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
      ${evs.map((e) => `<div onclick="abrirCompromisso(${e.id})" style="cursor:pointer;font-size:11.5px;background:${
        e.tipo === 'consulta' ? '#E6EEF8' : e.tipo === 'cobranca' ? '#FCECE9' : e.tipo === 'followup' ? '#FBF0D6' : '#EDF1F6'
      };padding:3px 6px;border-radius:5px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <b>${horaBR(e.inicio)}</b> ${esc(e.titulo)}</div>`).join('')}
    </div>`);
  }

  $('#tela').innerHTML = `
    <div class="topo">
      <div><h1>Agenda</h1><p>Dê dois cliques num dia para criar um compromisso</p></div>
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
  const { pacientes } = await api('/pacientes?limite=500');
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
        ${['marcado', 'feito', 'cancelado'].map((s) => `<option value="${s}"${c.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
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
   FINANCEIRO
   ========================================================== */
async function telaFinanceiro() {
  $('#tela').innerHTML = '<p class="vazio">Carregando…</p>';
  const [f, cob] = await Promise.all([api('/financeiro'), api('/cobrancas?filtro=abertas')]);

  const meses = {};
  f.por_mes.forEach((r) => { (meses[r.mes] ||= []).push(r); });
  const listaMeses = Object.keys(meses).sort().reverse().slice(0, 12);
  const totalBrl = (m) => meses[m].reduce((s, r) => s + Number(r.total_brl || 0), 0);
  const maxMes = Math.max(1, ...listaMeses.map(totalBrl));

  $('#tela').innerHTML = `
    <div class="topo"><div><h1>Financeiro</h1><p>Valores em moeda original e convertidos pela cotação do dia do recebimento</p></div></div>

    <div class="grid g4" style="margin-bottom:16px">
      ${f.a_receber.map((r) => `<div class="kpi"><span>A receber ${r.moeda}</span>
        <b style="font-size:20px">${money(r.total, r.moeda)}</b>
        <small style="color:var(--txt-2)">${r.qtd} parcelas</small></div>`).join('') || '<div class="kpi"><span>A receber</span><b>—</b></div>'}
    </div>

    <div class="grid g2">
      <div class="card">
        <h3>Recebimentos por mês</h3>
        <div style="margin-top:12px">
          ${listaMeses.map((m) => `<div style="margin-bottom:11px">
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <b>${m.split('-').reverse().join('/')}</b>
              <span>${money(totalBrl(m), 'BRL')}</span></div>
            <div class="barra-peso"><i style="width:${(totalBrl(m) / maxMes) * 100}%"></i></div>
            <small style="color:var(--txt-2)">${meses[m].map((r) => `${money(r.total, r.moeda)}`).join(' · ')}</small>
          </div>`).join('') || '<p class="vazio">Nenhum pagamento registrado.</p>'}
        </div>
      </div>

      <div class="card">
        <h3>Contratos por plano</h3>
        <table style="margin-top:8px"><thead><tr><th>Plano</th><th>Qtd</th><th>Total</th></tr></thead><tbody>
          ${f.por_plano.slice(0, 15).map((r) => `<tr>
            <td><span class="cod">${esc(r.codigo_plano || '—')}</span></td>
            <td>${r.qtd}</td><td>${money(r.total, r.moeda)}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">—</td></tr>'}
        </tbody></table>
      </div>
    </div>

    <div class="card" style="margin-top:14px;padding:0;overflow:auto">
      <h3 style="padding:16px 16px 6px">Parcelas em aberto (${cob.cobrancas.length})</h3>
      ${!cob.cobrancas.length ? '<p class="vazio">Nada em aberto.</p>' :
        `<table><thead><tr><th>Paciente</th><th>Parcela</th><th>Valor</th><th>Vence</th><th>Situação</th><th></th></tr></thead><tbody>
        ${cob.cobrancas.map((c) => `<tr>
          <td>${nomeCompleto(c)}</td>
          <td>${c.numero}/${c.total}</td>
          <td>${money(c.valor - c.pago, c.moeda)}</td>
          <td>${dataBR(c.vencimento)}</td>
          <td><span class="tag ${c.dias < 0 ? 'devendo' : c.dias === 0 ? 'hoje' : ''}">${c.dias < 0 ? Math.abs(c.dias) + 'd atraso' : c.dias === 0 ? 'hoje' : 'em ' + c.dias + 'd'}</span></td>
          <td style="white-space:nowrap">
            <button class="btn zap mini" onclick="zap('${esc(c.telefone || '')}')">Zap</button>
            <button class="btn mini" onclick="abrirPagamento(${c.paciente_id},${c.id},${c.valor - c.pago},'${c.moeda}')">Receber</button>
          </td></tr>`).join('')}</tbody></table>`}
    </div>`;
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
