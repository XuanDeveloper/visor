# Visor

Painel de desktop para acompanhar os containers Docker de um servidor remoto,
direto do Windows. Fica na bandeja como o ZeroTier: a janela fecha, a vigilância
continua, e o ícone muda de cor quando algo cai.

Conecta por **SSH até o `docker.sock` do servidor** — nenhuma porta exposta,
nenhum daemon reconfigurado, nenhum certificado para gerar. Usa a chave SSH que
você já tem.

---

## Como rodar

```bash
npm install
npm run dev      # app em modo desenvolvimento
npm run build    # typecheck + bundle de produção
npm run dist     # instalador .exe para Windows
```

Na primeira execução o app pede o servidor. Se ele já estiver no seu
`~/.ssh/config`, aparece como sugestão de um clique: host, porta, usuário e
caminho da chave vêm prontos de lá.

Nada de servidor fica no repositório. As preferências são gravadas em
`%APPDATA%/visor/visor.json`, na sua máquina.

### O que o servidor precisa ter

1. Docker rodando — `systemctl status docker`
2. Seu usuário SSH no grupo `docker` — `groups | grep docker`

Se o segundo não bater: `sudo usermod -aG docker $USER` e reconecte a sessão.
Nada mais precisa ser instalado do outro lado.

---

## A interface

O Visor tem **duas superfícies**, servidas pelo mesmo bundle:

**O painel da bandeja** (`?mode=popover`, 416×672) é a forma principal. Clique
esquerdo no ícone, ou `Ctrl+Shift+D` de qualquer lugar, e ele abre ancorado
ali — no espírito dos menu bar apps do macOS. Mostra o placar do servidor, as
stacks numeradas e, abertos automaticamente, os grupos com defeito.

Dá para operar inteiro sem o mouse:

| Tecla | O que faz |
|---|---|
| `↑` `↓` | Anda pela lista (grupos e serviços na mesma sequência) |
| `→` `←` | Abre e fecha o grupo sob o cursor |
| `Enter` | No grupo alterna; no serviço abre o detalhe na janela |
| `R` | Reinicia o serviço sob o cursor |
| `S` | Para, ou inicia se estiver parado |
| letras | Começa a filtrar — não há campo de busca fixo |
| `Esc` | Desfaz a busca; se não houver busca, fecha |

Reiniciar e parar também estão inline em cada linha, no hover. O motivo mais
comum de abrir o painel é justamente esse, e mandar você para a janela grande
só para isso seria um desvio sem propósito.

**A janela completa** (`?mode=panel`, 1180×760) só existe quando você pede: o
botão de expandir no painel, ou um clique em qualquer serviço. É onde cabem
logs, inspetor e busca.

As duas organizam por **stack do Compose** (label
`com.docker.compose.project`), porque é assim que você pensa nos serviços.
Containers soltos caem em *Avulsos*.

O dispositivo central é o **rail**: a linha vertical que costura os serviços de
uma stack. Ele fica neutro quando tudo está no ar e assume a cor do problema
exatamente no trecho defeituoso — você acha a falha pela forma, antes de ler
qualquer palavra.

Cada container é um nó no rail. **Forma e cor** comunicam o estado, para que a
leitura não dependa de distinguir verde de âmbar:

| Nó | Estado | Significado |
|---|---|---|
| ● com anel respirando | no ar | rodando, healthcheck passando (ou ausente) |
| ● com anel tracejado | degradado | rodando, mas healthcheck falhando — ou pausado |
| ◌ girando | em transição | subindo, reiniciando ou recém-criado |
| ○ vazado | parado | saiu com código 0 (inclui init de compose que cumpriu seu papel) |
| ✕ | falhou | saiu com erro, ou container morto |

Outras peças:

- **Constelação** (barra lateral) — um ponto por container, ordenado por
  gravidade. O estado inteiro do servidor em um bloco de 2 cm.
- **Inspetor** — clique numa linha: CPU, memória e rede com sparklines, ficha
  técnica e logs ao vivo com `stderr` destacado e filtro.
- **Busca** (`Ctrl K`) — cobre nome, serviço, stack e imagem; abre todas as
  stacks enquanto estiver ativa.
- **Ações** — iniciar, parar, reiniciar e pausar, no hover da linha ou no inspetor.

### Design

A direção é **instrumento de rack**: denso, catalogado, silencioso. Cor
saturada aparece só quando carrega significado de estado. O documento completo
— paleta, tipografia, componentes, wireframes, motion — está em
[`ui-kit/Visor-UI-Kit.pdf`](ui-kit/Visor-UI-Kit.pdf) (12 páginas).

O kit é gerado a partir de `ui-kit/ui-kit.html`, que reusa os mesmos tokens do
app: os componentes ali são renderizados, não fotografados.

### Divulgação

