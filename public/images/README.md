# Photography drop-in folder

Real JOC photography was not available for this concept build, so every product
image on the site is currently a built-in illustration
(`src/components/FoodArt.jsx`), rendered inside a shared studio-lighting setup
(soft warm halo + contact shadow) so it already behaves like a product shot.

## Folder layout

```
public/
  images/
    menu/            <- product photography (one file per menu item)
      paneer-momos.webp
      cold-coffee.webp
    gallery/         <- cafe / interior photography (optional)
```

## How to swap in real photos

1. Put the image files in `public/images/menu/`.
2. Reference the path from data — no component changes needed:

**Menu items** — `src/data/menu.js`

```js
{
  id: "paneer-momos",
  name: "Paneer Momos",
  // ...
  image: "/images/menu/paneer-momos.webp",   // was: null
}
```

**Gallery** — `src/data/gallery.js`

```js
{
  id: "g5",
  src: "/images/menu/momos.webp",           // was: undefined
  alt: "Steamed paneer momos served at JOC",
  w: 1200,
  h: 1500,
}
```

3. Keep `w` / `h` on gallery entries accurate. They reserve space and prevent
   layout shift while the image loads.

## File naming

Use the menu item's `id` from `src/data/menu.js` as the filename
(e.g. `id: "paneer-momos"` → `/images/menu/paneer-momos.webp`), so a photo can
be matched to a product without guessing.

## Shot requirements

Menu cards render the image in a **square (1:1)** frame, so export square:

- `object-fit: cover` in a 1/1 frame — compose with the product centred and
  roughly 55–75% of the frame, with breathing room on all sides.
- One consistent style across the whole menu: realistic, appetizing,
  studio/café lighting, warm cream or neutral uncluttered background.
- Consistent camera angle, lighting direction and crop between items.
- No text, watermarks, logos, borders, fake UI or heavily saturated filters.
- Do not mix sources: if one item has a real photo, the rest should be shot the
  same way — a single mismatched stock image is worse than keeping the
  illustration.

## Notes

- Suggested export: WebP, longest edge ~1400px, under ~200 KB each. AVIF is fine
  too if you add a fallback.
- `MenuCard` automatically switches alt text and accessibility behaviour when
  `image` is set: the photo is announced as the product name, while the
  illustration stays decorative. Nothing else changes.
- Do not present the built-in illustrations as photographs of the cafe. Once real
  photos are added, remove the "demo artwork" notes in `Hero`, `Gallery` and
  `Location` if they no longer apply.
