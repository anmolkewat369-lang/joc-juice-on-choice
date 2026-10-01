import { useEffect, useState } from "react";
import { MapPin, MessageCircle } from "lucide-react";
import { LINKS, whatsappUrl } from "../data/business";
import styles from "./StickyCta.module.css";

/**
 * Compact mobile action bar. Appears after the hero, and steps aside once the
 * location section is on screen so it never covers the address details.
 *
 * Two actions, not one: a phone user half-way down the page gets to start a
 * WhatsApp conversation as easily as they get directions. The number comes from
 * src/data/business.js via whatsappUrl — nothing is hard-coded here.
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
        className={`btn btn--whatsapp ${styles.whatsapp}`}
        href={whatsappUrl("Hello JOC, I have an enquiry about JOC Juice and Cafe.")}
        target="_blank"
        rel="noreferrer"
      >
        <MessageCircle size={18} aria-hidden="true" />
        WhatsApp
      </a>
      <a
        className={`btn btn--primary ${styles.map}`}
        href={LINKS.maps}
        target="_blank"
        rel="noreferrer"
      >
        <MapPin size={18} aria-hidden="true" />
        Get Directions
      </a>
    </div>
  );
}
