# CRM Luca Ternes — Fase 0 + 1

Sistema de controle de consultorias (Brasil e Estados Unidos).
Cloudflare Pages + Pages Functions + D1. Sem CLI: tudo pelo navegador.

## Como subir

**1. Criar o repositório no GitHub**
Suba estes arquivos mantendo a estrutura:

```
schema.sql
schema-uma-linha.sql
migrate-01.sql … migrate-09.sql
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
`schema-uma-linha.sql`: são 78 linhas, cada uma um comando completo.
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

## Importar os dados atuais (planilha oficial)

A base vem da aba **Clientes** da planilha oficial — não da aba CRM, que tem
linhas com `#REF!`, nem da aba Faturamento, que zera os últimos meses.

Regras que a importação aplica, as mesmas que a planilha documenta na aba Config:

- **Identidade é o nome.** O código se repete entre pessoas diferentes, então
  nome igual = renovação: vira um segundo contrato na mesma ficha.
- **A forma de pagamento define a moeda.** Zelle e PayPal em dólar, Pix, Asaas
  e Infinity em real, "Libras- Paypal" em libra, "Euros - paypal" em euro.
- **"Valor recebido R$" está em reais mesmo nos contratos em dólar.** A razão
  entre recebido e cobrado é a taxa que o Luca usou (5,0 · 5,2 · 5,5), e é essa
  taxa que entra no CRM — por isso o total em reais bate com o da planilha.
  Algumas linhas estão anotadas como Pix mas a razão de 5,5 mostra que foram
  cobradas em dólar; a importação corrige a moeda nessas.
- **Plano que só existe na planilha é criado no cadastro**, sem preço, para o
  contrato não ficar órfão na tela de Planos.
- **Contrato encerrado não vira cobrança.** O que sobrou é histórico (desconto,
  acerto por fora), não dívida a perseguir. Parceria e cortesia não geram parcela.

## Importar os dados atuais

Tela **Configurações → Importar dados**. O arquivo é enviado em blocos
automaticamente, não precisa dividir nada.

1. Tipo **Pacientes e contratos** → arquivo `crm-luca-pacientes.json`
   (417 linhas da aba Clientes: cadastro, plano, datas, valores, parcelas,
   a taxa de câmbio de cada contrato e os pagamentos já recebidos)
2. Tipo **Anamneses** → arquivo `seed/crm-luca-anamneses.json`
   (340 respostas do formulário BR)

   A anamnese não entra só como anexo: ela **completa a ficha**. Altura,
   nascimento, CPF, Instagram, e-mail, telefone, profissão, endereço e
   objetivo preenchem o que estiver em branco no cadastro — o que o Luca
   digitou à mão continua valendo. O peso informado vira a primeira ficha
   de consulta de quem ainda não tem nenhuma.

   **Como a resposta acha o paciente.** O COD do Luca é o número da linha
   na planilha de respostas, mas a numeração não é uniforme: no começo o
   COD é a linha menos um, e a partir de certo ponto passa a ser a linha.
   Existem ainda dois formulários, BR e US, cada um com sua contagem — o
   COD 100 de um não é o COD 100 do outro. Por isso cada resposta só é
   ligada quando há prova: o primeiro nome bate com o do cliente, ou o
   contrato começa até 7 dias depois do formulário. Duas respostas de
   pessoas diferentes disputando o mesmo paciente derrubam a mais fraca.
   Sem prova, a resposta entra no sistema sem dono — é melhor do que
   pendurar a ficha de saúde de alguém na pessoa errada.

   **Fichas sem dono.** Elas não somem: a tela de Pacientes mostra um aviso
   com a contagem, e o botão *Ver e ligar* abre a lista com nome, e-mail,
   telefone e data de cada resposta. Em cada linha ele escolhe o paciente e
   clica em Ligar — a ficha gruda, o cadastro é completado e a primeira
   consulta é criada com o peso do formulário, igual à importação. O × ao
   lado descarta a resposta que não é de ninguém (lead que não fechou).

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

## Scroll não mexe em data nem hora

