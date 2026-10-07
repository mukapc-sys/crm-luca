CREATE TABLE IF NOT EXISTS anexos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'dieta',
  titulo TEXT,
  data_ref TEXT,
  obs TEXT,
  arquivo_nome TEXT NOT NULL,
  chave TEXT NOT NULL,
  mime TEXT,
  tamanho INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_anexo_pac ON anexos(paciente_id, data_ref);
CREATE INDEX IF NOT EXISTS idx_anexo_tipo ON anexos(tipo);
