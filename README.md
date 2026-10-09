# Havit MS966WB Battery Monitor

Aplicativo leve para exibir no tray do Windows a carga do mouse sem fio
**Havit MS966WB** conectado pelo receptor USB 2.4 GHz.

O monitor consulta o receptor diretamente por HID, sem depender do software
oficial da Havit, de Python ou de drivers adicionais.

## Recursos

- porcentagem exata no menu e no tooltip do tray;
- indicação em tempo real de carregamento pelo cabo USB;
- ícone dinâmico com nível e cor da bateria;
- sincronização opcional dos ícones do `hmbm.exe`, da janela e da barra de tarefas
  com a faixa da bateria;
- escolha manual entre ícones original, galáctico, monocromático, minimalista e mítico;
- opção para iniciar oculto junto com o Windows;
- instância única: abrir novamente apenas traz a janela existente para frente;
- notificações nativas com limites inferior e superior ajustáveis, sem alertas repetidos;
- notificações nativas quando o mouse entra ou sai do modo de carregamento;
- controles separados para bateria baixa, limite de carga, início e fim do carregamento;
- atualização automática a cada 60 segundos;
- atualização manual pelo tray ou pela janela;
- mantém a última leitura quando o mouse entra em suspensão;
- fechar a janela mantém o aplicativo no tray;
- funcionamento local e offline, sem telemetria;
- instaladores NSIS (`.exe`) e MSI.

## Compatibilidade

- Windows 10 ou Windows 11;
- Havit MS966WB usando o receptor USB;
- receptor `VID_320F` / `PID_2261`;
- coleção HID `FF1C/0092`.

Bluetooth e conexão USB com fio ainda não são suportados.

## Desenvolvimento

Pré-requisitos:

