# CRM Luca Ternes — Fase 0 + 1

Sistema de controle de consultorias (Brasil e Estados Unidos).
Cloudflare Pages + Pages Functions + D1. Sem CLI: tudo pelo navegador.

## Como subir

**1. Criar o repositório no GitHub**
Suba estes arquivos mantendo a estrutura:

```
schema.sql
schema-uma-linha.sql
migrate-01.sql … migrate-06.sql
functions/_middleware.js
functions/api/[[path]].js
public/index.html
public/app.js
public/manifest.webmanifest
public/form/index.html
public/img/
seed/crm-luca-anamneses.json
worker-cron/index.js
```

**2. Criar o banco D1**
Cloudflare → Workers & Pages → D1 → *Create database* → nome `crm-luca`.
Abra a aba **Console** do banco, cole todo o conteúdo de `schema.sql` e execute.
O arquivo não tem comentários — o console do D1 rejeita `--`.

Se o console reclamar de vários comandos de uma vez, use
`schema-uma-linha.sql`: são 74 linhas, cada uma um comando completo.
Cole na ordem, de cima para baixo. Rodar de novo não quebra nada.

**3. Criar o projeto no Pages**
Workers & Pages → Create → Pages → Connect to Git → escolha o repositório.

- Framework preset: **None**
- Build command: *(vazio)*
- Build output directory: **`public`**

**4. Conectar o banco**
Settings → Functions → D1 database bindings → Add:

- Variable name: **`DB`** (exatamente assim)
- D1 database: `crm-luca`

Salve e faça um novo deploy (Deployments → Retry deployment).

**5. Criar o armazenamento dos anexos (R2)**
É onde ficam os PDFs de dieta e treino. O banco D1 guarda só a ficha do
anexo; o arquivo em si vai para o R2.

Cloudflare → R2 → *Create bucket* → nome `crm-luca-arquivos`.
Depois, no projeto Pages: Settings → Functions → R2 bucket bindings → Add:

- Variable name: **`ARQUIVOS`** (exatamente assim)
- R2 bucket: `crm-luca-arquivos`

Sem esse binding o CRM funciona inteiro, só a aba "Planos e anexos" avisa
que o armazenamento não está conectado.

**6. Primeiro acesso**
Abra a URL do Pages. A tela pede para criar o usuário administrador —
e-mail e senha do Luca. A partir daí é login normal.

## Importar os dados atuais

Tela **Configurações → Importar dados**. O arquivo é enviado em blocos
automaticamente, não precisa dividir nada.

1. Tipo **Pacientes e contratos** → arquivo `crm-luca-pacientes.json`
   (338 linhas da aba CRM: cadastro, plano, datas, valores, parcelas e
   os pagamentos já recebidos)
2. Tipo **Anamneses** → arquivo `seed/crm-luca-anamneses.json`
   (333 respostas do formulário BR, casadas com os pacientes pelo nome)

Importe os pacientes **antes** das anamneses — é o que permite casar as
duas bases.

## O que já funciona

