fn main() {
    alt_icons_build::configure(&[
        ("Default", "icons/icon.ico"),
        ("Warning", "icons/alternate/warning.ico"),
        ("Critical", "icons/alternate/critical.ico"),
    ]);
    tauri_build::build()
}
