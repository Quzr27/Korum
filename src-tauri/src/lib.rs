mod commands;
mod pty;
mod quit_guard;
mod storage;

use commands::{
    attach_terminal, confirm_app_exit, create_terminal, detach_terminal, kill_terminal,
    load_settings, load_state, resize_terminal, save_settings, save_state, write_terminal,
};
use pty::PtyState;
use quit_guard::QuitGuardState;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

const QUIT_REQUESTED_EVENT: &str = "korum://quit-requested";
const GUARDED_QUIT_MENU_ID: &str = "guarded-app-quit";

fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let guarded_quit = MenuItem::with_id(
        app,
        GUARDED_QUIT_MENU_ID,
        format!("Quit {}", pkg_info.name),
        true,
        Some("Cmd+Q"),
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "__tauri_window_menu__",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app,
        "__tauri_help_menu__",
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about_metadata.clone()))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &guarded_quit,
                ],
            )?,
            #[cfg(not(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            )))]
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &PredefinedMenuItem::close_window(app, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == GUARDED_QUIT_MENU_ID {
                let _ = app.emit(QUIT_REQUESTED_EVENT, ());
            }
        })
        .manage(PtyState::new())
        .manage(QuitGuardState::new())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            attach_terminal,
            detach_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            save_state,
            load_state,
            save_settings,
            load_settings,
            confirm_app_exit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let quit_guard = app.state::<QuitGuardState>();
            if quit_guard.consume_exit_allowance() {
                return;
            }

            api.prevent_exit();
            let _ = app.emit(QUIT_REQUESTED_EVENT, ());
        }
    });
}
