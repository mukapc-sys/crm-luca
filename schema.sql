-- ============================================================
-- CRM Luca Ternes — schema completo (Cloudflare D1)
-- Rode este arquivo inteiro no console do D1 uma vez.
-- É idempotente: pode rodar de novo sem quebrar nada.
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- acesso ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  senha      TEXT NOT NULL,              -- pbkdf2: salt:hash
  papel      TEXT NOT NULL DEFAULT 'admin',
  ativo      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  expira_em  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessoes_user ON sessoes(usuario_id);

-- ---------- catálogo de planos ----------
CREATE TABLE IF NOT EXISTS planos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo         TEXT NOT NULL UNIQUE,   -- 30D, 90DT, anual...
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'dieta',   -- dieta|treino|dieta_treino|le|outro
  dias           INTEGER NOT NULL DEFAULT 30,
  preco_brl      REAL DEFAULT 0,
  preco_usd      REAL DEFAULT 0,
  consultas      INTEGER DEFAULT 0,      -- consultas incluídas
  follow_up_dias INTEGER DEFAULT 0,      -- cadência de follow-up
  renova_auto    INTEGER NOT NULL DEFAULT 0,
  regras         TEXT,                   -- texto livre: o que o plano inclui
  ativo          INTEGER NOT NULL DEFAULT 1,
  posicao        INTEGER DEFAULT 0
);

-- ---------- parceiros / indicações ----------
CREATE TABLE IF NOT EXISTS parceiros (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nome    TEXT NOT NULL,
  contato TEXT,
  obs     TEXT,
  ativo   INTEGER NOT NULL DEFAULT 1
);

-- ---------- pacientes ----------
CREATE TABLE IF NOT EXISTS pacientes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cod          TEXT,                     -- código do form (chave de busca do Luca)
  nome         TEXT NOT NULL,
  apelido      TEXT,                     -- apelido interno
  pais         TEXT DEFAULT 'Brasil',
  email        TEXT,
  telefone     TEXT,
  instagram    TEXT,
  nascimento   TEXT,
  cpf          TEXT,
  profissao    TEXT,
  endereco     TEXT,
  objetivo     TEXT,                     -- multi, separado por vírgula
  status       TEXT NOT NULL DEFAULT 'ativo',  -- ativo|devendo|encerrado|parceria|lead
  parceiro_id  INTEGER,
  indicacao    TEXT,                     -- texto cru de quem indicou
  obs          TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pac_cod    ON pacientes(cod);
CREATE INDEX IF NOT EXISTS idx_pac_status ON pacientes(status);
CREATE INDEX IF NOT EXISTS idx_pac_nome   ON pacientes(nome);

-- ---------- contratos ----------
CREATE TABLE IF NOT EXISTS contratos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER NOT NULL,
  plano_id      INTEGER,
  codigo_plano  TEXT,
  data_inicial  TEXT,
  data_final    TEXT,
  valor_cobrado REAL DEFAULT 0,
  moeda         TEXT DEFAULT 'BRL',      -- BRL|USD|GBP|EUR
  forma         TEXT,                    -- pix|zelle|paypal|asaas|infinity|outro
  qtd_parcelas  INTEGER DEFAULT 1,
  status        TEXT DEFAULT 'ativo',    -- ativo|encerrado|parceria
  obs           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_con_pac ON contratos(paciente_id);

-- ---------- parcelas ----------
CREATE TABLE IF NOT EXISTS parcelas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL,
  paciente_id INTEGER NOT NULL,
  numero      INTEGER NOT NULL DEFAULT 1,
  total       INTEGER NOT NULL DEFAULT 1,
  valor       REAL NOT NULL DEFAULT 0,
  moeda       TEXT NOT NULL DEFAULT 'BRL',
  vencimento  TEXT,
  status      TEXT NOT NULL DEFAULT 'aberta',  -- aberta|paga|parcial|cancelada
  pago        REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_par_pac  ON parcelas(paciente_id);
CREATE INDEX IF NOT EXISTS idx_par_venc ON parcelas(vencimento, status);