[`LANCAMENTO.md`](LANCAMENTO.md) reúne pesquisa sobre onde e como lançar uma
ferramenta assim (r/selfhosted, Show HN, r/docker), o que faz esse tipo de post
funcionar, e rascunhos prontos para adaptar.

### Em segundo plano

O Visor se registra para **subir junto com o Windows** (ligado por padrão),
iniciando direto na bandeja com `--hidden` — quem acabou de ligar o PC não pediu
uma janela na cara. Fechar a janela esconde; só "Sair" no menu da bandeja
encerra de fato.

O registro no login **só vale no app instalado**. Em `npm run dev` o executável
é o `electron.exe` do `node_modules`, e registrar isso criaria uma entrada
quebrada no registro do usuário — então o app simplesmente não mexe nisso fora
do pacote.

### Avisos

Notificação nativa do Windows quando um container **cai**, fica **degradado** ou
entra em **loop de reinício** (3+ reinícios em 5 minutos). A régua é alta de
propósito: alerta que se aprende a ignorar não vale nada. Há cooldown de 2
minutos por container, e nada é disparado logo após uma reconexão — senão o
retorno de uma queda de rede viraria uma avalanche.

Clicar na notificação abre a janela. Tudo configurável nos ajustes.

---

## Licença

MIT. É um projeto pessoal publicado como está: use, modifique e redistribua à
vontade. Não há compromisso de suporte ou de aceitar pedidos de feature.

---

## Arquitetura

```
src/
├── shared/types.ts     Contrato único entre os três processos
├── main/
│   ├── tunnel.ts       SSH → direct-streamlocal → endpoint TCP local
│   ├── sshConfig.ts    Lê ~/.ssh/config para sugerir servidores
│   ├── docker.ts       dockerode sobre o túnel: lista, stats, logs, /events
│   ├── watcher.ts      Compara snapshots e decide o que merece notificação
│   ├── config.ts       Preferências persistidas
│   └── index.ts        Janela, bandeja, IPC, laços de atualização
├── preload/index.ts    contextBridge tipado — o renderer nunca vê ipcRenderer
└── renderer/           React 19, sem framework de UI
```

**Por que o túnel e não o CLI.** Encaminhar o socket Unix por SSH
(`direct-streamlocal@openssh.com`) dá acesso à Docker Engine API inteira. Isso
vale os streams de `/events` (a UI reage a mudanças na hora, sem esperar o
próximo poll), `/stats` e `/logs` — nada disso existiria parseando a saída do
`docker ps`.

O túnel reconecta sozinho com backoff exponencial (1s → 30s) e traduz os erros
crus do SSH para mensagens acionáveis. Erro de configuração não entra em
retry: ele para e espera você.

**Duas cadências.** A lista atualiza a cada 4s (mais os eventos do Docker, que
chegam na hora); as stats amostram em intervalo próprio, configurável. Misturar
as duas deixaria a lista lenta ou as stats caras sem motivo.

---

## Design

Direção: **painel de instrumentos silencioso**. Grafite arroxeado em toda a
interface, tipografia monoespaçada (JetBrains Mono) como face dominante, e cor
saturada reservada para significado de estado — nunca decoração. A paleta base é
`#1e202c` / `#60519b` / `#31323e` / `#bfc0d1`.

Todos os valores passam por tokens em `src/renderer/styles/tokens.css`. Um
`data-state` no elemento pai resolve a cromagem dos filhos via `--state`, então
nenhum componente conhece a paleta.

---

## Ferramentas de desenvolvimento

```bash
# Confere o caminho SSH → Docker fora do Electron (só leitura)
node scripts/probe.mjs [passphrase]

# Trabalha no visual no navegador, com dados falsos realistas
npx vite --config vite.preview.config.ts
#   ?view=inspector | search | settings | collapsed abre direto num estado

# Lê o que o app REAL renderizou e salva uma captura
#   1) electron . --remote-debugging-port=9222
#   2) node scripts/inspect-live.mjs 9222 live.png

# Regera os ícones da bandeja e do app (PNG escrito à mão, sem dependências)
npm run icons

# Mede o contraste real no app em execução — o preview não serve para isso,
# porque o app carrega o bundle de out/
#   1) electron . --remote-debugging-port=9222
#   2) node scripts/check-contrast.mjs popover
#      node scripts/check-contrast.mjs panel

# Captura as telas em viewport exata (--window-size do headless não garante)
#   1) msedge --headless=new --remote-debugging-port=9333 about:blank
#   2) node scripts/shoot-ui.mjs 9333 ui-kit/telas 2

# Regera o PDF do UI kit
#   msedge --headless=new --no-pdf-header-footer #     --print-to-pdf=ui-kit/Visor-UI-Kit.pdf file:///.../ui-kit/ui-kit.html
```
