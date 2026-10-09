/**
 * Gallery image configuration.
 *
 * DEMO ARTWORK NOTICE
 * No verified official JOC photography was available for this concept build, so
 * every entry below renders a built-in illustration. These are NOT photographs of
 * the actual cafe and must not be presented as such.
 *
 * HOW TO SWAP IN REAL PHOTOS
 * 1. Drop the real files into /public/images (e.g. public/images/joc-front.jpg).
 * 2. Set `src` on the entry to that path, e.g. src: "/images/joc-front.jpg".
 *    The illustration is replaced automatically whenever `src` is set.
 * 3. Add a real `alt` description. Keep `w` / `h` accurate — they reserve space
 *    and prevent layout shift.
 */

export const GALLERY_IMAGES = [
  { id: "g1", art: "juice", tone: "orange", category: "Juices", alt: "Illustration of a tall glass of fresh orange juice with a straw and orange slice", w: 800, h: 1000, span: "tall" },
  { id: "g2", art: "shake", tone: "chocolate", category: "Shakes", alt: "Illustration of a chocolate milkshake with whipped cream and a straw", w: 800, h: 600, span: "wide" },
  { id: "g3", art: "coffee", tone: "hot", category: "Coffee", alt: "Illustration of a hot coffee in a ceramic cup with rising steam", w: 800, h: 800, span: "sq" },
  { id: "g4", art: "sandwich", tone: "paneer", category: "Sandwiches", alt: "Illustration of a grilled paneer sandwich cut into triangles", w: 800, h: 600, span: "wide" },
  { id: "g5", art: "momo", tone: "paneer", category: "Momos", alt: "Illustration of steamed paneer momos in a bowl", w: 800, h: 1000, span: "tall" },
  { id: "g6", art: "pasta", tone: "cheese", category: "Pasta", alt: "Illustration of a bowl of creamy cheese pasta with a fork", w: 800, h: 800, span: "sq" },
  { id: "g7", art: "juice", tone: "watermelon", category: "Juices", alt: "Illustration of a chilled watermelon juice glass with a watermelon wedge", w: 800, h: 600, span: "wide" },
  { id: "g8", art: "maggi", tone: "paneer", category: "Maggi", alt: "Illustration of a hot bowl of noodles with steam and chopsticks", w: 800, h: 800, span: "sq" },
  { id: "g9", art: "combo", tone: "classic", category: "Combos", alt: "Illustration of a combo plate with a sandwich, juice and coffee", w: 800, h: 1000, span: "tall" },
  { id: "g10", art: "storefront", tone: "shop", category: "Storefront", alt: "JOC juice counter with fruit cups, beverages and a branded cafe facade", w: 1600, h: 1100, span: "tall", src: "/images/gallery/joc-juice-counter.png" },
  { id: "g11", art: "coldCoffee", tone: "cold", category: "Coffee", alt: "Illustration of a cold coffee served over ice with a chocolate straw", w: 800, h: 600, span: "wide" },
  { id: "g12", art: "interior", tone: "room", category: "Storefront", alt: "Inside JOC cafe with the seating area, colorful decor and the juice bar", w: 1600, h: 1200, span: "sq", src: "/images/gallery/joc-interior.png" },
];

export const GALLERY_FILTERS = [
  "All",
  "Juices",
  "Shakes",
  "Coffee",
  "Sandwiches",
  "Momos",
  "Pasta",
  "Maggi",
  "Combos",
  "Storefront",
];
