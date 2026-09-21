# Contribuindo

Obrigado pelo interesse no projeto.

## Antes de enviar um pull request

1. Instale as dependências com `bun install`.
2. Execute `bun run check`.
3. Execute `bun run typecheck`.
4. Execute `bun run build:web`.
5. Execute `cargo fmt --manifest-path .\src-tauri\Cargo.toml -- --check`.
6. Execute `cargo test --manifest-path .\crates\alt-icons\Cargo.toml`.
7. Execute `cargo test --manifest-path .\src-tauri\Cargo.toml`.
8. Para validar a troca real do recurso PE, execute
   `cargo test --manifest-path .\src-tauri\Cargo.toml swaps_executable_icon_and_restores_the_default -- --ignored`.

Não inclua capturas do software oficial, executáveis proprietários, logs HID
com dados desnecessários ou firmware do dispositivo.

Ao investigar outro firmware ou receptor, documente VID, PID, usage page e
usage, mas preserve a consulta como somente leitura.
