// ============================================================
// CRM Luca Ternes — API (Cloudflare Pages Functions + D1)
// Binding D1 obrigatório no Pages: nome "DB"
// ============================================================

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

// ---------- senha (pbkdf2) ----------
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function hashSenha(senha, saltHex) {
  const salt = saltHex || [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${salt}:${b64(bits)}`;
}
async function confereSenha(senha, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [salt] = guardado.split(':');
  return (await hashSenha(senha, salt)) === guardado;
}

// ---------- sessão ----------
async function usuarioDaSessao(env, req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id,u.nome,u.email,u.papel FROM sessoes s
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = ? AND s.expira_em > datetime('now') AND u.ativo = 1`
  ).bind(token).first();
  return row || null;
}

// ---------- helpers ----------
const hoje = () => new Date().toISOString().slice(0, 10);

function addDias(dataISO, dias) {
  const d = new Date(dataISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(dias || 0));
  return d.toISOString().slice(0, 10);
}
function diffDias(a, b) {
  const d1 = new Date(a + 'T12:00:00Z'), d2 = new Date(b + 'T12:00:00Z');
  return Math.round((d1 - d2) / 86400000);
}
/* Número que chega de três jeitos: já numérico (JSON), em pt-BR ("1.234,56")
   ou em en-US ("1,234.56"). Número nunca é reinterpretado — era o que
   transformava a cotação 5.199 em 5199. */
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return 0;
  const virgula = s.includes(','), ponto = s.includes('.');
  if (virgula && ponto) {
    // vale o separador que aparece por último
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (virgula) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ponto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');   // "1.234.567" é milhar, não decimal
  }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
// medição em branco é "não medi", não zero: zero afundaria o gráfico
const numOuNulo = (v) => (v === null || v === undefined || v === '' ? null : num(v));
const SIMBOLO = { BRL: 'R$', USD: 'US$', GBP: '£', EUR: '€' };
const dataBR = (d) => (!d ? '' : String(d).slice(0, 10).split('-').reverse().join('/'));
const MOEDA_POR_FORMA = { pix: 'BRL', asaas: 'BRL', infinity: 'BRL', zelle: 'USD', paypal: 'USD' };

// ---------- cotação ----------
const semTraco = (d) => String(d).slice(0, 10).replace(/-/g, '');

// Busca a série diária real (bid de fechamento de cada dia) e grava no banco.
// Um pedido cobre um intervalo inteiro, então a importação não faz uma chamada por data.
async function sincronizarCotacoes(env, moeda, de, ate) {
  if (!moeda || moeda === 'BRL') return 0;
  let gravadas = 0;
  let inicio = de;
  // a API devolve no máximo ~360 registros por pedido
  while (inicio <= ate) {
    const fim = addDias(inicio, 330) > ate ? ate : addDias(inicio, 330);
    const u = `https://economia.awesomeapi.com.br/json/daily/${moeda}-BRL/360`
      + `?start_date=${semTraco(inicio)}&end_date=${semTraco(fim)}`;
    try {
      const r = await fetch(u);
      if (r.ok) {
        const lista = await r.json();
        if (Array.isArray(lista)) {
          const st = [];
          for (const it of lista) {
            const taxa = Number(it.bid || it.ask);
            const ts = Number(it.timestamp);
            if (!(taxa > 0) || !ts) continue;
            const dia = new Date(ts * 1000).toISOString().slice(0, 10);
            st.push(env.DB.prepare(
              'INSERT OR REPLACE INTO cotacoes (dia,moeda,taxa,fonte) VALUES (?,?,?,?)')
              .bind(dia, moeda, taxa, 'awesomeapi/daily'));
          }
          if (st.length) { await env.DB.batch(st); gravadas += st.length; }
        }
      }
    } catch (e) { /* sem rede: segue com o que já tem */ }
    inicio = addDias(fim, 1);
  }
  return gravadas;
}

// Taxa de uma data. Usa o dia exato; se não houver (fim de semana, feriado),
// pega o pregão anterior mais próximo. Só busca na rede se o banco não souber.
async function cotacaoDoDia(env, moeda, dia) {
  if (!moeda || moeda === 'BRL') return 1;
  const d = (dia || hoje()).slice(0, 10);

  const exata = await env.DB.prepare('SELECT taxa FROM cotacoes WHERE dia=? AND moeda=?')
    .bind(d, moeda).first();
  if (exata) return exata.taxa;

  const anterior = await env.DB.prepare(
    'SELECT taxa FROM cotacoes WHERE moeda=? AND dia<=? AND dia>=? ORDER BY dia DESC LIMIT 1')
    .bind(moeda, d, addDias(d, -7)).first();
  if (anterior) return anterior.taxa;

  // não tem no banco: puxa uma janela de 10 dias terminando na data pedida
  await sincronizarCotacoes(env, moeda, addDias(d, -9), d);
  const depois = await env.DB.prepare(
    'SELECT taxa FROM cotacoes WHERE moeda=? AND dia<=? ORDER BY dia DESC LIMIT 1')
    .bind(moeda, d).first();
  if (depois) return depois.taxa;

  // data futura ou série indisponível: usa a mais recente conhecida
  const ultima = await env.DB.prepare(
    'SELECT taxa FROM cotacoes WHERE moeda=? ORDER BY dia DESC LIMIT 1').bind(moeda).first();
  return ultima ? ultima.taxa : 0;
}

// ---------- gerar parcelas de um contrato ----------
async function gerarParcelas(env, contrato) {
  await env.DB.prepare('DELETE FROM parcelas WHERE contrato_id=? AND status<>\'paga\'')
    .bind(contrato.id).run();
  const qtd = Math.max(1, Number(contrato.qtd_parcelas || 1));
  const valorParcela = Math.round((Number(contrato.valor_cobrado || 0) / qtd) * 100) / 100;
  // parceria e cortesia não têm o que cobrar: sem parcela, sem aviso na home
  if (!(valorParcela > 0)) return;
  const base = contrato.data_inicial || hoje();
  for (let i = 1; i <= qtd; i++) {
    const venc = addDias(base, 30 * (i - 1));
    await env.DB.prepare(
      `INSERT INTO parcelas (contrato_id,paciente_id,numero,total,valor,moeda,vencimento,status)
       VALUES (?,?,?,?,?,?,?,'aberta')`
    ).bind(contrato.id, contrato.paciente_id, i, qtd, valorParcela, contrato.moeda || 'BRL', venc).run();
  }
}

// ============================================================
// WHATSAPP — Evolution API
// ============================================================
// Converte "hora local naquele fuso" no instante UTC correspondente.
// Usa o próprio Intl para respeitar horário de verão de cada país.
function offsetMin(fuso, quando) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const x of f.formatToParts(quando)) p[x.type] = x.value;
    const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day,
      +p.hour % 24, +p.minute, +p.second);
    return (comoUtc - Math.floor(quando.getTime() / 1000) * 1000) / 60000;
  } catch { return 0; }
}

function localParaUtc(dia, hora, fuso) {
  const [hh, mm] = String(hora || '09:00').split(':').map(Number);
  const palpite = new Date(`${dia}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00Z`);
  let off = offsetMin(fuso, palpite);
  let r = new Date(palpite.getTime() - off * 60000);
  // uma segunda passada resolve a virada de horário de verão
  const off2 = offsetMin(fuso, r);
  if (off2 !== off) r = new Date(palpite.getTime() - off2 * 60000);
  return r.toISOString().slice(0, 19).replace('T', ' ');
}

async function mapaFusos(env) {
  const v = (await env.DB.prepare("SELECT value FROM settings WHERE key='fusos_pais'").first())?.value || '';
  const o = {};
  v.split('|').forEach((p) => { const [k, f] = p.split(':'); if (k && f) o[k.trim()] = f.trim(); });
  return o;
}
const fusoDe = (pac, mapa) => pac.fuso || mapa[pac.pais] || 'America/Sao_Paulo';

// Cidade vira fuso: é o que conserta o paciente da Califórnia receber às 6h.
// Acentos e hífens saem da conta, "São Paulo - SP" acha "sao paulo".
function chaveLugar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[-.,/]/g, ' ').replace(/\s+/g, ' ').trim();
}
async function fusoDoLugar(env, cidade, pais) {
  const k = chaveLugar(cidade);
  if (!k) return null;
  const tenta = async (chave) => (await env.DB.prepare(
    'SELECT fuso FROM fusos_lugar WHERE chave=? LIMIT 1').bind(chave).first())?.fuso || null;
  let f = await tenta(k);
  if (f) return f;
  // "Austin, TX" ou "Miami FL": tenta cada pedaço, do mais específico ao estado
  const partes = k.split(' ').filter(Boolean);
  for (let n = partes.length; n >= 1 && !f; n--) {
    for (let i = 0; i + n <= partes.length && !f; i++) {
      const t = partes.slice(i, i + n).join(' ');
      if (t !== k) f = await tenta(t);
    }
  }
  if (f) return f;
  if (pais) {
    const mapa = await mapaFusos(env);
    if (mapa[pais]) return mapa[pais];
  }
  return null;
}

// token do link de anamnese: só o Luca gera, e vale para um paciente só
const novoToken = () => crypto.randomUUID().replace(/-/g, '').slice(0, 24);

// o formulário tem domínio próprio; sem ele configurado, usa o do CRM
async function baseFormulario(env, url) {
  const v = (await env.DB.prepare("SELECT value FROM settings WHERE key='form_dominio'").first())?.value;
  const base = String(v || '').trim().replace(/\/+$/, '');
  if (base) return /^https?:\/\//.test(base) ? base : 'https://' + base;
  return url.origin + '/form';
}

// Uma migração que não rodou não pode derrubar a ficha inteira do paciente.
// O que é acessório volta vazio e a tela avisa, em vez de dar 500.
/* O formulário sabe coisas que a planilha não tem (altura, nascimento, CPF,
   Instagram). Preenche só o que estiver em branco na ficha — o que o Luca
   digitou à mão vale mais que o que o paciente respondeu. E o peso informado
   vira a primeira consulta de quem ainda não tem nenhuma. */
async function aproveitarAnamnese(env, pid, a) {
  const CAMPOS = ['email', 'telefone', 'instagram', 'nascimento', 'cpf',
    'profissao', 'endereco', 'objetivo', 'altura_cm', 'indicacao'];
  const antes = await env.DB.prepare(
    `SELECT ${CAMPOS.join(',')} FROM pacientes WHERE id=?`).bind(pid).first();
  if (!antes) return { completou: false, ficha: false };
  await env.DB.prepare(
    `UPDATE pacientes SET
        email=COALESCE(NULLIF(email,''),NULLIF(?,'')),
        telefone=COALESCE(NULLIF(telefone,''),NULLIF(?,'')),
        instagram=COALESCE(NULLIF(instagram,''),NULLIF(?,'')),
        nascimento=COALESCE(NULLIF(nascimento,''),NULLIF(?,'')),
        cpf=COALESCE(NULLIF(cpf,''),NULLIF(?,'')),
        profissao=COALESCE(NULLIF(profissao,''),NULLIF(?,'')),
        endereco=COALESCE(NULLIF(endereco,''),NULLIF(?,'')),
        objetivo=COALESCE(NULLIF(objetivo,''),NULLIF(?,'')),
        altura_cm=COALESCE(altura_cm,?),
        indicacao=COALESCE(NULLIF(indicacao,''),NULLIF(?,'')),
        updated_at=datetime('now')
      WHERE id=?`
  ).bind(a.email || '', a.telefone || '', a.instagram || '', a.nascimento || '',
    a.cpf || '', a.profissao || '', a.endereco || '', a.objetivo || '',
    a.altura_cm ? num(a.altura_cm) : null, a.indicacao || '', pid).run();
  const dep = await env.DB.prepare(
    `SELECT ${CAMPOS.join(',')} FROM pacientes WHERE id=?`).bind(pid).first();
  const completou = Object.values(dep).join('|') !== Object.values(antes).join('|');

  let ficha = false;
  const kg = a.peso_kg ? num(a.peso_kg) : 0;
  if (kg > 0) {
    const tem = await env.DB.prepare(
      'SELECT id FROM consultas WHERE paciente_id=? LIMIT 1').bind(pid).first();
    if (!tem) {
      await env.DB.prepare(
        `INSERT INTO consultas (paciente_id,data,peso_kg,peso_lbs,observacoes)
         VALUES (?,?,?,?,?)`
      ).bind(pid, a.respondido_em || hoje(), kg, Math.round(kg * 2.20462 * 10) / 10,
        'peso informado no formulário de anamnese').run();
      ficha = true;
    }
  }
  return { completou, ficha };
}

async function talvez(consulta, padrao) {
  try { return await consulta(); } catch (e) {
    // o SQLite escreve a falta de três jeitos diferentes conforme o comando
    if (/no such table|no such column|has no column named/i.test(String(e && e.message))) return padrao;
    throw e;
  }
}

async function idiomasForm(env) {
  const v = (await env.DB.prepare("SELECT value FROM settings WHERE key='form_idiomas'").first())?.value;
  const l = String(v || 'pt,en,es').split(',').map((s) => s.trim()).filter(Boolean);
  return l.length ? l : ['pt'];
}

// Credencial mora nas variáveis de ambiente do Pages, não no banco: um dump
// do D1 não vaza a chave. O que estiver no banco só vale se a variável faltar.
async function waConfig(env) {
  const r = await env.DB.prepare(
    "SELECT key,value FROM settings WHERE key LIKE 'wa_%'").all();
  const o = {}; (r.results || []).forEach((x) => { o[x.key] = x.value; });

  const fonte = {};
  const daVar = (chave, variavel) => {
    const v = (env[variavel] || '').trim();
    if (v) { o[chave] = v; fonte[chave] = variavel; }
    else if (o[chave]) fonte[chave] = 'banco';
    else fonte[chave] = 'vazio';
  };
  daVar('wa_url', 'EVOLUTION_URL');
  daVar('wa_apikey', 'EVOLUTION_APIKEY');
  daVar('wa_instancia', 'EVOLUTION_INSTANCIA');
  daVar('wa_token_cron', 'CRON_TOKEN');
  if (o.wa_url) o.wa_url = o.wa_url.replace(/\/+$/, '');
  o._fonte = fonte;
  return o;
}

const soDigitos = (t) => String(t || '').replace(/\D/g, '');

