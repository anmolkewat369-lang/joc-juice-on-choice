import { useEffect, useMemo, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import FoodArt from "./FoodArt";
import Reveal from "./Reveal";
import { GALLERY_FILTERS, GALLERY_IMAGES } from "../data/gallery";
import styles from "./Gallery.module.css";

export default function Gallery() {
  const [filter, setFilter] = useState("All");
  const [openIndex, setOpenIndex] = useState(null);
  const closeRef = useRef(null);

  const items = useMemo(
    () => (filter === "All" ? GALLERY_IMAGES : GALLERY_IMAGES.filter((i) => i.category === filter)),
    [filter],
  );

  const choose = (value) => {
    setOpenIndex(null);
    setFilter(value);
  };

  useEffect(() => {
    if (openIndex === null) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpenIndex(null);
      if (event.key === "ArrowRight") setOpenIndex((i) => (i + 1) % items.length);
      if (event.key === "ArrowLeft") setOpenIndex((i) => (i - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("is-locked");
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("is-locked");
    };
  }, [openIndex, items.length]);

  const open = items[openIndex];

  return (
    <section className="section section--paper" id="gallery" aria-labelledby="gallery-title">
      <div className="container">
        <div className="section-head section-head--center">
          <p className="eyebrow">Gallery</p>
          <h2 id="gallery-title">A Taste of JOC</h2>
          <p>
            Fresh café moments, colorful fruit blends, and the warm vibe that makes JOC a local favorite.
          </p>
        </div>

        <div className={styles.filterBar} role="group" aria-label="Filter the gallery">
          {GALLERY_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.filter} ${filter === value ? styles.filterActive : ""}`}
              onClick={() => choose(value)}
              aria-pressed={filter === value}
            >
              {value}
            </button>
          ))}
        </div>

        <ul className={styles.grid}>
          {items.map((item, index) => (
            <Reveal
              as="li"
              key={item.id}
              delay={Math.min(index, 8) * 45}
              className={`${styles.cell} ${styles[item.span]}`}
            >
              <button
                type="button"
                className={styles.tile}
                onClick={() => setOpenIndex(index)}
                aria-label={`Open larger view: ${item.alt}`}
              >
                <FoodArt
                  art={item.art}
                  tone={item.tone}
                  image={item.src}
                  alt=""
                  decorative
                  loading="lazy"
                />
                <span className={styles.overlay}>
                  <span className={styles.label}>{item.category}</span>
                  <ZoomIn size={18} aria-hidden="true" />
                </span>
              </button>
            </Reveal>
          ))}
        </ul>
      </div>

      {open ? (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={open.alt}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpenIndex(null);
          }}
        >
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={() => setOpenIndex(null)}
            aria-label="Close image viewer"
          >
            <X size={22} aria-hidden="true" />
          </button>
          <figure className={styles.figure}>
            <FoodArt
              art={open.art}
              tone={open.tone}
              image={open.src}
              alt={open.alt}
              className={styles.lightboxArt}
            />
            <figcaption className={styles.caption}>{open.alt}</figcaption>
          </figure>
        </div>
      ) : null}
    </section>
  );
}
