use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{
    utils::config::{PreventOverflowConfig, WindowConfig},
    LogicalRect, LogicalSize, Manager, RunEvent,
};
use url::Url;

use crate::{
    documents::Documents,
    navigation,
    open_requests::{self, Failures, OpenDecision, Origin, Requests, WindowKind},
    settings::{self, Settings, WindowSettings},
    watch, Document, DocumentState,
};

struct PreviewSettings {
    settings: Settings,
    warnings: Vec<String>,
}

#[derive(Default)]
struct Session(Mutex<Requests>);

impl Session {
    fn update<T>(&self, update: impl FnOnce(&mut Requests) -> T) -> T {
        update(&mut self.0.lock().expect("open request state poisoned"))
    }
}

fn guidance(text: String) -> Document {
    Document {
        path: None,
        images: None,
        snapshot: Mutex::new(DocumentState {
            text,
            error: None,
            warnings: Vec::new(),
            revision: 0,
        }),
    }
}

fn top_right_position(
    work_area: LogicalRect<f64, f64>,
    size: LogicalSize<f64>,
    margin: (u32, u32),
    slot: u32,
    step: f64,
) -> (f64, f64) {
    let sx = (work_area.size.width - size.width).max(0.0);
    let sy = (work_area.size.height - size.height).max(0.0);
    let ox = (sx - f64::from(margin.0)).clamp(0.0, sx);
    let oy = f64::from(margin.1).clamp(0.0, sy);
    let count = 1.0 + (ox.min(sy - oy) / step).floor();
    let offset = (f64::from(slot) % count) * step;
    (
        work_area.position.x + ox - offset,
        work_area.position.y + oy + offset,
    )
}

fn expected_content_size(config: &WindowConfig, work_area: LogicalSize<f64>) -> LogicalSize<f64> {
    if matches!(
        config.prevent_overflow,
        Some(PreventOverflowConfig::Enable(true))
    ) {
        LogicalSize::new(
            config.width.min(work_area.width),
            config.height.min(work_area.height),
        )
    } else {
        LogicalSize::new(config.width, config.height)
    }
}

fn window_config(template: &WindowConfig, label: &str, window: &WindowSettings) -> WindowConfig {
    let mut config = template.clone();
    config.label = label.into();
    if let Some(width) = window.width {
        config.width = f64::from(width);
    }
    if let Some(height) = window.height {
        config.height = f64::from(height);
    }
    config.prevent_overflow = (window.width.is_some() || window.height.is_some())
        .then_some(PreventOverflowConfig::Enable(true));
    config
}

