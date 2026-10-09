use url::Url;

pub fn allows_navigation(url: &Url, _dev_url: Option<&Url>) -> bool {
    if url.scheme() == "tauri" {
        return true;
    }
    #[cfg(debug_assertions)]
    if let Some(dev_url) = _dev_url {
        return url.origin() == dev_url.origin();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_bundled_pages_available() {
        assert!(allows_navigation(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            None
        ));
    }

    #[test]
    fn requires_a_configured_development_origin() {
        assert!(!allows_navigation(
            &Url::parse("http://localhost:1420").unwrap(),
            None
        ));
    }

    #[test]
    fn accepts_the_configured_origin_only_in_debug_builds() {
        let configured = Url::parse("http://localhost:1543/start").unwrap();
        let destination = Url::parse("http://localhost:1543/another#section").unwrap();
        assert_eq!(
            allows_navigation(&destination, Some(&configured)),
            cfg!(debug_assertions)
        );
    }

    #[test]
    fn refuses_other_ports_hosts_and_schemes() {
        let configured = Url::parse("http://localhost:1543/start").unwrap();
        for destination in [
            "http://localhost:1420",
            "http://127.0.0.1:1543",
            "https://localhost:1543",
            "https://example.com",
            "file:///tmp/example.md",
            "data:text/plain,example",
        ] {
            assert!(!allows_navigation(
                &Url::parse(destination).unwrap(),
                Some(&configured)
            ));
        }
    }
}
