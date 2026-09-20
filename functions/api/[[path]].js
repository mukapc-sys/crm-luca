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
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};
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

  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(metodo)) {
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
    // PLANOS
    // ==========================================================
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
               pa.objetivo, pa.status,
               c.codigo_plano  AS plano_atual,
               c.data_final    AS data_final,
               uc.ultima_consulta,
               COALESCE(ab.abertas, 0) AS parcelas_abertas
          FROM pacientes pa
          LEFT JOIN (SELECT paciente_id, MAX(id) AS mid FROM contratos GROUP BY paciente_id) lc
                 ON lc.paciente_id = pa.id
          LEFT JOIN contratos c ON c.id = lc.mid
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

      const r = await env.DB.prepare(sql).bind(...args).all();
      return json({ pacientes: r.results || [] });
    }

    if (rota === '/pacientes' && metodo === 'POST') {
      const b = body;
      if (!b.nome) return bad('Nome é obrigatório.');
      const res = await env.DB.prepare(
        `INSERT INTO pacientes (cod,nome,apelido,pais,email,telefone,instagram,nascimento,cpf,
             profissao,endereco,objetivo,status,parceiro_id,indicacao,obs)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(b.cod || null, b.nome.trim(), b.apelido || null, b.pais || 'Brasil', b.email || null,
        b.telefone || null, b.instagram || null, b.nascimento || null, b.cpf || null,
        b.profissao || null, b.endereco || null, b.objetivo || null, b.status || 'ativo',
        b.parceiro_id || null, b.indicacao || null, b.obs || null).run();
      return json({ ok: true, id: res.meta.last_row_id });
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
      return json({
        paciente: p,
        contratos: contratos.results || [],
        parcelas: parcelas.results || [],
        pagamentos: pagamentos.results || [],
        consultas: consultas.results || [],
        anamnese: anamnese || null,
      });
    }

    if (rota.startsWith('/pacientes/') && seg.length === 2 && metodo === 'PUT') {
      const id = seg[1]; const b = body;
      await env.DB.prepare(
        `UPDATE pacientes SET cod=?,nome=?,apelido=?,pais=?,email=?,telefone=?,instagram=?,
            nascimento=?,cpf=?,profissao=?,endereco=?,objetivo=?,status=?,parceiro_id=?,indicacao=?,obs=?,
            updated_at=datetime('now') WHERE id=?`
      ).bind(b.cod || null, b.nome, b.apelido || null, b.pais || 'Brasil', b.email || null,
        b.telefone || null, b.instagram || null, b.nascimento || null, b.cpf || null,
        b.profissao || null, b.endereco || null, b.objetivo || null, b.status || 'ativo',
        b.parceiro_id || null, b.indicacao || null, b.obs || null, id).run();
      return json({ ok: true });
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
    // CONSULTAS (a ficha do caderno)
    // ==========================================================
    if (rota === '/consultas' && metodo === 'POST') {
      const b = body;
      if (!b.paciente_id) return bad('Informe o paciente.');
      let kg = b.peso_kg === '' || b.peso_kg == null ? null : num(b.peso_kg);
      let lbs = b.peso_lbs === '' || b.peso_lbs == null ? null : num(b.peso_lbs);
      if (kg && !lbs) lbs = Math.round(kg * 2.20462 * 10) / 10;
      if (lbs && !kg) kg = Math.round((lbs / 2.20462) * 10) / 10;
      const res = await env.DB.prepare(
        `INSERT INTO consultas (paciente_id,data,peso_kg,peso_lbs,treino,cafe,lanche_manha,
             almoco,lanche_tarde,jantar,ceia,observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(b.paciente_id, b.data || hoje(), kg, lbs, b.treino || null, b.cafe || null,
        b.lanche_manha || null, b.almoco || null, b.lanche_tarde || null, b.jantar || null,
        b.ceia || null, b.observacoes || null).run();
      return json({ ok: true, id: res.meta.last_row_id });
    }

    if (rota.startsWith('/consultas/') && metodo === 'PUT') {
      const id = seg[1]; const b = body;
      let kg = b.peso_kg === '' || b.peso_kg == null ? null : num(b.peso_kg);
      let lbs = b.peso_lbs === '' || b.peso_lbs == null ? null : num(b.peso_lbs);
      if (kg && !lbs) lbs = Math.round(kg * 2.20462 * 10) / 10;
      if (lbs && !kg) kg = Math.round((lbs / 2.20462) * 10) / 10;
      await env.DB.prepare(
        `UPDATE consultas SET data=?,peso_kg=?,peso_lbs=?,treino=?,cafe=?,lanche_manha=?,almoco=?,
            lanche_tarde=?,jantar=?,ceia=?,observacoes=?,updated_at=datetime('now') WHERE id=?`
      ).bind(b.data, kg, lbs, b.treino || null, b.cafe || null, b.lanche_manha || null,
        b.almoco || null, b.lanche_tarde || null, b.jantar || null, b.ceia || null,
        b.observacoes || null, id).run();
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
        `SELECT c.*, pa.nome paciente_nome, pa.apelido paciente_apelido, pa.cod paciente_cod
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
      const porMes = await env.DB.prepare(
        `SELECT substr(data,1,7) mes, moeda, SUM(valor) total, SUM(valor_brl) total_brl
           FROM pagamentos GROUP BY mes, moeda ORDER BY mes DESC LIMIT 60`).all();
      const aReceber = await env.DB.prepare(
        `SELECT p.moeda, SUM(p.valor-p.pago) total, COUNT(*) qtd
           FROM parcelas p
           JOIN contratos c ON c.id=p.contrato_id
           JOIN pacientes pa ON pa.id=p.paciente_id
          WHERE p.status IN ('aberta','parcial') AND c.status='ativo'
            AND pa.status NOT IN ('encerrado','parceria')
          GROUP BY p.moeda`).all();
      const porPlano = await env.DB.prepare(
        `SELECT codigo_plano, COUNT(*) qtd, SUM(valor_cobrado) total, moeda
           FROM contratos GROUP BY codigo_plano, moeda ORDER BY qtd DESC`).all();
      const porPais = await env.DB.prepare(
        `SELECT pa.pais, COUNT(DISTINCT pa.id) pacientes FROM pacientes pa GROUP BY pa.pais`).all();
      return json({
        por_mes: porMes.results || [],
        a_receber: aReceber.results || [],
        por_plano: porPlano.results || [],
        por_pais: porPais.results || [],
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
          const cr = await env.DB.prepare(
            `INSERT INTO contratos (paciente_id,codigo_plano,data_inicial,data_final,valor_cobrado,
                moeda,forma,qtd_parcelas,status,obs)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).bind(pid, l.plano || null, l.data_inicial, l.data_final || null, num(l.valor_cobrado),
            moeda, l.forma || null, Number(l.qtd_parcelas || 1),
            l.status === 'encerrado' ? 'encerrado' : 'ativo', l.obs || null).run();
          const c = await env.DB.prepare('SELECT * FROM contratos WHERE id=?').bind(cr.meta.last_row_id).first();
          await gerarParcelas(env, c);

          if (num(l.valor_recebido) > 0) {
            // A coluna "Valor recebido" da planilha está SEMPRE em reais, inclusive
            // nos contratos em dólar. Converte para a moeda do contrato pela taxa
            // da data de início antes de dar baixa nas parcelas.
            const taxa = await cotacaoDoDia(env, c.moeda, l.data_inicial);
            const recebidoBrl = num(l.valor_recebido);
            let resta = (c.moeda === 'BRL' || !taxa)
              ? recebidoBrl
              : Math.round((recebidoBrl / taxa) * 100) / 100;

            const ps = await env.DB.prepare(
              'SELECT * FROM parcelas WHERE contrato_id=? ORDER BY numero ASC').bind(c.id).all();
            for (const p of (ps.results || [])) {
              if (resta <= 0.01) break;
              const aplica = Math.min(resta, Number(p.valor));
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
      return json({ ok: true, criados, renovacoes, contratos });
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
      let gravadas = 0, casadas = 0;
      for (const a of linhas) {
        if (!a.nome) continue;
        let pid = null;
        const p = await env.DB.prepare(
          'SELECT id FROM pacientes WHERE nome=? OR (cod IS NOT NULL AND cod=?)')
          .bind(a.nome, a.cod ? String(a.cod) : '___').first();
        if (p) { pid = p.id; casadas++; }
        await env.DB.prepare(
          `INSERT INTO anamneses (paciente_id,cod,nome,email,telefone,respondido_em,origem,dados)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(pid, a.cod ? String(a.cod) : null, a.nome, a.email || null, a.telefone || null,
          a.respondido_em || null, a.origem || 'BR', JSON.stringify(a.dados || {})).run();
        gravadas++;
      }
      return json({ ok: true, gravadas, casadas });
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

    return bad('Rota não encontrada: ' + rota, 404);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
