# CRM Luca Ternes — Fase 0 + 1

Sistema de controle de consultorias (Brasil e Estados Unidos).
Cloudflare Pages + Pages Functions + D1. Sem CLI: tudo pelo navegador.

## Como subir

**1. Criar o repositório no GitHub**
Suba estes arquivos mantendo a estrutura:

```
schema.sql
schema-uma-linha.sql
functions/api/[[path]].js
public/index.html
public/app.js
seed/crm-luca-anamneses.json
```

**2. Criar o banco D1**
Cloudflare → Workers & Pages → D1 → *Create database* → nome `crm-luca`.
Abra a aba **Console** do banco, cole todo o conteúdo de `schema.sql` e execute.
O arquivo não tem comentários — o console do D1 rejeita `--`.

Se o console reclamar de vários comandos de uma vez, use
`schema-uma-linha.sql`: são 29 linhas, cada uma um comando completo.
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

**5. Primeiro acesso**
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
| **Ficha de consulta** | O caderno do Luca em tela: COD, data, peso em kg **e** lbs (um calcula o outro), treino, as 5 refeições, ceia e observações; mostra a variação desde a última medição; imprime no mesmo formato |
| **Agenda** | Calendário mensal; dois cliques num dia criam o compromisso; consultas, follow-ups, cobranças e compromissos pessoais |
| **Financeiro** | Filtro de período (hoje, esta semana, este mês, últimos 30 dias, personalizado). Recebido no período comparado ao anterior, entradas, a receber e vencido. Gráficos de entradas por dia ou mês, por forma de pagamento, por plano e por país, mais a tendência dos últimos 18 meses e a tabela dos mesmos números |
| **Calculadora** | TMB e gasto energético total por Harris-Benedict, as mesmas constantes da planilha. Abre da ficha do paciente já preenchida com sexo, idade, altura e o peso da última consulta. Mostra faixas de déficit e superávit. Fatores de atividade editáveis em Configurações |
| **WhatsApp** | Conexão com a Evolution API (QR na tela), modelos de mensagem com variáveis, fila do que vai sair com edição e cancelamento, e histórico. Automáticas saem no fuso do paciente; de um clique saem dos botões do sistema |
| **Planos** | Além do cadastro: contratos ativos, vendidos e recebido nos últimos 12 meses por plano, taxa de renovação e aviso dos planos sem preço |
| **Formulário público** | Página em `/form`, português e inglês, com os campos da anamnese do Luca. Quem preenche vira lead no funil, com anamnese anexada, código gerado, peso virando a primeira ficha de consulta e conversores kg↔lb e cm↔pés |

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

## Unidades

Ele atende em oito países. Onde houver peso ou altura — cadastro do
paciente, ficha de consulta, calculadora — os dois sistemas aparecem lado
a lado e um preenche o outro: kg ↔ lb, cm ↔ pés/polegadas.

## Atualizar um banco que já existe

No console do D1, na ordem:

1. `migrate-01.sql` — tabelas do funil
2. `migrate-02.sql` — sexo e altura do paciente, fatores de atividade
3. `migrate-03.sql` — WhatsApp: modelos, fila e fuso do paciente
4. `migrate-04.sql` — textos do formulário público

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

O link é `<sua-url>/form`. Substitui os dois Google Forms: um endereço só,
que se adapta ao idioma do navegador e pode ser trocado no topo da página.

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
