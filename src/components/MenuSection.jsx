import { useMemo } from "react";
import MenuCard from "./MenuCard";
import Reveal from "./Reveal";
import { CATEGORIES, MENU_ITEMS, countByCategory, itemsByCategory } from "../data/menu";
import { PRICING_NOTE } from "../data/business";
import styles from "./MenuSection.module.css";

const FILTERS = ["All", ...CATEGORIES];

export default function MenuSection({ filter, onFilterChange }) {
  const items = useMemo(() => itemsByCategory(filter), [filter]);

  return (
    <section
      className="section section--tint"
      id="menu"
      aria-labelledby="menu-title"
    >
      <div className="container">
        <div className="section-head section-head--center">
          <p className="eyebrow">Everything on the list</p>
          <h2 id="menu-title">The Full Menu</h2>
          <p>Filter by category. Prices shown are the current publicly listed prices.</p>
        </div>

        <div
          className={styles.filterBar}
          role="group"
          aria-label="Filter the menu by category"
        >
          {FILTERS.map((value) => {
            const active = filter === value;
            return (
              <button
                key={value}
                type="button"
                className={`${styles.filter} ${active ? styles.filterActive : ""}`}
                onClick={() => onFilterChange(value)}
                aria-pressed={active}
              >
                {value}
                <span className={styles.filterCount} aria-hidden="true">
                  {countByCategory(value)}
                </span>
                <span className="visually-hidden">, {countByCategory(value)} items</span>
              </button>
            );
          })}
        </div>

        <p className={styles.status} role="status" aria-live="polite">
          Showing {items.length} {items.length === 1 ? "item" : "items"}
          {filter === "All" ? " across all categories" : ` in ${filter}`}.
        </p>

        <ul className={styles.grid} key={filter}>
          {items.map((item, index) => (
            <Reveal
              as="li"
              key={item.id}
              delay={Math.min(index, 8) * 45}
              className={styles.cell}
            >
              <MenuCard item={item} />
            </Reveal>
          ))}
        </ul>

        <p className={styles.note}>
          <span aria-hidden="true">*</span> {PRICING_NOTE}
        </p>
        <p className={styles.total}>
          {MENU_ITEMS.length} demo items listed across {CATEGORIES.length} categories.
        </p>
      </div>
    </section>
  );
}
