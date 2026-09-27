import { useId } from "react";

/**
 * Built-in demo artwork.
 *
 * No verified official JOC photography or logo artwork was available for this
 * concept build, so every image on this site is a generated illustration in the
 * JOC palette. These are NOT photographs of the actual cafe.
 *
 * To use real photos later, set `image: "/images/your-file.jpg"` on a menu or
 * gallery entry — the illustration is replaced automatically and no component
 * needs to change.
 */

const TONES = {
  apple: { bg: "#EDF7E8", liquid: "#A9D96B", liquidTop: "#C6EA8F", deep: "#6CB03C", fruit: "#D8443C", fruit2: "#4C9A2A" },
  orange: { bg: "#FFF1E4", liquid: "#FF9A4D", liquidTop: "#FFBE7C", deep: "#F2661F", fruit: "#FF8A2B", fruit2: "#4C9A2A" },
  banana: { bg: "#FDF6DC", liquid: "#F7DC6F", liquidTop: "#FCEB9E", deep: "#DFB538", fruit: "#F6E27A", fruit2: "#6C8F2A" },
  pomegranate: { bg: "#FBE8EB", liquid: "#C62A4E", liquidTop: "#DC5573", deep: "#8E1734", fruit: "#C62A4E", fruit2: "#4C9A2A" },
  watermelon: { bg: "#EFF7ED", liquid: "#E8455F", liquidTop: "#F27A8C", deep: "#C22C45", fruit: "#E8455F", fruit2: "#3FA34D" },

  chocolate: { bg: "#F5EDE5", cream: "#C98B5E", creamTop: "#DCA878", drizzle: "#4A2A1A", accent: "#F0C46A" },
  oreo: { bg: "#EDF0F3", cream: "#F0EDE4", creamTop: "#FBF8F1", drizzle: "#2C2C2C", accent: "#8C8C8C" },
  kitkat: { bg: "#FBEFE5", cream: "#E4B487", creamTop: "#EEC7A4", drizzle: "#8B4A2B", accent: "#D9603A" },

  hot: { bg: "#F4EEE5", cup: "#FFFFFF", coffee: "#4A3226", crema: "#B98A5F" },
  cold: { bg: "#EFEAF2", base: "#9A6E45", baseTop: "#C79A6D", top: "#F1E5D6", drizzle: "#4A2A1A" },
  icecream: { bg: "#F7EEF0", base: "#A9744B", baseTop: "#C08F60", top: "#F7E7D8", drizzle: "#4A2A1A" },
  iced: { bg: "#ECF1F4", base: "#4E3222", baseTop: "#6B452C", top: "#C69A6C", drizzle: "#3A2216" },

  veg: { bg: "#EFF6EA", bread: "#EAB873", breadTop: "#F2C68D", leaf: "#5BAE3F", tomato: "#E4483D", cheese: "#F5C948" },
  aloo: { bg: "#F7F1E5", bread: "#E6B26B", breadTop: "#EEC289", leaf: "#6BBF4A", tomato: "#D9553F", cheese: "#EFD08C" },
  cheese: { bg: "#FBF3E1", bread: "#E7B368", breadTop: "#F0C383", leaf: "#66B94A", tomato: "#E4483D", cheese: "#F5C242" },
  paneer: { bg: "#F6F1E9", bread: "#E3AE67", breadTop: "#EEC08A", leaf: "#4FA83B", tomato: "#D9553F", cheese: "#F0D3A0" },
  jumbo: { bg: "#F1F4ED", bread: "#DFA85F", breadTop: "#EABC80", leaf: "#4FA83B", tomato: "#D9553F", cheese: "#F2CE62" },
  kurkure: { bg: "#F7EFE1", bread: "#E9B573", breadTop: "#F1C68D", leaf: "#7A6A4F", tomato: "#C98A3C", cheese: "#D08A2C" },
  vegAlt: { bg: "#F4F0E6", bread: "#E7B26B", breadTop: "#EFC48C", leaf: "#5BAE3F", tomato: "#D9553F", cheese: "#F0CE76" },

  classic: { bg: "#F4F2E7", glass: "#FF9A4D", glassDeep: "#F2661F", bread: "#E3AE67", cup: "#4A3226" },
  combo: { bg: "#F1F4EC", glass: "#9BE564", glassDeep: "#4CC24A", bread: "#E3AE67", cup: "#4A3226" },
};

