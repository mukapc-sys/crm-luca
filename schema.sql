CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  senha      TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS planos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo         TEXT NOT NULL UNIQUE,
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'dieta',
  dias           INTEGER NOT NULL DEFAULT 30,
  preco_brl      REAL DEFAULT 0,
  preco_usd      REAL DEFAULT 0,
  consultas      INTEGER DEFAULT 0,
  follow_up_dias INTEGER DEFAULT 0,
  renova_auto    INTEGER NOT NULL DEFAULT 0,
  regras         TEXT,
  ativo          INTEGER NOT NULL DEFAULT 1,
  posicao        INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS parceiros (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nome    TEXT NOT NULL,
  contato TEXT,
  obs     TEXT,
  ativo   INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pacientes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cod          TEXT,
  nome         TEXT NOT NULL,
  apelido      TEXT,
  pais         TEXT DEFAULT 'Brasil',
  email        TEXT,
  telefone     TEXT,
  instagram    TEXT,
  nascimento   TEXT,
  cpf          TEXT,
  profissao    TEXT,
  endereco     TEXT,
  objetivo     TEXT,
  status       TEXT NOT NULL DEFAULT 'ativo',
  parceiro_id  INTEGER,
  indicacao    TEXT,
  obs          TEXT,
  sexo         TEXT,
  altura_cm    REAL,
  fuso         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pac_cod    ON pacientes(cod);
CREATE INDEX IF NOT EXISTS idx_pac_status ON pacientes(status);
CREATE INDEX IF NOT EXISTS idx_pac_nome   ON pacientes(nome);
CREATE TABLE IF NOT EXISTS contratos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER NOT NULL,
  plano_id      INTEGER,
  codigo_plano  TEXT,
  data_inicial  TEXT,
  data_final    TEXT,
  valor_cobrado REAL DEFAULT 0,
  moeda         TEXT DEFAULT 'BRL',
  forma         TEXT,
  qtd_parcelas  INTEGER DEFAULT 1,
  status        TEXT DEFAULT 'ativo',
  obs           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_con_pac ON contratos(paciente_id);
CREATE TABLE IF NOT EXISTS parcelas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL,
  paciente_id INTEGER NOT NULL,
  numero      INTEGER NOT NULL DEFAULT 1,
  total       INTEGER NOT NULL DEFAULT 1,
  valor       REAL NOT NULL DEFAULT 0,
  moeda       TEXT NOT NULL DEFAULT 'BRL',
  vencimento  TEXT,
  status      TEXT NOT NULL DEFAULT 'aberta',
  pago        REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_par_pac  ON parcelas(paciente_id);
CREATE INDEX IF NOT EXISTS idx_par_venc ON parcelas(vencimento, status);
CREATE TABLE IF NOT EXISTS pagamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parcela_id  INTEGER,
  paciente_id INTEGER NOT NULL,
  data        TEXT NOT NULL,
  valor       REAL NOT NULL,
  moeda       TEXT NOT NULL DEFAULT 'BRL',
  cotacao     REAL NOT NULL DEFAULT 1,
  valor_brl   REAL NOT NULL DEFAULT 0,
  forma       TEXT,
  obs         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pag_data ON pagamentos(data);
CREATE INDEX IF NOT EXISTS idx_pag_pac  ON pagamentos(paciente_id);
CREATE TABLE IF NOT EXISTS cotacoes (
  dia   TEXT NOT NULL,
  moeda TEXT NOT NULL,
  taxa  REAL NOT NULL,
  fonte TEXT DEFAULT 'awesomeapi',
  PRIMARY KEY (dia, moeda)
);
CREATE TABLE IF NOT EXISTS anamneses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER,
  cod           TEXT,
  nome          TEXT,
  email         TEXT,
  telefone      TEXT,
  respondido_em TEXT,
  origem        TEXT DEFAULT 'BR',
  dados         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ana_pac  ON anamneses(paciente_id);
CREATE INDEX IF NOT EXISTS idx_ana_nome ON anamneses(nome);
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
CREATE TABLE IF NOT EXISTS compromissos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'consulta',
  paciente_id INTEGER,
  inicio      TEXT NOT NULL,
  fim         TEXT,
  dia_todo    INTEGER NOT NULL DEFAULT 0,
  local       TEXT,
  obs         TEXT,
  status      TEXT NOT NULL DEFAULT 'marcado',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_inicio ON compromissos(inicio);
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
INSERT OR IGNORE INTO settings (key,value) VALUES
 ('fatores_f','Sedentário:1.40|Leve:1.55|Moderado:1.70|Intenso:2.00'),
 ('fatores_m','Sedentário:1.40|Leve:1.56|Moderado:1.78|Intenso:2.10');
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
INSERT OR IGNORE INTO settings (key,value) VALUES
 ('form_titulo','Anamnese — Luca Ternes'),
 ('form_intro','Preencha com calma. São essas informações que eu uso para montar o seu plano antes da nossa call.'),
 ('form_agradecimento','Recebi tudo. Vou analisar suas respostas e te chamo no WhatsApp para marcarmos a call.');