Campos de data, hora e número perdem o foco quando a roda do mouse passa
por cima: antes, rolar a página com o cursor sobre a data trocava o valor
sem ele perceber. Teclado e setas continuam funcionando normalmente.

## Cotação

Guardada por data — um pagamento antigo continua valendo pela taxa da
época. O campo é **editável**: se o Zelle ou a Wise converteram com outra
taxa, corrija e o painel bate com o extrato.

### De onde vem

São cinco fontes públicas, sem chave, na fila; vale a primeira que
responder, e o painel diz qual foi:

1. **Banco Central (PTAX)** — a oficial em reais, sem cota. Publica em dia
   útil, em boletins ao longo do dia; a busca pega o último boletim dos
   oito dias anteriores, então feriado e fim de semana não deixam o painel
   sem câmbio
2. **AwesomeAPI** — passou a limitar por cota e responde `429` quando
   estoura, por isso saiu da frente
3. **Frankfurter (BCE)** — dólar, euro, libra, franco, dólar canadense e
   australiano, iene; tem série histórica, mas não publica fim de semana
   nem feriado
4. **ExchangeRate-API** — cobre moedas fora da lista do BCE, como o peso
   argentino
5. **currency-api** — última reserva

A linha acima do campo diz **de que dia** é a cotação. Em dia útil com
boletim publicado ela diz "de hoje"; no sábado diz "de sexta — a mais
recente publicada", em vez de passar o número de sexta como se fosse de
agora.

Vale para a cotação de agora e para a série histórica que a importação usa.
Se nenhuma responder, o painel **não inventa**: o campo fica vazio, com o
aviso de digitar a taxa à mão. Nunca aparece `R$ 0,0000`, que faria toda
conversão dar zero.

Pagamento em moeda estrangeira **sem cotação é recusado** — antes ele
entraria convertido por 1, e US$ 250 viraria R$ 250 no faturamento. Para
conferir se algum pagamento antigo pegou isso, rode
`conferir-cotacao.sql`: lista pagamento em moeda estrangeira com cotação
ausente, zerada ou igual a 1.

Na tela de **Conversores**, a moeda puxa a cotação **de agora**, não a do
fechamento de ontem: é com ela que ele fecha preço na call. A linha de
cima diz de qual fonte veio e, quando a fonte informa, a que horas foi
medida; tem botão de atualizar e se renova sozinha a cada 5 minutos com a
tela aberta. Sem resposta de nenhuma fonte, usa a última conhecida e diz
de que dia é — em vez de mostrar um número velho como se fosse de hoje.
Além de dólar, euro e libra, dá para converter dólar canadense, franco
suíço, dólar australiano, peso argentino e iene.

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

## Nada se perde por clique errado

Toda tela de digitação — ficha de consulta, cadastro de paciente, medição do
InBody — pergunta antes de fechar se houver coisa não salva, seja no X, no
Esc, no clique fora ou no Cancelar. Salvar fecha direto, sem pergunta.

A **calculadora abre por cima da ficha**, não no lugar dela: volta e está
tudo como estava. Ela já abre com o peso que ele acabou de digitar e com a
idade da data daquela consulta, e o botão **Usar na ficha** devolve o peso e
o nível de atividade para a ficha.

## TMB e aniversário

A ficha de consulta calcula a TMB assim que o peso é digitado, usando a
idade **na data da ficha**. Como a idade vem da data de nascimento, o
metabolismo muda sozinho quando o paciente faz aniversário — não existe
valor congelado. A fórmula é a mesma da planilha (Harris-Benedict), a TMB
e o gasto total ficam gravados em cada ficha, e a ficha mostra quanto era
na consulta anterior.

A **altura** fica na própria ficha, em cm e em pés/polegadas. Vem do
cadastro, e corrigir ali corrige o cadastro ao salvar — é na consulta que
ele mede. Campo em branco não apaga a altura que já existia.

## O dia do paciente na ficha