const tone = (key) => TONES[key] || TONES.combo;

const Backdrop = ({ fill }) => (
  <>
    <circle cx="200" cy="212" r="168" fill={fill} />
    <ellipse cx="200" cy="352" rx="106" ry="13" fill="#0F1A12" opacity=".07" />
  </>
);

/* ------------------------------ JUICES ------------------------------ */

function Juice({ t }) {
  const clip = useId();
  return (
    <>
      <Backdrop fill={t.bg} />
      <defs>
        <clipPath id={clip}>
          <path d="M142 114h116l-14 190a24 24 0 0 1-24 19h-40a24 24 0 0 1-24-19l-14-190Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="110" y="110" width="180" height="220" fill="#FFFFFF" opacity=".5" />
        <rect x="110" y="178" width="180" height="160" fill={t.liquid} />
        <rect x="110" y="178" width="180" height="46" fill={t.liquidTop} />
        <rect x="110" y="216" width="180" height="10" fill="#FFFFFF" opacity=".16" />
        <rect x="150" y="192" width="30" height="28" rx="8" fill="#FFFFFF" opacity=".4" transform="rotate(-14 165 206)" />
        <rect x="200" y="216" width="27" height="25" rx="7" fill="#FFFFFF" opacity=".3" transform="rotate(18 213 228)" />
        <rect x="156" y="120" width="16" height="200" fill="#FFFFFF" opacity=".22" />
      </g>
      <path d="M142 114h116l-14 190a24 24 0 0 1-24 19h-40a24 24 0 0 1-24-19l-14-190Z" fill="none" stroke="#0F1A12" strokeOpacity=".13" strokeWidth="3" />
      <ellipse cx="200" cy="114" rx="58" ry="11" fill="#FFFFFF" opacity=".75" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <g transform="rotate(12 236 92)">
        <rect x="229" y="24" width="14" height="164" rx="7" fill="#FDE047" />
        <rect x="229" y="130" width="14" height="58" rx="7" fill={t.deep} opacity=".5" />
      </g>
      <g transform="translate(272 172)">
        <circle r="33" fill={t.fruit} />
        <path d="M0-28V28M-28 0H28" stroke="#FFFFFF" strokeOpacity=".38" strokeWidth="3" />
        <circle r="33" fill="none" stroke="#0F1A12" strokeOpacity=".1" strokeWidth="2" />
        <path d="M4-30c16-12 34-8 42 4-13 10-31 8-42-4Z" fill={t.fruit2} />
      </g>
    </>
  );
}

/* ------------------------------ SHAKES ------------------------------ */

