# JOC — Juice On Choice · Website Concept

A premium single-page concept website for **JOC Juice and Cafe**, Dixit Colony,
Marhatal, Jabalpur.

> **This is a concept/demo build prepared for a website proposal.** It is not the
> official website of JOC Juice and Cafe. Menu and pricing are demo data taken from
> the business's current public listing and must be confirmed with the business
> before production launch.

## Stack

- React 19 + Vite
- Plain CSS with design tokens (no UI framework)
- `lucide-react` for icons
- Zero runtime dependencies beyond React and the icon set

## Run it

```bash
npm install
npm run dev      # dev server
npm run build    # production build to dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

## Editing the content

All content is data-driven. You should not need to touch a component to change
copy, prices or images.

| What | Where |
| --- | --- |
| Menu items, prices, categories, badges | `src/data/menu.js` |
| Gallery entries | `src/data/gallery.js` |
| Category highlight cards | `src/data/categories.js` |
| Name, address, contact, disclaimer text | `src/data/business.js` |
| Design tokens, colours, type scale | `src/index.css` (`:root`) |
| Section styles | `src/components/*.module.css` |

### Swapping illustrations for real photos

Every image is currently a generated SVG illustration in `FoodArt.jsx`. Drop real
files into `public/images/` and set the `image` (menu) or `src` (gallery) field —
the illustration is replaced automatically. See `public/images/README.md`.

### Swapping the logo

The header uses a temporary text wordmark plus a small inline SVG mark. Replace the
`logoMark` block in `src/components/Navbar.jsx` with an `<img>` once the official
JOC logo is supplied.

## Factual content policy

Only verifiable public information is used: business name, address, menu
categories, currently listed items and prices, and the Google Maps location.

Deliberately **not** included anywhere on the site, because none of it is
verified:

- an official JOC phone number or email address
- a JOC Instagram / Facebook / other social handle
- founder or owner names
- establishment year, branch count, awards, reviews or ratings
- "best in Jabalpur" style claims, "#1", or customer counts
- opening hours in the page or in the structured data

The enquiry section routes to the developer's temporary contact details and says
so explicitly. `index.html` contains `CafeOrCoffeeShop` structured data limited to
name, address and category — no phone, no opening hours, no aggregate rating.

## Before going live

1. Confirm the menu, prices and item descriptions with the client.
2. Replace the illustrations with real photography.
3. Replace the temporary wordmark with the official logo.
4. Swap the developer's contact details for the business's own, in
   `src/data/business.js`.
5. Add the live domain as `<link rel="canonical">` and a real 1200×630 OG image.
6. Remove the concept/demo wording from the hero, contact section and footer.