Treino e refeições são uma lista só, na ordem do dia. Cada linha tem nome,
**horário** e texto, e se arrasta pelo ⋮⋮ para cima ou para baixo — dá para
pôr o treino entre o café e o almoço, ou ter dois treinos no mesmo dia.
Os botões **+ Treino** e **+ Refeição** ficam fixos no rodapé do modal,
junto com Calculadora, Imprimir, Cancelar e Salvar.

Por baixo, o treino continua indo também para a coluna `treino` (com o
horário na frente), que é o que as fichas antigas e a impressão leem.

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

## Impressão do InBody

Na apresentação em tela cheia, o botão **Salvar em PDF** abre a impressão
com a folha deitada em A4, sem a animação e sem os botões — é só escolher
*Salvar como PDF* no diálogo. Os valores não saem embaçados mesmo com o
olho ligado.

## Tarefas

Caixa flutuante no canto, presente em todas as telas. Cada linha é uma
tarefa com dia e hora opcionais; o check risca e tira da lista, e o que
foi concluído fica guardado no bloco "Concluídas" até ele mandar apagar.
O cabeçalho avisa quantas estão abertas e quantas são para hoje, e o que
venceu aparece em vermelho.

Arrasta-se pelo cabeçalho, sem sair da janela, e a posição fica lembrada
no navegador. Minimiza com um clique no cabeçalho. Tudo é salvo no
servidor: sobrevive a recarregar e a trocar de computador. Quem já usava
o bloco de notas antigo não perde nada — cada linha vira uma tarefa na
primeira vez que a tela abre.

## Filtro por mês de entrada

Na tela de Pacientes, o filtro **Entrada** lista os meses em que entraram
pacientes, com a contagem de cada um, e tem a opção **Recentes (últimos
60 dias)**. Entrada é o início do primeiro contrato; quem nunca fechou
conta pela data de cadastro. Esse filtro atravessa os segmentos — "quem
entrou em agosto" é uma pergunta sobre a base inteira — e a coluna de
destaque passa a mostrar a data de entrada.

## Vendeu numa call: o pré-cadastro

O botão **Vendeu! Pré-cadastro**, no topo do Início, é para ser preenchido
durante a conversa, enquanto o cliente ainda está na linha. Pede o
essencial — quem é, WhatsApp, cidade — e, principalmente, **o plano e a
forma de pagamento que acabaram de ser fechados**.

**O único campo obrigatório é o plano.** Na call o plano fecha antes de o
nome completo aparecer. Sem nome, o paciente entra como *Sem nome · COD
123* e o nome de verdade chega sozinho quando ele responder o formulário —
o rótulo é substituído, não duplicado. Se só o apelido for preenchido, é
ele que vira o nome.

Ao salvar, num clique só:

- o paciente entra como **ativo** (se já era lead, aproveita a ficha, não
  duplica);
- o **contrato é criado** com o plano, o valor, a moeda e as parcelas;
- a negociação que estava aberta no funil **fecha** apontando para esse
  contrato;
- sai o **link do formulário**, já preso a esse paciente, com botão de
  copiar e de mandar no WhatsApp.

Escolher o plano preenche o valor sozinho; escolher Zelle ou PayPal troca
a moeda para dólar e o valor acompanha. Se o plano não tiver preço na
moeda escolhida, o campo avisa em vez de ficar em branco. Valor zerado
pede confirmação — sem valor não nasce cobrança nenhuma.

**O plano não aparece no formulário do paciente.** Quem chega por esse
link não vê lista de planos nem o nome de nenhum outro: o que foi vendido
fica com o Luca. O `migrate-08.sql` desliga essa pergunta; se um dia ele
quiser oferecê-la a lead frio, é só reativar em *Configurações →
Perguntas*.

O mesmo botão está dentro do modal de agendamento da agenda: a call
terminou em venda, ele clica em **Vendeu!** ali mesmo e o pré-cadastro já
abre preenchido — com o paciente do compromisso, ou, se não houver um
escolhido, com o nome tirado do título (sem o "Call -" na frente) e a
observação do agendamento como observação da venda.