function Shake({ t }) {
  const clip = useId();
  return (
    <>
      <Backdrop fill={t.bg} />
      <defs>
        <clipPath id={clip}>
          <path d="M140 152h120l-14 158a24 24 0 0 1-24 20h-44a24 24 0 0 1-24-20l-14-158Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="110" y="148" width="180" height="200" fill="#FFFFFF" opacity=".48" />
        <rect x="110" y="196" width="180" height="160" fill={t.cream} />
        <rect x="110" y="196" width="180" height="34" fill={t.creamTop} />
        <rect x="150" y="240" width="18" height="100" fill="#FFFFFF" opacity=".2" />
      </g>
      <path d="M140 152h120l-14 158a24 24 0 0 1-24 20h-44a24 24 0 0 1-24-20l-14-158Z" fill="none" stroke="#0F1A12" strokeOpacity=".13" strokeWidth="3" />
      <ellipse cx="200" cy="196" rx="53" ry="12" fill={t.creamTop} />
      <g transform="rotate(-13 218 96)">
        <rect x="211" y="16" width="14" height="168" rx="7" fill={t.drizzle} opacity=".85" />
        <rect x="211" y="16" width="6" height="168" fill="#FFFFFF" opacity=".18" />
      </g>
      <ellipse cx="200" cy="152" rx="60" ry="11" fill="none" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <g fill="#FFFBF4">
        <ellipse cx="200" cy="150" rx="48" ry="16" />
        <ellipse cx="184" cy="130" rx="33" ry="14" />
        <ellipse cx="214" cy="115" rx="23" ry="12" />
        <ellipse cx="199" cy="100" rx="12" ry="9" />
      </g>
      <path d="M160 152c11 11 21-9 32 2s21-9 32 2 20-7 27-1" fill="none" stroke={t.drizzle} strokeWidth="6" strokeLinecap="round" />
      <g>
        <rect x="176" y="116" width="9" height="4" rx="2" fill={t.accent} transform="rotate(-24 180 118)" />
        <rect x="208" y="128" width="9" height="4" rx="2" fill="#E8455F" transform="rotate(18 212 130)" />
        <rect x="228" y="140" width="9" height="4" rx="2" fill={t.accent} transform="rotate(-40 232 142)" />
        <rect x="166" y="136" width="9" height="4" rx="2" fill="#4CC24A" transform="rotate(32 170 138)" />
        <rect x="196" y="140" width="9" height="4" rx="2" fill="#FDE047" transform="rotate(-8 200 142)" />
      </g>
    </>
  );
}

/* ------------------------------ COFFEE ------------------------------ */

function Coffee({ t }) {
  return (
    <>
      <Backdrop fill={t.bg} />
      <g stroke="#0F1A12" strokeOpacity=".12" strokeWidth="5" fill="none" strokeLinecap="round">
        <path d="M176 152c-13-15 13-23 0-40" />
        <path d="M204 146c-13-15 13-25 0-42" />
        <path d="M232 152c-13-15 13-23 0-38" />
      </g>
      <ellipse cx="200" cy="304" rx="104" ry="27" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".1" strokeWidth="3" />
      <ellipse cx="200" cy="300" rx="66" ry="15" fill="#F1ECE3" />
      <path d="M142 168h116v58a50 50 0 0 1-50 50h-16a50 50 0 0 1-50-50v-58Z" fill={t.cup} stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <path d="M258 186h16a30 30 0 0 1 0 60h-16v-13h13a17 17 0 0 0 0-34h-13v-13Z" fill={t.cup} stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <ellipse cx="200" cy="168" rx="58" ry="14" fill={t.coffee} />
      <ellipse cx="200" cy="168" rx="58" ry="14" fill="none" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <ellipse cx="200" cy="166" rx="44" ry="9" fill={t.crema} opacity=".85" />
      <ellipse cx="190" cy="164" rx="18" ry="4" fill="#FFFFFF" opacity=".22" />
    </>
  );
}

