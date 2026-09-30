import { ADDRESS, BRAND, LINKS, NAV_LINKS } from "../data/business";
import styles from "./Footer.module.css";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.top}>
          <div>
            <p className={styles.wordmark}>
              {BRAND.wordmark}
              <span>{BRAND.tagline}</span>
            </p>
            <p className={styles.categoryLine}>{BRAND.categoryLine}</p>
          </div>

          <nav aria-label="Footer">
            <h2 className={styles.colTitle}>Explore</h2>
            <ul className={styles.links}>
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a className={styles.link} href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.link} href="#contact">
                  Visit JOC
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className={styles.colTitle}>Visit JOC</h2>
            <p className={styles.address}>
              {ADDRESS.line1}
              <br />
              {ADDRESS.line2}
              <br />
              {ADDRESS.country}
            </p>
            <a className={styles.mapLink} href={LINKS.maps} target="_blank" rel="noreferrer">
              Get directions
            </a>
          </div>
        </div>

        <div className={styles.bottom}>
          <p>Copyright {year} {BRAND.name}.</p>
        </div>
      </div>
    </footer>
  );
}
