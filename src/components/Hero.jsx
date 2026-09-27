import { ArrowRight, MapPin, Sparkles } from "lucide-react";
import FoodArt from "./FoodArt";
import { BRAND, DISCLAIMER_SHORT } from "../data/business";
import styles from "./Hero.module.css";

const COMPOSITION = [
  { art: "juice", tone: "orange", className: styles.tileJuice, alt: "Illustration of a glass of fresh orange juice" },
  { art: "shake", tone: "chocolate", className: styles.tileShake, alt: "Illustration of a chocolate milkshake" },
  { art: "coffee", tone: "hot", className: styles.tileCoffee, alt: "Illustration of a cup of hot coffee" },
  { art: "sandwich", tone: "paneer", className: styles.tileBite, alt: "Illustration of a grilled paneer sandwich" },
];

export default function Hero() {
  return (
    <section className={styles.hero} id="home">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <p className={styles.badge}>
            <Sparkles size={14} aria-hidden="true" />
            {BRAND.name} — {DISCLAIMER_SHORT}
          </p>

          <h1 className={styles.title}>
            <span className={styles.titleTop}>Your Craving.</span>
            <span className={styles.titleBottom}>
              Your Choice. <em>Your JOC.</em>
            </span>
          </h1>

          <p className={styles.lead}>
            Fresh juices, creamy shakes, coffee and delicious quick bites — all in one place.
          </p>

          <div className={styles.ctas}>
            <a className="btn btn--primary btn--lg" href="#menu">
              Explore Menu
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="btn btn--ghost btn--lg" href="#location">
              <MapPin size={18} aria-hidden="true" />
              Find Us
            </a>
          </div>

          <ul className={styles.stats}>
            <li>
              <strong>9</strong>
              <span>Menu categories</span>
            </li>
            <li>
              <strong>37</strong>
              <span>Items listed</span>
            </li>
            <li>
              <strong>10</strong>
              <span>Combo options</span>
            </li>
          </ul>
        </div>

        <div className={styles.visual} aria-label={BRAND.categoryLine}>
          <div className={styles.blob} aria-hidden="true" />
          <div className={styles.grid}>
            {COMPOSITION.map((tile) => (
              <div key={tile.art} className={`${styles.tile} ${tile.className}`}>
                <FoodArt art={tile.art} tone={tile.tone} alt={tile.alt} />
              </div>
            ))}
          </div>
          <p className={styles.visualNote}>
            Demo artwork — swap in real JOC photography at launch.
          </p>
        </div>
      </div>
    </section>
  );
}
