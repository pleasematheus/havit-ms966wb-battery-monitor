# Crates locais

`alt-icons` e `alt-icons-build` são mantidos como crates separados, mas ficam
versionados neste repositório enquanto ainda não há uma publicação oficial.
Isso mantém builds locais e o GitHub Actions reproduzíveis, sem depender de um
caminho externo à árvore do projeto.

Os crates usam licença dual MIT ou Apache-2.0. A cópia incorporada inclui uma
correção descoberta na integração com o Tauri: o caminho inicial do executável e
o último ícone aplicado são mantidos em cache durante o processo, evitando que
uma segunda troca leia ou modifique o arquivo `.old`.
