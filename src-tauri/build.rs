fn main() {
    alt_icons_build::configure(&[
        ("Default", "icons/icon.ico"),
        ("Warning", "icons/alternate/warning.ico"),
        ("Critical", "icons/alternate/critical.ico"),
        ("Galactic", "icons/alternate/galactic.ico"),
        ("Monochrome", "icons/alternate/monochrome.ico"),
        ("Minimalist", "icons/alternate/minimalist.ico"),
        ("Mythic", "icons/alternate/mythic.ico"),
    ]);
    tauri_build::build()
}
