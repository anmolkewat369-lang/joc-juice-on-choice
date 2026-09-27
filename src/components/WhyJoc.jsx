import { Droplets, IceCreamBowl, Sandwich, Sparkles } from "lucide-react";
import Reveal from "./Reveal";
import styles from "./WhyJoc.module.css";

/**
 * Factual, category-based messaging only.
 * No "best in Jabalpur", no "#1", no years of experience, no customer counts.
 */
const REASONS = [
  {
    id: "fresh",
    title: "Fresh Choices",
    blurb: "A variety of juices and refreshing beverages.",
    Icon: Droplets,
    tone: styles.toneGreen,
  },
  {
    id: "sweet",
    title: "Something Sweet",
    blurb: "Shakes and chilled drinks for sweet cravings.",
    Icon: IceCreamBowl,
    tone: styles.toneCocoa,
  },
  {
    id: "bites",
    title: "Quick Bites",
    blurb: "Sandwiches, momos, pasta and Maggi.",
    Icon: Sandwich,
    tone: styles.toneLime,
  },
  {
    id: "plenty",
    title: "Plenty of Choices",
    blurb: "Multiple beverages, snacks and combo options.",
    Icon: Sparkles,
    tone: styles.toneOrange,
  },
];

export default function WhyJoc() {
  return (
    <section className="section section--paper" id="why" aria-labelledby="why-title">
      <div className="container">
        <div className="section-head section-head--center">
          <p className="eyebrow">Why JOC</p>
          <h2 id="why-title">One cafe, plenty of options</h2>
          <p>Everything below is taken straight from the categories JOC actually serves.</p>
        </div>

        <ul className={styles.grid}>
          {REASONS.map((reason, index) => (
            <Reveal as="li" key={reason.id} delay={index * 70} className={styles.cell}>
              <article className={styles.card}>
                <span className={`${styles.icon} ${reason.tone}`} aria-hidden="true">
                  <reason.Icon size={22} />
                </span>
                <h3 className={styles.title}>{reason.title}</h3>
                <p className={styles.blurb}>{reason.blurb}</p>
              </article>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