-- ---------- pagamentos ----------
CREATE TABLE IF NOT EXISTS pagamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parcela_id  INTEGER,
  paciente_id INTEGER NOT NULL,
  data        TEXT NOT NULL,
  valor       REAL NOT NULL,
  moeda       TEXT NOT NULL DEFAULT 'BRL',
  cotacao     REAL NOT NULL DEFAULT 1,   -- taxa usada (editável)
  valor_brl   REAL NOT NULL DEFAULT 0,   -- valor * cotacao
  forma       TEXT,
  obs         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pag_data ON pagamentos(data);
CREATE INDEX IF NOT EXISTS idx_pag_pac  ON pagamentos(paciente_id);

-- ---------- cotações (histórico real, por dia) ----------
CREATE TABLE IF NOT EXISTS cotacoes (
  dia   TEXT NOT NULL,
  moeda TEXT NOT NULL,
  taxa  REAL NOT NULL,
  fonte TEXT DEFAULT 'awesomeapi',
  PRIMARY KEY (dia, moeda)
);

-- ---------- anamnese (respostas do formulário) ----------
CREATE TABLE IF NOT EXISTS anamneses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER,
  cod           TEXT,
  nome          TEXT,
  email         TEXT,
  telefone      TEXT,
  respondido_em TEXT,
  origem        TEXT DEFAULT 'BR',       -- BR|US
  dados         TEXT,                    -- JSON com todas as respostas
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ana_pac  ON anamneses(paciente_id);
CREATE INDEX IF NOT EXISTS idx_ana_nome ON anamneses(nome);

-- ---------- ficha de consulta (o caderno) ----------
CREATE TABLE IF NOT EXISTS consultas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id  INTEGER NOT NULL,
  data         TEXT NOT NULL,
  peso_kg      REAL,
  peso_lbs     REAL,
  treino       TEXT,
  cafe         TEXT,
  lanche_manha TEXT,
  almoco       TEXT,
  lanche_tarde TEXT,
  jantar       TEXT,
  ceia         TEXT,
  observacoes  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cons_pac ON consultas(paciente_id, data);

-- ---------- agenda ----------
CREATE TABLE IF NOT EXISTS compromissos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'consulta', -- consulta|followup|pessoal|cobranca
  paciente_id INTEGER,
  inicio      TEXT NOT NULL,   -- 2026-09-22T14:00
  fim         TEXT,
  dia_todo    INTEGER NOT NULL DEFAULT 0,
  local       TEXT,
  obs         TEXT,
  status      TEXT NOT NULL DEFAULT 'marcado', -- marcado|feito|cancelado
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_inicio ON compromissos(inicio);

-- ---------- lista de espera ----------
CREATE TABLE IF NOT EXISTS lista_espera (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cod        TEXT,
  nome       TEXT,
  idade      TEXT,
  pais       TEXT,
  situacao   TEXT,
  obs        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- planos padrão (códigos que o Luca já usa) ----------
INSERT OR IGNORE INTO planos (codigo,nome,tipo,dias,consultas,follow_up_dias,posicao) VALUES
 ('30D','Dieta 30 dias','dieta',30,1,7,1),
 ('30T','Treino 30 dias','treino',30,1,7,2),
 ('30DT','Dieta + Treino 30 dias','dieta_treino',30,1,7,3),
 ('30LE','Low Energy 30 dias','le',30,1,7,4),
 ('90D','Dieta 90 dias','dieta',90,3,7,5),
 ('90T','Treino 90 dias','treino',90,3,7,6),
 ('90DT','Dieta + Treino 90 dias','dieta_treino',90,3,7,7),
 ('semestral','Semestral','dieta_treino',180,6,7,8),
 ('anual','Anual','dieta_treino',365,12,7,9),
 ('personalizado','Personalizado','outro',30,0,0,10);

INSERT OR IGNORE INTO settings (key,value) VALUES
 ('fuso','America/Sao_Paulo'),
 ('followup_dias_alerta','10'),
 ('vencimento_alerta_dias','30'),
 ('moedas','BRL,USD,GBP,EUR');
