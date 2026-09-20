ALTER TABLE pacientes ADD COLUMN sexo TEXT;
ALTER TABLE pacientes ADD COLUMN altura_cm REAL;
INSERT OR IGNORE INTO settings (key,value) VALUES
 ('fatores_f','Sedentário:1.40|Leve:1.55|Moderado:1.70|Intenso:2.00'),
 ('fatores_m','Sedentário:1.40|Leve:1.56|Moderado:1.78|Intenso:2.10');
