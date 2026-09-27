import { MessageCircle } from "lucide-react";
import MenuCard from "./MenuCard";
import Reveal from "./Reveal";
import { comboItems } from "../data/menu";
import { WHATSAPP_URL } from "../data/business";
import styles from "./ComboSection.module.css";

export default function ComboSection() {
  return (
    <section className={`section section--dark ${styles.section}`} id="combos" aria-labelledby="combos-title">
      <div className="container">
        <div className={styles.head}>
          <div className="section-head">
            <p className="eyebrow">Value combos</p>
            <h2 id="combos-title">
              More Together.
              <br />
              More Delicious.
            </h2>
            <p>Combo options currently on the JOC menu, from two-serving plates to a jumbo meal.</p>
          </div>
          <a
            className={`btn btn--lime ${styles.cta}`}
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={18} aria-hidden="true" />
            Ask about combos
          </a>
        </div>

        <ul className={styles.grid}>
          {comboItems.map((item, index) => (
            <Reveal as="li" key={item.id} delay={(index % 4) * 70} className={styles.cell}>
              <MenuCard item={item} variant="combo" headingLevel="h3" />
            </Reveal>
          ))}
        </ul>
      </div>

      <div className={styles.glow} aria-hidden="true" />
    </section>
  );
}