fn create_preview(
    app: &tauri::AppHandle,
    document: Document,
    kind: WindowKind,
) -> tauri::Result<String> {
    let title = if kind == WindowKind::Document {
        format!("{} — mjp", document.title())
    } else {
        "mjp".into()
    };
    let document = Arc::new(document);
    let documents = app.state::<Documents>();
    let result = documents.create(Arc::clone(&document), kind, |label, _slot| {
        if let Some(path) = document.path.clone() {
            match watch::start(app.clone(), label.into(), Arc::clone(&document), path) {
                Ok(watcher) => documents.attach_watcher(label, watcher),
                Err(error) => document.add_warning(format!("Live reload is unavailable: {error}")),
            }
        }
        for warning in &app.state::<PreviewSettings>().warnings {
            document.add_warning(warning.clone());
        }
        let dev_url = app.config().build.dev_url.clone();
        let config = window_config(
            &app.config().app.windows[0],
            label,
            &app.state::<PreviewSettings>().settings.window,
        );
        let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
            .title(title)
            .theme(app.state::<PreviewSettings>().settings.theme.native_theme())
            .on_navigation(move |url| navigation::allows_navigation(url, dev_url.as_ref()))
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()?;
        #[cfg(feature = "perf")]
        crate::perf::mark_window_now(window.label(), "window_created");
        let _ = window.set_focus();
        Ok(())
    });
    if kind.replaces_welcome(result.is_ok()) {
        for label in documents.labels(WindowKind::Welcome) {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }
    result
}

fn open_document(
    app: &tauri::AppHandle,
    document: Document,
    origin: Origin,
    failures: &mut Failures,
) -> tauri::Result<()> {
    let path = document.path.clone();
    match create_preview(app, document, WindowKind::Document) {
        Ok(label) => {
            if let Some(path) = path {
                app.state::<Session>()
                    .update(|state| state.opened(path, label));
            }
            Ok(())
        }
        Err(error) if origin.reports_in_gui() => {
            failures.push(
                path.map(|path| path.display().to_string())
                    .unwrap_or_else(|| "stdin".into()),
                format!("cannot create preview: {error}"),
            );
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn focus(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_welcome(app: &tauri::AppHandle) {
    let existing = app.state::<Documents>().labels(WindowKind::Welcome);
    if let Some(label) = existing.first() {
        focus(app, label);
    } else if let Err(error) = create_preview(app, guidance(
        "# Markdown. Just Preview.\n\nIn Finder, select a Markdown file and choose **Open With → mjp**.\n\nFrom a terminal, use `mjp <file>`.\n\nClose a preview with Esc, q, or ⌘W. Use ⌘Q to quit mjp.\n".into()
    ), WindowKind::Welcome) {
        eprintln!("mjp: cannot show welcome: {error}");
    }
}

fn exit_if_idle(app: &tauri::AppHandle) {
    let pending = app.state::<Session>().update(|state| state.has_pending());
    if app.state::<Documents>().can_exit(pending) {
        app.exit(0);
    }
}

fn on_main(app: &tauri::AppHandle, action: impl FnOnce(&tauri::AppHandle) + Send + 'static) {
    let handle = app.clone();
    // Tauri may run this immediately when already on the main thread.
    if let Err(error) = app.run_on_main_thread(move || action(&handle)) {
        eprintln!("mjp: cannot deliver open request to the event loop: {error}");
    }
}

fn prepare_batch(urls: Vec<Url>) -> (Vec<PathBuf>, Failures) {
    let (paths, mut failures) = open_requests::split_batch(urls);
    let mut canonical = Vec::new();
    for path in paths {
        match fs::canonicalize(&path) {
            Ok(path) => canonical.push(path),
            Err(error) => failures.push(
                path.display().to_string(),
                format!("cannot resolve file: {error}"),
            ),
        }
    }
    (canonical, failures)
}

fn start_batch(app: &tauri::AppHandle, urls: Vec<Url>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let prepared = tauri::async_runtime::spawn_blocking(move || prepare_batch(urls)).await;
        on_main(&app, move |app| match prepared {
            Ok((paths, failures)) => load_reserved(app, paths, failures),
            Err(error) => {
                let mut failures = Failures::default();
                failures.push("Open request", format!("cannot prepare files: {error}"));
                finish_batch(app, failures);
            }
        });
    });
}

fn load_reserved(app: &tauri::AppHandle, paths: Vec<PathBuf>, failures: Failures) {
    let mut reserved = Vec::new();
    for path in paths {
        let decision = app.state::<Session>().update(|state| state.reserve(&path));
        match decision {
            OpenDecision::Load => reserved.push(path),
            OpenDecision::Focus(label) => focus(app, &label),
            OpenDecision::Pending => {}
        }
    }
    if reserved.is_empty() {
        finish_batch(app, failures);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let inputs = reserved.clone();
        let loaded = tauri::async_runtime::spawn_blocking(move || {
            inputs
                .into_iter()
                .map(|path| crate::load_document_path(&path))
                .collect::<Vec<_>>()
        })
        .await;
        on_main(&app, move |app| {
            let mut failures = failures;
            match loaded {
                Ok(results) => {
                    for result in results {
                        match result {
                            Ok(document) => {
                                // The receiving process may have started as a CLI preview.
                                let _ = open_document(app, document, Origin::OsOpen, &mut failures);
                            }
                            Err(error) => failures.push_document(error),
                        }
                    }
                }
                Err(error) => {
                    for path in &reserved {
                        failures.push(
                            path.display().to_string(),
                            format!("cannot load file: {error}"),
                        );
                    }
                }
            }
            app.state::<Session>().update(|state| {
                for path in reserved {
                    state.release(&path);
                }
            });
            finish_batch(app, failures);
        });
    });
}

fn finish_batch(app: &tauri::AppHandle, failures: Failures) {
    if !failures.is_empty() {
        if let Err(error) = create_preview(app, guidance(failures.markdown()), WindowKind::Failures)
        {
            eprintln!("mjp: cannot show files that could not be opened: {error}");
        }
    }
    app.state::<Session>().update(Requests::finish);
    exit_if_idle(app);
}

pub fn run(initial: Option<Document>) -> tauri::Result<()> {
    let app_mode = initial.is_none();
    let (settings, warnings) = settings::config_path(std::env::var_os("HOME").as_deref())
        .map(|path| settings::load_settings(&path))
        .unwrap_or_default();
    #[cfg(feature = "perf")]
    crate::perf::mark_now("gui_run");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PreviewSettings { settings, warnings })
        .manage(Documents::default())
        .manage(Session::default());
    #[cfg(feature = "perf")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        crate::get_document,
        crate::get_image,
        crate::close_preview,
        crate::open_external,
        crate::perf_mark
    ]);
    #[cfg(not(feature = "perf"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        crate::get_document,
        crate::get_image,
        crate::close_preview,
        crate::open_external
    ]);
    let app = builder
        .setup(move |app| {
            if let Some(document) = initial {
                open_document(
                    app.handle(),
                    document,
                    Origin::CliInitial,
                    &mut Failures::default(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run(move |app, event| match event {
        RunEvent::Ready => {
            let (batches, reopen) = app
                .state::<Session>()
                .update(|state| (state.ready(), state.take_welcome_request()));
            if reopen || (app_mode && batches.is_empty()) {
                show_welcome(app);
            }
            for urls in batches {
                start_batch(app, urls);
            }
            app.state::<Session>().update(Requests::finish_startup);
            exit_if_idle(app);
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        RunEvent::Opened { urls } => {
            let batch = app.state::<Session>().update(|state| state.accept(urls));
            if let Some(urls) = batch {
                start_batch(app, urls);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let ready = app.state::<Session>().update(Requests::request_welcome);
            if ready {
                show_welcome(app);
                app.state::<Session>()
                    .update(Requests::take_welcome_request);
                exit_if_idle(app);
            }
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            app.state::<Documents>().remove(&label);
            app.state::<Session>()
                .update(|state| state.destroyed(&label));
            exit_if_idle(app);
        }
        RunEvent::ExitRequested { code, api, .. } => {
            let has_windows = !app.state::<Documents>().can_exit(false);
            if app
                .state::<Session>()
                .update(|state| state.prevents_exit(code, has_windows))
            {
                api.prevent_exit();
            }
        }
        _ => {}
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview_template() -> WindowConfig {
        WindowConfig {
            label: "preview-template".into(),
            width: 800.0,
            height: 600.0,
            center: true,
            create: false,
            drag_drop_enabled: true,
            resizable: false,
            title: "Template title".into(),
            ..Default::default()
        }
    }

    #[test]
    fn slot_zero_uses_the_top_right_margins_or_the_corner_for_zero() {
        let area = LogicalRect {
            position: (0.0, 0.0).into(),
            size: (1440.0, 900.0).into(),
        };
        let size = tauri::LogicalSize::new(800.0, 600.0);
        assert_eq!(
            top_right_position(area, size, (16, 16), 0, 24.0),
            (624.0, 16.0)
        );
        assert_eq!(
            top_right_position(area, size, (0, 0), 0, 24.0),
            (640.0, 0.0)
        );
    }

    #[test]
    fn successive_slots_cascade_left_and_down_by_the_fixed_step() {
        let area = LogicalRect {
            position: (0.0, 0.0).into(),
            size: (1440.0, 900.0).into(),
        };
        for slot in [1, 2, 5, 11] {
            let offset = f64::from(slot) * 24.0;
            assert_eq!(
                top_right_position(area, (800.0, 600.0).into(), (16, 16), slot, 24.0),
                (624.0 - offset, 16.0 + offset)
            );
        }
    }

    #[test]
    fn cascade_wraps_by_the_number_of_fitting_positions_including_exact_boundaries() {
        for (width, height, margin, count) in [
            (1440.0, 900.0, (16, 16), 12),
            (848.0, 648.0, (0, 0), 3),
            (800.0, 600.0, (0, 0), 1),
            (816.0, 616.0, (16, 16), 1),
        ] {
            let area = LogicalRect {
                position: (0.0, 0.0).into(),
                size: (width, height).into(),
            };
            let size = (800.0, 600.0).into();
            let first = top_right_position(area, size, margin, 0, 24.0);
            for slot in [count - 1, count, count + 1, u32::MAX] {
                let offset = f64::from(slot % count) * 24.0;
                assert_eq!(
                    top_right_position(area, size, margin, slot, 24.0),
                    (first.0 - offset, first.1 + offset)
                );
            }
        }
    }

    #[test]
    fn excessive_margins_yield_to_each_work_area_boundary() {
        let area = LogicalRect {
            position: (0.0, 0.0).into(),
            size: (1440.0, 900.0).into(),
        };
        for (margin, expected) in [
            ((1000, 16), (0.0, 16.0)),
            ((16, 1000), (624.0, 300.0)),
            ((1000, 1000), (0.0, 300.0)),
            ((u32::MAX, u32::MAX), (0.0, 300.0)),
        ] {
            for slot in [0, 1, u32::MAX] {
                assert_eq!(
                    top_right_position(area, (800.0, 600.0).into(), margin, slot, 24.0),
                    expected
                );
            }
        }
    }

    #[test]
    fn oversized_or_equal_edges_align_only_the_constrained_axes() {
        let area = LogicalRect {
            position: (10.0, 30.0).into(),
            size: (1440.0, 900.0).into(),
        };
        for (size, expected) in [
            ((1500.0, 600.0), (10.0, 46.0)),
            ((800.0, 1000.0), (634.0, 30.0)),
            ((1500.0, 1000.0), (10.0, 30.0)),
            ((1440.0, 600.0), (10.0, 46.0)),
            ((800.0, 900.0), (634.0, 30.0)),
            ((1440.0, 900.0), (10.0, 30.0)),
        ] {
            for slot in [0, 1, u32::MAX] {
                assert_eq!(
                    top_right_position(area, size.into(), (16, 16), slot, 24.0),
                    expected
                );
            }
        }
    }

    #[test]
    fn fractional_origins_preserve_exact_step_boundaries_and_wrapping() {
        for (width, count) in [
            (1056.0_f64.next_down(), 10),
            (1056.0, 11),
            (1056.0_f64.next_up(), 11),
        ] {
            for origin in [(0.0, 0.0), (0.1, -10.3), (-1920.5, 23.25)] {
                let area = LogicalRect {
                    position: origin.into(),
                    size: (width, 856.0).into(),
                };
                for slot in [count - 1, count, count + 1] {
                    let offset = f64::from(slot % count) * 24.0;
                    let actual =
                        top_right_position(area, (800.0, 600.0).into(), (16, 16), slot, 24.0);
                    let expected = (origin.0 + width - 816.0 - offset, origin.1 + 16.0 + offset);
                    assert!(
                        (actual.0 - expected.0).abs() < 1e-10,
                        "{actual:?} != {expected:?}"
                    );
                    assert!(
                        (actual.1 - expected.1).abs() < 1e-10,
                        "{actual:?} != {expected:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn work_area_origins_include_menu_bar_and_side_dock_offsets_without_inversion() {
        for (origin, extent, expected) in [
            ((0.0, 25.0), (1440.0, 875.0), (624.0, 41.0)),
            ((48.0, 25.0), (1392.0, 875.0), (624.0, 41.0)),
            ((0.0, 25.0), (1392.0, 875.0), (576.0, 41.0)),
            ((-1440.0, -900.0), (1440.0, 900.0), (-816.0, -884.0)),
        ] {
            let area = LogicalRect {
                position: origin.into(),
                size: extent.into(),
            };
            assert_eq!(
                top_right_position(area, (800.0, 600.0).into(), (16, 16), 0, 24.0),
                expected
            );
        }
    }

    #[test]
    fn placement_uses_fitted_content_only_when_overflow_prevention_is_enabled() {
        let template = preview_template();
        for (window, area, expected) in [
            (
                WindowSettings {
                    position: Some(settings::WindowPosition::TopRight),
                    ..Default::default()
                },
                (640.0, 480.0),
                (800.0, 600.0),
            ),
            (
                WindowSettings {
                    width: Some(1000),
                    ..Default::default()
                },
                (640.0, 480.0),
                (640.0, 480.0),
            ),
            (
                WindowSettings {
                    height: Some(700),
                    ..Default::default()
                },
                (1440.0, 480.0),
                (800.0, 480.0),
            ),
            (
                WindowSettings {
                    width: Some(u32::MAX),
                    height: Some(u32::MAX),
                    ..Default::default()
                },
                (1440.0, 900.0),
                (1440.0, 900.0),
            ),
            (
                WindowSettings {
                    width: Some(800),
                    ..Default::default()
                },
                (1440.0, 900.0),
                (800.0, 600.0),
            ),
        ] {
            let config = window_config(&template, "preview-size", &window);
            assert_eq!(expected_content_size(&config, area.into()), expected.into());
            assert_eq!(config.width, window.width.map(f64::from).unwrap_or(800.0));
            assert_eq!(config.height, window.height.map(f64::from).unwrap_or(600.0));
        }
    }

    #[test]
    fn unspecified_window_dimensions_preserve_the_template_except_its_label() {
        let template = preview_template();
        let original = template.clone();
        let config = window_config(&template, "preview-1", &settings::WindowSettings::default());
        let mut expected = template.clone();
        expected.label = "preview-1".into();
        assert_eq!(config, expected);
        assert_eq!(config.width, 800.0);
        assert_eq!(config.height, 600.0);
        assert_eq!(config.prevent_overflow, None);
        assert_eq!(template, original);
    }

    #[test]
    fn one_explicit_dimension_keeps_the_other_and_enables_overflow_prevention() {
        let mut custom_template = preview_template();
        custom_template.width = 812.5;
        custom_template.height = 612.5;
        for template in [preview_template(), custom_template] {
            let original = template.clone();
            for window in [
                WindowSettings {
                    width: Some(1),
                    height: None,
                    ..WindowSettings::default()
                },
                WindowSettings {
                    width: None,
                    height: Some(u32::MAX),
                    ..WindowSettings::default()
                },
                WindowSettings {
                    width: Some(800),
                    height: None,
                    ..WindowSettings::default()
                },
                WindowSettings {
                    width: None,
                    height: Some(600),
                    ..WindowSettings::default()
                },
            ] {
                let config = window_config(&template, "preview-2", &window);
                let mut expected = template.clone();
                expected.label = "preview-2".into();
                expected.width = window.width.map(f64::from).unwrap_or(template.width);
                expected.height = window.height.map(f64::from).unwrap_or(template.height);
                expected.prevent_overflow = Some(PreventOverflowConfig::Enable(true));
                assert_eq!(config, expected);
                assert_eq!(template, original);
            }
        }
    }

    #[test]
    fn both_explicit_dimensions_replace_only_size_label_and_overflow_preference() {
        let mut template = preview_template();
        template.width = 812.5;
        template.height = 612.5;
        template.prevent_overflow = Some(PreventOverflowConfig::Enable(false));
        let original = template.clone();
        let config = window_config(
            &template,
            "preview-3",
            &WindowSettings {
                width: Some(u32::MAX),
                height: Some(1),
                ..WindowSettings::default()
            },
        );
        let mut expected = original.clone();
        expected.label = "preview-3".into();
        expected.width = 4294967295.0;
        expected.height = 1.0;
        expected.prevent_overflow = Some(PreventOverflowConfig::Enable(true));
        assert_eq!(config, expected);
        assert_eq!(template, original);
    }

    #[test]
    fn guidance_has_no_path_image_scope_or_watch_target() {
        let document = guidance("# Welcome".into());
        assert!(document.path().is_none());
        assert!(document.images.is_none());
        assert_eq!(document.refresh(), None);
        assert_eq!(document.snapshot().unwrap().text, "# Welcome");
    }

    #[test]
    fn preparation_resolves_aliases_and_reports_missing_files_together() {
        let root = std::env::temp_dir().join(format!("mjp-open-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("日本語 # %.md");
        fs::write(&path, "# File").unwrap();
        let (paths, failures) = prepare_batch(vec![
            Url::from_file_path(&path).unwrap(),
            Url::from_file_path(root.join("missing.md")).unwrap(),
            Url::parse("https://example.com/file.md").unwrap(),
        ]);
        assert_eq!(paths, vec![fs::canonicalize(&path).unwrap()]);
        let text = failures.markdown();
        assert!(text.contains("missing.md"));
        assert!(text.contains("https://example.com/file.md"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failure_guidance_displays_each_failed_document_path_once() {
        let root =
            std::env::temp_dir().join(format!("mjp-failure-guidance-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let invalid = root.join("bad-utf8.md");
        let oversized = root.join("too-large.md");
        fs::write(&invalid, [0xff]).unwrap();
        fs::File::create(&oversized)
            .unwrap()
            .set_len(crate::MAX_DOCUMENT_BYTES + 1)
            .unwrap();
        let mut failures = Failures::default();
        for path in [&invalid, &oversized] {
            failures.push_document(crate::load_document_path(path).unwrap_err());
        }
        fs::remove_dir_all(&root).unwrap();
        let text = failures.markdown();
        for path in [&invalid, &oversized] {
            assert_eq!(
                text.matches(&path.display().to_string()).count(),
                1,
                "{text}"
            );
        }
    }
}