function ColdCoffee({ t }) {
  const clip = useId();
  return (
    <>
      <Backdrop fill={t.bg} />
      <defs>
        <clipPath id={clip}>
          <path d="M142 118h116l-14 186a24 24 0 0 1-24 19h-40a24 24 0 0 1-24-19l-14-186Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="110" y="114" width="180" height="216" fill="#FFFFFF" opacity=".48" />
        <rect x="110" y="196" width="180" height="140" fill={t.base} />
        <rect x="110" y="196" width="180" height="60" fill={t.baseTop} />
        <rect x="110" y="250" width="180" height="16" fill={t.base} opacity=".55" />
        <rect x="110" y="196" width="180" height="34" fill={t.top} opacity=".9" />
        <rect x="146" y="204" width="30" height="27" rx="8" fill="#FFFFFF" opacity=".38" transform="rotate(-12 161 217)" />
        <rect x="196" y="226" width="26" height="24" rx="7" fill="#FFFFFF" opacity=".28" transform="rotate(16 209 238)" />
        <rect x="156" y="126" width="17" height="196" fill="#FFFFFF" opacity=".22" />
      </g>
      <path d="M142 118h116l-14 186a24 24 0 0 1-24 19h-40a24 24 0 0 1-24-19l-14-186Z" fill="none" stroke="#0F1A12" strokeOpacity=".13" strokeWidth="3" />
      <ellipse cx="200" cy="118" rx="58" ry="11" fill="#FFFFFF" opacity=".75" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <g transform="rotate(11 232 96)">
        <rect x="225" y="20" width="14" height="164" rx="7" fill={t.drizzle} />
        <rect x="225" y="20" width="5" height="164" fill="#FFFFFF" opacity=".2" />
      </g>
      <g fill={t.drizzle} opacity=".7">
        <circle cx="186" cy="206" r="3" />
        <circle cx="204" cy="216" r="2.5" />
        <circle cx="216" cy="204" r="2" />
      </g>
    </>
  );
}

/* ---------------------------- SANDWICHES ---------------------------- */

function Sandwich({ t }) {
  const clip = useId();
  return (
    <>
      <Backdrop fill={t.bg} />
      <defs>
        <clipPath id={clip}>
          <path d="M200 84 314 268a18 18 0 0 1-14 29H100a18 18 0 0 1-14-29L200 84Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="80" y="84" width="240" height="214" fill={t.breadTop} />
        <rect x="80" y="128" width="240" height="18" fill={t.cheese} />
        <rect x="80" y="146" width="240" height="26" fill={t.leaf} />
        <rect x="80" y="172" width="240" height="16" fill={t.tomato} />
        <rect x="80" y="188" width="240" height="30" fill={t.cheese} opacity=".95" />
        <rect x="80" y="218" width="240" height="22" fill={t.leaf} opacity=".9" />
        <rect x="80" y="240" width="240" height="60" fill={t.bread} />
        <g stroke="#0F1A12" strokeOpacity=".12" strokeWidth="5" strokeLinecap="round">
          <path d="M150 100 178 126" />
          <path d="M186 96 214 122" />
          <path d="M222 92 250 118" />
        </g>
        <rect x="150" y="96" width="14" height="220" fill="#FFFFFF" opacity=".14" />
      </g>
      <path d="M200 84 314 268a18 18 0 0 1-14 29H100a18 18 0 0 1-14-29L200 84Z" fill="none" stroke="#0F1A12" strokeOpacity=".14" strokeWidth="3" />
      <g transform="translate(300 214)">
        <circle r="26" fill="#4CC24A" />
        <path d="M-14 0a14 14 0 0 1 14-14c-2 10-6 14-14 14Z" fill="#0F1A12" opacity=".14" />
      </g>
    </>
  );
}

/* ------------------------------ MOMOS ------------------------------ */

