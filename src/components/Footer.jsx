import { Mail, MessageCircle } from "lucide-react";
import {
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
            <p className={styles.address}>
              {BRAND.name}
              <br />
              Plot No. 207, Dixit Colony, Marhatal
              <br />
              Jabalpur, Madhya Pradesh â€” 482002
            </p>
            <a
              className={styles.mapLink}
              href={LINKS.maps}
              target="_blank"
              rel="noreferrer"
            >
              View on Google Maps
            </a>
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
                  Enquire
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className={styles.colTitle}>{CONTACT.role}</h2>
            <p className={styles.devName}>{CONTACT.name}</p>
            <ul className={styles.links}>
              <li>
                <a className={styles.link} href={WHATSAPP_URL} target="_blank" rel="noreferrer">
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
              Temporary proposal contact â€” not an official JOC contact.
            </p>
          </div>
        </div>

        <div className={styles.disclaimer}>
          <p className={styles.disclaimerText}>{DISCLAIMER_FULL}</p>
        </div>

        <div className={styles.bottom}>
          <p>
            Â© {year} {BRAND.name}. Concept website.
          </p>
          <p className={styles.credit}>
            Website concept by <strong>{CONTACT.name}</strong>
          </p>
        </div>
      </div>
    </footer>
  );
}
