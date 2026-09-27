# Photography drop-in folder

Real JOC photography was not available for this concept build, so every image on
the site is currently a built-in illustration (`src/components/FoodArt.jsx`).

## How to swap in real photos

1. Put the image files in this folder, e.g. `paneer-momos.jpg`.
2. Reference the path from data — no component changes needed:

**Menu items** — `src/data/menu.js`

```js
{
  id: "paneer-momos",
  name: "Paneer Momos",
  // ...
  image: "/images/paneer-momos.jpg",   // was: null
}
```

**Gallery** — `src/data/gallery.js`

```js
{
  id: "g5",
  src: "/images/momos.jpg",           // was: undefined
  alt: "Steamed paneer momos served at JOC",
  w: 1200,
  h: 1500,
}
```

3. Keep `w` / `h` on gallery entries accurate. They reserve space and prevent
   layout shift while the image loads.

## Notes

- Suggested export: WebP or AVIF, longest edge ~1400px, under ~200 KB each.
- Do not present the built-in illustrations as photographs of the cafe. Once real
  photos are added, remove the "demo artwork" notes in `Hero`, `Gallery` and
  `Location` if they no longer apply.
