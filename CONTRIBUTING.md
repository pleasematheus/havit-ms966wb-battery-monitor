# Contribuindo

Obrigado pelo interesse no projeto.

## Antes de enviar um pull request

1. Instale as dependências com `bun install`.
2. Execute `bun run typecheck`.
3. Execute `bun run build:web`.
4. Execute `cargo fmt --manifest-path .\src-tauri\Cargo.toml -- --check`.
5. Execute `cargo test --manifest-path .\src-tauri\Cargo.toml`.

Não inclua capturas do software oficial, executáveis proprietários, logs HID
com dados desnecessários ou firmware do dispositivo.

Ao investigar outro firmware ou receptor, documente VID, PID, usage page e
usage, mas preserve a consulta como somente leitura.

