import { MapPin, ShieldCheck } from "lucide-react";
import FoodArt from "./FoodArt";
import Reveal from "./Reveal";
import { ADDRESS, BRAND } from "../data/business";
import { CATEGORIES } from "../data/menu";
import styles from "./AboutSection.module.css";

export default function AboutSection() {
  return (
    <section className="section" id="about" aria-labelledby="about-title">
      <div className="container">
        <div className={styles.wrap}>
          <Reveal className={styles.visual}>
            <div className={styles.artMain}>
              <FoodArt
                art="storefront"
                alt="Illustration of the JOC cafe storefront"
              />
            </div>
            <div className={styles.artInset}>
              <FoodArt
                art="interior"
                alt="Illustration of a bright cafe interior with a window, plants and cups"
              />
            </div>
            <p className={styles.visualNote}>Illustrated concept visuals, not photographs.</p>
          </Reveal>

          <Reveal className={styles.copy} delay={80}>
            {/*
              Replace this section with the client-approved brand story after the
              deal is confirmed. No founder, founding year, branch count, awards or
              customer figures have been added here because none are verified.
            */}
            <p className="eyebrow">About {BRAND.wordmark}</p>
            <h2 id="about-title">Juice On Choice, in one convenient stop</h2>
            <p className={styles.lead}>
              Juice On Choice brings together refreshing beverages, shakes, coffee and quick
              bites in one convenient destination in Jabalpur.
            </p>
            <p className={styles.body}>
              The {BRAND.name} menu runs from fresh juices and thick shakes through hot and
              chilled coffee, sandwiches, momos, pasta, Maggi and a range of combos — so a
              single visit can cover a drink, a snack and a full meal.
            </p>

            <ul className={styles.facts}>
              <li>
                <ShieldCheck size={18} aria-hidden="true" />
                <span>
                  FSSAI listed as <strong>{BRAND.fssai}</strong>
                </span>
              </li>
              <li>
                <MapPin size={18} aria-hidden="true" />
                <span>
                  {ADDRESS.line1}, {ADDRESS.line2}
                </span>
              </li>
            </ul>

            <ul className={styles.tags}>
              {CATEGORIES.map((category) => (
                <li key={category} className="chip">
                  {category}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