function Momo({ t }) {
  const dough = t.bread;
  const pleat = "#0F1A12";
  return (
    <>
      <Backdrop fill={t.bg} />
      <g transform="translate(158 196) scale(0.78)">
        <path d="M0 0c-30 0-48 24-48 48 0 24 20 38 48 38s48-14 48-38C48 24 30 0 0 0Z" fill={dough} stroke={pleat} strokeOpacity=".14" strokeWidth="4" />
        <g stroke={pleat} strokeOpacity=".16" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M0 -46v46" />
          <path d="M-20 -42c-8 18-12 30-12 44" />
          <path d="M20 -42c8 18 12 30 12 44" />
        </g>
        <path d="M-42 44c14 8 70 8 84 0" stroke={pleat} strokeOpacity=".14" strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
      <g transform="translate(248 206) scale(0.62)">
        <path d="M0 0c-30 0-48 24-48 48 0 24 20 38 48 38s48-14 48-38C48 24 30 0 0 0Z" fill={t.cheese} stroke={pleat} strokeOpacity=".14" strokeWidth="4" />
        <g stroke={pleat} strokeOpacity=".16" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M0 -46v46" />
          <path d="M-20 -42c-8 18-12 30-12 44" />
          <path d="M20 -42c8 18 12 30 12 44" />
        </g>
      </g>
      <path d="M118 250h164l-16 66a24 24 0 0 1-24 18h-84a24 24 0 0 1-24-18l-16-66Z" fill="#FFFFFF" stroke={pleat} strokeOpacity=".12" strokeWidth="3" />
      <ellipse cx="200" cy="250" rx="82" ry="20" fill="#F1EBE0" stroke={pleat} strokeOpacity=".12" strokeWidth="3" />
      <ellipse cx="200" cy="250" rx="66" ry="14" fill="#E7DFD1" />
      <g stroke={pleat} strokeOpacity=".1" strokeWidth="4" fill="none">
        <path d="M150 268c22 10 78 10 100 0" />
        <path d="M160 288c20 8 60 8 80 0" />
      </g>
    </>
  );
}

/* ------------------------------- PASTA ------------------------------ */

function Pasta({ t }) {
  const clip = useId();
  return (
    <>
      <Backdrop fill={t.bg} />
      <defs>
        <clipPath id={clip}>
          <ellipse cx="196" cy="230" rx="116" ry="34" />
        </clipPath>
      </defs>
      <path d="M80 230h232l-26 84a34 34 0 0 1-32 24H138a34 34 0 0 1-32-24L80 230Z" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <path d="M80 230h232l-4 13H84l-4-13Z" fill={t.cheese} opacity=".55" />
      <ellipse cx="196" cy="230" rx="116" ry="34" fill={t.bread} />
      <g clipPath={`url(#${clip})`}>
        <rect x="70" y="192" width="252" height="80" fill={t.cheese} />
        <rect x="70" y="240" width="252" height="34" fill={t.bread} />
        <g stroke={t.breadTop} strokeWidth="13" fill="none" strokeLinecap="round" opacity=".95">
          <path d="M96 236c22-20 60-22 84-4s58 18 96 2" />
          <path d="M104 216c26 14 52-10 78 2s52 18 84 2" />
          <path d="M92 254c30-10 54 12 84 0s58-10 88 4" />
        </g>
        <circle cx="150" cy="216" r="7" fill="#D9553F" opacity=".9" />
        <circle cx="230" cy="244" r="6" fill="#D9553F" opacity=".9" />
        <circle cx="196" cy="206" r="5" fill="#4FA83B" opacity=".9" />
      </g>
      <ellipse cx="196" cy="230" rx="116" ry="34" fill="none" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <g transform="translate(292 214) rotate(16)">
        <path d="M0 0h10v96H0z" fill="#0F1A12" opacity=".55" />
        <g fill="#0F1A12" opacity=".55">
          <rect x="-14" y="-16" width="6" height="20" rx="3" />
          <rect x="-4" y="-18" width="6" height="22" rx="3" />
          <rect x="6" y="-16" width="6" height="20" rx="3" />
        </g>
        <rect x="0" y="92" width="10" height="34" rx="5" fill="#0F1A12" opacity=".35" />
      </g>
    </>
  );
}

/* ------------------------------- MAGGI ------------------------------ */

