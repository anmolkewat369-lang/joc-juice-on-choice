/**
 * Demo menu data sourced from publicly available listing.
 * Confirm menu and prices with client before production launch.
 *
 * ----------------------------------------------------------------------------
 * HOW TO EDIT
 * Add / remove / re-price items here. Every component reads from this file,
 * so no component needs to be touched.
 *
 * Fields:
 *   id          unique string key
 *   name        display name
 *   category    must match one of CATEGORIES below
 *   price       number, in rupees
 *   size        optional serving size label
 *   description one short line, factual, no marketing superlatives
 *   art         key for the built-in illustration (see src/components/FoodArt.jsx)
 *   tone        palette hint for the illustration
 *   badge       optional neutral label (e.g. "Chilled", "For Two")
 *   image       leave as null while using the built-in illustration. To swap in a
 *               real photo, drop the file in /public/images and set
 *               image: "/images/your-file.jpg" — the illustration is then
 *               replaced automatically, no component changes needed.
 * ----------------------------------------------------------------------------
 */

/** Menu items whose description cannot be verified are described only by name. */
const combosNote = "Combo option from the current menu. Ask the team for today's inclusions.";

export const CATEGORIES = [
  "Juices",
  "Shakes",
  "Coffee",
  "Tea",
  "Sandwiches",
  "Momos",
  "Pasta",
  "Maggi",
  "Combos",
];

