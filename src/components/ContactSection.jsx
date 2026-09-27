import { Mail, MessageCircle, Phone } from "lucide-react";
import { CONTACT, MAILTO_URL, WHATSAPP_URL } from "../data/business";
import styles from "./ContactSection.module.css";

export default function ContactSection() {
  return (
    <section className={`section section--dark ${styles.section}`} id="contact" aria-labelledby="contact-title">
      <div className="container">
        <div className={styles.wrap}>
          <div className={styles.copy}>
            <p className="eyebrow">Website concept</p>
            <h2 id="contact-title">Want a Website Like This?</h2>
            <p className={styles.lead}>
              This website is a concept created for {`JOC Juice and Cafe`}. Interested in
              discussing the website or creating a similar online presence for your business?
            </p>
            <p className={styles.disclaimer}>
              These are temporary proposal contact details, not official JOC contact details.
            </p>

            <div className={styles.actions}>
              <a
                className="btn btn--whatsapp btn--lg"
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={19} aria-hidden="true" />
                Chat on WhatsApp
              </a>
              <a className="btn btn--onDark btn--lg" href={MAILTO_URL}>
                <Mail size={19} aria-hidden="true" />
                Send Email
              </a>
            </div>
          </div>

          <div className={styles.card}>
            <p className={styles.cardLabel}>{CONTACT.label}</p>
            <p className={styles.cardName}>{CONTACT.name}</p>

            <ul className={styles.contacts}>
              <li>
                <span className={styles.icon} aria-hidden="true">
                  <Phone size={18} />
                </span>
                <span className={styles.contactBody}>
                  <span className={styles.contactLabel}>WhatsApp</span>
                  <a
                    className={styles.contactLink}
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {CONTACT.phoneDisplay}
                  </a>
                </span>
              </li>
              <li>
                <span className={styles.icon} aria-hidden="true">
                  <Mail size={18} />
                </span>
                <span className={styles.contactBody}>
                  <span className={styles.contactLabel}>Email</span>
                  <a className={styles.contactLink} href={MAILTO_URL}>
                    {CONTACT.email}
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