function Maggi({ t }) {
  const clip = useId();
  return (
    <>
      <Backdrop fill={t.bg} />
      <g stroke="#0F1A12" strokeOpacity=".13" strokeWidth="5" fill="none" strokeLinecap="round">
        <path d="M168 138c-12-14 12-22 0-38" />
        <path d="M200 128c-12-14 12-24 0-40" />
        <path d="M232 138c-12-14 12-22 0-38" />
      </g>
      <path d="M92 208h216l-24 88a36 36 0 0 1-34 26h-100a36 36 0 0 1-34-26l-24-88Z" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <path d="M92 208h216l-4 12H96l-4-12Z" fill={t.noodleDeep ?? t.breadTop} opacity=".5" />
      <ellipse cx="200" cy="208" rx="108" ry="30" fill={t.bread} />
      <defs>
        <clipPath id={clip}>
          <ellipse cx="200" cy="208" rx="108" ry="30" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="80" y="176" width="240" height="64" fill={t.breadTop ?? t.bread} />
        <g stroke={t.bread} strokeWidth="9" fill="none" strokeLinecap="round">
          <path d="M100 214c24-16 52 8 76-2s54 12 84-2" />
          <path d="M110 196c26 12 48-8 74 2s50 12 78-2" />
        </g>
        <circle cx="160" cy="200" r="5" fill="#5BAE3F" />
        <circle cx="236" cy="218" r="5" fill="#5BAE3F" />
      </g>
      <ellipse cx="200" cy="208" rx="108" ry="30" fill="none" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
      <g transform="rotate(24 262 150)">
        <rect x="250" y="52" width="8" height="180" rx="4" fill="#B98A5F" />
        <rect x="264" y="46" width="8" height="184" rx="4" fill="#A87A50" />
      </g>
    </>
  );
}

/* ------------------------------- COMBO ------------------------------ */

const MiniGlass = ({ liquid = "#FF9A4D", deep = "#F2661F" }) => (
  <g>
    <path d="M-24 -54h48l-7 78a10 10 0 0 1-10 9h-14a10 10 0 0 1-10-9l-7-78Z" fill="#FFFFFF" opacity=".7" />
    <path d="M-20 -16h40l-5 40a9 9 0 0 1-9 8h-12a9 9 0 0 1-9-8l-5-40Z" fill={liquid} />
    <path d="M-20 -16h40l-1 8h-38l-1-8Z" fill={deep} opacity=".5" />
    <path d="M-24 -54h48l-7 78a10 10 0 0 1-10 9h-14a10 10 0 0 1-10-9l-7-78Z" fill="none" stroke="#0F1A12" strokeOpacity=".14" strokeWidth="3" />
    <ellipse cx="0" cy="-54" rx="24" ry="5" fill="#FFFFFF" opacity=".8" />
    <rect x="7" y="-104" width="6" height="62" rx="3" transform="rotate(10 10 -73)" fill="#FDE047" />
  </g>
);

const MiniCup = () => (
  <g>
    <path d="M-30 -34h60v30a26 26 0 0 1-26 26h-8a26 26 0 0 1-26-26v-30Z" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
    <path d="M30 -26h10a16 16 0 0 1 0 32H30v-7h8a9 9 0 0 0 0-18h-8v-7Z" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" />
    <ellipse cx="0" cy="-34" rx="30" ry="8" fill="#4A3226" />
    <g stroke="#0F1A12" strokeOpacity=".12" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M-12 -48c-6-8 6-12 0-20" />
      <path d="M10 -50c-6-8 6-14 0-22" />
    </g>
  </g>
);

const MiniMomos = ({ t }) => (
  <g>
    <path d="M-34 6c0-20 14-32 30-32S26-14 26 6 12 26-4 26s-30-6-30-20Z" fill={t.bread} />
    <g stroke="#0F1A12" strokeOpacity=".16" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M-4 -24V0" />
      <path d="M-16 -22c-4 10-6 16-6 24" />
      <path d="M8 -22c4 10 6 16 6 24" />
    </g>
    <path d="M14 16c0-14 10-22 20-22s20 8 20 22-9 14-20 14-20-2-20-14Z" fill={t.cheese} />
  </g>
);

