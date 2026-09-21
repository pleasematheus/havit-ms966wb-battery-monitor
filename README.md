# Havit MS966WB Battery Monitor

Aplicativo leve para exibir no tray do Windows a carga do mouse sem fio
**Havit MS966WB** conectado pelo receptor USB 2.4 GHz.

O monitor consulta o receptor diretamente por HID, sem depender do software
oficial da Havit, de Python ou de drivers adicionais.

## Recursos

- porcentagem exata no menu e no tooltip do tray;
- ícone dinâmico com nível e cor da bateria;
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

O aplicativo envia apenas essa consulta de leitura. Ele não altera DPI, RGB,
perfis, firmware ou qualquer outra configuração do mouse.

## Stack

- Tauri 2 + Rust
- React 19 + TypeScript
- Tailwind CSS 4
- Bun + Vite
- Biome
- `hidapi`

## Aviso

Este é um projeto comunitário independente, sem associação com a Havit. Havit
e MS966WB são marcas ou identificações de seus respectivos proprietários.

## Licença

[MIT](LICENSE)
