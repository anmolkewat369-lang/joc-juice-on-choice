import { useEffect, useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { CONTACT, MAILTO_URL, WHATSAPP_URL } from "../data/business";
import styles from "./StickyCta.module.css";

/**
 * Compact mobile action bar. Appears after the hero, and steps aside once the
 * enquiry section is on screen so it never covers the real contact details.
 */
export default function StickyCta() {
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const contact = document.getElementById("contact");
    const footer = document.querySelector("footer");

    const onScroll = () => {
      const past = window.scrollY > Math.min(520, window.innerHeight * 0.7);
      setVisible(past);
      if (!contact || !footer) return;
      const rect = contact.getBoundingClientRect();
      const footRect = footer.getBoundingClientRect();
      setHidden(rect.top < window.innerHeight * 0.6 && footRect.top > window.innerHeight);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      className={`${styles.bar} ${visible ? styles.barVisible : ""} ${hidden ? styles.barHidden : ""}`}
    >
      <a
        className={`btn btn--whatsapp btn--block ${styles.wa}`}
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
      >
        <MessageCircle size={19} aria-hidden="true" />
        WhatsApp Enquiry
      </a>
      <a className={styles.call} href={`tel:${CONTACT.phoneRaw}`} aria-label={`Call ${CONTACT.phoneDisplay}`}>
        <Phone size={19} aria-hidden="true" />
      </a>
      <a className={styles.mail} href={MAILTO_URL} aria-label={`Email ${CONTACT.email}`}>
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="3" />
          <path d="m3 6 9 6 9-6" />
        </svg>
      </a>
    </div>
  );
}
