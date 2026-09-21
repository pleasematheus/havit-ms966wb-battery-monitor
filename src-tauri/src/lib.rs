use hidapi::HidApi;
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, Window, WindowEvent, Wry,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

alt_icons::include_icons!();

const VID: u16 = 0x320F;
const PID: u16 = 0x2261;
const USAGE_PAGE: u16 = 0xFF1C;
const USAGE: u16 = 0x0092;
const REPORT_ID: u8 = 0x04;
const READ_COMMAND: u8 = 0x1A;
const WIRELESS_ROUTE: u8 = 0x02;
const REPORT_LENGTH: usize = 64;
const TRAY_ID: &str = "battery-monitor";
const POLL_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum BatteryStatus {
    Available,
    Sleeping,
    NotFound,
    Busy,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatterySnapshot {
    percentage: Option<u8>,
    last_known_percentage: Option<u8>,
    status: BatteryStatus,
    message: String,
    updated_at: u64,
    last_success_at: Option<u64>,
}

impl BatterySnapshot {
    fn initial() -> Self {
        Self {
            percentage: None,
            last_known_percentage: None,
            status: BatteryStatus::Sleeping,
            message: "Aguardando a primeira leitura…".into(),
            updated_at: now_ms(),
            last_success_at: None,
        }
    }
}

struct BatteryStore {
    snapshot: Mutex<BatterySnapshot>,
    refresh_lock: tokio::sync::Mutex<()>,
}

impl BatteryStore {
    fn new() -> Self {
        Self {
            snapshot: Mutex::new(BatterySnapshot::initial()),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }
}

struct TrayItems {
    status: MenuItem<Wry>,
}

struct ExecutableIconStore {
    update_lock: tokio::sync::Mutex<()>,
}

impl ExecutableIconStore {
    fn new() -> Self {
        Self {
            update_lock: tokio::sync::Mutex::new(()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutableIconResult {
    icon: String,
    changed: bool,
}

enum ReadFailure {
    Sleeping,
    NotFound,
    Busy,
    Protocol(String),
    Hid(String),
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn make_read_request() -> [u8; REPORT_LENGTH] {
    let mut packet = [0_u8; REPORT_LENGTH];
    packet[0] = REPORT_ID;
    packet[3] = READ_COMMAND;
    packet[4] = 6;
    packet[5] = 0;
    packet[6] = 0;
    packet[7] = 0;
    packet[32] = WIRELESS_ROUTE;

    let checksum: u16 = packet[3..32].iter().map(|value| u16::from(*value)).sum();
    packet[1] = checksum as u8;
    packet[2] = (checksum >> 8) as u8;
    packet
}

fn query_battery() -> Result<u8, ReadFailure> {
    let api = HidApi::new().map_err(|error| ReadFailure::Hid(error.to_string()))?;
    let info = api
        .device_list()
        .find(|info| {
            info.vendor_id() == VID
                && info.product_id() == PID
                && info.usage_page() == USAGE_PAGE
                && info.usage() == USAGE
        })
        .ok_or(ReadFailure::NotFound)?;

    let device = info.open_device(&api).map_err(|_| ReadFailure::Busy)?;
    let request = make_read_request();
    let written = device
        .write(&request)
        .map_err(|error| ReadFailure::Hid(error.to_string()))?;
    if written != REPORT_LENGTH {
        return Err(ReadFailure::Protocol(format!(
            "envio incompleto: {written} de {REPORT_LENGTH} bytes"
        )));
    }

    let mut response = [0_u8; REPORT_LENGTH];
    let received = device
        .read_timeout(&mut response, 3_000)
        .map_err(|error| ReadFailure::Hid(error.to_string()))?;
    if received == 0 {
        return Err(ReadFailure::Sleeping);
    }
    if received != REPORT_LENGTH {
        return Err(ReadFailure::Protocol(format!(
            "resposta com {received} bytes; esperados {REPORT_LENGTH}"
        )));
    }
    if response[0] != REPORT_ID {
        return Err(ReadFailure::Protocol(format!(
            "report ID inesperado: 0x{:02X}",
            response[0]
        )));
    }
    if matches!(response[3], 0xFE | 0xFF) || matches!(response[7], 0xFE | 0xFF) {
        return Err(ReadFailure::Sleeping);
    }
    if response[3] != READ_COMMAND {
        return Err(ReadFailure::Protocol(format!(
            "comando inesperado na resposta: 0x{:02X}",
            response[3]
        )));
    }

    let percentage = response[8];
    if percentage > 100 {
        return Err(ReadFailure::Protocol(format!(
            "porcentagem inválida: {percentage}"
        )));
    }
    Ok(percentage)
}

fn snapshot_from_result(
    previous: &BatterySnapshot,
    result: Result<u8, ReadFailure>,
) -> BatterySnapshot {
    let updated_at = now_ms();
    match result {
        Ok(percentage) => BatterySnapshot {
            percentage: Some(percentage),
            last_known_percentage: Some(percentage),
            status: BatteryStatus::Available,
            message: "Leitura recebida diretamente do receptor USB.".into(),
            updated_at,
            last_success_at: Some(updated_at),
        },
        Err(ReadFailure::Sleeping) => BatterySnapshot {
            percentage: None,
            last_known_percentage: previous.last_known_percentage,
            status: BatteryStatus::Sleeping,
            message: "O mouse está dormindo ou desligado. Mova-o para atualizar.".into(),
            updated_at,
            last_success_at: previous.last_success_at,
        },
        Err(ReadFailure::NotFound) => BatterySnapshot {
            percentage: None,
            last_known_percentage: previous.last_known_percentage,
            status: BatteryStatus::NotFound,
            message: "Receptor USB VID_320F/PID_2261 não encontrado.".into(),
            updated_at,
            last_success_at: previous.last_success_at,
        },
        Err(ReadFailure::Busy) => BatterySnapshot {
            percentage: None,
            last_known_percentage: previous.last_known_percentage,
            status: BatteryStatus::Busy,
            message: "Interface HID ocupada. Feche o aplicativo oficial da Havit.".into(),
            updated_at,
            last_success_at: previous.last_success_at,
        },
        Err(ReadFailure::Protocol(details)) | Err(ReadFailure::Hid(details)) => BatterySnapshot {
            percentage: None,
            last_known_percentage: previous.last_known_percentage,
            status: BatteryStatus::Error,
            message: format!("Falha ao consultar o receptor: {details}"),
            updated_at,
            last_success_at: previous.last_success_at,
        },
    }
}

async fn refresh_and_publish(app: AppHandle) -> BatterySnapshot {
    let store = app.state::<BatteryStore>();
    let _refresh_guard = store.refresh_lock.lock().await;
    let result = tauri::async_runtime::spawn_blocking(query_battery)
        .await
        .unwrap_or_else(|error| Err(ReadFailure::Hid(error.to_string())));

    let previous = store.snapshot.lock().unwrap().clone();
    let snapshot = snapshot_from_result(&previous, result);
    *store.snapshot.lock().unwrap() = snapshot.clone();

    update_tray(&app, &snapshot);
    let _ = app.emit("battery-updated", snapshot.clone());
    snapshot
}

fn tray_label(snapshot: &BatterySnapshot) -> String {
    match (snapshot.percentage, snapshot.last_known_percentage) {
        (Some(level), _) => format!("Bateria: {level}%"),
        (None, Some(level)) => format!("Mouse dormindo · última leitura: {level}%"),
        (None, None) => match snapshot.status {
            BatteryStatus::NotFound => "Receptor não encontrado".into(),
            BatteryStatus::Busy => "Interface HID ocupada".into(),
            BatteryStatus::Error => "Erro ao ler a bateria".into(),
            _ => "Bateria indisponível".into(),
        },
    }
}

fn update_tray(app: &AppHandle, snapshot: &BatterySnapshot) {
    let label = tray_label(snapshot);
    let tray_items = app.state::<TrayItems>();
    let _ = tray_items.status.set_text(&label);

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = format!("Havit MS966WB · {label}");
        let _ = tray.set_tooltip(Some(&tooltip));
        let _ = tray.set_icon(Some(make_battery_icon(
            snapshot.percentage.or(snapshot.last_known_percentage),
            snapshot.percentage.is_some(),
        )));
    }
}

fn make_battery_icon(level: Option<u8>, fresh: bool) -> Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = vec![0_u8; (SIZE * SIZE * 4) as usize];
    let outline = if fresh {
        [220, 230, 236, 255]
    } else {
        [125, 135, 144, 255]
    };
    let fill = match level {
        Some(0..=20) => [238, 96, 96, 255],
        Some(21..=40) => [236, 190, 75, 255],
        Some(_) if fresh => [76, 224, 146, 255],
        Some(_) => [112, 150, 132, 255],
        None => [92, 103, 112, 255],
    };

    let mut pixel = |x: u32, y: u32, color: [u8; 4]| {
        let index = ((y * SIZE + x) * 4) as usize;
        rgba[index..index + 4].copy_from_slice(&color);
    };

    for x in 3..27 {
        for y in 7..25 {
            if x <= 5 || x >= 24 || y <= 9 || y >= 22 {
                pixel(x, y, outline);
            }
        }
    }
    for x in 27..30 {
        for y in 12..20 {
            pixel(x, y, outline);
        }
    }

    if let Some(level) = level {
        let width = (level as u32 * 16).div_ceil(100);
        for x in 7..(7 + width) {
            for y in 11..21 {
                pixel(x, y, fill);
            }
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_on_close(window: &Window, event: &WindowEvent) {
    if window.label() == "main"
        && let WindowEvent::CloseRequested { api, .. } = event
    {
        api.prevent_close();
        let _ = window.hide();
    }
}

#[tauri::command]
fn get_cached_battery(state: State<'_, BatteryStore>) -> BatterySnapshot {
    state.snapshot.lock().unwrap().clone()
}

#[tauri::command]
async fn refresh_battery(app: AppHandle) -> BatterySnapshot {
    refresh_and_publish(app).await
}

fn icon_for_level(level: u8) -> AppIcon {
    match level {
        0..=20 => AppIcon::Critical,
        21..=40 => AppIcon::Warning,
        _ => AppIcon::Default,
    }
}

fn icon_from_variant(variant: &str) -> Option<AppIcon> {
    match variant.to_ascii_lowercase().as_str() {
        "default" | "green" => Some(AppIcon::Default),
        "warning" | "yellow" => Some(AppIcon::Warning),
        "critical" | "red" => Some(AppIcon::Critical),
        "galactic" => Some(AppIcon::Galactic),
        "monochrome" => Some(AppIcon::Monochrome),
        "minimalist" => Some(AppIcon::Minimalist),
        "mythic" => Some(AppIcon::Mythic),
        _ => None,
    }
}

fn set_executable_icon(desired: AppIcon) -> Result<ExecutableIconResult, String> {
    let current = alt_icons::current_icon().map_err(|error| error.to_string())?;
    let desired_name = alt_icons::Icon::name(&desired);
    let already_active = current.as_deref() == Some(desired_name)
        || (current.is_none() && desired == AppIcon::Default);

    if !already_active {
        alt_icons::set_icon(desired).map_err(|error| error.to_string())?;
    }

    Ok(ExecutableIconResult {
        icon: desired_name.into(),
        changed: !already_active,
    })
}

fn apply_executable_icon(
    automatic: bool,
    level: Option<u8>,
    variant: String,
) -> Result<ExecutableIconResult, String> {
    let desired = match (automatic, level) {
        (false, _) => icon_from_variant(&variant)
            .ok_or_else(|| format!("variante de ícone desconhecida: {variant}"))?,
        (true, Some(level)) => icon_for_level(level),
        (true, None) => {
            let current = alt_icons::current_icon().map_err(|error| error.to_string())?;
            return Ok(ExecutableIconResult {
                icon: current.unwrap_or_else(|| "Default".into()),
                changed: false,
            });
        }
    };
    set_executable_icon(desired)
}

/// Handles the diagnostic `--set-icon` command before the Tauri runtime starts.
/// Returns an exit code when the command was present, or `None` for normal startup.
pub fn handle_icon_cli_command() -> Option<i32> {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() != Some("--set-icon") {
        return None;
    }

    let requested = arguments.next().unwrap_or_default();
    let icon = match icon_from_variant(&requested) {
        Some(icon) => icon,
        None => {
            eprintln!(
                "uso: hmbm.exe --set-icon <default|warning|critical|galactic|monochrome|minimalist|mythic>"
            );
            return Some(2);
        }
    };

    let result = alt_icons::init()
        .map_err(|error| error.to_string())
        .and_then(|_| set_executable_icon(icon).map(|_| ()));
    if let Err(error) = result {
        eprintln!("não foi possível trocar o ícone: {error}");
        return Some(1);
    }

    Some(0)
}

#[tauri::command]
async fn set_executable_icon_preference(
    state: State<'_, ExecutableIconStore>,
    automatic: bool,
    level: Option<u8>,
    variant: String,
) -> Result<ExecutableIconResult, String> {
    let _update_guard = state.update_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || apply_executable_icon(automatic, level, variant))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = alt_icons::init() {
        eprintln!("não foi possível limpar uma troca anterior de ícone: {error}");
    }

    let start_hidden = std::env::args().any(|argument| argument == "--autostart");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                show_main_window(app);
            },
        ))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(BatteryStore::new())
        .manage(ExecutableIconStore::new())
        .invoke_handler(tauri::generate_handler![
            get_cached_battery,
            refresh_battery,
            set_executable_icon_preference
        ])
        .setup(move |app| {
            let status = MenuItem::with_id(
                app,
                "battery-status",
                "Consultando a bateria…",
                false,
                None::<&str>,
            )?;
            let open = MenuItem::with_id(app, "open", "Abrir monitor", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Atualizar agora", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &open, &refresh, &separator, &quit])?;

            app.manage(TrayItems {
                status: status.clone(),
            });

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Havit MS966WB · consultando bateria…")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "refresh" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            refresh_and_publish(handle).await;
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if start_hidden && let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    refresh_and_publish(handle.clone()).await;
                    tokio::time::sleep(POLL_INTERVAL).await;
                }
            });
            Ok(())
        })
        .on_window_event(hide_on_close)
        .run(tauri::generate_context!())
        .expect("erro ao executar o Havit MS966WB Battery Monitor");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_matches_the_validated_receiver_query() {
        let packet = make_read_request();
        assert_eq!(&packet[..8], &[0x04, 0x20, 0x00, 0x1A, 0x06, 0, 0, 0]);
        assert_eq!(packet[32], 0x02);
        assert_eq!(packet.len(), 64);
    }

    #[test]
    fn executable_icon_follows_battery_bands() {
        assert_eq!(icon_for_level(0), AppIcon::Critical);
        assert_eq!(icon_for_level(20), AppIcon::Critical);
        assert_eq!(icon_for_level(21), AppIcon::Warning);
        assert_eq!(icon_for_level(40), AppIcon::Warning);
        assert_eq!(icon_for_level(41), AppIcon::Default);
        assert_eq!(icon_for_level(100), AppIcon::Default);
    }

    #[test]
    fn executable_icon_variants_are_resolved_by_name() {
        assert_eq!(icon_from_variant("default"), Some(AppIcon::Default));
        assert_eq!(icon_from_variant("galactic"), Some(AppIcon::Galactic));
        assert_eq!(icon_from_variant("monochrome"), Some(AppIcon::Monochrome));
        assert_eq!(icon_from_variant("minimalist"), Some(AppIcon::Minimalist));
        assert_eq!(icon_from_variant("mythic"), Some(AppIcon::Mythic));
        assert_eq!(icon_from_variant("unknown"), None);
    }

    #[test]
    #[ignore = "rewrites this test executable's Windows icon"]
    fn swaps_executable_icon_and_restores_the_default() {
        alt_icons::init().expect("leftovers from an earlier icon swap should be cleaned");

        let warning = apply_executable_icon(true, Some(30), "default".into())
            .expect("the warning icon should be applied to the test executable");
        assert_eq!(warning.icon, "Warning");
        assert_eq!(
            alt_icons::current_icon().expect("the active icon should be readable"),
            Some("Warning".into())
        );

        for (variant, expected) in [
            ("galactic", "Galactic"),
            ("monochrome", "Monochrome"),
            ("minimalist", "Minimalist"),
            ("mythic", "Mythic"),
        ] {
            let applied = apply_executable_icon(false, None, variant.into())
                .expect("the manual icon should be applied to the test executable");
            assert_eq!(applied.icon, expected);
            assert_eq!(
                alt_icons::current_icon().expect("the manual icon should be readable"),
                Some(expected.into())
            );
        }

        let default = apply_executable_icon(false, None, "default".into())
            .expect("the default icon should be restored on the test executable");
        assert_eq!(default.icon, "Default");
        assert_eq!(
            alt_icons::current_icon().expect("the restored icon should be readable"),
            Some("Default".into())
        );
    }

    #[test]
    #[ignore = "requires a connected and awake Havit MS966WB"]
    fn reads_battery_from_real_hardware() {
        match query_battery() {
            Ok(level) => println!("Havit MS966WB battery: {level}%"),
            Err(_) => panic!("could not read the connected mouse battery"),
        }
    }
}