export const MENU_ITEMS = [
  /* ------------------------------- JUICES ------------------------------- */
  {
    id: "apple-juice",
    name: "Apple Juice",
    category: "Juices",
    price: 149,
    size: "350 ml",
    description: "Crisp, naturally sweet pressed apple juice.",
    art: "juice",
    tone: "apple",
    image: "/images/menu/apple-juice.jpg",
  },
  {
    id: "orange-juice",
    name: "Orange Juice",
    category: "Juices",
    price: 149,
    size: "350 ml",
    description: "Bright and zesty, squeezed orange juice.",
    art: "juice",
    tone: "orange",
    badge: "Fresh",
    image: "/images/menu/orange-juice.jpg",
  },
  {
    id: "banana-juice",
    name: "Banana Juice",
    category: "Juices",
    price: 149,
    size: "350 ml",
    description: "Thick, smooth and naturally creamy.",
    art: "juice",
    tone: "banana",
    image: "/images/menu/banana-juice.jpg",
  },
  {
    id: "pomegranate-juice",
    name: "Pomegranate Juice",
    category: "Juices",
    price: 149,
    size: "350 ml",
    description: "Sweet-tangy pomegranate with real fruit character.",
    art: "juice",
    tone: "pomegranate",
    image: "/images/menu/pomegranate-juice.jpg",
  },
  {
    id: "watermelon-juice",
    name: "Watermelon Juice",
    category: "Juices",
    price: 149,
    size: "350 ml",
    description: "Chillingly refreshing, served cold.",
    art: "juice",
    tone: "watermelon",
    badge: "Chilled",
    image: "/images/menu/watermelon-juice.jpg",
  },

  /* ------------------------------- SHAKES ------------------------------- */
  {
    id: "chocolate-shake",
    name: "Chocolate Shake",
    category: "Shakes",
    price: 159,
    description: "Rich chocolate milkshake, thick and creamy.",
    art: "shake",
    tone: "chocolate",
    image: "/images/menu/kitkat-shake.jpg",
  },
  {
    id: "oreo-shake",
    name: "Oreo Shake",
    category: "Shakes",
    price: 169,
    description: "Blended with crushed Oreo cookies.",
    art: "shake",
    tone: "oreo",
    badge: "Creamy",
    image: "/images/menu/oreo-shake.jpg",
  },
  {
    id: "kitkat-shake",
    name: "KitKat Shake",
    category: "Shakes",
    price: 189,
    description: "Thick shake with crushed KitKat chunks.",
    art: "shake",
    tone: "kitkat",
    image: "/images/menu/kitkat-shake.jpg",
  },

  /* ------------------------------- COFFEE ------------------------------- */
  {
    id: "hot-coffee",
    name: "Hot Coffee",
    category: "Coffee",
    price: 119,
    description: "Hot, freshly brewed coffee.",
    art: "coffee",
    tone: "hot",
    badge: "Hot",
    image: "/images/menu/hot-coffee.jpg",
  },
  {
    id: "cold-coffee",
    name: "Cold Coffee",
    category: "Coffee",
    price: 139,
    description: "Chilled blended coffee over ice.",
    art: "coldCoffee",
    tone: "cold",
    badge: "Chilled",
    image: "/images/menu/cold-coffee.jpg",
  },
  {
    id: "cold-coffee-ice-cream",
    name: "Cold Coffee with Ice Cream",
    category: "Coffee",
    price: 159,
    description: "Cold coffee crowned with an ice cream scoop.",
    art: "coldCoffee",
    tone: "icecream",
    badge: "Signature",
    image: "/images/menu/cold-coffee-ice-cream.jpg",
  },
  {
    id: "iced-coffee",
    name: "Iced Coffee",
    category: "Coffee",
    price: 149,
    description: "Slow-poured coffee served over ice.",
    art: "coldCoffee",
    tone: "iced",
    badge: "Iced",
    image: "/images/menu/iced-coffee.jpg",
  },
  {
    id: "oreo-cold-coffee",
    name: "Oreo Cold Coffee",
    category: "Coffee",
    price: 159,
    description: "Cold coffee blended with Oreo cookies.",
    art: "coldCoffee",
    tone: "oreo",
    image: "/images/menu/oreo-cold-coffee.jpg",
  },

  /* --------------------------------- TEA --------------------------------- */
  {
    id: "tea-one-cup",
    name: "One Cup Tea",
    category: "Tea",
    price: 1,
    description: "One cup of tea",
    art: "coffee",
    tone: "hot",
    image: "/images/menu/hot-coffee.jpg",
  },

  /* ----------------------------- SANDWICHES ----------------------------- */
  {
    id: "veg-sandwich",
    name: "Veg Sandwich",
    category: "Sandwiches",
    price: 129,
    description: "Grilled sandwich with a seasoned vegetable filling.",
    art: "sandwich",
    tone: "veg",
    image: "/images/menu/veg-sandwich.jpg",
  },
  {
    id: "aloo-sandwich",
    name: "Aloo Sandwich",
    category: "Sandwiches",
    price: 129,
    description: "Classic spiced potato sandwich.",
    art: "sandwich",
    tone: "aloo",
    image: "/images/menu/aloo-sandwich.jpg",
  },
  {
    id: "cheese-sandwich",
    name: "Cheese Sandwich",
    category: "Sandwiches",
    price: 149,
    description: "Melted cheese with a creamy spread.",
    art: "sandwich",
    tone: "cheese",
    badge: "Cheese",
    image: "/images/menu/cheese-sandwich.jpg",
  },
  {
    id: "paneer-sandwich",
    name: "Paneer Sandwich",
    category: "Sandwiches",
    price: 169,
    description: "Spiced paneer with sauce, toasted.",
    art: "sandwich",
    tone: "paneer",
    image: "/images/menu/paneer-sandwich.jpg",
  },
  {
    id: "jumbo-sandwich",
    name: "Jumbo Sandwich",
    category: "Sandwiches",
    price: 189,
    description: "The larger, loaded sandwich option.",
    art: "sandwich",
    tone: "jumbo",
    badge: "Jumbo",
    image: "/images/menu/jumbo-sandwich.jpg",
  },

  /* -------------------------------- MOMOS ------------------------------- */
  {
    id: "veg-momos",
    name: "Veg Momos",
    category: "Momos",
    price: 139,
    description: "Soft steamed momos with a vegetable filling.",
    art: "momo",
    tone: "veg",
    image: "/images/menu/veg-momos.jpg",
  },
  {
    id: "paneer-momos",
    name: "Paneer Momos",
    category: "Momos",
    price: 159,
    description: "Momos filled with spiced paneer.",
    art: "momo",
    tone: "paneer",
    badge: "Spiced",
    image: "/images/menu/veg-momos.jpg",
  },
  {
    id: "kurkure-momos",
    name: "Kurkure Momos",
    category: "Momos",
    price: 169,
    description: "Crisp-topped momos with a crunchy coating.",
    art: "momo",
    tone: "kurkure",
    image: "/images/menu/kurkure-momos.jpg",
  },

  /* -------------------------------- PASTA ------------------------------- */
  {
    id: "veg-pasta",
    name: "Veg Pasta",
    category: "Pasta",
    price: 149,
    description: "Pasta tossed in a seasoned tomato sauce.",
    art: "pasta",
    tone: "veg",
    image: "/images/menu/veg-pasta.jpg",
  },
  {
    id: "cheese-pasta",
    name: "Cheese Pasta",
    category: "Pasta",
    price: 159,
    description: "Creamy pasta loaded with melted cheese.",
    art: "pasta",
    tone: "cheese",
    badge: "Creamy",
    image: "/images/menu/cheese-pasta.jpg",
  },
  {
    id: "paneer-pasta",
    name: "Paneer Pasta",
    category: "Pasta",
    price: 169,
    description: "Pasta with savoury spiced paneer.",
    art: "pasta",
    tone: "paneer",
    image: "/images/menu/paneer-pasta.jpg",
  },

  /* -------------------------------- MAGGI ------------------------------- */
  {
    id: "veg-maggi",
    name: "Veg Maggi",
    category: "Maggi",
    price: 119,
    description: "Classic noodles, cooked hot and ready to eat.",
    art: "maggi",
    tone: "veg",
    image: "/images/menu/veg-maggi.jpg",
  },
  {
    id: "cheese-maggi",
    name: "Cheese Maggi",
    category: "Maggi",
    price: 139,
    description: "Noodles topped with melted cheese.",
    art: "maggi",
    tone: "cheese",
    image: "/images/menu/veg-maggi.jpg",
  },
  {
    id: "paneer-maggi",
    name: "Paneer Maggi",
    category: "Maggi",
    price: 159,
    description: "Noodles with spiced paneer on top.",
    art: "maggi",
    tone: "paneer",
    image: "/images/menu/paneer-maggi.jpg",
  },

  /* ------------------------------- COMBOS ------------------------------- */
  {
    id: "classic-combo",
    name: "Classic Combo",
    category: "Combos",
    price: 219,
    description: combosNote,
    art: "combo",
    tone: "classic",
    image: "/images/menu/classic-combo.jpg",
  },
  {
    id: "maggi-combo",
    name: "Maggi Combo",
    category: "Combos",
    price: 219,
    description: "A Maggi-based combo option.",
    art: "combo",
    tone: "maggi",
    image: "/images/menu/maggi-combo.jpg",
  },
  {
    id: "momo-combo",
    name: "Momo Combo",
    category: "Combos",
    price: 229,
    description: "A momo-based combo option.",
    art: "combo",
    tone: "momo",
    image: "/images/menu/momo-combo.jpg",
  },
  {
    id: "paneer-sandwich-combo",
    name: "Paneer Sandwich Combo",
    category: "Combos",
    price: 239,
    description: "Built around the paneer sandwich.",
    art: "combo",
    tone: "paneer",
    image: "/images/menu/paneer-sandwich-combo.jpg",
  },
  {
    id: "paneer-oreo-combo",
    name: "Paneer & Oreo Combo",
    category: "Combos",
    price: 279,
    description: "Pairs a paneer item with an Oreo shake.",
    art: "combo",
    tone: "oreo",
    image: "/images/menu/paneer-oreo-combo.jpg",
  },
  {
    id: "jumbo-shake-combo",
    name: "Jumbo Shake Combo",
    category: "Combos",
    price: 329,
    description: "A larger shake combo option.",
    art: "combo",
    tone: "shake",
    image: "/images/menu/jumbo-shake-combo.jpg",
  },
  {
    id: "double-coffee-combo",
    name: "Double Coffee Combo",
    category: "Combos",
    price: 299,
    description: "A coffee combo for two.",
    art: "combo",
    tone: "coffee",
    image: "/images/menu/double-coffee-combo.jpg",
  },
  {
    id: "momos-for-two",
    name: "Momos for Two",
    category: "Combos",
    price: 349,
    description: "A two-serving momos combo.",
    art: "combo",
    tone: "two",
    badge: "For Two",
    image: "/images/menu/momos-for-two.jpg",
  },
  {
    id: "couple-sandwich-combo",
    name: "Couple Sandwich Combo",
    category: "Combos",
    price: 399,
    description: "A sandwich combo for two.",
    art: "combo",
    tone: "couple",
    badge: "For Two",
    image: "/images/menu/couple-sandwich-combo.jpg",
  },
  {
    id: "jumbo-meal-combo",
    name: "Jumbo Meal Combo",
    category: "Combos",
    price: 399,
    description: "One of the larger combo meals.",
    art: "combo",
    tone: "jumbo",
    badge: "Jumbo",
    image: "/images/menu/jumbo-meal-combo.jpg",
  },
];

/* ------------------------------ Derived data ------------------------------ */

export const FEATURED_IDS = [
  "orange-juice",
  "kitkat-shake",
  "pomegranate-juice",
];

export const COMBO_IDS = [
  "classic-combo",
  "momo-combo",
  "paneer-sandwich-combo",
  "paneer-oreo-combo",
  "momos-for-two",
  "couple-sandwich-combo",
  "jumbo-meal-combo",
];

const byId = new Map(MENU_ITEMS.map((item) => [item.id, item]));

export const featuredItems = FEATURED_IDS.map((id) => byId.get(id)).filter(Boolean);

export const comboItems = COMBO_IDS.map((id) => byId.get(id)).filter(Boolean);

export const itemsByCategory = (category) =>
  category === "All" ? MENU_ITEMS : MENU_ITEMS.filter((item) => item.category === category);

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const formatPrice = (price) => `\u20b9${inr.format(price)}`;

export const countByCategory = (category) =>
  category === "All" ? MENU_ITEMS.length : MENU_ITEMS.filter((i) => i.category === category).length;