| Tela | O que faz |
|---|---|
| **Início** | O dia do Luca: calls, follow-ups combinados para hoje, cobranças, renovações em aberto, agenda e pacientes sem consulta recente. Cards de taxa de fechamento, recebido no mês contra o anterior, a receber e ativos |
| **Funil** | Duas esteiras. **Leads novos**: chegou no direct → call agendada → follow-up → fechou/perdido. **Renovações**: criadas sozinhas 30 dias antes do fim do plano → a abordar → abordado → follow-up → renovou/não renovou. Fechar a venda cria o contrato e as parcelas. Perder exige motivo, e os motivos viram relatório |
| **Pacientes** | Separado pelo que exige ação: em acompanhamento, renovação chegando, devendo, leads e inativos. A coluna de destaque e o botão de ação mudam com o segmento. Busca por COD, nome ou apelido atravessa a base inteira |
| **Planos e anexos** | Aba na ficha do paciente. O plano que ele monta no outro sistema entra aqui com tipo, data e uma observação do que mudou. Nada é substituído: cada troca vira um anexo novo e o mais recente de cada tipo aparece marcado como **atual**. Dieta, treino, exame, foto e outros. Até 25 MB por arquivo |
| **Ficha de consulta** | O caderno do Luca em tela: COD, data, peso em kg **e** lbs (um calcula o outro), treino, observações e a variação desde a última medição. As refeições são uma lista: ele renomeia, põe horário em cada uma, acrescenta (pré-treino, ceia, o que for) e tira as que não usa. Mostra o objetivo de agora com opção de trocar — o que muda o objetivo do paciente — e a TMB calculada na hora que o peso é digitado |
| **InBody** | Aba na ficha, ligada por paciente. Entrada de até 12 medições (data, hora, peso, massa muscular, gordura em kg e %, gordura visceral e uma observação) e o botão **Apresentar**: os cinco gráficos de evolução em tela cheia por cima de tudo, com cabeçalho, textos explicativos e rodapé — é o que ele vira para o paciente no atendimento presencial. Esc fecha |
| **Conversores** | Fuso horário (escolhendo o paciente ou o fuso), relógio dos oito países que ele atende marcando quem está dormindo, peso, altura e moeda com a cotação do dia |
| **Bloco de notas** | Post-it flutuante em todas as telas. Minimiza, sobrevive a trocar de tela, recarregar e trocar de computador. Só esvazia no **Concluir** |
| **Agenda** | Calendário mensal; dois cliques num dia criam o compromisso; consultas, follow-ups, cobranças e compromissos pessoais |
| **Financeiro** | Filtro de período (hoje, esta semana, este mês, últimos 30 dias, personalizado). Recebido no período comparado ao anterior, entradas, a receber e vencido. Gráficos de entradas por dia ou mês, por forma de pagamento, por plano e por país, mais a tendência dos últimos 18 meses e a tabela dos mesmos números |
| **Calculadora** | TMB e gasto energético total por Harris-Benedict, as mesmas constantes da planilha. Abre da ficha do paciente já preenchida com sexo, idade, altura e o peso da última consulta. Mostra faixas de déficit e superávit. Fatores de atividade editáveis em Configurações |
| **WhatsApp** | Conexão com a Evolution API (QR na tela), modelos de mensagem com variáveis, fila do que vai sair com edição e cancelamento, e histórico. Automáticas saem no fuso do paciente; de um clique saem dos botões do sistema |
| **Planos** | Além do cadastro: contratos ativos, vendidos e recebido nos últimos 12 meses por plano, taxa de renovação e aviso dos planos sem preço |
| **Formulário público** | Página própria em **form.lucaternes.com.br**, em português, inglês e espanhol, escolhidos pela bandeira. As perguntas ficam no banco e são editadas em Configurações — texto, dica, tipo, ordem, opções e se entra ou não no formulário —, nos três idiomas. Todas as respostas são obrigatórias. Quem preenche vira lead no funil, com anamnese anexada, código gerado, peso virando a primeira ficha de consulta, cidade virando fuso horário e conversores kg↔lb e cm↔pés |

## Regras que vieram da planilha

- Códigos de plano preservados: `30D 30T 30DT 30LE 90D 90T 90DT semestral anual personalizado`
- Forma de pagamento define a moeda: `pix asaas infinity` → BRL · `zelle paypal` → USD
- Parcelas vencem a cada 30 dias a partir do início do contrato
- Escrever "pago" não baixa nada: só o lançamento de pagamento abate a parcela
- Moedas aceitas: BRL, USD, GBP, EUR

## Cotação

Buscada do câmbio do dia (AwesomeAPI) e guardada por data — um pagamento
antigo continua valendo pela taxa da época. O campo é **editável**: se o
Zelle ou a Wise converteram com outra taxa, corrija e o painel bate com o
extrato.

## Unidades e fuso

Ele atende em oito países. Onde houver peso ou altura — cadastro do
paciente, ficha de consulta, calculadora, formulário e a tela de
Conversores — os dois sistemas aparecem lado a lado e um preenche o
outro: kg ↔ lb, cm ↔ pés/polegadas.

O **fuso sai da cidade**. O cadastro tem campo de cidade; digitou, o
sistema procura numa tabela de 656 lugares (todos os estados dos EUA e do
Brasil, as capitais, as cidades grandes e os países onde ele atende) e
grava o fuso certo. É o que resolve o paciente da Califórnia receber
mensagem às 6 da manhã: San Diego vira `America/Los_Angeles`, não
`America/New_York`. Cidade que não está na tabela cai no fuso do país.

## TMB e aniversário

A ficha de consulta calcula a TMB assim que o peso é digitado, usando a
idade **na data da ficha**. Como a idade vem da data de nascimento, o
metabolismo muda sozinho quando o paciente faz aniversário — não existe
valor congelado. A fórmula é a mesma da planilha (Harris-Benedict), a TMB
e o gasto total ficam gravados em cada ficha, e a ficha mostra quanto era
na consulta anterior.

## Objetivos

Deixaram de ser uma lista fixa no código. **Configurações → Objetivos**:
cria, renomeia, traduz para inglês e espanhol e tira da lista. Renomear
arrasta os pacientes e as fichas junto. Objetivo em uso não é apagado, é
desativado — some das listas novas sem sumir do histórico.

## InBody

Aba na ficha de cada paciente, desligada por padrão. Ligada, vira a
planilha que ele já preenche: até 12 medições com data, hora, peso, massa
muscular, gordura em kg e em %, gordura visceral e uma observação (o
"Calça Jeans*"). Campo em branco fica em branco no gráfico, não vira zero.

O botão **Apresentar** abre a tela que ele vira para o paciente: os cinco
gráficos em sequência, cada um com o valor de agora, quanto mudou desde a
primeira medição e o texto explicativo ao lado. Cabe inteira em 1366×768
sem rolar. Esc fecha.

