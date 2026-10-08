import { ArrowRight } from "lucide-react";
import MenuCard from "./MenuCard";
import Reveal from "./Reveal";
import { featuredItems } from "../data/menu";
import { PRICING_NOTE } from "../data/business";
import styles from "./FeaturedMenu.module.css";

export default function FeaturedMenu({ onSelectCategory }) {
  return (
    <section
      className={`section section--paper ${styles.section}`}
      id="featured"
      aria-labelledby="featured-title"
    >
      <div className="container">
        <div className={styles.head}>
          <div className="section-head">
            <p className="eyebrow">Popular today</p>
            <h2 id="featured-title">
              Loved by <em>Our Customers</em>
            </h2>
            <p>Fresh, tasty picks from the current JOC menu.</p>
          </div>
          <button
            type="button"
            className={`btn btn--ghost ${styles.allLink}`}
            onClick={() => onSelectCategory("All")}
          >
            View All
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