// Preenche as variáveis do modelo com o que o CRM já sabe
function montarTexto(corpo, ctx) {
  const v = {
    nome: ctx.nome || '',
    primeiro_nome: (ctx.nome || '').trim().split(/\s+/)[0] || '',
    apelido: ctx.apelido || '',
    cod: ctx.cod || '',
    plano: ctx.plano || '',
    valor: ctx.valor || '',
    parcela: ctx.parcela || '',
    vencimento: ctx.vencimento || '',
    data_call: ctx.data_call || '',
    hora_call: ctx.hora_call || '',
    data_fim: ctx.data_fim || '',
    dias: ctx.dias != null ? String(ctx.dias) : '',
    link_anamnese: ctx.link_anamnese || '',
  };
  return String(corpo || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}

async function enviarWhats(env, telefone, mensagem) {
  const c = await waConfig(env);
  if (!c.wa_url || !c.wa_apikey || !c.wa_instancia)
    return { ok: false, erro: 'WhatsApp não configurado.' };
  const base = c.wa_url.replace(/\/+$/, '');
  try {
    const r = await fetch(`${base}/message/sendText/${encodeURIComponent(c.wa_instancia)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: c.wa_apikey },
      body: JSON.stringify({ number: soDigitos(telefone), text: mensagem }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: j.message || j.error || `HTTP ${r.status}` };
    return { ok: true, resposta: j };
  } catch (e) {
    return { ok: false, erro: String(e && e.message || e) };
  }
}

// ---------- monta a fila do que está por vir ----------
async function agendarAutomaticas(env) {
  const cfg = await waConfig(env);
  if (cfg.wa_ativo !== '1') return { criadas: 0, motivo: 'automações desligadas' };
  const mapa = await mapaFusos(env);
  const ts = await env.DB.prepare("SELECT * FROM wa_templates WHERE ativo=1 AND modo='auto'").all();
  const porEvento = {};
  (ts.results || []).forEach((t) => { porEvento[t.evento] = t; });
  const h = hoje();
  const agoraUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let criadas = 0;

  const janIni = cfg.wa_janela_ini || '08:00';
  const janFim = cfg.wa_janela_fim || '20:00';

  // Respeita a janela de horário do paciente e não dispara mensagem velha:
  // atrasou até 3h, sai no próximo ciclo; mais que isso, o evento perdeu a hora.
  const ajustarHorario = (quandoUtc, fuso, dia) => {
    const iniUtc = localParaUtc(dia, janIni, fuso);
    const fimUtc = localParaUtc(dia, janFim, fuso);
    let q = quandoUtc;
    if (q < iniUtc) q = iniUtc;
    if (q > fimUtc) return null;
    if (q < agoraUtc) {
      const atrasoH = (new Date(agoraUtc.replace(' ', 'T') + 'Z') - new Date(q.replace(' ', 'T') + 'Z')) / 3600000;
      if (atrasoH > 3) return null;
      q = agoraUtc;
    }
    return q;
  };

  const enfileirar = async (chaveUnica, pac, tpl, quandoUtc, texto, refTipo, refId) => {
    if (!pac || !pac.telefone || !quandoUtc) return;
    try {
      await env.DB.prepare(
        `INSERT INTO wa_fila (chave_unica,paciente_id,template_chave,telefone,mensagem,
             agendado_para,status,modo,ref_tipo,ref_id)
         VALUES (?,?,?,?,?,?, 'agendado','auto',?,?)`
      ).bind(chaveUnica, pac.id, tpl.chave, pac.telefone, texto, quandoUtc, refTipo, refId).run();
      criadas++;
    } catch { /* chave_unica repetida: já estava na fila */ }
  };

  // 1) lembrete de call
  if (porEvento.call) {
    const t = porEvento.call;
    const alvo = await env.DB.prepare(
      `SELECT n.id, n.call_em, pa.* FROM negociacoes n JOIN pacientes pa ON pa.id=n.paciente_id
        WHERE n.etapa='call_agendada' AND substr(n.call_em,1,10) BETWEEN ? AND ?`)
      .bind(h, addDias(h, 3)).all();
    for (const x of (alvo.results || [])) {
      const quando = new Date(new Date(x.call_em + ':00Z').getTime() - t.antecedencia_h * 3600000);
      let utc = quando.toISOString().slice(0, 19).replace('T', ' ');
      if (utc < agoraUtc) utc = null;
      const texto = montarTexto(t.corpo, { ...x,
        data_call: dataBR(x.call_em), hora_call: (x.call_em || '').slice(11, 16) });
      await enfileirar(`call:${x.id}`, x, t, utc, texto, 'negociacao', x.id);
    }
  }

  // 2) parcelas: antes, no dia e em atraso
  const eventosParcela = [
    ['parcela_previa', (t) => addDias(h, Math.round(t.antecedencia_h / 24))],
    ['parcela_hoje', () => h],
    ['parcela_atraso', (t) => addDias(h, -Math.round(t.antecedencia_h / 24))],
  ];
  for (const [ev, calcVenc] of eventosParcela) {
    const t = porEvento[ev];
    if (!t) continue;
    const venc = calcVenc(t);
    const alvo = await env.DB.prepare(
      `SELECT p.id, p.numero, p.total, p.valor, p.pago, p.moeda, p.vencimento,
              c.codigo_plano, pa.*
         FROM parcelas p
         JOIN contratos c ON c.id=p.contrato_id
         JOIN pacientes pa ON pa.id=p.paciente_id
        WHERE p.status IN ('aberta','parcial') AND p.vencimento=?
          AND c.status='ativo' AND pa.status NOT IN ('encerrado','parceria')`).bind(venc).all();
    for (const x of (alvo.results || [])) {
      const fu = fusoDe(x, mapa);
      const utc = ajustarHorario(localParaUtc(h, t.hora_envio || '09:00', fu), fu, h);
      const texto = montarTexto(t.corpo, { ...x,
        parcela: `${x.numero}/${x.total}`,
        valor: (SIMBOLO[x.moeda] || x.moeda) + ' ' + Number(x.valor - x.pago).toFixed(2),
        vencimento: dataBR(x.vencimento), plano: x.codigo_plano });
      await enfileirar(`${ev}:${x.id}`, x, t, utc, texto, 'parcela', x.id);
    }
  }

  // 3) renovação
  if (porEvento.renovacao) {
    const t = porEvento.renovacao;
    const diasAntes = Math.round(t.antecedencia_h / 24);
    const alvo = await env.DB.prepare(
      `SELECT c.id, c.data_final, c.codigo_plano, pa.*
         FROM contratos c JOIN pacientes pa ON pa.id=c.paciente_id
        WHERE c.status='ativo' AND c.data_final=?
          AND pa.status NOT IN ('encerrado','parceria')`).bind(addDias(h, diasAntes)).all();
    for (const x of (alvo.results || [])) {
      const fu = fusoDe(x, mapa);
      const utc = ajustarHorario(localParaUtc(h, t.hora_envio || '10:00', fu), fu, h);
      const texto = montarTexto(t.corpo, { ...x,
        plano: x.codigo_plano, data_fim: dataBR(x.data_final), dias: diasAntes });
      await enfileirar(`renov:${x.id}:${h}`, x, t, utc, texto, 'contrato', x.id);
    }
  }

  // 4) check-in diário de quem está ativo
  if (porEvento.checkin) {
    const t = porEvento.checkin;
    const alvo = await env.DB.prepare(
      `SELECT DISTINCT pa.* FROM pacientes pa
         JOIN contratos c ON c.paciente_id=pa.id AND c.status='ativo'
        WHERE pa.status='ativo' AND pa.telefone IS NOT NULL AND pa.telefone<>''`).all();
    for (const x of (alvo.results || [])) {
      const fu = fusoDe(x, mapa);
      const utc = ajustarHorario(localParaUtc(h, t.hora_envio || '08:00', fu), fu, h);
      await enfileirar(`checkin:${x.id}:${h}`, x, t, utc,
        montarTexto(t.corpo, x), 'paciente', x.id);
    }
  }

  return { criadas };
}

// ============================================================
// ROTEADOR
// ============================================================
export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const seg = (params.path || []);
  const rota = '/' + seg.join('/');
  const metodo = request.method.toUpperCase();

  if (metodo === 'OPTIONS') return new Response(null, { status: 204 });
  if (!env.DB) return bad('Banco D1 não conectado (binding "DB").', 500);

  // upload de arquivo chega como multipart: o corpo é lido na própria rota
  const ehUpload = (request.headers.get('content-type') || '').includes('multipart/form-data');
  let body = {};
  if (!ehUpload && ['POST', 'PUT', 'PATCH'].includes(metodo)) {
    try { body = await request.json(); } catch { body = {}; }
  }

  try {
    // ---------- setup inicial (cria o primeiro admin) ----------
    if (rota === '/setup' && metodo === 'POST') {
      const n = await env.DB.prepare('SELECT COUNT(*) c FROM usuarios').first();
      if (n.c > 0) return bad('Já existe usuário cadastrado.', 409);
      const { nome, email, senha } = body;
      if (!email || !senha) return bad('Informe e-mail e senha.');
      await env.DB.prepare('INSERT INTO usuarios (nome,email,senha,papel) VALUES (?,?,?,?)')
        .bind(nome || 'Luca Ternes', String(email).toLowerCase(), await hashSenha(senha), 'admin').run();
      return json({ ok: true });
    }

    if (rota === '/setup' && metodo === 'GET') {
      const n = await env.DB.prepare('SELECT COUNT(*) c FROM usuarios').first();
      return json({ precisa_setup: n.c === 0 });
    }

    // ---------- login ----------
    if (rota === '/login' && metodo === 'POST') {
      const email = String(body.email || '').toLowerCase().trim();
      const u = await env.DB.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1')
        .bind(email).first();
      if (!u || !(await confereSenha(body.senha || '', u.senha)))
        return bad('E-mail ou senha incorretos.', 401);
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const expira = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      await env.DB.prepare('INSERT INTO sessoes (token,usuario_id,expira_em) VALUES (?,?,?)')
        .bind(token, u.id, expira).run();
      return json({ token, usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } });
    }

    // ==========================================================
    // PÚBLICO — formulário de anamnese (sem login, é o paciente)
    // ==========================================================
    if (rota === '/publico/config' && metodo === 'GET') {
      const r = await env.DB.prepare(
        `SELECT codigo, nome, dias, preco_brl, preco_usd FROM planos
          WHERE ativo=1 ORDER BY posicao, codigo`).all();
      const st = await env.DB.prepare(
        "SELECT key,value FROM settings WHERE key LIKE 'form_%'").all();
      const o = {}; (st.results || []).forEach((x) => { o[x.key] = x.value; });
      const blocos = await env.DB.prepare(
        'SELECT * FROM form_blocos WHERE ativo=1 ORDER BY posicao, id').all();
      const campos = await env.DB.prepare(
        'SELECT * FROM form_campos WHERE ativo=1 ORDER BY posicao, id').all();
      const objs = await env.DB.prepare(
        'SELECT nome, nome_en, nome_es FROM objetivos WHERE ativo=1 ORDER BY posicao, id').all();

      // link com token: já sei quem é, o formulário cumprimenta pelo nome
      let convidado = null;
      const t = (url.searchParams.get('t') || '').trim();
      if (t) {
        const p = await env.DB.prepare(
          'SELECT nome, email, telefone, pais, cidade FROM pacientes WHERE form_token=? LIMIT 1')
          .bind(t).first();
        if (p) convidado = p;
      }
      return json({
        planos: r.results || [], textos: o,
        idiomas: await idiomasForm(env),
        blocos: blocos.results || [], campos: campos.results || [],
        objetivos: objs.results || [], convidado,
      });
    }

    if (rota === '/publico/anamnese' && metodo === 'POST') {
      const b = body || {};
      // campo-isca: robô preenche, gente não vê
      if (b.website) return json({ ok: true });

      const nome = String(b.nome || '').trim();
      const email = String(b.email || '').trim();
      const telefone = String(b.telefone || '').trim();
      if (!nome || nome.length < 3) return bad('Informe seu nome completo.');
      if (!email || !email.includes('@')) return bad('Informe um e-mail válido.');
      if (!telefone || telefone.replace(/\D/g, '').length < 8) return bad('Informe um telefone válido.');

      const respostas = (b.respostas && typeof b.respostas === 'object') ? b.respostas : {};
      const IDI = { pt: 'BR', en: 'US', es: 'ES' };
      const idioma = IDI[b.idioma] || 'BR';
      const pais = String(b.pais || (idioma === 'US' ? 'US' : 'Brasil')).trim();
      const cidade = String(b.cidade || '').trim();
      const fuso = await fusoDoLugar(env, cidade, pais);
      const sexo = b.sexo === 'M' || /^m/i.test(b.sexo || '') ? 'M'
        : b.sexo === 'F' || /^(f|mu)/i.test(b.sexo || '') ? 'F' : null;

      // link com token manda direto para a ficha certa, sem adivinhar quem é;
      // sem token, reaproveita por e-mail ou nome e só então cria ficha nova
      let pac = null;
      const tok = String(b.token || '').trim();
      if (tok) pac = await env.DB.prepare(
        'SELECT * FROM pacientes WHERE form_token=? LIMIT 1').bind(tok).first();
      if (!pac) pac = await env.DB.prepare(
        'SELECT * FROM pacientes WHERE lower(trim(email))=lower(trim(?)) LIMIT 1').bind(email).first();
      if (!pac) pac = await env.DB.prepare(
        'SELECT * FROM pacientes WHERE lower(trim(nome))=lower(trim(?)) LIMIT 1').bind(nome).first();

      let pid, cod;
      if (pac) {
        pid = pac.id; cod = pac.cod;
        await env.DB.prepare(
          `UPDATE pacientes SET email=COALESCE(NULLIF(?,''),email),
               telefone=COALESCE(NULLIF(?,''),telefone), pais=COALESCE(NULLIF(?,''),pais),
               cidade=COALESCE(NULLIF(?,''),cidade), fuso=COALESCE(NULLIF(?,''),fuso),
               instagram=COALESCE(NULLIF(?,''),instagram), nascimento=COALESCE(NULLIF(?,''),nascimento),
               objetivo=COALESCE(NULLIF(?,''),objetivo), altura_cm=COALESCE(?,altura_cm),
               sexo=COALESCE(NULLIF(?,''),sexo), profissao=COALESCE(NULLIF(?,''),profissao),
               updated_at=datetime('now') WHERE id=?`
        ).bind(email, telefone, pais, cidade, fuso || '', b.instagram || '', b.nascimento || '',
          b.objetivo || '', b.altura_cm ? num(b.altura_cm) : null, sexo || '', b.profissao || '', pid).run();
      } else {
        const maior = await env.DB.prepare(
          "SELECT MAX(CAST(cod AS INTEGER)) m FROM pacientes WHERE cod GLOB '[0-9]*'").first();
        cod = String((Number(maior && maior.m) || 0) + 1);
        const r = await env.DB.prepare(
          `INSERT INTO pacientes (cod,nome,pais,cidade,fuso,email,telefone,instagram,nascimento,objetivo,
               altura_cm,sexo,profissao,status,indicacao)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'lead', ?)`
        ).bind(cod, nome, pais, cidade || null, fuso, email, telefone, b.instagram || null,
          b.nascimento || null, b.objetivo || null, b.altura_cm ? num(b.altura_cm) : null,
          sexo, b.profissao || null, b.indicacao || null).run();
        pid = r.meta.last_row_id;
      }
      // token é de uso único: respondeu, queima
      if (tok) await env.DB.prepare(
        'UPDATE pacientes SET form_token=NULL WHERE form_token=?').bind(tok).run();

      await env.DB.prepare(
        `INSERT INTO anamneses (paciente_id,cod,nome,email,telefone,respondido_em,origem,dados)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(pid, cod, nome, email, telefone, hoje(), idioma, JSON.stringify(respostas)).run();

      // primeiro peso vira ficha de consulta, para a evolução começar do dia zero
      if (b.peso_kg && num(b.peso_kg) > 0) {
        const kg = num(b.peso_kg);
        await env.DB.prepare(
          `INSERT INTO consultas (paciente_id,data,peso_kg,peso_lbs,observacoes)
           VALUES (?,?,?,?,?)`
        ).bind(pid, hoje(), kg, Math.round(kg * 2.20462 * 10) / 10,
          'peso informado no formulário de anamnese').run();
      }

      // quem já é cliente só está preenchendo a anamnese: não vira lead de novo
      const jaCliente = await env.DB.prepare(
        `SELECT id FROM contratos WHERE paciente_id=? AND status='ativo' LIMIT 1`).bind(pid).first();
      // entra no funil se ainda não houver negociação aberta
      const aberta = jaCliente || await env.DB.prepare(
        `SELECT id FROM negociacoes WHERE paciente_id=? AND tipo='novo'
            AND etapa NOT IN ('fechou','perdido') LIMIT 1`).bind(pid).first();
      if (!aberta) {
        const plano = b.plano_codigo
          ? await env.DB.prepare('SELECT * FROM planos WHERE codigo=?').bind(b.plano_codigo).first() : null;
        await env.DB.prepare(
          `INSERT INTO negociacoes (paciente_id,tipo,etapa,origem,plano_id,valor_previsto,moeda,obs)
           VALUES (?,'novo','novo',?,?,?,?,?)`
        ).bind(pid, b.origem || 'Formulário', plano ? plano.id : null,
          plano ? (pais === 'US' ? plano.preco_usd : plano.preco_brl) : 0,
          pais === 'US' ? 'USD' : 'BRL',
          b.plano_codigo ? `Pediu o plano ${b.plano_codigo} no formulário` : null).run();
      }

      return json({ ok: true, cod });
    }

    // ---------- fila do WhatsApp: chamado pelo Worker de cron ----------
    // Não usa sessão: autentica pelo token gerado na tela de WhatsApp.
    if (rota === '/whatsapp/processar' && metodo === 'POST') {
      const c = await waConfig(env);
      const token = (request.headers.get('x-cron-token') || body.token || '').trim();
      if (!c.wa_token_cron || token !== c.wa_token_cron) return bad('Token inválido.', 401);
      if (c.wa_ativo !== '1') return json({ ok: true, enviadas: 0, motivo: 'automações desligadas' });
      if (!c.wa_url || !c.wa_apikey || !c.wa_instancia)
        return json({ ok: true, enviadas: 0, motivo: 'WhatsApp não configurado' });

      // monta a fila do que precisa sair e só depois envia o que já venceu
      const agendou = await agendarAutomaticas(env);

      const agora = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const pend = await env.DB.prepare(
        `SELECT * FROM wa_fila WHERE status='agendado' AND agendado_para <= ?
          ORDER BY agendado_para ASC LIMIT 40`).bind(agora).all();

      const base = c.wa_url.replace(/\/+$/, '');
      let enviadas = 0, falhas = 0;
      for (const m of (pend.results || [])) {
        let ok = false, erro = null;
        try {
          const r = await fetch(`${base}/message/sendText/${encodeURIComponent(c.wa_instancia)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', apikey: c.wa_apikey },
            body: JSON.stringify({ number: String(m.telefone).replace(/\D/g, ''), text: m.mensagem }),
          });
          const j = await r.json().catch(() => ({}));
          ok = r.ok;
          if (!ok) erro = j.message || j.error || `HTTP ${r.status}`;
        } catch (e) { erro = String(e && e.message || e); }
        await env.DB.prepare(
          'UPDATE wa_fila SET status=?, erro=?, enviado_em=? WHERE id=?')
          .bind(ok ? 'enviado' : 'erro', erro,
            ok ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, m.id).run();
        ok ? enviadas++ : falhas++;
      }
      return json({ ok: true, agendadas: agendou.criadas || 0, enviadas, falhas,
        pendentes: (pend.results || []).length });
    }

    // ---------- daqui pra baixo exige login ----------
    const me = await usuarioDaSessao(env, request);
    if (!me) return bad('Sessão expirada. Faça login novamente.', 401);

    if (rota === '/logout' && metodo === 'POST') {
      const t = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      await env.DB.prepare('DELETE FROM sessoes WHERE token=?').bind(t).run();
      return json({ ok: true });
    }

    if (rota === '/me') return json({ usuario: me });

    // ==========================================================
    // HOME — cobranças, agenda e follow-ups
    // ==========================================================
    if (rota === '/home' && metodo === 'GET') {
      const h = hoje();
      const em7 = addDias(h, 7);
      const em30 = addDias(h, 30);

      const cobrancas = await env.DB.prepare(
        `SELECT p.id,p.numero,p.total,p.valor,p.moeda,p.vencimento,p.pago,
                pa.id paciente_id, pa.nome, pa.apelido, pa.cod, pa.telefone
           FROM parcelas p
           JOIN pacientes pa ON pa.id=p.paciente_id
           JOIN contratos c  ON c.id=p.contrato_id
          WHERE p.status IN ('aberta','parcial') AND p.vencimento <= ?
            AND c.status='ativo' AND pa.status NOT IN ('encerrado','parceria')
          ORDER BY p.vencimento ASC LIMIT 100`).bind(em7).all();

      const listaCob = (cobrancas.results || []).map((r) => ({
        ...r,
        situacao: r.vencimento < h ? 'atrasada' : (r.vencimento === h ? 'hoje' : 'proxima'),
        dias: diffDias(r.vencimento, h),
      }));

      const agenda = await env.DB.prepare(
        `SELECT c.*, pa.nome paciente_nome, pa.apelido paciente_apelido, pa.cod paciente_cod
           FROM compromissos c LEFT JOIN pacientes pa ON pa.id=c.paciente_id
          WHERE c.status='marcado' AND substr(c.inicio,1,10) BETWEEN ? AND ?
          ORDER BY c.inicio ASC LIMIT 50`).bind(h, em7).all();

      const diasFollow = Number((await env.DB.prepare(
        "SELECT value v FROM settings WHERE key='followup_dias_alerta'").first())?.v || 10);

      // Follow-up é quem JÁ foi atendido e sumiu. Quem nunca teve ficha não é
      // atraso de acompanhamento — seria a base inteira no primeiro dia de uso.
      const semRegistro = await env.DB.prepare(
        `SELECT pa.id,pa.nome,pa.apelido,pa.cod,pa.telefone, uc.ultima
           FROM pacientes pa
           JOIN (SELECT paciente_id, MAX(data) AS ultima FROM consultas GROUP BY paciente_id) uc
             ON uc.paciente_id = pa.id
          WHERE pa.status='ativo' AND uc.ultima <= ?
          ORDER BY uc.ultima ASC LIMIT 50`).bind(addDias(h, -diasFollow)).all();

      const vencendo = await env.DB.prepare(
        `SELECT c.id contrato_id,c.data_final,c.codigo_plano,
                pa.id paciente_id,pa.nome,pa.apelido,pa.cod,pa.telefone
           FROM contratos c JOIN pacientes pa ON pa.id=c.paciente_id
          WHERE c.status='ativo' AND c.data_final BETWEEN ? AND ?
          ORDER BY c.data_final ASC LIMIT 50`).bind(h, em30).all();

      const st = await env.DB.prepare(
        `SELECT status, COUNT(*) c FROM pacientes GROUP BY status`).all();

      const aReceber = await env.DB.prepare(
        `SELECT p.moeda, SUM(p.valor - p.pago) total, COUNT(*) qtd
           FROM parcelas p
           JOIN contratos c ON c.id=p.contrato_id
           JOIN pacientes pa ON pa.id=p.paciente_id
          WHERE p.status IN ('aberta','parcial') AND c.status='ativo'
            AND pa.status NOT IN ('encerrado','parceria')
          GROUP BY p.moeda`).all();

      const mesAtual = h.slice(0, 7);
      const mesAnterior = h.slice(0, 8) === h.slice(0, 8)
        ? addDias(h.slice(0, 8) + '01', -1).slice(0, 7) : mesAtual;
      const recebido = await env.DB.prepare(
        `SELECT moeda, SUM(valor) total, SUM(valor_brl) total_brl
           FROM pagamentos WHERE substr(data,1,7)=? GROUP BY moeda`).bind(mesAtual).all();
      const recebidoAnt = await env.DB.prepare(
        `SELECT SUM(valor_brl) total_brl FROM pagamentos WHERE substr(data,1,7)=?`)
        .bind(mesAnterior).first();

      // --- venda: o dia do Luca ---
      const calls = await env.DB.prepare(
        `SELECT n.id, n.call_em, n.tipo, n.origem, n.valor_previsto, n.moeda,
                pa.id paciente_id, pa.nome, pa.apelido, pa.cod, pa.telefone, pa.objetivo
           FROM negociacoes n JOIN pacientes pa ON pa.id=n.paciente_id
          WHERE n.etapa='call_agendada' AND substr(n.call_em,1,10) <= ?
          ORDER BY n.call_em ASC LIMIT 50`).bind(em7).all();

      const followVenda = await env.DB.prepare(
        `SELECT n.id, n.tipo, n.proximo_contato, n.motivo, n.obs, n.valor_previsto, n.moeda,
                pa.id paciente_id, pa.nome, pa.apelido, pa.cod, pa.telefone
           FROM negociacoes n JOIN pacientes pa ON pa.id=n.paciente_id
          WHERE n.etapa='follow_up' AND n.proximo_contato <= ?
          ORDER BY n.proximo_contato ASC LIMIT 50`).bind(h).all();

      const renovar = await env.DB.prepare(
        `SELECT n.id, n.etapa, n.proximo_contato, n.valor_previsto, n.moeda,
                c.data_final, c.codigo_plano,
                pa.id paciente_id, pa.nome, pa.apelido, pa.cod, pa.telefone
           FROM negociacoes n
           JOIN pacientes pa ON pa.id=n.paciente_id
           LEFT JOIN contratos c ON c.id=n.contrato_origem
          WHERE n.tipo='renovacao' AND n.etapa IN ('a_abordar','abordado','follow_up')
          ORDER BY c.data_final ASC LIMIT 50`).all();

      const mesIni = mesAtual + '-01';
      const funilMes = await env.DB.prepare(
        `SELECT
           SUM(CASE WHEN substr(call_em,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) calls,
           SUM(CASE WHEN etapa='fechou'  AND substr(fechado_em,1,7)=? THEN 1 ELSE 0 END) fechou,
           SUM(CASE WHEN etapa='perdido' AND substr(fechado_em,1,7)=? THEN 1 ELSE 0 END) perdeu
         FROM negociacoes WHERE tipo='novo'`).bind(mesIni, h, mesAtual, mesAtual).first();

      return json({
        hoje: h,
        cobrancas: listaCob,
        agenda: agenda.results || [],
        calls: (calls.results || []).map((r) => ({
          ...r, dias: diffDias((r.call_em || '').slice(0, 10), h) })),
        follow_venda: (followVenda.results || []).map((r) => ({
          ...r, dias: diffDias(r.proximo_contato, h) })),
        renovacoes: (renovar.results || []).map((r) => ({
          ...r, dias: r.data_final ? diffDias(r.data_final, h) : null })),
        followups: (semRegistro.results || []).map((r) => ({
          ...r, dias_sem_registro: r.ultima ? diffDias(h, r.ultima) : null,
        })),
        vencendo: (vencendo.results || []).map((r) => ({ ...r, dias: diffDias(r.data_final, h) })),
        status: st.results || [],
        a_receber: aReceber.results || [],
        recebido_mes: recebido.results || [],
        recebido_mes_anterior: (recebidoAnt && recebidoAnt.total_brl) || 0,
        funil_mes: funilMes || { calls: 0, fechou: 0, perdeu: 0 },
      });
    }

    // ==========================================================
    // FUNIL — leads novos e renovações
    // ==========================================================
    const ETAPAS_NOVO = ['novo', 'call_agendada', 'follow_up', 'fechou', 'perdido'];
    const ETAPAS_RENOV = ['a_abordar', 'abordado', 'follow_up', 'renovou', 'saiu'];

    // cria a negociação de renovação dos contratos que estão terminando
    if (rota === '/funil/sincronizar' && metodo === 'POST') {
      const dias = Number((await env.DB.prepare(
        "SELECT value v FROM settings WHERE key='renovacao_antecedencia'").first())?.v || 30);
      const limite = addDias(hoje(), dias);
      const alvos = await env.DB.prepare(
        `SELECT c.id, c.paciente_id, c.valor_cobrado, c.moeda, c.plano_id
           FROM contratos c
           JOIN pacientes pa ON pa.id=c.paciente_id
          WHERE c.status='ativo' AND c.data_final BETWEEN ? AND ?
            AND pa.status NOT IN ('encerrado','parceria')
            AND NOT EXISTS (SELECT 1 FROM negociacoes n WHERE n.contrato_origem=c.id)
          LIMIT 200`).bind(hoje(), limite).all();
      let criadas = 0;
      for (const c of (alvos.results || [])) {
        await env.DB.prepare(
          `INSERT INTO negociacoes (paciente_id,tipo,etapa,contrato_origem,plano_id,valor_previsto,moeda)
           VALUES (?,'renovacao','a_abordar',?,?,?,?)`
        ).bind(c.paciente_id, c.id, c.plano_id || null, c.valor_cobrado || 0, c.moeda || 'BRL').run();
        criadas++;
      }
      return json({ ok: true, criadas });
    }

    if (rota === '/funil' && metodo === 'GET') {
      const tipo = url.searchParams.get('tipo') || 'novo';
      const h = hoje();
      const r = await env.DB.prepare(
        `SELECT n.*, pa.nome, pa.apelido, pa.cod, pa.telefone, pa.pais, pa.objetivo, pa.instagram,
                c.data_final, c.codigo_plano AS plano_anterior
           FROM negociacoes n
           JOIN pacientes pa ON pa.id=n.paciente_id
           LEFT JOIN contratos c ON c.id=n.contrato_origem
          WHERE n.tipo=?
          ORDER BY COALESCE(n.proximo_contato, substr(n.call_em,1,10), c.data_final, n.created_at) ASC
          LIMIT 500`).bind(tipo).all();
      const motivos = await env.DB.prepare(
        `SELECT * FROM motivos_perda WHERE ativo=1 AND aplica IN ('ambos',?) ORDER BY posicao`)
        .bind(tipo).all();
      return json({
        negociacoes: (r.results || []).map((x) => ({
          ...x,
          atrasado: !!(x.proximo_contato && x.proximo_contato < h),
          dias_contato: x.proximo_contato ? diffDias(x.proximo_contato, h) : null,
        })),
        etapas: tipo === 'renovacao' ? ETAPAS_RENOV : ETAPAS_NOVO,
        motivos: motivos.results || [],
      });
    }

    // novo lead: cria a pessoa e a negociação juntas
    if (rota === '/funil' && metodo === 'POST') {
      const b = body;
      if (!b.nome) return bad('Informe o nome.');
      let pid = b.paciente_id;
      if (!pid) {
        const r = await env.DB.prepare(
          `INSERT INTO pacientes (nome,apelido,pais,telefone,email,instagram,objetivo,status,indicacao)
           VALUES (?,?,?,?,?,?,?, 'lead', ?)`
        ).bind(b.nome.trim(), b.apelido || null, b.pais || 'Brasil', b.telefone || null,
          b.email || null, b.instagram || null, b.objetivo || null, b.indicacao || null).run();
        pid = r.meta.last_row_id;
      }
      const res = await env.DB.prepare(
        `INSERT INTO negociacoes (paciente_id,tipo,etapa,origem,call_em,proximo_contato,
             plano_id,valor_previsto,moeda,obs)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(pid, b.tipo || 'novo', b.etapa || (b.call_em ? 'call_agendada' : 'novo'),
        b.origem || 'Direct', b.call_em || null, b.proximo_contato || null,
        b.plano_id || null, num(b.valor_previsto), b.moeda || 'BRL', b.obs || null).run();
      return json({ ok: true, id: res.meta.last_row_id, paciente_id: pid });
    }

    if (rota.startsWith('/funil/') && seg.length === 2 && metodo === 'PUT') {
      const id = seg[1]; const b = body;
      const n = await env.DB.prepare('SELECT * FROM negociacoes WHERE id=?').bind(id).first();
      if (!n) return bad('Negociação não encontrada.', 404);

      const etapa = b.etapa || n.etapa;
      const terminal = ['fechou', 'perdido', 'renovou', 'saiu'].includes(etapa);
      const fechadoEm = terminal ? (b.fechado_em || hoje()) : null;

      await env.DB.prepare(
        `UPDATE negociacoes SET etapa=?, origem=?, call_em=?, proximo_contato=?, motivo=?,
             plano_id=?, valor_previsto=?, moeda=?, obs=?, fechado_em=?, updated_at=datetime('now')
         WHERE id=?`
      ).bind(etapa, b.origem ?? n.origem, b.call_em ?? n.call_em,
        etapa === 'follow_up' ? (b.proximo_contato ?? n.proximo_contato) : null,
        terminal ? (b.motivo ?? n.motivo) : null,
        b.plano_id ?? n.plano_id, b.valor_previsto != null ? num(b.valor_previsto) : n.valor_previsto,
        b.moeda ?? n.moeda, b.obs ?? n.obs, fechadoEm, id).run();

      // registra o toque no histórico
      if (b.interacao) {
        await env.DB.prepare(
          `INSERT INTO interacoes (negociacao_id,paciente_id,tipo,data,resultado,obs)
           VALUES (?,?,?,?,?,?)`
        ).bind(id, n.paciente_id, b.interacao.tipo || 'nota', b.interacao.data || hoje(),
          b.interacao.resultado || etapa, b.interacao.obs || null).run();
      }

      // perdeu / não renovou: a pessoa sai de ativo
      if (etapa === 'perdido') {
        await env.DB.prepare(
          "UPDATE pacientes SET status='encerrado', updated_at=datetime('now') WHERE id=? AND status='lead'")
          .bind(n.paciente_id).run();
      }
      if (etapa === 'saiu' && n.contrato_origem) {
        await env.DB.prepare("UPDATE contratos SET status='encerrado' WHERE id=?")
          .bind(n.contrato_origem).run();
      }
      return json({ ok: true });
    }

    // fechar a venda: vira contrato de verdade
    if (rota.startsWith('/funil/') && seg.length === 3 && seg[2] === 'fechar' && metodo === 'POST') {
      const id = seg[1]; const b = body;
      const n = await env.DB.prepare('SELECT * FROM negociacoes WHERE id=?').bind(id).first();
      if (!n) return bad('Negociação não encontrada.', 404);

      const plano = b.plano_id
        ? await env.DB.prepare('SELECT * FROM planos WHERE id=?').bind(b.plano_id).first() : null;
      const ini = b.data_inicial || hoje();
      const fim = b.data_final || (plano ? addDias(ini, plano.dias) : addDias(ini, 30));
      const moeda = b.moeda || MOEDA_POR_FORMA[(b.forma || '').toLowerCase()] || n.moeda || 'BRL';
      const valor = b.valor_cobrado != null && b.valor_cobrado !== ''
        ? num(b.valor_cobrado)
        : (plano ? (moeda === 'USD' ? plano.preco_usd : plano.preco_brl) : num(n.valor_previsto));

      const cr = await env.DB.prepare(
        `INSERT INTO contratos (paciente_id,plano_id,codigo_plano,data_inicial,data_final,
            valor_cobrado,moeda,forma,qtd_parcelas,status,obs)
         VALUES (?,?,?,?,?,?,?,?,?, 'ativo', ?)`
      ).bind(n.paciente_id, b.plano_id || null, plano ? plano.codigo : (b.codigo_plano || null),
        ini, fim, valor, moeda, b.forma || null, Number(b.qtd_parcelas || 1), b.obs || null).run();

      const contrato = await env.DB.prepare('SELECT * FROM contratos WHERE id=?')
        .bind(cr.meta.last_row_id).first();
      await gerarParcelas(env, contrato);

      const etapa = n.tipo === 'renovacao' ? 'renovou' : 'fechou';
      await env.DB.prepare(
        `UPDATE negociacoes SET etapa=?, contrato_id=?, fechado_em=?, proximo_contato=NULL,
             valor_previsto=?, moeda=?, updated_at=datetime('now') WHERE id=?`
      ).bind(etapa, contrato.id, hoje(), valor, moeda, id).run();

      await env.DB.prepare(
        "UPDATE pacientes SET status='ativo', updated_at=datetime('now') WHERE id=?")
        .bind(n.paciente_id).run();

      // renovação fechada encerra o contrato anterior
      if (n.contrato_origem) {
        await env.DB.prepare("UPDATE contratos SET status='encerrado' WHERE id=?")
          .bind(n.contrato_origem).run();
      }

      await env.DB.prepare(
        `INSERT INTO interacoes (negociacao_id,paciente_id,tipo,data,resultado,obs)
         VALUES (?,?,'call',?,?,?)`
      ).bind(id, n.paciente_id, hoje(), etapa, b.obs || null).run();

      return json({ ok: true, contrato_id: contrato.id, paciente_id: n.paciente_id });
    }

    if (rota.startsWith('/funil/') && seg.length === 2 && metodo === 'DELETE') {
      const id = seg[1];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM interacoes WHERE negociacao_id=?').bind(id),
        env.DB.prepare('DELETE FROM negociacoes WHERE id=?').bind(id),
      ]);
      return json({ ok: true });
    }

    if (rota === '/motivos' && metodo === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM motivos_perda ORDER BY posicao, nome').all();
      return json({ motivos: r.results || [] });
    }
    if (rota === '/motivos' && metodo === 'POST') {
      await env.DB.prepare('INSERT OR IGNORE INTO motivos_perda (nome,aplica,posicao) VALUES (?,?,?)')
        .bind(body.nome, body.aplica || 'ambos', Number(body.posicao || 99)).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/motivos/') && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM motivos_perda WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // relatório: por que perde
    if (rota === '/funil/relatorio' && metodo === 'GET') {
      const de = url.searchParams.get('de') || addDias(hoje(), -180);
      const porMotivo = await env.DB.prepare(
        `SELECT tipo, motivo, COUNT(*) qtd, SUM(valor_previsto) valor
           FROM negociacoes
          WHERE etapa IN ('perdido','saiu') AND fechado_em >= ?
          GROUP BY tipo, motivo ORDER BY qtd DESC`).bind(de).all();
      const conversao = await env.DB.prepare(
        `SELECT tipo,
                SUM(CASE WHEN etapa IN ('fechou','renovou') THEN 1 ELSE 0 END) ganhou,
                SUM(CASE WHEN etapa IN ('perdido','saiu')   THEN 1 ELSE 0 END) perdeu,
                SUM(CASE WHEN etapa IN ('fechou','renovou') THEN valor_previsto ELSE 0 END) valor_ganho
           FROM negociacoes WHERE fechado_em >= ? GROUP BY tipo`).bind(de).all();
      const porOrigem = await env.DB.prepare(
        `SELECT origem, COUNT(*) qtd,
                SUM(CASE WHEN etapa='fechou' THEN 1 ELSE 0 END) fechou
           FROM negociacoes WHERE tipo='novo' AND created_at >= ?
          GROUP BY origem ORDER BY qtd DESC`).bind(de).all();
      return json({
        de,
        por_motivo: porMotivo.results || [],
        conversao: conversao.results || [],
        por_origem: porOrigem.results || [],
      });
    }

    // ==========================================================
    // DIAGNÓSTICO — o que o banco ainda não tem
    // Sem CLI, é assim que ele descobre qual migração falta rodar.
    // ==========================================================
    if (rota === '/diagnostico' && metodo === 'GET') {
      const EXIGE = [
        { migracao: 'migrate-01.sql', o_que: 'funil de vendas',
          tabelas: ['negociacoes', 'interacoes', 'motivos_perda'], colunas: [] },
        { migracao: 'migrate-02.sql', o_que: 'sexo e altura do paciente',
          tabelas: [], colunas: [['pacientes', 'sexo'], ['pacientes', 'altura_cm']] },
        { migracao: 'migrate-03.sql', o_que: 'WhatsApp',
          tabelas: ['wa_templates', 'wa_fila'], colunas: [['pacientes', 'fuso']] },
        { migracao: 'migrate-04.sql', o_que: 'textos do formulário',
          tabelas: [], colunas: [] },
        { migracao: 'migrate-05.sql', o_que: 'planos e anexos na ficha',
          tabelas: ['anexos'], colunas: [] },
        { migracao: 'migrate-06.sql',
          o_que: 'objetivos, perguntas do formulário, cidade/fuso, refeições, TMB e InBody',
          tabelas: ['objetivos', 'form_blocos', 'form_campos', 'fusos_lugar', 'inbody'],
          colunas: [['pacientes', 'cidade'], ['pacientes', 'form_token'],
            ['pacientes', 'inbody_ativo'], ['consultas', 'refeicoes'], ['consultas', 'tmb']] },
      ];
      const existe = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'").all();
      const tabelas = new Set((existe.results || []).map((x) => x.name));
      const colunasDe = {};
      for (const t of ['pacientes', 'consultas']) {
        if (!tabelas.has(t)) { colunasDe[t] = new Set(); continue; }
        const c = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
        colunasDe[t] = new Set((c.results || []).map((x) => x.name));
      }
      const pendentes = [];
      for (const m of EXIGE) {
        const faltamTabelas = m.tabelas.filter((t) => !tabelas.has(t));
        const faltamColunas = m.colunas.filter(([t, c]) => !(colunasDe[t] || new Set()).has(c));
        if (faltamTabelas.length || faltamColunas.length) {
          pendentes.push({ migracao: m.migracao, o_que: m.o_que,
            tabelas: faltamTabelas, colunas: faltamColunas.map(([t, c]) => `${t}.${c}`) });
        }
      }
      return json({
        ok: pendentes.length === 0,
        pendentes,
        r2: !!env.ARQUIVOS,
        tabelas: [...tabelas].sort(),
      });
    }

    // ==========================================================
    // INBODY — a planilha de medições e a tela de apresentação
    // ==========================================================
    if (rota === '/inbody' && metodo === 'GET') {
      const pid = url.searchParams.get('paciente_id');
      if (!pid) return bad('Informe o paciente.');
      const p = await env.DB.prepare('SELECT * FROM pacientes WHERE id=?').bind(pid).first();
      if (!p) return bad('Paciente não encontrado.', 404);
      const r = await env.DB.prepare(
        'SELECT * FROM inbody WHERE paciente_id=? ORDER BY data ASC, hora ASC, id ASC').bind(pid).all();
      const medicoes = r.results || [];
      const st = await env.DB.prepare(
        "SELECT key,value FROM settings WHERE key LIKE 'inbody_%'").all();
      const cfg = {}; (st.results || []).forEach((x) => { cfg[x.key] = x.value; });
      // o cabeçalho da planilha: peso e data iniciais são a primeira medição
      const contrato = await env.DB.prepare(
        `SELECT c.codigo_plano, pl.nome plano_nome FROM contratos c
            LEFT JOIN planos pl ON pl.codigo=c.codigo_plano
          WHERE c.paciente_id=? AND c.status='ativo' ORDER BY c.id DESC LIMIT 1`).bind(pid).first();
      return json({
        paciente: p, medicoes, config: cfg,
        cabecalho: {
          id_nome: `${p.cod || ''}${p.cod ? '- ' : ''}${p.nome}`,
          altura_cm: p.altura_cm, sexo: p.sexo, nascimento: p.nascimento,
          peso_inicial: medicoes.length ? medicoes[0].peso : null,
          data_inicial: medicoes.length ? medicoes[0].data : null,
          data_ultima: medicoes.length ? medicoes[medicoes.length - 1].data : null,
          plano: p.inbody_plano || (contrato ? (contrato.plano_nome || contrato.codigo_plano) : ''),
          modelo: p.inbody_modelo || cfg.inbody_modelo || 'H30',
        },
      });
    }
    if (rota === '/inbody' && metodo === 'POST') {
      const b = body;
      if (!b.paciente_id) return bad('Informe o paciente.');
      if (!b.data) return bad('Informe a data da medição.');
      const r = await env.DB.prepare(
        `INSERT INTO inbody (paciente_id,data,hora,peso,massa_muscular,gordura_kg,
             gordura_pct,gordura_visceral,obs)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(b.paciente_id, b.data, b.hora || null, numOuNulo(b.peso), numOuNulo(b.massa_muscular),
        numOuNulo(b.gordura_kg), numOuNulo(b.gordura_pct), numOuNulo(b.gordura_visceral),
        b.obs || null).run();
      // primeira medição liga o InBody na ficha sozinha
      await env.DB.prepare('UPDATE pacientes SET inbody_ativo=1 WHERE id=?').bind(b.paciente_id).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    if (rota.startsWith('/inbody/') && seg.length === 2 && seg[1] !== 'config' && metodo === 'PUT') {
      const b = body;
      await env.DB.prepare(
        `UPDATE inbody SET data=?,hora=?,peso=?,massa_muscular=?,gordura_kg=?,
            gordura_pct=?,gordura_visceral=?,obs=? WHERE id=?`
      ).bind(b.data, b.hora || null, numOuNulo(b.peso), numOuNulo(b.massa_muscular),
        numOuNulo(b.gordura_kg), numOuNulo(b.gordura_pct), numOuNulo(b.gordura_visceral),
        b.obs || null, seg[1]).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/inbody/') && seg.length === 2 && seg[1] !== 'config' && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM inbody WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }
    // liga/desliga o InBody e ajusta modelo e plano do cabeçalho
    if (rota === '/inbody/config' && metodo === 'PUT') {
      const b = body;
      if (!b.paciente_id) return bad('Informe o paciente.');
      await env.DB.prepare(
        'UPDATE pacientes SET inbody_ativo=?, inbody_modelo=?, inbody_plano=? WHERE id=?')
        .bind(b.inbody_ativo ? 1 : 0, b.inbody_modelo || null, b.inbody_plano || null, b.paciente_id).run();
      return json({ ok: true });
    }

    // ==========================================================
    // OBJETIVOS — a lista que alimenta cadastro, ficha e formulário
    // ==========================================================
    if (rota === '/objetivos' && metodo === 'GET') {
      const r = await env.DB.prepare(
        'SELECT * FROM objetivos ORDER BY posicao, id').all();
      return json({ objetivos: r.results || [] });
    }
    if (rota === '/objetivos' && metodo === 'POST') {
      const nome = String(body.nome || '').trim();
      if (!nome) return bad('Informe o nome do objetivo.');
      const existe = await env.DB.prepare(
        'SELECT id FROM objetivos WHERE lower(nome)=lower(?)').bind(nome).first();
      if (existe) return bad('Já existe um objetivo com esse nome.');
      const m = await env.DB.prepare('SELECT MAX(posicao) p FROM objetivos').first();
      const r = await env.DB.prepare(
        'INSERT INTO objetivos (nome,nome_en,nome_es,posicao) VALUES (?,?,?,?)')
        .bind(nome, body.nome_en || null, body.nome_es || null, (Number(m && m.p) || 0) + 1).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    if (rota.startsWith('/objetivos/') && metodo === 'PUT') {
      const id = seg[1];
      const atual = await env.DB.prepare('SELECT * FROM objetivos WHERE id=?').bind(id).first();
      if (!atual) return bad('Objetivo não encontrado.', 404);
      const nome = String(body.nome || '').trim();
      if (!nome) return bad('Informe o nome do objetivo.');
      await env.DB.prepare(
        'UPDATE objetivos SET nome=?,nome_en=?,nome_es=?,ativo=?,posicao=? WHERE id=?')
        .bind(nome, body.nome_en || null, body.nome_es || null,
          body.ativo === 0 || body.ativo === false ? 0 : 1,
          body.posicao == null ? atual.posicao : Number(body.posicao), id).run();
      // renomear o objetivo não pode deixar os pacientes apontando para o nome velho
      if (nome !== atual.nome) {
        await env.DB.prepare('UPDATE pacientes SET objetivo=? WHERE objetivo=?').bind(nome, atual.nome).run();
        await env.DB.prepare('UPDATE consultas SET objetivo=? WHERE objetivo=?').bind(nome, atual.nome).run();
      }
      return json({ ok: true });
    }
    if (rota.startsWith('/objetivos/') && metodo === 'DELETE') {
      const alvo = await env.DB.prepare('SELECT * FROM objetivos WHERE id=?').bind(seg[1]).first();
      if (!alvo) return bad('Objetivo não encontrado.', 404);
      const uso = await env.DB.prepare(
        "SELECT COUNT(*) c FROM pacientes WHERE objetivo LIKE '%'||?||'%'").bind(alvo.nome).first();
      // em uso vira inativo: some das listas novas sem sumir das fichas antigas
      if (uso && uso.c > 0) {
        await env.DB.prepare('UPDATE objetivos SET ativo=0 WHERE id=?').bind(seg[1]).run();
        return json({ ok: true, desativado: true, pacientes: uso.c });
      }
      await env.DB.prepare('DELETE FROM objetivos WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // ==========================================================
    // FORMULÁRIO DE ANAMNESE — perguntas editáveis em 3 idiomas
    // ==========================================================
    if (rota === '/form/campos' && metodo === 'GET') {
      const blocos = await env.DB.prepare('SELECT * FROM form_blocos ORDER BY posicao, id').all();
      const campos = await env.DB.prepare('SELECT * FROM form_campos ORDER BY posicao, id').all();
      return json({
        blocos: blocos.results || [], campos: campos.results || [],
        idiomas: await idiomasForm(env),
      });
    }
    if (rota === '/form/campos' && metodo === 'PUT') {
      const campos = Array.isArray(body.campos) ? body.campos : [];
      const blocos = Array.isArray(body.blocos) ? body.blocos : [];
      for (const b of blocos) {
        if (!b.chave) continue;
        await env.DB.prepare(
          `UPDATE form_blocos SET titulo_pt=?,titulo_en=?,titulo_es=?,
             ajuda_pt=?,ajuda_en=?,ajuda_es=?,ativo=?,posicao=? WHERE chave=?`)
          .bind(b.titulo_pt || '', b.titulo_en || '', b.titulo_es || '',
            b.ajuda_pt || '', b.ajuda_en || '', b.ajuda_es || '',
            b.ativo ? 1 : 0, Number(b.posicao) || 0, b.chave).run();
      }
      for (const c of campos) {
        if (!c.chave) continue;
        await env.DB.prepare(
          `UPDATE form_campos SET rot_pt=?,rot_en=?,rot_es=?,dica_pt=?,dica_en=?,dica_es=?,
             opcoes_pt=?,opcoes_en=?,opcoes_es=?,obrigatorio=?,ativo=?,posicao=? WHERE chave=?`)
          .bind(c.rot_pt || '', c.rot_en || '', c.rot_es || '',
            c.dica_pt || '', c.dica_en || '', c.dica_es || '',
            c.opcoes_pt || '', c.opcoes_en || '', c.opcoes_es || '',
            c.obrigatorio ? 1 : 0, c.ativo ? 1 : 0, Number(c.posicao) || 0, c.chave).run();
      }
      return json({ ok: true, blocos: blocos.length, campos: campos.length });
    }
    if (rota === '/form/campos' && metodo === 'POST') {
      const chave = String(body.chave || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!chave) return bad('Informe a chave da pergunta.');
      if (!String(body.rot_pt || '').trim()) return bad('Informe a pergunta em português.');
      const bloco = String(body.bloco_chave || '').trim();
      const temBloco = await env.DB.prepare('SELECT chave FROM form_blocos WHERE chave=?').bind(bloco).first();
      if (!temBloco) return bad('Bloco não encontrado.');
      const existe = await env.DB.prepare('SELECT id FROM form_campos WHERE chave=?').bind(chave).first();
      if (existe) return bad('Já existe uma pergunta com essa chave.');
      const m = await env.DB.prepare('SELECT MAX(posicao) p FROM form_campos').first();
      const r = await env.DB.prepare(
        `INSERT INTO form_campos (bloco_chave,chave,tipo,rot_pt,rot_en,rot_es,
           dica_pt,dica_en,dica_es,opcoes_pt,opcoes_en,opcoes_es,obrigatorio,posicao)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(bloco, chave, body.tipo || 'texto', body.rot_pt, body.rot_en || '', body.rot_es || '',
          body.dica_pt || '', body.dica_en || '', body.dica_es || '',
          body.opcoes_pt || '', body.opcoes_en || '', body.opcoes_es || '',
          body.obrigatorio === 0 || body.obrigatorio === false ? 0 : 1,
          (Number(m && m.p) || 0) + 1).run();
      return json({ ok: true, id: r.meta.last_row_id, chave });
    }
    if (rota.startsWith('/form/campos/') && metodo === 'DELETE') {
      // as perguntas de cadastro sustentam o CRM; essas só podem ser desligadas
      const FIXAS = ['nome', 'email', 'telefone', 'pais'];
      const c = await env.DB.prepare('SELECT * FROM form_campos WHERE id=?').bind(seg[2]).first();
      if (!c) return bad('Pergunta não encontrada.', 404);
      if (FIXAS.includes(c.chave)) return bad('Essa pergunta é obrigatória para o cadastro funcionar.');
      await env.DB.prepare('DELETE FROM form_campos WHERE id=?').bind(seg[2]).run();
      return json({ ok: true });
    }

    // ---------- fuso a partir da cidade ----------
    if (rota === '/fusos' && metodo === 'GET') {
      const lugar = url.searchParams.get('lugar') || '';
      const pais = url.searchParams.get('pais') || '';
      const fuso = await fusoDoLugar(env, lugar, pais);
      return json({ fuso, achou: !!fuso });
    }

    // ---------- tarefas: a listinha que acompanha o Luca em todas as telas ----------
    if (rota === '/tarefas' && metodo === 'GET') {
      // quem já usava o bloco de notas não perde o que escreveu:
      // cada linha vira uma tarefa, uma vez só
      const tem = await env.DB.prepare('SELECT id FROM tarefas LIMIT 1').first();
      if (!tem) {
        const velho = (await env.DB.prepare(
          "SELECT value FROM settings WHERE key='postit'").first())?.value || '';
        const linhas = velho.split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < linhas.length; i++) {
          await env.DB.prepare('INSERT INTO tarefas (texto,posicao) VALUES (?,?)')
            .bind(linhas[i].slice(0, 500), i + 1).run();
        }
        if (linhas.length) await env.DB.prepare(
          "UPDATE settings SET value='' WHERE key='postit'").run();
      }
      // sem data vai para o fim da lista, não para o começo
      const abertas = await env.DB.prepare(
        `SELECT * FROM tarefas WHERE feita=0
          ORDER BY CASE WHEN data IS NULL OR data='' THEN 1 ELSE 0 END,
                   data ASC, COALESCE(NULLIF(hora,''),'99:99') ASC, posicao ASC, id ASC`).all();
      const feitas = await env.DB.prepare(
        'SELECT * FROM tarefas WHERE feita=1 ORDER BY feita_em DESC, id DESC LIMIT 50').all();
      const quantasFeitas = await env.DB.prepare(
        'SELECT COUNT(*) c FROM tarefas WHERE feita=1').first();
      return json({
        abertas: abertas.results || [],
        feitas: feitas.results || [],
        total_feitas: (quantasFeitas && quantasFeitas.c) || 0,
      });
    }
    if (rota === '/tarefas' && metodo === 'POST') {
      const texto = String(body.texto || '').trim().slice(0, 500);
      if (!texto) return bad('Escreva a tarefa.');
      const m = await env.DB.prepare('SELECT MAX(posicao) p FROM tarefas').first();
      const r = await env.DB.prepare(
        'INSERT INTO tarefas (texto,data,hora,posicao) VALUES (?,?,?,?)')
        .bind(texto, body.data || null, body.hora || null, (Number(m && m.p) || 0) + 1).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    if (rota.startsWith('/tarefas/') && seg[1] !== 'limpar' && metodo === 'PUT') {
      const t = await env.DB.prepare('SELECT * FROM tarefas WHERE id=?').bind(seg[1]).first();
      if (!t) return bad('Tarefa não encontrada.', 404);
      const feita = body.feita === undefined ? t.feita : (body.feita ? 1 : 0);
      const agora = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await env.DB.prepare(
        'UPDATE tarefas SET texto=?,data=?,hora=?,feita=?,feita_em=? WHERE id=?')
        .bind(
          body.texto === undefined ? t.texto : String(body.texto).trim().slice(0, 500) || t.texto,
          body.data === undefined ? t.data : (body.data || null),
          body.hora === undefined ? t.hora : (body.hora || null),
          feita,
          feita ? (t.feita ? t.feita_em : agora) : null,
          seg[1]).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/tarefas/') && seg[1] !== 'limpar' && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM tarefas WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }
    if (rota === '/tarefas/limpar' && metodo === 'POST') {
      const q = await env.DB.prepare('SELECT COUNT(*) c FROM tarefas WHERE feita=1').first();
      await env.DB.prepare('DELETE FROM tarefas WHERE feita=1').run();
      return json({ ok: true, apagadas: (q && q.c) || 0 });
    }

    // ==========================================================
    // PLANOS
    // ==========================================================
    // ---------- desempenho dos planos ----------
    if (rota === '/planos/desempenho' && metodo === 'GET') {
      const h = hoje();
      const ativos = await env.DB.prepare(
        `SELECT c.codigo_plano plano, COUNT(*) qtd
           FROM contratos c JOIN pacientes pa ON pa.id=c.paciente_id
          WHERE c.status='ativo' AND pa.status NOT IN ('encerrado','parceria')
          GROUP BY plano`).all();
      const vendas = await env.DB.prepare(
        `SELECT codigo_plano plano, moeda, COUNT(*) qtd, SUM(valor_cobrado) total,
                AVG(valor_cobrado) ticket
           FROM contratos WHERE data_inicial >= ?
          GROUP BY plano, moeda`).bind(addDias(h, -365)).all();
      const recebido = await env.DB.prepare(
        `SELECT c.codigo_plano plano, SUM(pg.valor_brl) total_brl
           FROM pagamentos pg
           JOIN parcelas p ON p.id=pg.parcela_id
           JOIN contratos c ON c.id=p.contrato_id
          WHERE pg.data >= ? GROUP BY plano`).bind(addDias(h, -365)).all();
      const renovacao = await env.DB.prepare(
        `SELECT c.codigo_plano plano,
                SUM(CASE WHEN n.etapa='renovou' THEN 1 ELSE 0 END) renovou,
                SUM(CASE WHEN n.etapa='saiu' THEN 1 ELSE 0 END) saiu
           FROM negociacoes n JOIN contratos c ON c.id=n.contrato_origem
          WHERE n.tipo='renovacao' GROUP BY plano`).all();
      return json({
        ativos: ativos.results || [], vendas: vendas.results || [],
        recebido: recebido.results || [], renovacao: renovacao.results || [],
      });
    }

    if (rota === '/planos' && metodo === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM planos ORDER BY posicao, codigo').all();
      return json({ planos: r.results || [] });
    }
    if (rota === '/planos' && metodo === 'POST') {
      const b = body;
      if (!b.codigo || !b.nome) return bad('Código e nome são obrigatórios.');
      await env.DB.prepare(
        `INSERT INTO planos (codigo,nome,tipo,dias,preco_brl,preco_usd,consultas,follow_up_dias,renova_auto,regras,ativo,posicao)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(b.codigo.trim(), b.nome.trim(), b.tipo || 'dieta', Number(b.dias || 30),
        num(b.preco_brl), num(b.preco_usd), Number(b.consultas || 0), Number(b.follow_up_dias || 0),
        b.renova_auto ? 1 : 0, b.regras || null, b.ativo === 0 ? 0 : 1, Number(b.posicao || 99)).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/planos/') && metodo === 'PUT') {
      const id = seg[1];
      const b = body;
      await env.DB.prepare(
        `UPDATE planos SET codigo=?,nome=?,tipo=?,dias=?,preco_brl=?,preco_usd=?,consultas=?,
                follow_up_dias=?,renova_auto=?,regras=?,ativo=?,posicao=? WHERE id=?`
      ).bind(b.codigo, b.nome, b.tipo || 'dieta', Number(b.dias || 30), num(b.preco_brl), num(b.preco_usd),
        Number(b.consultas || 0), Number(b.follow_up_dias || 0), b.renova_auto ? 1 : 0,
        b.regras || null, b.ativo === 0 ? 0 : 1, Number(b.posicao || 99), id).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/planos/') && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM planos WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // ==========================================================
    // PACIENTES
    // ==========================================================
    if (rota === '/pacientes' && metodo === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const status = url.searchParams.get('status') || '';
      const objetivo = url.searchParams.get('objetivo') || '';
      const pais = url.searchParams.get('pais') || '';
      const plano = url.searchParams.get('plano') || '';
      const limite = Math.min(2000, Number(url.searchParams.get('limite') || 1000));

      // Uma passada por tabela em vez de subconsulta por linha: com algumas
      // centenas de pacientes a diferença é de segundos para milissegundos.
      let sql = `
        SELECT pa.id, pa.cod, pa.nome, pa.apelido, pa.pais, pa.telefone, pa.email,
               pa.objetivo, pa.status, pa.sexo, pa.altura_cm, pa.nascimento, pa.created_at,
               COLUNAS_NOVAS
               COALESCE(prim.entrada, substr(pa.created_at,1,10)) AS entrada,
               c.codigo_plano  AS plano_atual,
               c.data_final    AS data_final,
               uc.ultima_consulta,
               COALESCE(ab.abertas, 0) AS parcelas_abertas
          FROM pacientes pa
          LEFT JOIN (SELECT paciente_id, MAX(id) AS mid FROM contratos GROUP BY paciente_id) lc
                 ON lc.paciente_id = pa.id
          LEFT JOIN contratos c ON c.id = lc.mid
          LEFT JOIN (SELECT paciente_id, MIN(data_inicial) AS entrada
                       FROM contratos GROUP BY paciente_id) prim
                 ON prim.paciente_id = pa.id
          LEFT JOIN (SELECT paciente_id, MAX(data) AS ultima_consulta
                       FROM consultas GROUP BY paciente_id) uc
                 ON uc.paciente_id = pa.id
          LEFT JOIN (SELECT p.paciente_id, COUNT(*) AS abertas
                       FROM parcelas p
                       JOIN contratos c2 ON c2.id = p.contrato_id
                      WHERE p.status IN ('aberta','parcial') AND c2.status='ativo'
                      GROUP BY p.paciente_id) ab
                 ON ab.paciente_id = pa.id
         WHERE 1=1`;
      const args = [];
      if (q) { sql += ' AND (pa.nome LIKE ? OR pa.apelido LIKE ? OR pa.cod LIKE ? OR pa.email LIKE ? OR pa.telefone LIKE ?)';
        const like = `%${q}%`; args.push(like, like, like, like, like); }
      if (status) { sql += ' AND pa.status=?'; args.push(status); }
      if (objetivo) { sql += ' AND pa.objetivo LIKE ?'; args.push(`%${objetivo}%`); }
      if (pais) { sql += ' AND pa.pais=?'; args.push(pais); }
      if (plano) { sql += ' AND c.codigo_plano=?'; args.push(plano); }
      sql += ' ORDER BY pa.nome COLLATE NOCASE ASC LIMIT ?'; args.push(limite);

      const NOVAS = 'pa.cidade, pa.fuso, pa.instagram, pa.inbody_ativo,';
      let r = await talvez(
        () => env.DB.prepare(sql.replace('COLUNAS_NOVAS', NOVAS)).bind(...args).all(), null);
      // banco ainda sem o migrate-06: a tela abre sem os campos novos
      if (!r) r = await env.DB.prepare(sql.replace('COLUNAS_NOVAS', '')).bind(...args).all();
      return json({ pacientes: r.results || [] });
    }

    if (rota === '/pacientes' && metodo === 'POST') {
      const b = body;
      if (!b.nome) return bad('Nome é obrigatório.');
      // fuso vem da cidade; só respeita o que foi escolhido à mão se veio preenchido
      const fuso = await talvez(() => fusoDoLugar(env, b.cidade, b.pais), null) || b.fuso || null;
      const comuns = [b.cod || null, b.nome.trim(), b.apelido || null, b.pais || 'Brasil',
        b.email || null, b.telefone || null, b.instagram || null, b.nascimento || null, b.cpf || null,
        b.profissao || null, b.endereco || null, b.objetivo || null, b.status || 'ativo',
        b.parceiro_id || null, b.indicacao || null, b.obs || null,
        b.sexo || null, b.altura_cm ? num(b.altura_cm) : null];
      let res = await talvez(() => env.DB.prepare(
        `INSERT INTO pacientes (cod,nome,apelido,pais,email,telefone,instagram,nascimento,cpf,
             profissao,endereco,objetivo,status,parceiro_id,indicacao,obs,sexo,altura_cm,cidade,fuso)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(...comuns, b.cidade || null, fuso).run(), null);
      // banco ainda sem o migrate-06: cadastra sem cidade e fuso
      if (!res) res = await env.DB.prepare(
        `INSERT INTO pacientes (cod,nome,apelido,pais,email,telefone,instagram,nascimento,cpf,
             profissao,endereco,objetivo,status,parceiro_id,indicacao,obs,sexo,altura_cm)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...comuns).run();
      return json({ ok: true, id: res.meta.last_row_id, fuso });
    }

    if (rota.startsWith('/pacientes/') && seg.length === 2 && metodo === 'GET') {
      const id = seg[1];
      const p = await env.DB.prepare('SELECT * FROM pacientes WHERE id=?').bind(id).first();
      if (!p) return bad('Paciente não encontrado.', 404);
      const contratos = await env.DB.prepare(
        'SELECT * FROM contratos WHERE paciente_id=? ORDER BY id DESC').bind(id).all();
      const parcelas = await env.DB.prepare(
        'SELECT * FROM parcelas WHERE paciente_id=? ORDER BY vencimento ASC').bind(id).all();
      const pagamentos = await env.DB.prepare(
        'SELECT * FROM pagamentos WHERE paciente_id=? ORDER BY data DESC').bind(id).all();
      const consultas = await env.DB.prepare(
        'SELECT * FROM consultas WHERE paciente_id=? ORDER BY data DESC').bind(id).all();
      const anamnese = await env.DB.prepare(
        'SELECT * FROM anamneses WHERE paciente_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
      const anexos = await talvez(() => env.DB.prepare(
        `SELECT id,tipo,titulo,data_ref,obs,arquivo_nome,mime,tamanho,created_at
           FROM anexos WHERE paciente_id=? ORDER BY data_ref DESC, id DESC`).bind(id).all(), null);
      return json({
        paciente: p,
        contratos: contratos.results || [],
        parcelas: parcelas.results || [],
        pagamentos: pagamentos.results || [],
        consultas: consultas.results || [],
        anamnese: anamnese || null,
        anexos: anexos ? (anexos.results || []) : [],
        faltando: anexos ? [] : ['anexos'],
      });
    }

    if (rota.startsWith('/pacientes/') && seg.length === 2 && metodo === 'PUT') {
      const id = seg[1]; const b = body;
      const fuso = await talvez(() => fusoDoLugar(env, b.cidade, b.pais), null) || b.fuso || null;
      const comuns = [b.cod || null, b.nome, b.apelido || null, b.pais || 'Brasil',
        b.email || null, b.telefone || null, b.instagram || null, b.nascimento || null, b.cpf || null,
        b.profissao || null, b.endereco || null, b.objetivo || null, b.status || 'ativo',
        b.parceiro_id || null, b.indicacao || null, b.obs || null,
        b.sexo || null, b.altura_cm ? num(b.altura_cm) : null];
      const BASE = `UPDATE pacientes SET cod=?,nome=?,apelido=?,pais=?,email=?,telefone=?,instagram=?,
            nascimento=?,cpf=?,profissao=?,endereco=?,objetivo=?,status=?,parceiro_id=?,indicacao=?,obs=?,
            sexo=?,altura_cm=?`;
      const feito = await talvez(() => env.DB.prepare(
        `${BASE},cidade=?,fuso=?,updated_at=datetime('now') WHERE id=?`)
        .bind(...comuns, b.cidade || null, fuso, id).run(), null);
      if (!feito) await env.DB.prepare(`${BASE},updated_at=datetime('now') WHERE id=?`)
        .bind(...comuns, id).run();
      return json({ ok: true, fuso });
    }

    // link de anamnese com token: usado para mandar o formulário a quem já
    // é cliente, sem criar paciente novo nem precisar casar por nome
    if (rota.startsWith('/pacientes/') && seg[2] === 'anamnese-link' && metodo === 'POST') {
      const p = await env.DB.prepare('SELECT id, form_token FROM pacientes WHERE id=?').bind(seg[1]).first();
      if (!p) return bad('Paciente não encontrado.', 404);
      const token = p.form_token || novoToken();
      if (!p.form_token) await env.DB.prepare(
        'UPDATE pacientes SET form_token=? WHERE id=?').bind(token, p.id).run();
      const base = await baseFormulario(env, url);
      return json({ ok: true, token, caminho: '/form?t=' + token, link: `${base}/?t=${token}` });
    }

    if (rota.startsWith('/pacientes/') && seg.length === 2 && metodo === 'DELETE') {
      const id = seg[1];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM consultas WHERE paciente_id=?').bind(id),
        env.DB.prepare('DELETE FROM pagamentos WHERE paciente_id=?').bind(id),
        env.DB.prepare('DELETE FROM parcelas WHERE paciente_id=?').bind(id),
        env.DB.prepare('DELETE FROM contratos WHERE paciente_id=?').bind(id),
        env.DB.prepare('DELETE FROM pacientes WHERE id=?').bind(id),
      ]);
      return json({ ok: true });
    }

    // ==========================================================
    // ANEXOS — planos de dieta e outros arquivos do paciente
    // Arquivo no R2 (binding "ARQUIVOS"), ficha no D1.
    // ==========================================================
    const TIPOS_ANEXO = ['dieta', 'treino', 'exame', 'foto', 'outro'];
    const LIMITE_MB = 25;

    if (rota === '/anexos' && metodo === 'POST') {
      if (!env.ARQUIVOS)
        return bad('Armazenamento de arquivos não conectado (binding R2 "ARQUIVOS").', 500);
      const fd = await request.formData();
      const arquivo = fd.get('arquivo');
      const pacienteId = Number(fd.get('paciente_id'));
      if (!pacienteId) return bad('Informe o paciente.');
      if (!arquivo || typeof arquivo === 'string' || !arquivo.name)
        return bad('Escolha um arquivo.');
      if (arquivo.size > LIMITE_MB * 1024 * 1024)
        return bad(`Arquivo acima de ${LIMITE_MB} MB.`);

      const tipo = TIPOS_ANEXO.includes(fd.get('tipo')) ? fd.get('tipo') : 'dieta';
      const limpo = String(arquivo.name).replace(/[^\w.\-]+/g, '_').slice(-80);
      const chave = `pacientes/${pacienteId}/${crypto.randomUUID()}-${limpo}`;

      await env.ARQUIVOS.put(chave, arquivo.stream(), {
        httpMetadata: { contentType: arquivo.type || 'application/octet-stream' },
      });

      const r = await env.DB.prepare(
        `INSERT INTO anexos (paciente_id,tipo,titulo,data_ref,obs,arquivo_nome,chave,mime,tamanho)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(pacienteId, tipo, (fd.get('titulo') || '').trim() || null,
        (fd.get('data_ref') || '') || hoje(), (fd.get('obs') || '').trim() || null,
        arquivo.name, chave, arquivo.type || null, arquivo.size).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }

    if (rota === '/anexos' && metodo === 'GET') {
      const pid = url.searchParams.get('paciente_id');
      if (!pid) return bad('Informe o paciente.');
      const r = await env.DB.prepare(
        `SELECT id,paciente_id,tipo,titulo,data_ref,obs,arquivo_nome,mime,tamanho,created_at
           FROM anexos WHERE paciente_id=?
          ORDER BY data_ref DESC, id DESC`).bind(pid).all();
      return json({ anexos: r.results || [] });
    }

    if (rota.startsWith('/anexos/') && seg.length === 3 && seg[2] === 'arquivo' && metodo === 'GET') {
      if (!env.ARQUIVOS) return bad('Armazenamento não conectado.', 500);
      const a = await env.DB.prepare('SELECT * FROM anexos WHERE id=?').bind(seg[1]).first();
      if (!a) return bad('Anexo não encontrado.', 404);
      const obj = await env.ARQUIVOS.get(a.chave);
      if (!obj) return bad('Arquivo não está mais no armazenamento.', 404);
      return new Response(obj.body, {
        headers: {
          'content-type': a.mime || 'application/octet-stream',
          'content-disposition': `inline; filename="${encodeURIComponent(a.arquivo_nome)}"`,
          'cache-control': 'private, no-store',
        },
      });
    }

    if (rota.startsWith('/anexos/') && seg.length === 2 && metodo === 'PUT') {
      const b = body;
      await env.DB.prepare(
        'UPDATE anexos SET tipo=?, titulo=?, data_ref=?, obs=? WHERE id=?')
        .bind(TIPOS_ANEXO.includes(b.tipo) ? b.tipo : 'dieta', b.titulo || null,
          b.data_ref || null, b.obs || null, seg[1]).run();
      return json({ ok: true });
    }

    if (rota.startsWith('/anexos/') && seg.length === 2 && metodo === 'DELETE') {
      const a = await env.DB.prepare('SELECT * FROM anexos WHERE id=?').bind(seg[1]).first();
      if (a && env.ARQUIVOS) { try { await env.ARQUIVOS.delete(a.chave); } catch { /* segue */ } }
      await env.DB.prepare('DELETE FROM anexos WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // ==========================================================
    // CONSULTAS (a ficha do caderno)
    // ==========================================================
    // Refeições deixaram de ser 6 colunas fixas: viram uma lista com nome,
    // horário e texto. As colunas antigas continuam preenchidas para as
    // fichas velhas (e para a impressão) não perderem nada.
    const FIXAS_REF = { 'café da manhã': 'cafe', 'lanche (manhã)': 'lanche_manha',
      'almoço': 'almoco', 'lanche (tarde)': 'lanche_tarde', 'jantar': 'jantar', 'ceia': 'ceia' };
    function refeicoesDoCorpo(b) {
      const lista = Array.isArray(b.refeicoes) ? b.refeicoes
        .map((r) => ({
          nome: String(r.nome || '').trim(),
          hora: String(r.hora || '').trim().slice(0, 5),
          texto: String(r.texto == null ? '' : r.texto),
        }))
        .filter((r) => r.nome) : null;
      const col = { cafe: null, lanche_manha: null, almoco: null, lanche_tarde: null, jantar: null, ceia: null };
      if (lista) {
        lista.forEach((r) => {
          const k = FIXAS_REF[r.nome.toLowerCase()];
          if (k && !col[k]) col[k] = r.texto || null;
        });
      } else {
        Object.keys(col).forEach((k) => { col[k] = b[k] || null; });
      }
      return { json: lista ? JSON.stringify(lista) : null, col };
    }

    if (rota === '/consultas' && metodo === 'POST') {
      const b = body;
      if (!b.paciente_id) return bad('Informe o paciente.');
      let kg = b.peso_kg === '' || b.peso_kg == null ? null : num(b.peso_kg);
      let lbs = b.peso_lbs === '' || b.peso_lbs == null ? null : num(b.peso_lbs);
      if (kg && !lbs) lbs = Math.round(kg * 2.20462 * 10) / 10;
      if (lbs && !kg) kg = Math.round((lbs / 2.20462) * 10) / 10;
      const { json: refJson, col } = refeicoesDoCorpo(b);
      const res = await env.DB.prepare(
        `INSERT INTO consultas (paciente_id,data,peso_kg,peso_lbs,treino,cafe,lanche_manha,
             almoco,lanche_tarde,jantar,ceia,observacoes,refeicoes,objetivo,tmb,get_kcal,fator_atividade)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(b.paciente_id, b.data || hoje(), kg, lbs, b.treino || null, col.cafe,
        col.lanche_manha, col.almoco, col.lanche_tarde, col.jantar,
        col.ceia, b.observacoes || null, refJson, b.objetivo || null,
        b.tmb ? num(b.tmb) : null, b.get_kcal ? num(b.get_kcal) : null,
        b.fator_atividade ? num(b.fator_atividade) : null).run();
      // o objetivo escolhido na consulta passa a ser o objetivo do paciente
      if (b.objetivo) await env.DB.prepare(
        "UPDATE pacientes SET objetivo=?, updated_at=datetime('now') WHERE id=?")
        .bind(b.objetivo, b.paciente_id).run();
      return json({ ok: true, id: res.meta.last_row_id });
    }

    if (rota.startsWith('/consultas/') && metodo === 'PUT') {
      const id = seg[1]; const b = body;
      let kg = b.peso_kg === '' || b.peso_kg == null ? null : num(b.peso_kg);
      let lbs = b.peso_lbs === '' || b.peso_lbs == null ? null : num(b.peso_lbs);
      if (kg && !lbs) lbs = Math.round(kg * 2.20462 * 10) / 10;
      if (lbs && !kg) kg = Math.round((lbs / 2.20462) * 10) / 10;
      const { json: refJson, col } = refeicoesDoCorpo(b);
      await env.DB.prepare(
        `UPDATE consultas SET data=?,peso_kg=?,peso_lbs=?,treino=?,cafe=?,lanche_manha=?,almoco=?,
            lanche_tarde=?,jantar=?,ceia=?,observacoes=?,refeicoes=?,objetivo=?,tmb=?,get_kcal=?,
            fator_atividade=?,updated_at=datetime('now') WHERE id=?`
      ).bind(b.data, kg, lbs, b.treino || null, col.cafe, col.lanche_manha,
        col.almoco, col.lanche_tarde, col.jantar, col.ceia,
        b.observacoes || null, refJson, b.objetivo || null,
        b.tmb ? num(b.tmb) : null, b.get_kcal ? num(b.get_kcal) : null,
        b.fator_atividade ? num(b.fator_atividade) : null, id).run();
      if (b.objetivo && b.paciente_id) await env.DB.prepare(
        "UPDATE pacientes SET objetivo=?, updated_at=datetime('now') WHERE id=?")
        .bind(b.objetivo, b.paciente_id).run();
      return json({ ok: true });
    }

    if (rota.startsWith('/consultas/') && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM consultas WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // ==========================================================
    // CONTRATOS
    // ==========================================================
    if (rota === '/contratos' && metodo === 'POST') {
      const b = body;
      if (!b.paciente_id) return bad('Informe o paciente.');
      const plano = b.plano_id
        ? await env.DB.prepare('SELECT * FROM planos WHERE id=?').bind(b.plano_id).first()
        : null;
      const ini = b.data_inicial || hoje();
      const fim = b.data_final || (plano ? addDias(ini, plano.dias) : addDias(ini, 30));
      const moeda = b.moeda || MOEDA_POR_FORMA[(b.forma || '').toLowerCase()] || 'BRL';
      const valor = b.valor_cobrado != null && b.valor_cobrado !== ''
        ? num(b.valor_cobrado)
        : (plano ? (moeda === 'USD' ? plano.preco_usd : plano.preco_brl) : 0);

      const res = await env.DB.prepare(
        `INSERT INTO contratos (paciente_id,plano_id,codigo_plano,data_inicial,data_final,
            valor_cobrado,moeda,forma,qtd_parcelas,status,obs)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(b.paciente_id, b.plano_id || null, plano ? plano.codigo : (b.codigo_plano || null),
        ini, fim, valor, moeda, b.forma || null, Number(b.qtd_parcelas || 1),
        b.status || 'ativo', b.obs || null).run();

      const contrato = await env.DB.prepare('SELECT * FROM contratos WHERE id=?')
        .bind(res.meta.last_row_id).first();
      await gerarParcelas(env, contrato);
      return json({ ok: true, id: contrato.id });
    }

    if (rota.startsWith('/contratos/') && metodo === 'PUT') {
      const id = seg[1]; const b = body;
      await env.DB.prepare(
        `UPDATE contratos SET plano_id=?,codigo_plano=?,data_inicial=?,data_final=?,valor_cobrado=?,
            moeda=?,forma=?,qtd_parcelas=?,status=?,obs=? WHERE id=?`
      ).bind(b.plano_id || null, b.codigo_plano || null, b.data_inicial, b.data_final,
        num(b.valor_cobrado), b.moeda || 'BRL', b.forma || null, Number(b.qtd_parcelas || 1),
        b.status || 'ativo', b.obs || null, id).run();
      if (b.regerar_parcelas) {
        const c = await env.DB.prepare('SELECT * FROM contratos WHERE id=?').bind(id).first();
        await gerarParcelas(env, c);
      }
      return json({ ok: true });
    }

    if (rota.startsWith('/contratos/') && metodo === 'DELETE') {
      const id = seg[1];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM parcelas WHERE contrato_id=?').bind(id),
        env.DB.prepare('DELETE FROM contratos WHERE id=?').bind(id),
      ]);
      return json({ ok: true });
    }

    // ==========================================================
    // COBRANÇAS / PAGAMENTOS
    // ==========================================================
    if (rota === '/cobrancas' && metodo === 'GET') {
      const filtro = url.searchParams.get('filtro') || 'abertas';
      const h = hoje();
      let sql = `SELECT p.*, pa.nome,pa.apelido,pa.cod,pa.telefone,pa.pais
                   FROM parcelas p
                   JOIN pacientes pa ON pa.id=p.paciente_id
                   JOIN contratos c  ON c.id=p.contrato_id
                  WHERE 1=1`;
      const args = [];
      if (filtro !== 'pagas') sql += " AND c.status='ativo' AND pa.status NOT IN ('encerrado','parceria')";
      if (filtro === 'abertas') sql += " AND p.status IN ('aberta','parcial')";
      if (filtro === 'atrasadas') { sql += " AND p.status IN ('aberta','parcial') AND p.vencimento < ?"; args.push(h); }
      if (filtro === 'pagas') sql += " AND p.status='paga'";
      sql += ' ORDER BY p.vencimento ASC LIMIT 500';
      const r = await env.DB.prepare(sql).bind(...args).all();
      return json({ cobrancas: (r.results || []).map((x) => ({ ...x, dias: diffDias(x.vencimento, h) })) });
    }

    if (rota === '/cotacao' && metodo === 'GET') {
      const moeda = url.searchParams.get('moeda') || 'USD';
      const dia = url.searchParams.get('dia') || hoje();
      const taxa = await cotacaoDoDia(env, moeda, dia);
      return json({ moeda, dia, taxa });
    }

    if (rota === '/pagamentos' && metodo === 'POST') {
      const b = body;
      if (!b.paciente_id || !b.valor) return bad('Informe paciente e valor.');
      const data = b.data || hoje();
      const moeda = b.moeda || 'BRL';
      const cotacao = b.cotacao != null && b.cotacao !== ''
        ? num(b.cotacao) : await cotacaoDoDia(env, moeda, data);
      const valor = num(b.valor);
      const valorBrl = Math.round(valor * (cotacao || 1) * 100) / 100;

      await env.DB.prepare(
        `INSERT INTO pagamentos (parcela_id,paciente_id,data,valor,moeda,cotacao,valor_brl,forma,obs)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(b.parcela_id || null, b.paciente_id, data, valor, moeda, cotacao || 1,
        valorBrl, b.forma || null, b.obs || null).run();

      if (b.parcela_id) {
        const p = await env.DB.prepare('SELECT * FROM parcelas WHERE id=?').bind(b.parcela_id).first();
        if (p) {
          const pago = Math.round((Number(p.pago) + valor) * 100) / 100;
          const status = pago + 0.009 >= Number(p.valor) ? 'paga' : 'parcial';
          await env.DB.prepare('UPDATE parcelas SET pago=?,status=? WHERE id=?')
            .bind(pago, status, p.id).run();
        }
      }
      return json({ ok: true, cotacao: cotacao || 1, valor_brl: valorBrl });
    }

    if (rota.startsWith('/pagamentos/') && metodo === 'DELETE') {
      const id = seg[1];
      const pg = await env.DB.prepare('SELECT * FROM pagamentos WHERE id=?').bind(id).first();
      if (pg && pg.parcela_id) {
        const p = await env.DB.prepare('SELECT * FROM parcelas WHERE id=?').bind(pg.parcela_id).first();
        if (p) {
          const pago = Math.max(0, Math.round((Number(p.pago) - Number(pg.valor)) * 100) / 100);
          const status = pago <= 0 ? 'aberta' : (pago + 0.009 >= Number(p.valor) ? 'paga' : 'parcial');
          await env.DB.prepare('UPDATE parcelas SET pago=?,status=? WHERE id=?').bind(pago, status, p.id).run();
        }
      }
      await env.DB.prepare('DELETE FROM pagamentos WHERE id=?').bind(id).run();
      return json({ ok: true });
    }

    // ==========================================================
    // AGENDA
    // ==========================================================
    if (rota === '/compromissos' && metodo === 'GET') {
      const de = url.searchParams.get('de') || addDias(hoje(), -30);
      const ate = url.searchParams.get('ate') || addDias(hoje(), 90);
      const r = await env.DB.prepare(
        `SELECT c.*, pa.nome paciente_nome, pa.apelido paciente_apelido, pa.cod paciente_cod,
                pa.instagram paciente_instagram, pa.telefone paciente_telefone,
                pa.cidade paciente_cidade, pa.fuso paciente_fuso, pa.pais paciente_pais
           FROM compromissos c LEFT JOIN pacientes pa ON pa.id=c.paciente_id
          WHERE substr(c.inicio,1,10) BETWEEN ? AND ? ORDER BY c.inicio ASC`).bind(de, ate).all();
      return json({ compromissos: r.results || [] });
    }
    if (rota === '/compromissos' && metodo === 'POST') {
      const b = body;
      if (!b.titulo || !b.inicio) return bad('Informe título e data/hora.');
      const res = await env.DB.prepare(
        `INSERT INTO compromissos (titulo,tipo,paciente_id,inicio,fim,dia_todo,local,obs,status)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(b.titulo, b.tipo || 'consulta', b.paciente_id || null, b.inicio, b.fim || null,
        b.dia_todo ? 1 : 0, b.local || null, b.obs || null, b.status || 'marcado').run();
      return json({ ok: true, id: res.meta.last_row_id });
    }
    if (rota.startsWith('/compromissos/') && metodo === 'PUT') {
      const b = body;
      await env.DB.prepare(
        `UPDATE compromissos SET titulo=?,tipo=?,paciente_id=?,inicio=?,fim=?,dia_todo=?,local=?,obs=?,status=?
         WHERE id=?`
      ).bind(b.titulo, b.tipo || 'consulta', b.paciente_id || null, b.inicio, b.fim || null,
        b.dia_todo ? 1 : 0, b.local || null, b.obs || null, b.status || 'marcado', seg[1]).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/compromissos/') && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM compromissos WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // ==========================================================
    // FINANCEIRO (painel)
    // ==========================================================
    if (rota === '/financeiro' && metodo === 'GET') {
      const h = hoje();
      const de = (url.searchParams.get('de') || addDias(h, -29)).slice(0, 10);
      const ate = (url.searchParams.get('ate') || h).slice(0, 10);
      const dias = Math.max(1, diffDias(ate, de) + 1);

      // período anterior do mesmo tamanho, para comparar
      const antAte = addDias(de, -1);
      const antDe = addDias(antAte, -(dias - 1));

      // dia a dia até ~2 meses; depois mês a mês
      const porDia = dias <= 62;
      const chave = porDia ? 'substr(data,1,10)' : 'substr(data,1,7)';

      const serie = await env.DB.prepare(
        `SELECT ${chave} AS rotulo, SUM(valor_brl) total_brl, COUNT(*) qtd
           FROM pagamentos WHERE data BETWEEN ? AND ?
          GROUP BY rotulo ORDER BY rotulo ASC`).bind(de, ate).all();

      const porMoeda = await env.DB.prepare(
        `SELECT moeda, SUM(valor) total, SUM(valor_brl) total_brl, COUNT(*) qtd
           FROM pagamentos WHERE data BETWEEN ? AND ? GROUP BY moeda
          ORDER BY total_brl DESC`).bind(de, ate).all();

      const totalPeriodo = await env.DB.prepare(
        `SELECT COALESCE(SUM(valor_brl),0) total, COUNT(*) qtd,
                COUNT(DISTINCT paciente_id) pessoas
           FROM pagamentos WHERE data BETWEEN ? AND ?`).bind(de, ate).first();

      const totalAnterior = await env.DB.prepare(
        `SELECT COALESCE(SUM(valor_brl),0) total FROM pagamentos WHERE data BETWEEN ? AND ?`)
        .bind(antDe, antAte).first();

      const porForma = await env.DB.prepare(
        `SELECT COALESCE(NULLIF(forma,''),'não informado') forma,
                SUM(valor_brl) total_brl, COUNT(*) qtd
           FROM pagamentos WHERE data BETWEEN ? AND ?
          GROUP BY forma ORDER BY total_brl DESC`).bind(de, ate).all();

      // plano e país vêm do contrato do pagamento
      const porPlano = await env.DB.prepare(
        `SELECT COALESCE(NULLIF(c.codigo_plano,''),'sem plano') plano,
                SUM(pg.valor_brl) total_brl, COUNT(DISTINCT c.id) contratos
           FROM pagamentos pg
           JOIN parcelas p  ON p.id=pg.parcela_id
           JOIN contratos c ON c.id=p.contrato_id
          WHERE pg.data BETWEEN ? AND ?
          GROUP BY plano ORDER BY total_brl DESC LIMIT 12`).bind(de, ate).all();

      const porPais = await env.DB.prepare(
        `SELECT COALESCE(NULLIF(pa.pais,''),'não informado') pais,
                SUM(pg.valor_brl) total_brl, COUNT(DISTINCT pa.id) pessoas
           FROM pagamentos pg JOIN pacientes pa ON pa.id=pg.paciente_id
          WHERE pg.data BETWEEN ? AND ?
          GROUP BY pais ORDER BY total_brl DESC LIMIT 10`).bind(de, ate).all();

      // contratos fechados no período: ticket médio
      const vendas = await env.DB.prepare(
        `SELECT COUNT(*) qtd, COALESCE(SUM(valor_cobrado),0) total, moeda
           FROM contratos WHERE data_inicial BETWEEN ? AND ? GROUP BY moeda`).bind(de, ate).all();

      // a receber é foto de agora, não depende do período
      const aReceber = await env.DB.prepare(
        `SELECT p.moeda, SUM(p.valor-p.pago) total, COUNT(*) qtd
           FROM parcelas p
           JOIN contratos c ON c.id=p.contrato_id
           JOIN pacientes pa ON pa.id=p.paciente_id
          WHERE p.status IN ('aberta','parcial') AND c.status='ativo'
            AND pa.status NOT IN ('encerrado','parceria')
          GROUP BY p.moeda`).all();

      const atrasado = await env.DB.prepare(
        `SELECT COALESCE(SUM(p.valor-p.pago),0) total, COUNT(*) qtd
           FROM parcelas p
           JOIN contratos c ON c.id=p.contrato_id
           JOIN pacientes pa ON pa.id=p.paciente_id
          WHERE p.status IN ('aberta','parcial') AND p.vencimento < ?
            AND c.status='ativo' AND pa.status NOT IN ('encerrado','parceria')`).bind(h).first();

      // histórico longo para o gráfico de tendência
      const porMes = await env.DB.prepare(
        `SELECT substr(data,1,7) mes, SUM(valor_brl) total_brl
           FROM pagamentos GROUP BY mes ORDER BY mes DESC LIMIT 18`).all();

      return json({
        de, ate, dias, granularidade: porDia ? 'dia' : 'mes',
        anterior: { de: antDe, ate: antAte, total: (totalAnterior && totalAnterior.total) || 0 },
        total: totalPeriodo || { total: 0, qtd: 0, pessoas: 0 },
        serie: serie.results || [],
        por_moeda: porMoeda.results || [],
        por_forma: porForma.results || [],
        por_plano: porPlano.results || [],
        por_pais: porPais.results || [],
        vendas: vendas.results || [],
        a_receber: aReceber.results || [],
        atrasado: atrasado || { total: 0, qtd: 0 },
        por_mes: (porMes.results || []).reverse(),
      });
    }

    // ==========================================================
    // PARCEIROS
    // ==========================================================
    if (rota === '/parceiros' && metodo === 'GET') {
      const r = await env.DB.prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM pacientes WHERE parceiro_id=p.id) indicados
           FROM parceiros p ORDER BY p.nome`).all();
      return json({ parceiros: r.results || [] });
    }
    if (rota === '/parceiros' && metodo === 'POST') {
      const res = await env.DB.prepare('INSERT INTO parceiros (nome,contato,obs) VALUES (?,?,?)')
        .bind(body.nome, body.contato || null, body.obs || null).run();
      return json({ ok: true, id: res.meta.last_row_id });
    }
    if (rota.startsWith('/parceiros/') && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM parceiros WHERE id=?').bind(seg[1]).run();
      return json({ ok: true });
    }

    // ==========================================================
    // IMPORTAÇÃO (planilha atual + anamneses)
    // ==========================================================
    if (rota === '/importar/pacientes' && metodo === 'POST') {
      const linhas = Array.isArray(body.linhas) ? body.linhas : [];
      let criados = 0, renovacoes = 0, contratos = 0;
      const planosNovos = [];
      for (const l of linhas) {
        if (!l.nome) continue;
        // Identidade é o NOME. O código da planilha se repete entre pessoas
        // diferentes, então não serve como chave: nome igual = renovação.
        const existente = await env.DB.prepare(
          'SELECT id FROM pacientes WHERE lower(trim(nome))=lower(trim(?))').bind(l.nome).first();

        let pid;
        if (existente) {
          pid = existente.id;
          await env.DB.prepare(
            `UPDATE pacientes SET cod=COALESCE(?,cod), pais=COALESCE(?,pais), status=COALESCE(?,status),
                 apelido=COALESCE(?,apelido), obs=COALESCE(?,obs), updated_at=datetime('now') WHERE id=?`
          ).bind(l.cod ? String(l.cod) : null, l.pais || null, l.status || null,
            l.apelido || null, l.obs || null, pid).run();
          renovacoes++;
        } else {
          const r = await env.DB.prepare(
            `INSERT INTO pacientes (cod,nome,apelido,pais,status,obs,objetivo,telefone,email)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).bind(l.cod ? String(l.cod) : null, l.nome, l.apelido || null, l.pais || 'Brasil',
            l.status || 'ativo', l.obs || null, l.objetivo || null, l.telefone || null, l.email || null).run();
          pid = r.meta.last_row_id; criados++;
        }

        if (l.data_inicial && l.valor_cobrado != null) {
          const moeda = l.moeda || MOEDA_POR_FORMA[(l.forma || '').toLowerCase()] || 'BRL';
          // plano que só existe na planilha entra no cadastro sem preço,
          // para o contrato não ficar órfão na tela de Planos
          if (l.plano) {
            const tem = await env.DB.prepare('SELECT id FROM planos WHERE codigo=?').bind(l.plano).first();
            if (!tem) {
              const m = await env.DB.prepare('SELECT MAX(posicao) p FROM planos').first();
              await env.DB.prepare(
                `INSERT INTO planos (codigo,nome,tipo,dias,consultas,follow_up_dias,posicao,ativo)
                 VALUES (?,?,?,?,?,?,?,1)`
              ).bind(l.plano, l.plano, 'outro', 30, 0, 7, (Number(m && m.p) || 0) + 1).run();
              planosNovos.push(l.plano);
            }
          }
          const cr = await env.DB.prepare(
            `INSERT INTO contratos (paciente_id,codigo_plano,data_inicial,data_final,valor_cobrado,
                moeda,forma,qtd_parcelas,status,obs)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).bind(pid, l.plano || null, l.data_inicial, l.data_final || null, num(l.valor_cobrado),
            moeda, l.forma || null, Number(l.qtd_parcelas || 1),
            l.status === 'encerrado' ? 'encerrado' : 'ativo', l.obs || null).run();
          const c = await env.DB.prepare('SELECT * FROM contratos WHERE id=?').bind(cr.meta.last_row_id).first();
          await gerarParcelas(env, c);

          if (num(l.valor_recebido) > 0 || num(l.valor_recebido_moeda) > 0) {
            // A coluna "Valor recebido" da planilha está em reais, inclusive nos
            // contratos em dólar. Quando a planilha traz a taxa que o Luca usou
            // (valor_recebido_moeda + cotacao), vale a dela: o total em reais do
            // CRM fica igual ao da planilha. Sem isso, usa o câmbio do dia.
            let taxa, resta;
            // "exato" = o valor já veio na moeda do contrato (com a taxa que o
            // Luca usou) ou o contrato é em real. Só nesse caso o que sobrar
            // depois de quitar as parcelas é dinheiro de verdade que entrou.
            // Quando a conversão foi estimada pelo câmbio do dia, a sobra é
            // ruído da taxa e não pode virar faturamento.
            const exato = num(l.valor_recebido_moeda) > 0 || c.moeda === 'BRL';
            if (num(l.valor_recebido_moeda) > 0) {
              resta = num(l.valor_recebido_moeda);
              taxa = num(l.cotacao) > 0 ? num(l.cotacao)
                : (c.moeda === 'BRL' ? 1 : await cotacaoDoDia(env, c.moeda, l.data_inicial) || 1);
            } else {
              taxa = await cotacaoDoDia(env, c.moeda, l.data_inicial);
              const recebidoBrl = num(l.valor_recebido);
              resta = (c.moeda === 'BRL' || !taxa)
                ? recebidoBrl
                : Math.round((recebidoBrl / taxa) * 100) / 100;
            }

            const ps = (await env.DB.prepare(
              'SELECT * FROM parcelas WHERE contrato_id=? ORDER BY numero ASC').bind(c.id).all()).results || [];
            for (let i = 0; i < ps.length; i++) {
              const p = ps[i];
              if (resta <= 0.01) break;
              const ultima = exato && i === ps.length - 1;
              const aplica = ultima ? resta : Math.min(resta, Number(p.valor));
              const status = aplica + 0.009 >= Number(p.valor) ? 'paga' : 'parcial';
              await env.DB.prepare('UPDATE parcelas SET pago=?,status=? WHERE id=?')
                .bind(Math.round(aplica * 100) / 100, status, p.id).run();
              await env.DB.prepare(
                `INSERT INTO pagamentos (parcela_id,paciente_id,data,valor,moeda,cotacao,valor_brl,forma,obs)
                 VALUES (?,?,?,?,?,?,?,?,?)`
              ).bind(p.id, pid, l.data_inicial, Math.round(aplica * 100) / 100, c.moeda, taxa || 1,
                Math.round(aplica * (taxa || 1) * 100) / 100, l.forma || null,
                'importado da planilha').run();
              resta -= aplica;
            }
          }

          // Contrato que já acabou não gera cobrança. O saldo que sobrou é
          // histórico (desconto, acerto por fora), não dívida a perseguir.
          if (c.status !== 'ativo') {
            await env.DB.prepare(
              `UPDATE parcelas SET status='cancelada'
                WHERE contrato_id=? AND status IN ('aberta','parcial')`).bind(c.id).run();
          }
          contratos++;
        }
      }
      return json({ ok: true, criados, renovacoes, contratos,
        planos_criados: [...new Set(planosNovos)] });
    }

    // sincroniza o histórico de câmbio de uma vez (deixa a importação rápida)
    if (rota === '/cotacoes/sincronizar' && metodo === 'POST') {
      const de = body.de || addDias(hoje(), -730);
      const ate = body.ate || hoje();
      const moedas = body.moedas || ['USD', 'GBP', 'EUR'];
      const res = {};
      for (const m of moedas) res[m] = await sincronizarCotacoes(env, m, de, ate);
      return json({ ok: true, de, ate, gravadas: res });
    }

    if (rota === '/importar/anamneses' && metodo === 'POST') {
      const linhas = Array.isArray(body.linhas) ? body.linhas : [];
      let gravadas = 0, casadas = 0, completados = 0, fichas = 0;
      for (const a of linhas) {
        if (!a.nome) continue;
        // paciente_nome vem do cruzamento já resolvido (o COD do Luca é o
        // número da linha do formulário, e essa numeração desloca em alguns
        // trechos). Sem ele, tenta pelo nome de quem respondeu e pelo código.
        let pid = null;
        let p = null;
        if (a.paciente_nome) p = await env.DB.prepare(
          'SELECT * FROM pacientes WHERE lower(trim(nome))=lower(trim(?)) LIMIT 1')
          .bind(a.paciente_nome).first();
        if (!p) p = await env.DB.prepare(
          `SELECT * FROM pacientes
            WHERE lower(trim(nome))=lower(trim(?)) OR (cod IS NOT NULL AND cod=?)`)
          .bind(a.nome, a.cod ? String(a.cod) : '___').first();
        if (p) { pid = p.id; casadas++; }
        /* Guarda também os campos já lidos da resposta (altura, nascimento,
           CPF…). Sem eles, uma ficha que só ganha dono depois entraria no
           cadastro vazia: o JSON de `dados` tem as perguntas cruas, não os
           valores limpos. */
        const extra = JSON.stringify({
          instagram: a.instagram || '', nascimento: a.nascimento || '',
          cpf: a.cpf || '', profissao: a.profissao || '', endereco: a.endereco || '',
          objetivo: a.objetivo || '', indicacao: a.indicacao || '',
          altura_cm: a.altura_cm || null, peso_kg: a.peso_kg || null,
        });
        const vals = [pid, a.cod ? String(a.cod) : null, a.nome, a.email || null,
          a.telefone || null, a.respondido_em || null, a.origem || 'BR',
          JSON.stringify(a.dados || {})];
        const gravou = await talvez(() => env.DB.prepare(
          `INSERT INTO anamneses
             (paciente_id,cod,nome,email,telefone,respondido_em,origem,dados,extra)
            VALUES (?,?,?,?,?,?,?,?,?)`).bind(...vals, extra).run(), null);
        if (!gravou) await env.DB.prepare(
          `INSERT INTO anamneses
             (paciente_id,cod,nome,email,telefone,respondido_em,origem,dados)
            VALUES (?,?,?,?,?,?,?,?)`).bind(...vals).run();
        gravadas++;

        if (p) {
          const r = await aproveitarAnamnese(env, pid, a);
          if (r.completou) completados++;
          if (r.ficha) fichas++;
        }
      }
      return json({ ok: true, gravadas, casadas, completados, fichas });
    }

    /* ---------- fichas sem dono ----------
       Resposta de formulário que não achou paciente nenhum fica guardada sem
       dono em vez de ser pendurada na pessoa errada. Esta tela é onde o Luca
       vê essas respostas e diz de quem é cada uma. */
    if (rota === '/anamneses/sem-dono' && metodo === 'GET') {
      const r = await talvez(() => env.DB.prepare(
        `SELECT id, cod, nome, email, telefone, respondido_em, origem,
                substr(dados,1,1) AS tem_dados
           FROM anamneses WHERE paciente_id IS NULL
          ORDER BY nome`).all(), { results: [] });
      return json({ linhas: r.results || [] });
    }

    if (rota.startsWith('/anamneses/') && seg[2] === 'ligar' && metodo === 'POST') {
      const id = Number(seg[1]);
      const pid = Number(body.paciente_id);
      const a = await env.DB.prepare('SELECT * FROM anamneses WHERE id=?').bind(id).first();
      if (!a) return json({ error: 'Ficha não encontrada.' }, 404);
      if (a.paciente_id) return json({ error: 'Essa ficha já tem dono.' }, 400);
      const p = await env.DB.prepare('SELECT id,nome FROM pacientes WHERE id=?').bind(pid).first();
      if (!p) return json({ error: 'Paciente não encontrado.' }, 404);
      const outra = await env.DB.prepare(
        'SELECT id FROM anamneses WHERE paciente_id=? LIMIT 1').bind(pid).first();
      await env.DB.prepare('UPDATE anamneses SET paciente_id=? WHERE id=?').bind(pid, id).run();
      // os campos ficam no JSON de respostas; o aproveitamento lê de lá
      let d = {}; try { d = JSON.parse(a.extra || '{}'); } catch { d = {}; }
      const r = await aproveitarAnamnese(env, pid, {
        email: a.email, telefone: a.telefone, respondido_em: a.respondido_em, ...d,
      });
      return json({ ok: true, paciente: p.nome, completou: r.completou,
        ficha: r.ficha, ja_tinha: !!outra });
    }

    if (rota.startsWith('/anamneses/') && seg.length === 2 && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM anamneses WHERE id=? AND paciente_id IS NULL')
        .bind(Number(seg[1])).run();
      return json({ ok: true });
    }

    // ---------- settings ----------
    if (rota === '/settings' && metodo === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM settings').all();
      const o = {}; (r.results || []).forEach((x) => { o[x.key] = x.value; });
      return json({ settings: o });
    }
    if (rota === '/settings' && metodo === 'PUT') {
      for (const [k, v] of Object.entries(body || {})) {
        await env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
          .bind(k, String(v)).run();
      }
      return json({ ok: true });
    }

    // ==========================================================
    // WHATSAPP — Evolution API
    // ==========================================================

    if (rota === '/whatsapp/config' && metodo === 'GET') {
      const c = await waConfig(env);
      const fusos = (await env.DB.prepare("SELECT value FROM settings WHERE key='fusos_pais'").first())?.value || '';
      return json({
        url: c.wa_url || '', instancia: c.wa_instancia || '',
        tem_apikey: !!c.wa_apikey,
        apikey_dica: c.wa_apikey ? '••••' + c.wa_apikey.slice(-4) : '',
        ativo: c.wa_ativo === '1',
        janela_ini: c.wa_janela_ini || '08:00', janela_fim: c.wa_janela_fim || '20:00',
        tem_token_cron: !!c.wa_token_cron, token_cron: c.wa_token_cron || '',
        fusos_pais: fusos,
        fonte: c._fonte,
        nomes_variaveis: { wa_url: 'EVOLUTION_URL', wa_apikey: 'EVOLUTION_APIKEY',
          wa_instancia: 'EVOLUTION_INSTANCIA', wa_token_cron: 'CRON_TOKEN' },
      });
    }

    if (rota === '/whatsapp/config' && metodo === 'PUT') {
      const b = body;
      const atual = await waConfig(env);
      const put = async (k, v) => env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(k, String(v ?? '')).run();
      // o que vem de variável de ambiente não é gravado no banco
      const daVar = (k) => atual._fonte && atual._fonte[k] && atual._fonte[k] !== 'banco'
        && atual._fonte[k] !== 'vazio';
      if (!daVar('wa_url')) await put('wa_url', (b.url || '').trim().replace(/\/+$/, ''));
      if (!daVar('wa_instancia')) await put('wa_instancia', (b.instancia || '').trim());
      // chave mascarada ou vazia não sobrescreve a guardada
      if (!daVar('wa_apikey') && b.apikey && !b.apikey.startsWith('••••'))
        await put('wa_apikey', b.apikey.trim());
      await put('wa_ativo', b.ativo ? '1' : '0');
      await put('wa_janela_ini', b.janela_ini || '08:00');
      await put('wa_janela_fim', b.janela_fim || '20:00');
      if (b.fusos_pais != null) await put('fusos_pais', b.fusos_pais);
      if (!daVar('wa_token_cron') && !atual.wa_token_cron)
        await put('wa_token_cron', crypto.randomUUID().replace(/-/g, ''));
      return json({ ok: true });
    }

    if (rota === '/whatsapp/status' && metodo === 'GET') {
      const c = await waConfig(env);
      if (!c.wa_url || !c.wa_apikey || !c.wa_instancia)
        return json({ configurado: false, estado: 'sem configuração' });
      try {
        const r = await fetch(
          `${c.wa_url.replace(/\/+$/, '')}/instance/connectionState/${encodeURIComponent(c.wa_instancia)}`,
          { headers: { apikey: c.wa_apikey } });
        const j = await r.json().catch(() => ({}));
        const estado = j?.instance?.state || j?.state || (r.ok ? 'desconhecido' : `HTTP ${r.status}`);
        return json({ configurado: true, conectado: estado === 'open', estado, bruto: j });
      } catch (e) {
        return json({ configurado: true, conectado: false, estado: 'sem resposta do servidor',
          erro: String(e && e.message || e) });
      }
    }

    if (rota === '/whatsapp/conectar' && metodo === 'POST') {
      const c = await waConfig(env);
      if (!c.wa_url || !c.wa_apikey || !c.wa_instancia) return bad('Configure a Evolution primeiro.');
      try {
        const r = await fetch(
          `${c.wa_url.replace(/\/+$/, '')}/instance/connect/${encodeURIComponent(c.wa_instancia)}`,
          { headers: { apikey: c.wa_apikey } });
        const j = await r.json().catch(() => ({}));
        return json({ ok: r.ok, qr: j?.base64 || j?.qrcode?.base64 || null,
          codigo: j?.code || j?.qrcode?.code || null, bruto: j });
      } catch (e) { return bad('Não consegui falar com a Evolution: ' + String(e && e.message || e), 502); }
    }

    // ---------- modelos ----------
    if (rota === '/whatsapp/templates' && metodo === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM wa_templates ORDER BY posicao, nome').all();
      return json({ templates: r.results || [] });
    }
    if (rota === '/whatsapp/templates' && metodo === 'POST') {
      const b = body;
      if (!b.chave || !b.nome || !b.corpo) return bad('Chave, nome e corpo são obrigatórios.');
      await env.DB.prepare(
        `INSERT INTO wa_templates (chave,nome,modo,evento,corpo,antecedencia_h,hora_envio,ativo,posicao)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(b.chave.trim(), b.nome.trim(), b.modo || 'semi', b.evento || null, b.corpo,
        Number(b.antecedencia_h || 0), b.hora_envio || '', b.ativo === 0 ? 0 : 1,
        Number(b.posicao || 50)).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/whatsapp/templates/') && metodo === 'PUT') {
      const b = body;
      await env.DB.prepare(
        `UPDATE wa_templates SET nome=?,modo=?,evento=?,corpo=?,antecedencia_h=?,hora_envio=?,ativo=?,posicao=?
         WHERE id=?`
      ).bind(b.nome, b.modo || 'semi', b.evento || null, b.corpo, Number(b.antecedencia_h || 0),
        b.hora_envio || '', b.ativo === 0 ? 0 : 1, Number(b.posicao || 50), seg[2]).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/whatsapp/templates/') && metodo === 'DELETE') {
      await env.DB.prepare('DELETE FROM wa_templates WHERE id=?').bind(seg[2]).run();
      return json({ ok: true });
    }

    // ---------- envio com um clique ----------
    if (rota === '/whatsapp/enviar' && metodo === 'POST') {
      const b = body;
      let texto = b.mensagem;
      let pac = null;
      if (b.paciente_id) pac = await env.DB.prepare('SELECT * FROM pacientes WHERE id=?')
        .bind(b.paciente_id).first();
      if (!texto && b.template_chave) {
        const t = await env.DB.prepare('SELECT * FROM wa_templates WHERE chave=?')
          .bind(b.template_chave).first();
        if (!t) return bad('Modelo não encontrado.');
        texto = montarTexto(t.corpo, { ...(pac || {}), ...(b.ctx || {}) });
      }
      const tel = b.telefone || (pac && pac.telefone);
      if (!tel) return bad('Paciente sem telefone cadastrado.');
      if (!texto) return bad('Mensagem vazia.');

      const r = await enviarWhats(env, tel, texto);
      await env.DB.prepare(
        `INSERT INTO wa_fila (paciente_id,template_chave,telefone,mensagem,agendado_para,status,modo,
             ref_tipo,ref_id,erro,enviado_em)
         VALUES (?,?,?,?,?,?,'semi',?,?,?,?)`
      ).bind(b.paciente_id || null, b.template_chave || null, tel, texto,
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        r.ok ? 'enviado' : 'erro', b.ref_tipo || null, b.ref_id || null,
        r.ok ? null : r.erro, r.ok ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null).run();

      if (!r.ok) return bad(r.erro, 502);
      return json({ ok: true, mensagem: texto });
    }

    // ---------- prévia do texto já com as variáveis ----------
    if (rota === '/whatsapp/previa' && metodo === 'POST') {
      const b = body;
      const t = await env.DB.prepare('SELECT * FROM wa_templates WHERE chave=?')
        .bind(b.template_chave).first();
      if (!t) return bad('Modelo não encontrado.');
      const pac = b.paciente_id
        ? await env.DB.prepare('SELECT * FROM pacientes WHERE id=?').bind(b.paciente_id).first() : {};
      // modelo que manda o formulário precisa de um link com token para esse paciente
      const extra = {};
      if (pac && pac.id && /\{link_anamnese\}/.test(t.corpo)) {
        const token = pac.form_token || novoToken();
        if (!pac.form_token) await env.DB.prepare(
          'UPDATE pacientes SET form_token=? WHERE id=?').bind(token, pac.id).run();
        extra.link_anamnese = `${await baseFormulario(env, url)}/?t=${token}`;
      }
      return json({
        mensagem: montarTexto(t.corpo, { ...(pac || {}), ...extra, ...(b.ctx || {}) }),
        template: t,
      });
    }

    if (rota === '/whatsapp/agendar' && metodo === 'POST') {
      return json({ ok: true, ...(await agendarAutomaticas(env)) });
    }

    if (rota === '/whatsapp/fila' && metodo === 'GET') {
      const st = url.searchParams.get('status') || 'agendado';
      const r = await env.DB.prepare(
        `SELECT f.*, pa.nome, pa.apelido, pa.cod, pa.pais
           FROM wa_fila f LEFT JOIN pacientes pa ON pa.id=f.paciente_id
          WHERE (? = 'todos' OR f.status = ?)
          ORDER BY CASE WHEN f.status='agendado' THEN f.agendado_para END ASC,
                   f.id DESC LIMIT 300`).bind(st, st).all();
      const cont = await env.DB.prepare(
        'SELECT status, COUNT(*) c FROM wa_fila GROUP BY status').all();
      return json({ fila: r.results || [], contagem: cont.results || [] });
    }

    if (rota.startsWith('/whatsapp/fila/') && seg.length === 3 && metodo === 'PUT') {
      const b = body;
      await env.DB.prepare(
        'UPDATE wa_fila SET mensagem=COALESCE(?,mensagem), agendado_para=COALESCE(?,agendado_para), status=COALESCE(?,status) WHERE id=?')
        .bind(b.mensagem ?? null, b.agendado_para ?? null, b.status ?? null, seg[2]).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/whatsapp/fila/') && seg.length === 3 && metodo === 'DELETE') {
      await env.DB.prepare("UPDATE wa_fila SET status='cancelado' WHERE id=? AND status='agendado'")
        .bind(seg[2]).run();
      return json({ ok: true });
    }
    if (rota.startsWith('/whatsapp/fila/') && seg.length === 4 && seg[3] === 'enviar' && metodo === 'POST') {
      const f = await env.DB.prepare('SELECT * FROM wa_fila WHERE id=?').bind(seg[2]).first();
      if (!f) return bad('Item não encontrado.', 404);
      const r = await enviarWhats(env, f.telefone, f.mensagem);
      await env.DB.prepare(
        "UPDATE wa_fila SET status=?, erro=?, enviado_em=? WHERE id=?")
        .bind(r.ok ? 'enviado' : 'erro', r.ok ? null : r.erro,
          r.ok ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, f.id).run();
      if (!r.ok) return bad(r.erro, 502);
      return json({ ok: true });
    }

    return bad('Rota não encontrada: ' + rota, 404);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
