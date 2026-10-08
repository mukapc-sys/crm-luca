CREATE TABLE IF NOT EXISTS tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL,
  data TEXT,
  hora TEXT,
  feita INTEGER NOT NULL DEFAULT 0,
  feita_em TEXT,
  posicao INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tarefa_aberta ON tarefas(feita, data, hora);
CREATE INDEX IF NOT EXISTS idx_tarefa_feita ON tarefas(feita, feita_em);

ALTER TABLE anamneses ADD COLUMN extra TEXT;
CREATE INDEX IF NOT EXISTS idx_ana_orfa ON anamneses(paciente_id,nome);
