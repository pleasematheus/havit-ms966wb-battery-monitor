#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = havit_ms966wb_battery_monitor_lib::handle_icon_cli_command() {
        std::process::exit(exit_code);
    }
    havit_ms966wb_battery_monitor_lib::run();
}