function Combo({ t }) {
  return (
    <>
      <circle cx="200" cy="212" r="168" fill={t.bg} />
      <ellipse cx="200" cy="352" rx="118" ry="14" fill="#0F1A12" opacity=".07" />
      <circle cx="200" cy="238" r="126" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".1" strokeWidth="3" />
      <circle cx="200" cy="238" r="102" fill="none" stroke={t.glass} strokeOpacity=".35" strokeWidth="3" />
      <g transform="translate(118 196) scale(0.92)">
        <MiniGlass liquid="#FF9A4D" deep="#F2661F" />
      </g>
      <g transform="translate(196 208)">
        <path d="M0 -54 56 24H-56Z" fill={t.bread} stroke="#0F1A12" strokeOpacity=".13" strokeWidth="3" />
        <path d="M-45 8h90l-4 12h-82l-4-12Z" fill="#5BAE3F" />
        <path d="M-52 20h104l-3 10H-49l-3-10Z" fill="#F5C948" />
      </g>
      <g transform="translate(268 202)">
        <MiniCup />
      </g>
      <g transform="translate(150 288) scale(0.92)">
        <MiniMomos t={t} />
      </g>
      <g transform="translate(258 290)">
        <circle r="22" fill="#4CC24A" />
        <path d="M-10 0a10 10 0 0 1 10-10c-2 8-4 10-10 10Z" fill="#0F1A12" opacity=".14" />
      </g>
    </>
  );
}

/* ----------------------------- STOREFRONT --------------------------- */

function Storefront() {
  return (
    <>
      <circle cx="200" cy="212" r="168" fill="#EFF3EA" />
      <rect x="52" y="118" width="296" height="212" rx="8" fill="#F6F1E4" />
      <rect x="52" y="118" width="296" height="212" rx="8" fill="none" stroke="#0F1A12" strokeOpacity=".1" strokeWidth="3" />
      <g>
        {Array.from({ length: 7 }).map((_, i) => (
          <path
            key={i}
            d={`M${60 + i * 42} 118h21a26 26 0 0 1 0 40H${60 + i * 42}a26 26 0 0 1 0-40Z`}
            fill={i % 2 === 0 ? "#4CC24A" : "#FFFBF3"}
          />
        ))}
        <rect x="52" y="158" width="296" height="12" fill="#0F1A12" opacity=".08" />
      </g>
      <rect x="118" y="60" width="164" height="58" rx="10" fill="#0F1A12" />
      <text x="200" y="99" textAnchor="middle" fontFamily="Poppins, Segoe UI, sans-serif" fontSize="34" fontWeight="800" fill="#9BE564" letterSpacing="2">
        JOC
      </text>
      <rect x="140" y="186" width="146" height="112" rx="10" fill="#D8E7DA" />
      <g stroke="#0F1A12" strokeOpacity=".12" strokeWidth="4">
        <path d="M213 186v112" />
        <path d="M140 232h146" />
      </g>
      <rect x="140" y="270" width="146" height="28" rx="6" fill="#C2A98A" />
      <g fill="#FFFFFF">
        <path d="M158 234h20l-3 30h-14l-3-30Z" />
        <path d="M196 240h22l-3 24h-16l-3-24Z" />
        <path d="M236 232h18l-3 32h-12l-3-32Z" />
      </g>
      <rect x="292" y="186" width="42" height="144" rx="8" fill="#E4DACA" />
      <circle cx="326" cy="262" r="5" fill="#0F1A12" opacity=".45" />
      <g transform="translate(92 300)">
        <path d="M-16 0h32l-4 26h-24l-4-26Z" fill="#C98B5E" />
        <path d="M0 0c-14-4-18-20-10-28 6 10 12 12 10 28ZM0 0c14-4 18-20 10-28-6 10-12 12-10 28Z" fill="#4CC24A" />
      </g>
      <g transform="translate(312 300)">
        <path d="M-14 0h28l-4 24h-20l-4-24Z" fill="#C98B5E" />
        <path d="M0 0c-12-4-16-18-8-26 6 10 10 12 8 26ZM0 0c12-4 16-18 8-26-6 10-10 12-8 26Z" fill="#4CC24A" />
      </g>
    </>
  );
}

