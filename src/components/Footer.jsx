import { Mail, MessageCircle } from "lucide-react";
import {
  ADDRESS,
  BRAND,
  CONTACT,
  DISCLAIMER_FULL,
  LINKS,
  MAILTO_URL,
  NAV_LINKS,
  WHATSAPP_URL,
} from "../data/business";
import styles from "./Footer.module.css";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.top}>
          <div>
            <p className={styles.wordmark}>
              {BRAND.wordmark}
              <span>{BRAND.tagline}</span>
            </p>
            <p className={styles.categoryLine}>{BRAND.categoryLine}</p>
          </div>

          <nav aria-label="Footer">
            <h2 className={styles.colTitle}>Explore</h2>
            <ul className={styles.links}>
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a className={styles.link} href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.link} href="#contact">
                  Visit JOC
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className={styles.colTitle}>Visit JOC</h2>
            <p className={styles.address}>
              {ADDRESS.line1}
              <br />
              {ADDRESS.line2}
              <br />
              {ADDRESS.country}
            </p>
            <a className={styles.mapLink} href={LINKS.maps} target="_blank" rel="noreferrer">
              Get directions
            </a>
          </div>

          {/*
            Contact Us.

            Rendered unconditionally, for every viewport. It was removed from this
            file in an earlier change, which left a phone user who had scrolled past
            the contact section with no way to reach anyone: the sticky "Get
            Directions" bar is a map link and the footer had no contact action.

            The details come from src/data/business.js, the same centralized config
            the rest of the site reads, so no number is hard-coded here.
          */}
          <div className={styles.contact}>
            <h2 className={styles.colTitle}>Contact Us</h2>
            <p className={styles.devName}>{CONTACT.name}</p>

            <a
              className={`btn btn--whatsapp btn--block ${styles.whatsapp}`}
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={18} aria-hidden="true" />
              WhatsApp
            </a>

            <ul className={styles.links}>
              {/* The number appears once, as a dial link — not a second WhatsApp
                  button offering the same action twice. */}
              <li>
                <a className={styles.link} href={`tel:${CONTACT.phoneRaw}`}>
                  <MessageCircle size={15} aria-hidden="true" />
                  {CONTACT.phoneDisplay}
                </a>
              </li>
              <li>
                <a className={styles.link} href={MAILTO_URL}>
                  <Mail size={15} aria-hidden="true" />
                  {CONTACT.email}
                </a>
              </li>
            </ul>

            <p className={styles.devNote}>
              {CONTACT.role} — not an official JOC contact.
            </p>
          </div>
        </div>

        <div className={styles.disclaimer}>
          <p className={styles.disclaimerText}>{DISCLAIMER_FULL}</p>
        </div>

        <div className={styles.bottom}>
          <p>
            Copyright {year} {BRAND.name}.
          </p>
          <p className={styles.credit}>
            {CONTACT.role} <strong>{CONTACT.name}</strong>
          </p>
        </div>
      </div>
    </footer>
  );
}
