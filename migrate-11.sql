ALTER TABLE pacientes ADD COLUMN cods_antigos TEXT;
ALTER TABLE pacientes ADD COLUMN nomes_antigos TEXT;
ALTER TABLE pacientes ADD COLUMN peso_inicial_kg REAL;
ALTER TABLE pacientes ADD COLUMN inicio_em TEXT;
ALTER TABLE contratos ADD COLUMN desconto REAL;
ALTER TABLE anamneses ADD COLUMN liberada INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS uniao_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, lote TEXT NOT NULL, mantido_id INTEGER NOT NULL, mantido_nome TEXT, absorvido_id INTEGER NOT NULL, absorvido_nome TEXT, absorvido_cod TEXT, movidos TEXT, feito_em TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE INDEX IF NOT EXISTS idx_uniao_lote ON uniao_log(lote);
CREATE INDEX IF NOT EXISTS idx_ana_liberada ON anamneses(liberada);
