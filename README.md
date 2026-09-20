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
| **Pacientes** | Busca por COD, nome ou apelido; filtros de situação, objetivo e país; ficha completa com abas de visão geral, consultas, financeiro e anamnese |
| **Ficha de consulta** | O caderno do Luca em tela: COD, data, peso em kg **e** lbs (um calcula o outro), treino, as 5 refeições, ceia e observações; mostra a variação desde a última medição; imprime no mesmo formato |
| **Agenda** | Calendário mensal; dois cliques num dia criam o compromisso; consultas, follow-ups, cobranças e compromissos pessoais |
| **Financeiro** | Recebimentos por mês e por moeda, contratos por plano, parcelas em aberto com botão de WhatsApp e de baixa |
| **Planos** | Cadastro com código, duração, preço BRL e USD, consultas incluídas, cadência de follow-up e regras |

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

## Atualizar um banco que já existe

Quem já rodou o `schema.sql` antigo roda `migrate-01.sql` no console do D1 —
ele cria as tabelas do funil sem tocar nos dados. Instalação nova não precisa:
o `schema.sql` já vem completo.

## Ainda não entra nesta fase

- Formulário público novo integrado (F2)
- Portal do paciente
- Disparo automático de WhatsApp (hoje o botão abre a conversa com a
  mensagem pronta)