/* ------------------------------ INTERIOR ---------------------------- */

function Interior() {
  return (
    <>
      <circle cx="200" cy="212" r="168" fill="#F1F2EA" />
      <rect x="60" y="76" width="150" height="150" rx="10" fill="#DCEBF3" />
      <g stroke="#0F1A12" strokeOpacity=".14" strokeWidth="5">
        <path d="M60 151h150" />
        <path d="M135 76v150" />
      </g>
      <rect x="60" y="76" width="150" height="150" rx="10" fill="none" stroke="#0F1A12" strokeOpacity=".14" strokeWidth="5" />
      <g fill="#FFFFFF" opacity=".55">
        <ellipse cx="92" cy="110" rx="18" ry="10" />
        <ellipse cx="120" cy="96" rx="13" ry="8" />
      </g>
      <g transform="translate(268 96)">
        <path d="M0 0v34" stroke="#0F1A12" strokeOpacity=".4" strokeWidth="4" />
        <path d="M-22 34h44l-8 26h-28l-8-26Z" fill="#FDE047" />
        <circle cx="0" cy="0" r="7" fill="#0F1A12" opacity=".3" />
      </g>
      <g transform="translate(96 190)">
        <path d="M-22 0h44l-6 52h-32l-6-52Z" fill="#C98B5E" />
        <path d="M0 0c-22-8-28-38-14-52 10 18 18 22 14 52ZM0 0c22-8 28-38 14-52-10 18-18 22-14 52Z" fill="#4CC24A" />
        <path d="M0 0c-6-14 0-28 12-34-2 14-6 22-12 34Z" fill="#3FA34D" />
      </g>
      <rect x="60" y="268" width="286" height="18" rx="9" fill="#D7C6AB" />
      <rect x="84" y="286" width="12" height="52" rx="6" fill="#C0AC8E" />
      <rect x="310" y="286" width="12" height="52" rx="6" fill="#C0AC8E" />
      <g transform="translate(158 246)">
        <MiniCup />
        <ellipse cx="0" cy="22" rx="30" ry="8" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".1" strokeWidth="3" />
      </g>
      <g transform="translate(238 250)">
        <path d="M-24 18h48l-8 18h-32l-8-18Z" fill="#FFFFFF" stroke="#0F1A12" strokeOpacity=".1" strokeWidth="3" />
        <path d="M-20 18c4-16 8-24 20-24s16 8 20 24Z" fill="#F5C948" />
      </g>
      <rect x="60" y="336" width="286" height="10" rx="5" fill="#0F1A12" opacity=".08" />
    </>
  );
}

/* ------------------------------ Registry ---------------------------- */

const VARIANTS = {
  juice: Juice,
  shake: Shake,
  coffee: Coffee,
  coldCoffee: ColdCoffee,
  sandwich: Sandwich,
  momo: Momo,
  pasta: Pasta,
  maggi: Maggi,
  combo: Combo,
  storefront: Storefront,
  interior: Interior,
};

export default function FoodArt({
  art = "juice",
  tone: toneKey = "combo",
  image,
  alt = "",
  decorative = false,
  className = "",
  ...rest
}) {
  const Variant = VARIANTS[art] || Juice;
  const t = tone(toneKey);

  if (image) {
    return (
      <img
        className={className}
        src={image}
        alt={alt}
        loading="lazy"
        decoding="async"
        {...rest}
      />
    );
  }

  return (
    <svg
      className={className || undefined}
      viewBox="0 0 400 400"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : alt || undefined}
      focusable="false"
      {...rest}
    >
      <Variant t={t} />
    </svg>
  );
}
