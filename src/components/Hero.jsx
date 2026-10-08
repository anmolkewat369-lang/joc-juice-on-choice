import { ArrowRight, ClipboardList, Coffee, Leaf, MapPin, Sparkles } from "lucide-react";
import { BRAND } from "../data/business";
import { CATEGORIES, MENU_ITEMS, countByCategory } from "../data/menu";
import styles from "./Hero.module.css";

const COMPOSITION = [
  {
    image: "/images/menu/orange-juice.jpg",
    alt: "Orange juice with fresh orange slices",
  },
  {
    image: "/images/menu/kitkat-shake.jpg",
    alt: "Chocolate shake with chocolate pieces",
  },
  {
    image: "/images/menu/pomegranate-juice.jpg",
    alt: "Pomegranate juice with fresh pomegranate",
  },
];

export default function Hero() {
  const stats = [
    { value: CATEGORIES.length, label: "Menu categories", Icon: Leaf, tone: "green" },
    { value: MENU_ITEMS.length, label: "Items listed", Icon: ClipboardList, tone: "orange" },
    { value: countByCategory("Combos"), label: "Combo options", Icon: Coffee, tone: "rose" },
    { value: "482002", label: "Jabalpur", Icon: Leaf, tone: "green" },
  ];

  return (
    <>
      <section className={styles.hero} id="home">
        <div className={`container ${styles.inner}`}>
          <div className={styles.copy}>
            <p className={styles.badge}>
              <Leaf size={15} aria-hidden="true" />
              Fresh <span>•</span> Healthy <span>•</span> Delicious
            </p>

            <h1 className={styles.title}>
              <span>Fresh Juices.</span>
              <em>Great Vibes.</em>
            </h1>

            <p className={styles.lead}>
              From fresh fruits to creamy shakes, from aromatic coffee to quick bites — all
              in one place.
            </p>

            <div className={styles.ctas}>
              <a className={`btn btn--primary btn--lg ${styles.exploreButton}`} href="#menu">
                Explore Menu
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className={`btn btn--onDark btn--lg ${styles.findButton}`} href="#location">
                <MapPin size={18} aria-hidden="true" />
                Find Us
              </a>
            </div>
          </div>

          <div className={styles.visual} aria-label={BRAND.categoryLine}>
            <div className={styles.photoFrame}>
              <img
                className={styles.mainPhoto}
                src={COMPOSITION[0].image}
                alt={COMPOSITION[0].alt}
                fetchPriority="high"
              />
              <span className={styles.photoTag}>
                <Sparkles size={15} aria-hidden="true" />
                Good Food · Good Mood
              </span>
            </div>
            <div className={`${styles.tile} ${styles.tileShake}`}>
              <img src={COMPOSITION[1].image} alt={COMPOSITION[1].alt} />
            </div>
            <div className={`${styles.tile} ${styles.tileCoffee}`}>
              <img src={COMPOSITION[2].image} alt={COMPOSITION[2].alt} />
            </div>
            <span className={styles.leafAccent} aria-hidden="true">
              <Leaf />
            </span>
          </div>
        </div>
      </section>
      <section className={styles.statsBand} aria-label="JOC at a glance">
        <div className={`container ${styles.statsWrap}`}>
          <ul className={styles.stats}>
            {stats.map(({ Icon, ...stat }) => (
              <li key={stat.label}>
                <span className={`${styles.statIcon} ${styles[`tone${stat.tone}`]}`}>
                  <Icon size={25} aria-hidden="true" />
                </span>
                <strong>{stat.value}</strong>
                <span className={styles.statLabel}>{stat.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
