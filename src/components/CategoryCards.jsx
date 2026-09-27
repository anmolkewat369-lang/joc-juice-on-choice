import { ArrowUpRight } from "lucide-react";
import FoodArt from "./FoodArt";
import Reveal from "./Reveal";
import { CATEGORY_CARDS } from "../data/categories";
import styles from "./CategoryCards.module.css";

export default function CategoryCards({ onSelectCategory }) {
  return (
    <section className="section section--paper" id="categories" aria-labelledby="categories-title">
      <div className="container">
        <div className="section-head section-head--center">
          <p className="eyebrow">Browse by craving</p>
          <h2 id="categories-title">What are you craving?</h2>
          <p>Four ways into the menu. Pick one and we will take you straight to it.</p>
        </div>

        <ul className={styles.grid}>
          {CATEGORY_CARDS.map((card, index) => (
            <Reveal as="li" key={card.id} delay={index * 70} className={styles.item}>
              <button
                type="button"
                className={styles.card}
                onClick={() => onSelectCategory(card.filter)}
                aria-label={`Show ${card.title.toLowerCase()} in the menu`}
              >
                <span className={styles.art}>
                  <FoodArt art={card.art} tone={card.tone} alt="" decorative />
                </span>
                <span className={styles.body}>
                  <span className={styles.titleRow}>
                    <span className={styles.title}>{card.title}</span>
                    <ArrowUpRight className={styles.arrow} size={20} aria-hidden="true" />
                  </span>
                  <span className={styles.blurb}>{card.blurb}</span>
                  <span className={styles.count}>{card.count} items</span>
                </span>
              </button>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
