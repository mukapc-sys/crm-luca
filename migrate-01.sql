CREATE TABLE IF NOT EXISTS negociacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'novo',
  etapa TEXT NOT NULL DEFAULT 'novo',
  origem TEXT,
  call_em TEXT,
  proximo_contato TEXT,
  motivo TEXT,
  plano_id INTEGER,
  valor_previsto REAL DEFAULT 0,
  moeda TEXT DEFAULT 'BRL',
  contrato_id INTEGER,
  contrato_origem INTEGER,
  obs TEXT,
  fechado_em TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_neg_etapa ON negociacoes(tipo, etapa);
CREATE INDEX IF NOT EXISTS idx_neg_pac ON negociacoes(paciente_id);
CREATE INDEX IF NOT EXISTS idx_neg_prox ON negociacoes(proximo_contato);
CREATE INDEX IF NOT EXISTS idx_neg_call ON negociacoes(call_em);
CREATE UNIQUE INDEX IF NOT EXISTS idx_neg_renov ON negociacoes(contrato_origem) WHERE contrato_origem IS NOT NULL;
CREATE TABLE IF NOT EXISTS interacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negociacao_id INTEGER,
  paciente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'nota',
  data TEXT NOT NULL,
  resultado TEXT,
  obs TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_int_neg ON interacoes(negociacao_id);
CREATE INDEX IF NOT EXISTS idx_int_pac ON interacoes(paciente_id, data);
CREATE TABLE IF NOT EXISTS motivos_perda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  aplica TEXT NOT NULL DEFAULT 'ambos',
  ativo INTEGER NOT NULL DEFAULT 1,
  posicao INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO motivos_perda (nome,aplica,posicao) VALUES
 ('Preço','ambos',1),
 ('Vai pensar / sumiu','ambos',2),
 ('Sem tempo agora','ambos',3),
 ('Foi com outro profissional','ambos',4),
 ('Não era o perfil','novo',5),
 ('Não respondeu','ambos',6),
 ('Atingiu o objetivo','renovacao',7),
 ('Insatisfeito com o resultado','renovacao',8);
INSERT OR IGNORE INTO settings (key,value) VALUES
 ('renovacao_antecedencia','30'),
 ('origens','Direct,Indicação,Formulário,Anúncio,Outro');
