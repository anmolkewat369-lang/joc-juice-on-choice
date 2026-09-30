import { MapPin } from "lucide-react";
import { ADDRESS, BRAND, LINKS } from "../data/business";
import styles from "./ContactSection.module.css";

export default function ContactSection() {
  return (
    <section className={`section section--dark ${styles.section}`} id="contact" aria-labelledby="contact-title">
      <div className="container">
        <div className={styles.wrap}>
          <div className={styles.copy}>
            <p className="eyebrow">Visit Us</p>
            <h2 id="contact-title">Find JOC</h2>
            <p className={styles.lead}>
              Visit {BRAND.name} at {ADDRESS.line1}, {ADDRESS.line2}.
            </p>

            <div className={styles.actions}>
              <a
                className="btn btn--primary btn--lg"
                href={LINKS.maps}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={19} aria-hidden="true" />
                Get Directions
              </a>
              <a className="btn btn--onDark btn--lg" href="#location">
                <MapPin size={19} aria-hidden="true" />
                View Location
              </a>
            </div>
          </div>

          <div className={styles.card}>
            <p className={styles.cardLabel}>Location</p>
            <p className={styles.cardName}>{BRAND.name}</p>

            <ul className={styles.contacts}>
              <li>
                <span className={styles.icon} aria-hidden="true">
                  <MapPin size={18} />
                </span>
                <span className={styles.contactBody}>
                  <span className={styles.contactLabel}>Address</span>
                  <a
                    className={styles.contactLink}
                    href={LINKS.maps}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ADDRESS.line1}, {ADDRESS.line2}
                  </a>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
