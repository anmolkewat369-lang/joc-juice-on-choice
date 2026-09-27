import { ArrowRight } from "lucide-react";
import MenuCard from "./MenuCard";
import Reveal from "./Reveal";
import { featuredItems } from "../data/menu";
import { PRICING_NOTE } from "../data/business";
import styles from "./FeaturedMenu.module.css";

export default function FeaturedMenu({ onSelectCategory }) {
  return (
    <section className="section" id="featured" aria-labelledby="featured-title">
      <div className="container">
        <div className={styles.head}>
          <div className="section-head">
            <p className="eyebrow">Straight from the menu</p>
            <h2 id="featured-title">Popular Choices</h2>
            <p>
              A few of the items on the current JOC menu, priced as listed publicly today.
            </p>
          </div>
          <button
            type="button"
            className={`btn btn--ghost ${styles.allLink}`}
            onClick={() => onSelectCategory("All")}
          >
            See the full menu
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>

        <ul className={styles.grid}>
          {featuredItems.map((item, index) => (
            <Reveal as="li" key={item.id} delay={(index % 3) * 70} className={styles.cell}>
              <MenuCard item={item} variant="featured" />
            </Reveal>
          ))}
        </ul>

        <p className={styles.note}>
          <span aria-hidden="true">*</span> {PRICING_NOTE}
        </p>
      </div>
    </section>
  );
}
