ALTER TABLE pacientes ADD COLUMN fuso TEXT;
CREATE TABLE IF NOT EXISTS wa_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  modo TEXT NOT NULL DEFAULT 'semi',
  evento TEXT,
  corpo TEXT NOT NULL,
  antecedencia_h REAL DEFAULT 0,
  hora_envio TEXT DEFAULT '09:00',
  ativo INTEGER NOT NULL DEFAULT 1,
  posicao INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wa_fila (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave_unica TEXT UNIQUE,
  paciente_id INTEGER,
  template_chave TEXT,
  telefone TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  agendado_para TEXT,
  status TEXT NOT NULL DEFAULT 'agendado',
  modo TEXT NOT NULL DEFAULT 'auto',
  ref_tipo TEXT,
  ref_id INTEGER,
  erro TEXT,
  enviado_em TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_status ON wa_fila(status, agendado_para);
CREATE INDEX IF NOT EXISTS idx_wa_pac ON wa_fila(paciente_id, created_at);
INSERT OR IGNORE INTO settings (key,value) VALUES
 ('wa_url',''),
 ('wa_apikey',''),
 ('wa_instancia',''),
 ('wa_ativo','0'),
 ('wa_token_cron',''),
 ('wa_janela_ini','08:00'),
 ('wa_janela_fim','20:00'),
 ('fusos_pais','Brasil:America/Sao_Paulo|US:America/New_York|Portugal:Europe/Lisbon|Inglaterra:Europe/London|Canadá:America/Toronto|Colômbia:America/Bogota|Luxemburgo:Europe/Luxembourg|Tchéquia:Europe/Prague');
INSERT OR IGNORE INTO wa_templates (chave,nome,modo,evento,corpo,antecedencia_h,hora_envio,posicao) VALUES
 ('call_lembrete','Lembrete de call','auto','call','Oi {primeiro_nome}! Passando pra confirmar nossa call de hoje às {hora_call}. Tudo certo pra você?',3,'',1),
 ('cobranca_previa','Cobrança — 3 dias antes','auto','parcela_previa','Oi {primeiro_nome}! Sua parcela {parcela} de {valor} vence em {vencimento}. Qualquer dúvida é só me chamar.',72,'09:00',2),
 ('cobranca_hoje','Cobrança — no dia','auto','parcela_hoje','Oi {primeiro_nome}! Hoje vence a parcela {parcela} de {valor}. Me avisa quando fizer que eu já dou baixa.',0,'09:00',3),
 ('cobranca_atraso','Cobrança — em atraso','auto','parcela_atraso','Oi {primeiro_nome}, tudo bem? A parcela {parcela} de {valor} venceu em {vencimento} e ainda não identifiquei. Deu algum problema no pagamento?',48,'09:00',4),
 ('renovacao_aviso','Renovação — 15 dias antes','auto','renovacao','Oi {primeiro_nome}! Seu plano {plano} termina em {data_fim}. Vamos falar sobre os próximos passos? Me diz um horário que funciona pra você.',360,'10:00',5),
 ('checkin_diario','Check-in diário da rotina','auto','checkin','Bom dia {primeiro_nome}! Como foi a rotina de ontem? Me conta o treino, as refeições e como você se sentiu.',0,'08:00',6),
 ('followup_venda','Follow-up de venda','semi','','Oi {primeiro_nome}! Como combinamos, estou passando pra retomar nossa conversa sobre a consultoria. Seguimos?',0,'',10),
 ('boas_vindas','Boas-vindas ao fechar','semi','','{primeiro_nome}, seja muito bem-vindo! Seu plano {plano} começa agora e vai até {data_fim}. Vou te mandar os próximos passos por aqui.',0,'',11),
 ('pedir_retorno','Pedir retorno do paciente','semi','','Oi {primeiro_nome}! Faz um tempo que não recebo notícias suas. Como está indo?',0,'',12),
 ('cobranca_manual','Cobrança manual','semi','','Oi {primeiro_nome}! Passando pra lembrar da parcela {parcela} de {valor}, vencimento {vencimento}.',0,'',13);