Os textos explicativos, o rodapé de contato e o modelo do aparelho ficam
em **Configurações → Textos do InBody**. O plano e o modelo podem ser
trocados por paciente no botão **Cabeçalho**.

## Bloco de notas

Post-it flutuante no canto, presente em todas as telas. O conteúdo é
salvo no servidor, então sobrevive a recarregar a página e a trocar de
computador. Minimiza no cabeçalho e só esvazia quando ele clica em
**Concluir**.

## Atualizar um banco que já existe

No console do D1, na ordem:

1. `migrate-01.sql` — tabelas do funil
2. `migrate-02.sql` — sexo e altura do paciente, fatores de atividade
3. `migrate-03.sql` — WhatsApp: modelos, fila e fuso do paciente
4. `migrate-04.sql` — textos do formulário público
5. `migrate-05.sql` — anexos da ficha do paciente (exige o R2 do passo 5
   da instalação)
6. `migrate-06.sql` — objetivos, perguntas do formulário em 3 idiomas,
   cidade e fuso do paciente, refeições e TMB na ficha, InBody e o
   endereço do formulário. É o maior: 656 cidades viram fuso horário

Instalação nova não precisa de nenhum: o `schema.sql` já vem completo.

## Credenciais da Evolution

Ficam em **variáveis de ambiente do Pages**, não no banco. Cloudflare →
projeto Pages → Settings → Variables and Secrets → Production, cada uma
marcada como **Secret**:

| Variável | O que é |
|---|---|
| `EVOLUTION_URL` | endereço do servidor, sem barra no fim |
| `EVOLUTION_APIKEY` | a apikey |
| `EVOLUTION_INSTANCIA` | nome da instância |
| `CRON_TOKEN` | senha do disparador (invente uma frase longa) |

Variável só passa a valer no **deploy seguinte**. O que estiver em variável
manda; os campos da tela ficam bloqueados e o banco vira só reserva para
quem ainda não migrou.

## Disparador do WhatsApp

O Pages não tem agendador. Para as mensagens automáticas saírem:

1. Tela **WhatsApp → Conexão e automações**: confira que a Evolution
   aparece vindo das variáveis, ligue o envio automático e copie o
   **token do disparador**
2. Cloudflare → Workers → Create → cole o conteúdo de `worker-cron/index.js`
3. Troque `CRM` pela URL do Pages e `TOKEN` pelo token copiado
4. No Worker: Settings → Triggers → Cron Triggers → `*/15 * * * *`

Abrir a URL do Worker no navegador roda na hora, serve para testar.

Regras de horário: a mensagem sai no fuso do paciente (mapa editável na
tela), respeitando a janela configurada. Se o horário já passou há menos de
3 horas, sai no ciclo seguinte; passou de 3 horas, o evento perdeu a hora e
não envia — ninguém recebe "bom dia" às 19h.

## Formulário público

### O endereço

O formulário tem domínio próprio: **form.lucaternes.com.br**.

1. Cloudflare → projeto Pages → **Custom domains** → *Set up a domain* →
   `form.lucaternes.com.br`
2. Em **Configurações → Endereço do formulário**, deixe o mesmo endereço.
   É ele que entra nos links que o CRM gera e nas mensagens de WhatsApp.

Quem abrir `form.lucaternes.com.br` cai direto no formulário, sem `/form`
na URL — o `functions/_middleware.js` cuida disso. O painel continua só no
domínio do CRM.

### Os três idiomas

Português, inglês e espanhol, pelas bandeiras no topo. A página abre no
idioma do navegador de quem recebeu o link. **Todas as perguntas são
obrigatórias** — ninguém envia pela metade.

### As perguntas

Ficam no banco, não no código. **Configurações → Perguntas do formulário**:
cada pergunta tem texto, dica, tipo, ordem, opções (quando é escolha única)
e as chaves "obrigatória" e "no formulário". Edita-se um idioma de cada vez
pela bandeira; sem tradução, o paciente vê o português. Nome, e-mail,
telefone e país sustentam o cadastro e não podem ser apagados — só
reescritos.

### Mandar para quem já pagou

Na ficha do paciente, botão **Mandar anamnese**. Gera um link com token
daquele paciente: a resposta cai direto na ficha dele, sem criar cadastro
novo nem abrir negociação no funil. O token vale até ser respondido. O
modelo de WhatsApp `anamnese_link` usa a variável `{link_anamnese}`.

Quem preenche entra como **lead** no funil, etapa "chegou no direct", com
origem "Formulário". O código do paciente é gerado na sequência do maior
número já existente. Se a pessoa já estiver na base (mesmo e-mail ou mesmo
nome), a ficha é reaproveitada e a anamnese nova entra ao lado da antiga —
sem paciente duplicado e sem segunda negociação aberta.

Título, texto de abertura e mensagem de agradecimento saem de
Configurações. São em português: em inglês a página usa os textos padrão.

## Ainda não entra nesta fase

- Portal do paciente
- Disparo automático de WhatsApp (hoje o botão abre a conversa com a
  mensagem pronta)
