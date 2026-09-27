import { useEffect, useState } from "react";
import { MapPin, Menu as MenuIcon, X, MessageCircle } from "lucide-react";
import { BRAND, NAV_LINKS, WHATSAPP_URL } from "../data/business";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("#home");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = NAV_LINKS.map((link) => document.querySelector(link.href)).filter(Boolean);
    if (!sections.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(`#${visible.target.id}`);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.2, 0.6] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-locked", open);
    return () => document.body.classList.remove("is-locked");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={`${styles.header} ${scrolled ? styles.isScrolled : ""}`}>
      <div className={`container ${styles.inner}`}>
        {/*
          Temporary text wordmark + mark.
          To use the real JOC logo, drop the file in /public and swap the
          <span className={styles.logoMark}> block below for an <img> with the
          brand's alt text. Nothing else needs to change.
        */}
        <a className={styles.logo} href="#home" aria-label={`${BRAND.name} — home`}>
          <span className={styles.logoMark} aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M9 4h14l-2 20a3 3 0 0 1-3 2.6h-4A3 3 0 0 1 11 24L9 4Z" fill="currentColor" />
              <rect x="17" y="1" width="2.4" height="14" rx="1.2" transform="rotate(12 18 8)" fill="#FDE047" />
              <circle cx="24" cy="9" r="3" fill="#FF7A3D" />
            </svg>
          </span>
          <span className={styles.logoText}>
            <strong>{BRAND.wordmark}</strong>
            <em>{BRAND.tagline}</em>
          </span>
        </a>

        <nav className={styles.desktopNav} aria-label="Primary">
          <ul className={styles.navList}>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  className={`${styles.navLink} ${active === link.href ? styles.navLinkActive : ""}`}
                  href={link.href}
                  aria-current={active === link.href ? "true" : undefined}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.actions}>
          <a
            className={`btn btn--primary ${styles.enquire}`}
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={17} aria-hidden="true" />
            Enquire Now
          </a>
          <button
            type="button"
            className={styles.burger}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X size={22} aria-hidden="true" /> : <MenuIcon size={22} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        className={styles.mobilePanel}
        hidden={!open}
      >
        <nav aria-label="Mobile">
          <ul className={styles.mobileList}>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a className={styles.mobileLink} href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.mobileActions}>
          <a
            className="btn btn--whatsapp btn--block"
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            <MessageCircle size={18} aria-hidden="true" />
            Enquire on WhatsApp
          </a>
          <a
            className="btn btn--ghost btn--block"
            href="#location"
            onClick={() => setOpen(false)}
          >
            <MapPin size={18} aria-hidden="true" />
            Find Us
          </a>
        </div>
      </div>

      <button
        type="button"
        className={styles.scrim}
        onClick={() => setOpen(false)}
        aria-label="Close menu"
        tabIndex={-1}
        hidden={!open}
      />
    </header>
  );
}
