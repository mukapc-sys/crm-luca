ALTER TABLE form_campos ADD COLUMN alerta INTEGER NOT NULL DEFAULT 0;
UPDATE form_campos SET alerta=1 WHERE chave='restricao_alimentar';
ALTER TABLE pacientes ADD COLUMN alertas TEXT;
ALTER TABLE planos ADD COLUMN favorito INTEGER NOT NULL DEFAULT 0;