No Início há o bloco **Vendeu e falta a ficha**: quem pagou e ainda não
respondeu o formulário, com o tempo desde o fechamento e o botão de mandar
o link de novo — é o mesmo link, continua valendo.

## Agenda

Cabeçalho dos dias da semana e as células do mês são **uma grade só**. Eram
duas grades irmãs com as mesmas colunas, e bastava um compromisso de título
comprido esticar uma coluna para o "QUI" parar em cima de quarta: as
colunas usavam `1fr`, que cresce com o conteúdo. Agora é
`minmax(0,1fr)` numa grade única — não há duas coisas para manter em sincronia.

Junto disso: o cabeçalho gruda no topo ao rolar, o dia da semana de hoje
fica em dourado, os dias de outro mês viram células fantasma (a semana se lê
inteira, sem buraco), sábado e domingo têm fundo levemente diferente e há um
botão **Hoje** para voltar ao mês atual.

Quando o título do compromisso já contém o nome do paciente, o nome não é
repetido ao lado — em coluna de 150px isso cortava os dois. No celular a
grade vira uma coluna, cada dia mostra a própria sigla e os títulos quebram
em linha em vez de cortar.

## Calorias da dieta e saldo calórico

O campo **Calorias da dieta** fica na ficha de consulta e na visão geral do
paciente — nos dois lugares ele edita, e o que ele digitar num aparece no
outro. Preenchido na consulta, atualiza também o cadastro, do mesmo jeito
que o objetivo.

Ao lado dele, o **saldo calórico**: a dieta menos o gasto energético total,
com a porcentagem sobre o gasto.

> Gasto 2.000 kcal/dia · dieta 1.400 kcal/dia
> → **▼ 600 kcal de déficit · 30% abaixo do gasto**

Acima do gasto é superávit (▲), igual é manutenção. A tela mostra o fato e
não julga: déficit não é bom nem ruim por si — quem diz isso é o objetivo
do paciente. Por isso cada caso tem seta e palavra, não só cor.

Na visão geral do paciente, TMB e gasto vêm da última ficha de consulta com
peso e altura; o campo de calorias salva ali mesmo, sem precisar abrir uma
consulta.

## Os números da tela, por pessoa

Os cards de Início e de Financeiro — recebido, a receber, vencido,
entradas, ativos, fechamento — abrem ao clique e mostram **quem compõe
aquele número**: nome, data, valor, atalho para a ficha e, quando é
parcela em aberto, o botão de receber ali mesmo.

## O olho

O botão **Ocultar valores**, no menu da esquerda, embaça faturamento,
valores e totais da tela inteira. É para o atendimento presencial, quando
o paciente enxerga o monitor. As contagens continuam à mostra — número de
parcelas não é faturamento. A escolha fica lembrada no navegador, e na
impressão os valores saem normais.

## Ordenar e achar paciente

Na tela de Pacientes, o seletor **Ordenar por** troca entre nome (A→Z e
Z→A), data de entrada e COD, nos dois sentidos. O COD é comparado como
número: o 7 vem antes do 70, não depois.

Onde se escolhe um paciente — hoje no compromisso da agenda — o campo é de
digitar, não lista suspensa: procura por **COD, nome ou apelido**, em
qualquer pedaço da palavra e sem precisar de acento, com as setas e o
Enter funcionando. COD exato vem primeiro.

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
7. `migrate-07.sql` — lista de tarefas (substitui o bloco de notas)
8. `migrate-08.sql` — tira a escolha de plano do formulário do paciente
   (um comando só)
9. `migrate-09.sql` — calorias da dieta na ficha e no cadastro (dois
   comandos)

Se estiver em dúvida sobre quais já rodaram, o próprio sistema diz: ao
entrar no painel aparece uma faixa amarela no topo nomeando as migrações
que faltam, e o botão **O que falta** mostra tabela por tabela e campo por
campo — além de avisar se o R2 ainda não está ligado. Enquanto falta
migração, o CRM continua abrindo: o que depende dela fica de fora, em vez
de derrubar a tela.

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