- [Bun](https://bun.sh/);
- [Rust](https://www.rust-lang.org/tools/install);
- Microsoft C++ Build Tools e WebView2 Runtime, conforme os
  [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
bun install
bun run dev
```

Verificações locais:

```powershell
bun run check
bun run typecheck
cargo test --manifest-path .\src-tauri\Cargo.toml
```

O frontend usa o Biome para lint, formatação e organização de imports. Para
aplicar as correções automaticamente, execute `bun run check:fix`.

O teste de hardware é ignorado por padrão. Com o receptor conectado e o mouse
acordado, ele pode ser executado explicitamente:

```powershell
cargo test --manifest-path .\src-tauri\Cargo.toml reads_battery_from_real_hardware -- --ignored --nocapture
```

## Gerar instaladores

```powershell
bun run build
```

Os artefatos são produzidos em:

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

O executável instalado se chama `hmbm.exe`; o nome exibido para o usuário e
nos instaladores continua sendo **Havit MS966WB Battery Monitor**.

## Ícone alternativo do executável

A opção **Ícone do executável** usa o crate `alt-icons` versão `1.2.0` do crates.io,
tanto no runtime quanto no build, com limpeza automática dos arquivos `.old`.
O build script declara as variantes e aplica a versão padrão ao próprio `hmbm.exe`.
No modo automático, ela acompanha estas três faixas:

- verde para carga acima de 40%;
- amarelo entre 21% e 40%;
- vermelho até 20%.

A troca só ocorre quando a faixa muda. Desativar o modo automático aplica o ícone
selecionado manualmente, com as opções **Original**, **Galáctico**,
**Monocromático**, **Minimalista** e **Mítico**. Como o recurso reescreve os
recursos PE do executável, a pasta de instalação precisa permitir escrita. Uma
janela do Explorer que já estava aberta pode manter o ícone anterior em cache até
o Explorer ser reiniciado.

Enquanto o aplicativo está aberto, a mesma escolha é aplicada imediatamente ao
ícone da janela, à barra de tarefas e ao logotipo no cabeçalho, sem depender do
cache do Explorer.

Modificar o executável altera seu hash e invalida uma eventual assinatura
Authenticode. Por isso o recurso é desativado por padrão e deve permanecer
desativado em distribuições assinadas.

Para diagnóstico, uma variante também pode ser aplicada sem abrir a interface:

```powershell
.\hmbm.exe --set-icon warning
.\hmbm.exe --set-icon critical
.\hmbm.exe --set-icon galactic
.\hmbm.exe --set-icon monochrome
.\hmbm.exe --set-icon minimalist
.\hmbm.exe --set-icon mythic
.\hmbm.exe --set-icon default
```

### Testar a limpeza automática

Compile o executável com a dependência publicada:

```powershell
bun run build --no-bundle
```

Execute `src-tauri/target/release/hmbm.exe`, escolha um ícone diferente e observe o
arquivo `hmbm.exe.<pid>-<contador>.old` na mesma pasta. Encerre o aplicativo pela
opção **Sair** da bandeja: o `.old` deve desaparecer após alguns segundos, sem abrir
o aplicativo novamente. Fechar apenas a janela mantém o processo na bandeja e o
arquivo antigo continua em uso. Encerre outra instância já aberta do monitor antes
de iniciar o executável de testes, pois o aplicativo permite apenas uma instância.

A inicialização existente com `alt_icons::init()` habilita a limpeza por padrão.
Para testar a preservação, substitua essa chamada por
`alt_icons::init_with_options(alt_icons::Options { cleanup_old: false })` e
recompile. O auxiliar usa Windows PowerShell oculto; se a política do sistema o
bloquear, a próxima inicialização tenta novamente a limpeza.

## Integração com o Windows

O controle **Iniciar com o Windows** registra o aplicativo para abrir já oculto
na bandeja. O plugin de instância única impede que o autostart, um atalho ou uma
segunda abertura criem dois monitores simultâneos; nesse caso, a janela da
instância existente é exibida e recebe foco.

Use a seção **Notificações** para ativar ou desativar cada tipo de aviso.
O controle **Bateria baixa** avisa quando a leitura chega ao limite inferior.
O controle **Limite de carga** avisa quando a leitura chega ao limite superior.
Os limites padrão são 20% e 80%. Ajuste cada limite em passos de 5%.
Mantenha o limite inferior abaixo do limite superior.

O monitor salva os limites e os quatro controles neste computador.
As configurações também se aplicam quando o aplicativo inicia oculto.
Configurações antigas mantêm os limites e ativam os quatro tipos de aviso.
Cada alerta de limite ocorre uma vez por ciclo completo. O alerta superior
precisa de uma leitura abaixo do limite antes do primeiro aviso.
Cada alerta volta a ficar disponível quando a leitura chega ao limite oposto.
Ativar um controle não repete eventos que ocorreram com o aviso desativado.
Os limites apenas geram avisos. Eles não interrompem a carga do mouse.

O controle **Início do carregamento** avisa quando o mouse começa a carregar.
O controle **Fim do carregamento** avisa quando o mouse volta a usar a bateria.
Cada aviso ocorre uma vez por mudança de estado. A primeira leitura define
o estado inicial e não gera um aviso de mudança.
Leituras indisponíveis mantêm esse estado. Elas não geram avisos.
Alterar os limites não repete os avisos de carregamento.
O monitor detecta as mudanças na consulta a cada 60 segundos ou na atualização manual.
Durante uma leitura atual de carregamento, o menu e o tooltip da bandeja
exibem **Carregando: N%**. Ao sair desse modo, eles exibem **Bateria: N%**.

No Windows, notificações nativas são associadas corretamente ao aplicativo
instalado. Durante o desenvolvimento, o sistema pode exibir o nome e o ícone do
PowerShell no aviso.

O workflow `build-windows.yml` executa as mesmas validações e publica os
instaladores como artefato de cada execução no GitHub Actions.

## Protocolo HID

A leitura usa um relatório de 64 bytes na coleção privada do receptor:

| Campo | Valor | Finalidade |
|---|---:|---|
| Report ID | `0x04` | canal de configuração |
| Comando | `0x1A` | leitura de estado |
| Comprimento | `0x06` | seis bytes |
| Endereço | `0x0000` | estado de energia |
| Byte 32 | `0x02` | rota do dispositivo sem fio |
| Resposta, byte 8 | `0–100` | porcentagem da bateria |
| Resposta, byte 9 | `0x00` / `0x01` | usando a bateria / carregando pelo cabo |

O aplicativo envia apenas essa consulta de leitura. Ele não altera DPI, RGB,
perfis, firmware ou qualquer outra configuração do mouse.

## Stack

- Tauri 2 + Rust
- React 19 + TypeScript
- Tailwind CSS 4
- shadcn/ui (Radix Nova) + Lucide
- Bun + Vite
- Biome
- `hidapi`
- `alt-icons` publicado no crates.io

## Aviso

Este é um projeto comunitário independente, sem associação com a Havit. Havit
e MS966WB são marcas ou identificações de seus respectivos proprietários.

## Licença

[MIT](LICENSE)
