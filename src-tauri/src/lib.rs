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
        let width = ((level as u32 * 16) + 99) / 100;
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
    if window.label() == "main" {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BatteryStore::new())
        .invoke_handler(tauri::generate_handler![
            get_cached_battery,
            refresh_battery
        ])
        .setup(|app| {
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
    #[ignore = "requires a connected and awake Havit MS966WB"]
    fn reads_battery_from_real_hardware() {
        match query_battery() {
            Ok(level) => println!("Havit MS966WB battery: {level}%"),
            Err(_) => panic!("could not read the connected mouse battery"),
        }
    }
}
