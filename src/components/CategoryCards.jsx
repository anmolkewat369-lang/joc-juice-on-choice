import { ArrowRight, Coffee, CupSoda, IceCreamBowl, Sandwich } from "lucide-react";
import Reveal from "./Reveal";
import { CATEGORY_CARDS } from "../data/categories";
import styles from "./CategoryCards.module.css";

const ICONS = {
  "fresh-juices": CupSoda,
  shakes: IceCreamBowl,
  coffee: Coffee,
  "quick-bites": Sandwich,
};

export default function CategoryCards({ onSelectCategory }) {
  return (
    <section
      className={`section section--dark ${styles.section}`}
      id="categories"
      aria-labelledby="categories-title"
    >
      <div className="container">
        <div className={styles.head}>
          <div className={styles.intro}>
            <p className="eyebrow">Our categories</p>
            <h2 id="categories-title">
              Something for <em>Every Craving</em>
            </h2>
            <p>Choose your favorite, we’ll take care of the rest.</p>
          </div>
          <button
            type="button"
            className={styles.viewAll}
            onClick={() => onSelectCategory("All")}
          >
            View All
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>

        <ul className={styles.grid}>
          {CATEGORY_CARDS.map((card, index) => {
            const Icon = ICONS[card.id];
            return (
              <Reveal as="li" key={card.id} delay={index * 70} className={styles.item}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => onSelectCategory(card.filter)}
                  aria-label={`Show ${card.title.toLowerCase()} in the menu`}
                >
                  <span className={`${styles.icon} ${styles[`tone${index}`]}`} aria-hidden="true">
                    <Icon size={29} strokeWidth={1.8} />
                  </span>
                  <span className={styles.title}>{card.title}</span>
                  <span className={styles.arrow} aria-hidden="true">
                    <ArrowRight size={17} />
                  </span>
                </button>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
