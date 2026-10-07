import FoodArt from "./FoodArt";
import AddToCartButton from "./cart/AddToCartButton";
import { formatPrice } from "../data/menu";
import styles from "./MenuCard.module.css";

const TONE_CLASS = {
  Juices: styles.toneJuice,
  Shakes: styles.toneShake,
  Coffee: styles.toneCoffee,
  Sandwiches: styles.toneBite,
  Momos: styles.toneBite,
  Pasta: styles.toneBite,
  Maggi: styles.toneBite,
  Combos: styles.toneCombo,
};

const BADGE_CLASS = {
  Juices: "",
  Shakes: styles.badgeShake,
  Coffee: styles.badgeCoffee,
  Sandwiches: "",
  Momos: "",
  Pasta: "",
  Maggi: "",
  Combos: styles.badgeCombo,
};

export default function MenuCard({
  item,
  variant = "default",
  headingLevel: Heading = "h3",
  orderable = true,
}) {
  const variantClass = styles[variant] ? ` ${styles[variant]}` : "";
  const hasPhoto = Boolean(item.image);

  return (
    <article className={`${styles.card}${variantClass}`}>
      <div className={styles.art}>
        <FoodArt
          art={item.art}
          tone={item.tone}
          image={item.image}
          alt={hasPhoto ? `${item.name}${item.size ? `, ${item.size}` : ""}` : ""}
          decorative={!hasPhoto}
        />
        {item.badge ? (
          <span className={`chip chip--dark ${styles.badge} ${BADGE_CLASS[item.category] ?? ""}`}>
            {item.badge}
          </span>
        ) : null}
      </div>

      <div className={styles.body}>
        <div className={styles.head}>
          <Heading className={styles.name}>{item.name}</Heading>
          {item.size ? <span className={styles.size}>{item.size}</span> : null}
        </div>

        <p className={styles.desc}>{item.description}</p>

        <div className={styles.foot}>
          <span className={`chip ${TONE_CLASS[item.category] ?? ""}`}>{item.category}</span>
          <span className={styles.price}>
            <span className="visually-hidden">Price </span>
            {formatPrice(item.price)}
          </span>
        </div>

        {orderable ? (
          <div className={styles.order}>
            <AddToCartButton item={item} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
