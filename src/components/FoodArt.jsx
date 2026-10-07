import { useId } from "react";

/**
 * JOC product artwork.
 *
 * Every product is rendered in ONE consistent "studio product photography"
 * language: a warm cream seamless backdrop with a soft key-light halo, a single
 * realistic contact shadow, and material gradients (glass, liquid, foam,
 * ceramic, bread, dough) with specular highlights — so the menu reads as real
 * food and drink rather than flat vector art.
 *
 * The illustrations are still illustrations. They are NOT photographs of the
 * actual cafe. To use real photography, set
 * `image: "/images/menu/your-file.webp"` on a menu entry — this component then
 * renders the photo instead, with no other change needed.
 */

const TONES = {
  apple: { bg: "#EDF7E6", liquid: "#A9D96B", liquidTop: "#C6EA8F", deep: "#6CB03C", fruit: "#D8443C", fruit2: "#4C9A2A" },
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

/* --------------------------- colour utilities --------------------------- */

const clamp255 = (n) => Math.max(0, Math.min(255, n));

const toRgb = (hex) => {
  const s = String(hex).replace("#", "");
  const h = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
};

const toHex = (rgb) =>
  "#" + rgb.map((n) => clamp255(Math.round(n)).toString(16).padStart(2, "0")).join("");

const mix = (a, b, t) => {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
};

const lit = (c, t) => mix(c, "#ffffff", t);
const shd = (c, t) => mix(c, "#16281D", t);

const cleanId = (raw) => raw.replace(/[^a-zA-Z0-9]/g, "");

/* --------------------------- shared studio base -------------------------- */

/**
 * The common backdrop: a warm key-light halo that fades to fully transparent
 * before it reaches the edge of the square, so it sits seamlessly on whatever
 * surface the host container provides — no letterboxing seams at any aspect.
 * Also ships the soft contact-shadow gradient and the steam blur filter.
 */
function Studio({ ns, t }) {
  return (
    <>
      <defs>
        <radialGradient id={`${ns}-halo`} gradientUnits="userSpaceOnUse" cx="200" cy="196" r="188">
          <stop offset="0%" stopColor={lit(t.bg, 0.55)} stopOpacity="1" />
          <stop offset="42%" stopColor={t.bg} stopOpacity="0.92" />
          <stop offset="74%" stopColor={t.bg} stopOpacity="0.34" />
          <stop offset="100%" stopColor={t.bg} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${ns}-sh`}>
          <stop offset="0%" stopColor="#16281D" stopOpacity="0.4" />
          <stop offset="46%" stopColor="#16281D" stopOpacity="0.17" />
          <stop offset="100%" stopColor="#16281D" stopOpacity="0" />
        </radialGradient>
        <filter id={`${ns}-bl`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${ns}-halo)`} />
    </>
  );
}

const Shadow = ({ ns, cx = 200, cy = 330, rx = 104, ry = 20 }) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${ns}-sh)`} />
);

const Steam = ({ ns, x = 200, top = 108, spread = 30 }) => (
  <g
    filter={`url(#${ns}-bl)`}
    stroke="#7C8878"
    strokeOpacity="0.4"
    strokeWidth="7"
    strokeLinecap="round"
    fill="none"
  >
    <path d={`M${x - spread} ${top + 44}c-12-15 12-23 0-40`} />
    <path d={`M${x} ${top + 38}c-12-16 12-25 0-42`} />
    <path d={`M${x + spread} ${top + 44}c-12-15 12-22 0-38`} />
  </g>
);

/* ------------------------------- FRUIT PROP ------------------------------ */

/**
 * A single piece of fruit resting on the surface beside the drink.
 * Only ever the fruit the product name already implies.
 */
function Fruit({ ns, cx, cy, r, kind, t }) {
  const gid = `${ns}-fr${cx}${cy}`;
  const body = t.fruit;
  const leaf = t.fruit2;

  const sphere = (
    <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={cx - r * 0.4} cy={cy - r * 0.44} r={r * 1.7}>
      <stop offset="0%" stopColor={lit(body, 0.55)} />
      <stop offset="36%" stopColor={body} />
      <stop offset="100%" stopColor={shd(body, 0.45)} />
    </radialGradient>
  );

  let shape = null;

  if (kind === "banana") {
    shape = (
      <>
        <path
          d={`M${cx - r} ${cy - r * 0.45}Q${cx} ${cy + r * 1.15} ${cx + r} ${cy - r * 0.45}`}
          stroke={`url(#${gid})`}
          strokeWidth={r * 0.62}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M${cx - r * 0.72} ${cy - r * 0.2}Q${cx} ${cy + r * 0.72} ${cx + r * 0.72} ${cy - r * 0.2}`}
          stroke={shd(body, 0.22)}
          strokeOpacity="0.45"
          strokeWidth={r * 0.1}
          strokeLinecap="round"
          fill="none"
        />
      </>
    );
  } else if (kind === "watermelon") {
    shape = (
      <>
        <path d={`M${cx - r} ${cy}A${r} ${r} 0 0 0 ${cx + r} ${cy}Z`} fill={leaf} />
        <path d={`M${cx - r * 0.9} ${cy}A${r * 0.9} ${r * 0.9} 0 0 0 ${cx + r * 0.9} ${cy}Z`} fill={lit(leaf, 0.55)} />
        <path d={`M${cx - r * 0.8} ${cy}A${r * 0.8} ${r * 0.8} 0 0 0 ${cx + r * 0.8} ${cy}Z`} fill={body} />
        <g fill="#3A1220">
          <ellipse cx={cx - r * 0.36} cy={cy + r * 0.4} rx={r * 0.08} ry={r * 0.12} />
          <ellipse cx={cx + r * 0.16} cy={cy + r * 0.52} rx={r * 0.08} ry={r * 0.12} />
          <ellipse cx={cx + r * 0.5} cy={cy + r * 0.26} rx={r * 0.07} ry={r * 0.11} />
        </g>
        <path
          d={`M${cx - r * 0.55} ${cy + r * 0.18}A${r * 0.8} ${r * 0.8} 0 0 0 ${cx - r * 0.1} ${cy + r * 0.7}`}
          stroke="#FFFFFF"
          strokeOpacity="0.35"
          strokeWidth={r * 0.12}
          strokeLinecap="round"
          fill="none"
        />
      </>
    );
  } else {
    const crown = kind === "pomegranate" ? (
      <g fill={shd(body, 0.35)}>
        <path d={`M${cx - r * 0.22} ${cy - r * 0.92}l${r * 0.22} ${-r * 0.34}l${r * 0.22} ${r * 0.34}Z`} />
        <path d={`M${cx - r * 0.4} ${cy - r * 0.82}l${r * 0.18} ${-r * 0.22}l${r * 0.1} ${r * 0.3}Z`} />
        <path d={`M${cx + r * 0.04} ${cy - r * 0.86}l${r * 0.2} ${-r * 0.24}l${r * 0.08} ${r * 0.3}Z`} />
      </g>
    ) : (
      <g>
        <path d={`M${cx} ${cy - r * 0.86}v${-r * 0.3}`} stroke={shd(body, 0.55)} strokeWidth={r * 0.12} strokeLinecap="round" />
        <path
          d={`M${cx + r * 0.06} ${cy - r * 1.06}c${r * 0.5} ${-r * 0.3} ${r * 0.94} ${r * 0.06} ${r * 0.86} ${r * 0.34}c-${r * 0.44} ${r * 0.2} -${r * 0.8} ${r * 0.02} -${r * 0.86} -${r * 0.34}Z`}
          fill={leaf}
        />
      </g>
    );

    shape = (
      <>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${gid})`} />
        {kind === "orange" ? (
          <g fill={shd(body, 0.3)} opacity="0.35">
            <circle cx={cx + r * 0.3} cy={cy + r * 0.22} r={r * 0.07} />
            <circle cx={cx + r * 0.44} cy={cy - r * 0.06} r={r * 0.06} />
            <circle cx={cx + r * 0.14} cy={cy + r * 0.5} r={r * 0.06} />
          </g>
        ) : null}
        <ellipse
          cx={cx - r * 0.36}
          cy={cy - r * 0.42}
          rx={r * 0.24}
          ry={r * 0.15}
          fill="#FFFFFF"
          opacity="0.62"
          transform={`rotate(-32 ${cx - r * 0.36} ${cy - r * 0.42})`}
        />
        {crown}
      </>
    );
  }

  return (
    <>
      <defs>{sphere}</defs>
      <ellipse cx={cx} cy={cy + r * 0.94} rx={r * 1.2} ry={r * 0.3} fill={`url(#${ns}-sh)`} />
      {shape}
    </>
  );
}

/* -------------------------------- JUICES -------------------------------- */

const JUICE_FRUIT = {
  apple: "apple",
  orange: "orange",
  banana: "banana",
  pomegranate: "pomegranate",
  watermelon: "watermelon",
};

function Juice({ t, k }) {
  const ns = cleanId(useId());
  const glass = "M142 114h116l-14 190a24 24 0 0 1-24 19h-40a24 24 0 0 1-24-19l-14-190Z";
  const top = 178;

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <clipPath id={`${ns}-g`}>
          <path d={glass} />
        </clipPath>
        <linearGradient id={`${ns}-liq`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2="324">
          <stop offset="0%" stopColor={lit(t.liquidTop, 0.35)} />
          <stop offset="12%" stopColor={t.liquidTop} />
          <stop offset="34%" stopColor={t.liquid} />
          <stop offset="72%" stopColor={t.liquid} />
          <stop offset="100%" stopColor={shd(t.deep, 0.3)} />
        </linearGradient>
        <linearGradient id={`${ns}-vol`} gradientUnits="userSpaceOnUse" x1="142" y1="0" x2="258" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="14%" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="46%" stopColor="#16281D" stopOpacity="0.07" />
          <stop offset="84%" stopColor="#FFFFFF" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.52" />
        </linearGradient>
      </defs>

      <Shadow ns={ns} cx={200} cy={330} rx={96} ry={19} />
      <Fruit ns={ns} cx={306} cy={296} r={34} kind={JUICE_FRUIT[k]} t={t} />

      <g clipPath={`url(#${ns}-g)`}>
        <rect x="130" y="108" width="140" height="70" fill="#FFFFFF" opacity="0.6" />
        <rect x="130" y={top} width="140" height="200" fill={`url(#${ns}-liq)`} />
        <ellipse cx="200" cy={top} rx="58" ry="9" fill={lit(t.liquidTop, 0.4)} opacity="0.9" />
        <g fill="#FFFFFF" opacity="0.24">
          <rect x="152" y="196" width="36" height="31" rx="10" transform="rotate(-14 170 211)" />
          <rect x="200" y="226" width="29" height="27" rx="8" transform="rotate(16 214 239)" />
        </g>
        <g stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth="2" fill="none">
          <rect x="152" y="196" width="36" height="31" rx="10" transform="rotate(-14 170 211)" />
        </g>
        <rect x="142" y="108" width="116" height="220" fill={`url(#${ns}-vol)`} />
        <rect x="155" y="132" width="13" height="172" rx="6.5" fill="#FFFFFF" opacity="0.55" />
        <rect x="243" y="158" width="6" height="132" rx="3" fill="#FFFFFF" opacity="0.3" />
        <g fill="#FFFFFF" opacity="0.5">
          <circle cx="176" cy="252" r="3.2" />
          <circle cx="192" cy="280" r="2.4" />
          <circle cx="224" cy="258" r="2.8" />
          <circle cx="233" cy="288" r="2.2" />
          <circle cx="167" cy="294" r="2.6" />
          <circle cx="212" cy="300" r="2" />
        </g>
      </g>

      <path d={glass} fill="none" stroke={shd(t.liquid, 0.5)} strokeOpacity="0.4" strokeWidth="3" />
      <ellipse cx="200" cy="114" rx="58" ry="11" fill="#FFFFFF" opacity="0.55" />
      <ellipse cx="200" cy="114" rx="58" ry="11" fill="none" stroke={shd(t.liquid, 0.5)} strokeOpacity="0.32" strokeWidth="3" />

      <g transform="rotate(13 236 96)">
        <rect x="229" y="56" width="14" height="150" rx="7" fill="#FDE047" />
        <rect x="232" y="56" width="5" height="150" rx="2.5" fill="#FFFFFF" opacity="0.45" />
        <rect x="229" y="152" width="14" height="54" rx="7" fill={shd(t.deep, 0.2)} opacity="0.4" />
      </g>
    </>
  );
}

/* -------------------------------- SHAKES -------------------------------- */

const SHAKE_CRUMBS = {
  oreo: ["#2C2C2C", "#3C3C3C", "#1E1E1E"],
  kitkat: ["#8B4A2B", "#A55A33", "#6E3A22"],
};

function Shake({ t, k }) {
  const ns = cleanId(useId());
  const glass = "M140 152h120l-14 158a24 24 0 0 1-24 20h-44a24 24 0 0 1-24-20l-14-158Z";
  const crumbs = SHAKE_CRUMBS[k] || ["#4A2A1A", "#5C3624", "#3A2116"];

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <clipPath id={`${ns}-g`}>
          <path d={glass} />
        </clipPath>
        <linearGradient id={`${ns}-shake`} gradientUnits="userSpaceOnUse" x1="0" y1="196" x2="0" y2="330">
          <stop offset="0%" stopColor={lit(t.creamTop, 0.3)} />
          <stop offset="16%" stopColor={t.creamTop} />
          <stop offset="48%" stopColor={t.cream} />
          <stop offset="100%" stopColor={shd(t.cream, 0.34)} />
        </linearGradient>
        <linearGradient id={`${ns}-vol`} gradientUnits="userSpaceOnUse" x1="140" y1="0" x2="260" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.58" />
          <stop offset="15%" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="47%" stopColor="#16281D" stopOpacity="0.07" />
          <stop offset="85%" stopColor="#FFFFFF" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={`${ns}-foam`} gradientUnits="userSpaceOnUse" x1="0" y1="104" x2="0" y2="172">
          <stop offset="0%" stopColor="#FFFDF7" />
          <stop offset="60%" stopColor={lit(t.creamTop, 0.55)} />
          <stop offset="100%" stopColor={t.creamTop} />
        </linearGradient>
      </defs>

      <Shadow ns={ns} cx={200} cy={334} rx={94} ry={18} />

      <g clipPath={`url(#${ns}-g)`}>
        <rect x="130" y="148" width="140" height="56" fill="#FFFFFF" opacity="0.55" />
        <rect x="130" y="196" width="140" height="150" fill={`url(#${ns}-shake)`} />
        <rect x="142" y="148" width="116" height="190" fill={`url(#${ns}-vol)`} />
        <rect x="154" y="212" width="13" height="110" rx="6.5" fill="#FFFFFF" opacity="0.5" />
        <g fill="#FFFFFF" opacity="0.34">
          <circle cx="178" cy="256" r="7" />
          <circle cx="214" cy="284" r="5" />
          <circle cx="196" cy="308" r="4" />
        </g>
      </g>

      <path d={glass} fill="none" stroke={shd(t.cream, 0.5)} strokeOpacity="0.4" strokeWidth="3" />
      <ellipse cx="200" cy="152" rx="60" ry="11" fill={t.creamTop} opacity="0.55" />

      {/* thick, creamy crown — no invented toppings */}
      <g fill={`url(#${ns}-foam)`}>
        <ellipse cx="200" cy="152" rx="52" ry="17" />
        <ellipse cx="186" cy="134" rx="36" ry="15" />
        <ellipse cx="214" cy="120" rx="25" ry="13" />
        <ellipse cx="200" cy="108" rx="16" ry="10" />
      </g>
      <ellipse cx="184" cy="132" rx="14" ry="6" fill="#FFFFFF" opacity="0.65" transform="rotate(-16 184 132)" />

      <path
        d="M164 150c11 10 21-8 32 2s21-8 32 2 19-6 26-1"
        fill="none"
        stroke={t.drizzle}
        strokeOpacity="0.85"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g>
        <rect x="178" y="120" width="11" height="6" rx="3" fill={crumbs[0]} transform="rotate(-24 183 123)" />
        <rect x="208" y="132" width="10" height="6" rx="3" fill={crumbs[1]} transform="rotate(18 213 135)" />
        <rect x="226" y="144" width="10" height="6" rx="3" fill={crumbs[2]} transform="rotate(-40 231 147)" />
        <rect x="166" y="142" width="10" height="6" rx="3" fill={crumbs[1]} transform="rotate(32 171 145)" />
        <rect x="196" y="146" width="11" height="6" rx="3" fill={crumbs[0]} transform="rotate(-8 201 149)" />
      </g>

      <g transform="rotate(-13 218 96)">
        <rect x="211" y="58" width="14" height="130" rx="7" fill={t.drizzle} />
        <rect x="214" y="58" width="5" height="130" rx="2.5" fill="#FFFFFF" opacity="0.24" />
      </g>
    </>
  );
}

/* -------------------------------- COFFEE -------------------------------- */

function Coffee({ t }) {
  const ns = cleanId(useId());
  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <linearGradient id={`${ns}-cup`} gradientUnits="userSpaceOnUse" x1="142" y1="0" x2="274" y2="0">
          <stop offset="0%" stopColor={lit(t.cup, 0)} />
          <stop offset="16%" stopColor="#FFFFFF" />
          <stop offset="58%" stopColor="#F3EFE7" />
          <stop offset="100%" stopColor="#DFD8CB" />
        </linearGradient>
        <radialGradient id={`${ns}-brew`} cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor={lit(t.coffee, 0.35)} />
          <stop offset="60%" stopColor={t.coffee} />
          <stop offset="100%" stopColor={shd(t.coffee, 0.35)} />
        </radialGradient>
        <linearGradient id={`${ns}-saucer`} gradientUnits="userSpaceOnUse" x1="0" y1="278" x2="0" y2="330">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E6DFD3" />
        </linearGradient>
      </defs>

      <Steam ns={ns} x={204} top={104} spread={30} />
      <Shadow ns={ns} cx={200} cy={334} rx={104} ry={18} />

      <ellipse cx="200" cy="304" rx="104" ry="27" fill={`url(#${ns}-saucer)`} />
      <ellipse cx="200" cy="304" rx="104" ry="27" fill="none" stroke="#16281D" strokeOpacity="0.12" strokeWidth="3" />
      <ellipse cx="200" cy="300" rx="66" ry="15" fill="#EFEAE0" />
      <ellipse cx="200" cy="299" rx="66" ry="15" fill="none" stroke="#16281D" strokeOpacity="0.07" strokeWidth="2" />

      <path
        d="M142 168h116v58a50 50 0 0 1-50 50h-16a50 50 0 0 1-50-50v-58Z"
        fill={`url(#${ns}-cup)`}
        stroke="#16281D"
        strokeOpacity="0.14"
        strokeWidth="3"
      />
      <path
        d="M258 186h16a30 30 0 0 1 0 60h-16v-13h13a17 17 0 0 0 0-34h-13v-13Z"
        fill={`url(#${ns}-cup)`}
        stroke="#16281D"
        strokeOpacity="0.14"
        strokeWidth="3"
      />
      <ellipse cx="200" cy="168" rx="58" ry="14" fill={t.coffee} />
      <ellipse cx="200" cy="168" rx="58" ry="14" fill={`url(#${ns}-brew)`} />
      <ellipse cx="200" cy="168" rx="58" ry="14" fill="none" stroke="#16281D" strokeOpacity="0.16" strokeWidth="3" />
      <ellipse cx="200" cy="166" rx="44" ry="9" fill={t.crema} opacity="0.85" />
      <path
        d="M172 166c8-7 20-8 28-2"
        fill="none"
        stroke={lit(t.crema, 0.55)}
        strokeOpacity="0.8"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse cx="186" cy="163" rx="16" ry="4" fill="#FFFFFF" opacity="0.3" />
      <rect x="152" y="186" width="11" height="76" rx="5.5" fill="#FFFFFF" opacity="0.5" />
    </>
  );
}

function ColdCoffee({ t, k }) {
  const ns = cleanId(useId());
  const c = { ...TONES.cold, ...t };
  const glass = "M142 118h116l-14 186a24 24 0 0 1-24 19h-40a24 24 0 0 1-24-19l-14-186Z";
  const crumbs = k === "oreo" ? ["#2C2C2C", "#3C3C3C", "#1E1E1E"] : null;

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <clipPath id={`${ns}-g`}>
          <path d={glass} />
        </clipPath>
        <linearGradient id={`${ns}-cc`} gradientUnits="userSpaceOnUse" x1="0" y1="196" x2="0" y2="324">
          <stop offset="0%" stopColor={c.top} />
          <stop offset="14%" stopColor={lit(c.baseTop, 0.25)} />
          <stop offset="40%" stopColor={c.baseTop} />
          <stop offset="72%" stopColor={c.base} />
          <stop offset="100%" stopColor={shd(c.base, 0.4)} />
        </linearGradient>
        <linearGradient id={`${ns}-vol`} gradientUnits="userSpaceOnUse" x1="142" y1="0" x2="258" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="14%" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="46%" stopColor="#16281D" stopOpacity="0.07" />
          <stop offset="84%" stopColor="#FFFFFF" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.52" />
        </linearGradient>
      </defs>

      <Shadow ns={ns} cx={200} cy={326} rx={94} ry={18} />

      <g clipPath={`url(#${ns}-g)`}>
        <rect x="130" y="112" width="140" height="88" fill="#FFFFFF" opacity="0.55" />
        <rect x="130" y="196" width="140" height="140" fill={`url(#${ns}-cc)`} />
        <ellipse cx="200" cy="198" rx="58" ry="10" fill={lit(c.top, 0.35)} opacity="0.9" />
        <g fill="#FFFFFF" opacity="0.3">
          <rect x="150" y="212" width="32" height="29" rx="9" transform="rotate(-12 166 226)" />
          <rect x="198" y="242" width="27" height="25" rx="8" transform="rotate(15 211 254)" />
          <rect x="162" y="266" width="24" height="22" rx="7" transform="rotate(-20 174 277)" />
        </g>
        <rect x="142" y="112" width="116" height="220" fill={`url(#${ns}-vol)`} />
        <rect x="155" y="136" width="13" height="168" rx="6.5" fill="#FFFFFF" opacity="0.55" />
        <rect x="243" y="162" width="6" height="126" rx="3" fill="#FFFFFF" opacity="0.3" />
        <g fill="#FFFFFF" opacity="0.5">
          <circle cx="176" cy="248" r="3.2" />
          <circle cx="194" cy="276" r="2.4" />
          <circle cx="224" cy="256" r="2.8" />
          <circle cx="232" cy="286" r="2.2" />
          <circle cx="168" cy="290" r="2.6" />
        </g>
        {crumbs ? (
          <g fill={crumbs[0]} opacity="0.75">
            <rect x="172" y="204" width="9" height="5" rx="2.5" transform="rotate(-18 176 206)" />
            <rect x="206" y="212" width="8" height="5" rx="2.5" transform="rotate(22 210 214)" />
            <rect x="222" y="204" width="8" height="5" rx="2.5" transform="rotate(-36 226 206)" />
          </g>
        ) : null}
      </g>

      <path d={glass} fill="none" stroke={shd(c.base, 0.5)} strokeOpacity="0.4" strokeWidth="3" />
      <ellipse cx="200" cy="118" rx="58" ry="11" fill="#FFFFFF" opacity="0.55" />
      <ellipse cx="200" cy="118" rx="58" ry="11" fill="none" stroke={shd(c.base, 0.5)} strokeOpacity="0.32" strokeWidth="3" />

      {k === "icecream" ? (
        <g>
          <ellipse cx="200" cy="112" rx="34" ry="24" fill="#FFF7EC" />
          <ellipse cx="200" cy="112" rx="34" ry="24" fill="none" stroke="#16281D" strokeOpacity="0.1" strokeWidth="2" />
          <ellipse cx="190" cy="104" rx="13" ry="8" fill="#FFFFFF" opacity="0.85" />
          <path
            d="M176 122c10 7 24 8 36 3"
            fill="none"
            stroke={c.drizzle}
            strokeOpacity="0.7"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
      ) : null}

      <g transform="rotate(11 232 96)">
        <rect x="225" y="58" width="14" height="150" rx="7" fill={c.drizzle} />
        <rect x="228" y="58" width="5" height="150" rx="2.5" fill="#FFFFFF" opacity="0.22" />
      </g>
    </>
  );
}

/* ------------------------------- SANDWICHES ------------------------------ */

function Sandwich({ t }) {
  const ns = cleanId(useId());
  const wedge = "M200 84 314 268a18 18 0 0 1-14 29H100a18 18 0 0 1-14-29L200 84Z";

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <clipPath id={`${ns}-g`}>
          <path d={wedge} />
        </clipPath>
        <linearGradient id={`${ns}-crumb`} gradientUnits="userSpaceOnUse" x1="86" y1="0" x2="314" y2="0">
          <stop offset="0%" stopColor={lit(t.breadTop, 0.35)} />
          <stop offset="42%" stopColor={t.breadTop} />
          <stop offset="100%" stopColor={shd(t.bread, 0.22)} />
        </linearGradient>
        <linearGradient id={`${ns}-plate`} gradientUnits="userSpaceOnUse" x1="0" y1="284" x2="0" y2="336">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E7E0D4" />
        </linearGradient>
      </defs>

      <Shadow ns={ns} cx={200} cy={330} rx={128} ry={20} />
      <ellipse cx="200" cy="308" rx="146" ry="28" fill={`url(#${ns}-plate)`} />
      <ellipse cx="200" cy="308" rx="146" ry="28" fill="none" stroke="#16281D" strokeOpacity="0.12" strokeWidth="3" />
      <ellipse cx="200" cy="306" rx="116" ry="20" fill="none" stroke="#16281D" strokeOpacity="0.07" strokeWidth="2" />
      <ellipse cx="200" cy="300" rx="86" ry="14" fill="#16281D" opacity="0.06" />

      <g clipPath={`url(#${ns}-g)`}>
        <rect x="80" y="84" width="240" height="214" fill={`url(#${ns}-crumb)`} />
        <rect x="80" y="126" width="240" height="20" fill={t.cheese} />
        <rect x="80" y="146" width="240" height="26" fill={t.leaf} />
        <rect x="80" y="172" width="240" height="16" fill={t.tomato} />
        <rect x="80" y="188" width="240" height="30" fill={lit(t.cheese, 0.15)} />
        <rect x="80" y="218" width="240" height="22" fill={shd(t.leaf, 0.12)} />
        <rect x="80" y="240" width="240" height="60" fill={t.bread} />
        <g stroke={shd(t.bread, 0.3)} strokeOpacity="0.35" strokeWidth="5" strokeLinecap="round">
          <path d="M150 100 178 126" />
          <path d="M186 96 214 122" />
          <path d="M222 92 250 118" />
        </g>
        <rect x="148" y="92" width="16" height="220" fill="#FFFFFF" opacity="0.16" />
        <rect x="268" y="120" width="8" height="180" fill="#16281D" opacity="0.07" />
      </g>

      <path d={wedge} fill="none" stroke={shd(t.bread, 0.45)} strokeOpacity="0.4" strokeWidth="3" />
      <g transform="translate(306 250)">
        <circle r="24" fill={lit(t.leaf, 0.12)} />
        <path d="M-13 0a13 13 0 0 1 13-13c-2 9-6 13-13 13Z" fill="#16281D" opacity="0.14" />
      </g>
    </>
  );
}

/* --------------------------------- MOMOS --------------------------------- */

function Momo({ t }) {
  const ns = cleanId(useId());
  const dough = t.bread;
  const pleat = "#16281D";

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <linearGradient id={`${ns}-bowl`} gradientUnits="userSpaceOnUse" x1="0" y1="248" x2="0" y2="336">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F6F2EA" />
          <stop offset="100%" stopColor="#DED6C8" />
        </linearGradient>
        <radialGradient id={`${ns}-doughA`} cx="38%" cy="30%" r="76%">
          <stop offset="0%" stopColor={lit(dough, 0.5)} />
          <stop offset="55%" stopColor={dough} />
          <stop offset="100%" stopColor={shd(dough, 0.28)} />
        </radialGradient>
        <radialGradient id={`${ns}-doughB`} cx="38%" cy="30%" r="76%">
          <stop offset="0%" stopColor={lit(t.cheese, 0.4)} />
          <stop offset="55%" stopColor={t.cheese} />
          <stop offset="100%" stopColor={shd(t.cheese, 0.28)} />
        </radialGradient>
      </defs>

      <Steam ns={ns} x={200} top={118} spread={34} />
      <Shadow ns={ns} cx={200} cy={340} rx={116} ry={18} />

      <g transform="translate(156 192) scale(0.8)">
        <path d="M0 0c-30 0-48 24-48 48 0 24 20 38 48 38s48-14 48-38C48 24 30 0 0 0Z" fill={`url(#${ns}-doughA)`} />
        <g stroke={pleat} strokeOpacity="0.18" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M0 -46v46" />
          <path d="M-20 -42c-8 18-12 30-12 44" />
          <path d="M20 -42c8 18 12 30 12 44" />
        </g>
        <path d="M-42 44c14 8 70 8 84 0" stroke={pleat} strokeOpacity="0.16" strokeWidth="4" fill="none" strokeLinecap="round" />
        <ellipse cx="-16" cy="18" rx="17" ry="11" fill="#FFFFFF" opacity="0.35" transform="rotate(-24 -16 18)" />
      </g>

      <g transform="translate(250 204) scale(0.64)">
        <path d="M0 0c-30 0-48 24-48 48 0 24 20 38 48 38s48-14 48-38C48 24 30 0 0 0Z" fill={`url(#${ns}-doughB)`} />
        <g stroke={pleat} strokeOpacity="0.18" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M0 -46v46" />
          <path d="M-20 -42c-8 18-12 30-12 44" />
          <path d="M20 -42c8 18 12 30 12 44" />
        </g>
        <ellipse cx="-14" cy="18" rx="15" ry="10" fill="#FFFFFF" opacity="0.35" transform="rotate(-24 -14 18)" />
      </g>

      <path
        d="M118 250h164l-16 66a24 24 0 0 1-24 18h-84a24 24 0 0 1-24-18l-16-66Z"
        fill={`url(#${ns}-bowl)`}
        stroke={pleat}
        strokeOpacity="0.16"
        strokeWidth="3"
      />
      <ellipse cx="200" cy="250" rx="82" ry="20" fill="#F4EFE5" stroke={pleat} strokeOpacity="0.14" strokeWidth="3" />
      <ellipse cx="200" cy="250" rx="66" ry="14" fill="#E9E1D2" />
      <g stroke={pleat} strokeOpacity="0.12" strokeWidth="4" fill="none">
        <path d="M150 268c22 10 78 10 100 0" />
        <path d="M160 288c20 8 60 8 80 0" />
      </g>
      <path d="M142 264c4 34 18 54 34 66" fill="none" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="7" strokeLinecap="round" />
    </>
  );
}

/* --------------------------------- PASTA --------------------------------- */

function Pasta({ t }) {
  const ns = cleanId(useId());
  const clip = `${ns}-g`;

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <clipPath id={clip}>
          <ellipse cx="196" cy="230" rx="116" ry="34" />
        </clipPath>
        <linearGradient id={`${ns}-bowl`} gradientUnits="userSpaceOnUse" x1="0" y1="228" x2="0" y2="340">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F7F3EB" />
          <stop offset="100%" stopColor="#DFD7C9" />
        </linearGradient>
        <linearGradient id={`${ns}-sauce`} gradientUnits="userSpaceOnUse" x1="0" y1="196" x2="0" y2="272">
          <stop offset="0%" stopColor={lit(t.cheese, 0.25)} />
          <stop offset="100%" stopColor={shd(t.cheese, 0.18)} />
        </linearGradient>
      </defs>

      <Steam ns={ns} x={196} top={140} spread={34} />
      <Shadow ns={ns} cx={200} cy={344} rx={124} ry={18} />

      <path
        d="M80 230h232l-26 84a34 34 0 0 1-32 24H138a34 34 0 0 1-32-24L80 230Z"
        fill={`url(#${ns}-bowl)`}
        stroke="#16281D"
        strokeOpacity="0.14"
        strokeWidth="3"
      />
      <path d="M80 230h232l-4 13H84l-4-13Z" fill={t.cheese} opacity="0.5" />
      <ellipse cx="196" cy="230" rx="116" ry="34" fill={t.bread} />
      <g clipPath={`url(#${clip})`}>
        <rect x="70" y="192" width="252" height="80" fill={`url(#${ns}-sauce)`} />
        <rect x="70" y="240" width="252" height="34" fill={shd(t.bread, 0.16)} />
        <g stroke={lit(t.breadTop, 0.2)} strokeWidth="13" fill="none" strokeLinecap="round">
          <path d="M96 236c22-20 60-22 84-4s58 18 96 2" />
          <path d="M104 216c26 14 52-10 78 2s52 18 84 2" />
          <path d="M92 254c30-10 54 12 84 0s58-10 88 4" />
        </g>
        <g stroke={shd(t.breadTop, 0.2)} strokeOpacity="0.5" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M110 244c24-14 54-14 76 0" />
          <path d="M148 262c26-8 52-6 74 4" />
        </g>
        <circle cx="150" cy="216" r="7" fill="#D9553F" />
        <circle cx="230" cy="244" r="6" fill="#D9553F" />
        <circle cx="196" cy="206" r="5" fill="#4FA83B" />
        <circle cx="264" cy="226" r="5" fill="#4FA83B" />
        <ellipse cx="146" cy="210" rx="16" ry="7" fill="#FFFFFF" opacity="0.3" transform="rotate(-18 146 210)" />
      </g>
      <ellipse cx="196" cy="230" rx="116" ry="34" fill="none" stroke="#16281D" strokeOpacity="0.14" strokeWidth="3" />
      <path d="M96 300c16 12 44 20 74 22" fill="none" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="7" strokeLinecap="round" />

      <g transform="translate(296 214) rotate(16)">
        <path d="M0 0h10v96H0z" fill="#3A4139" />
        <g fill="#3A4139">
          <rect x="-14" y="-16" width="6" height="20" rx="3" />
          <rect x="-4" y="-18" width="6" height="22" rx="3" />
          <rect x="6" y="-16" width="6" height="20" rx="3" />
        </g>
        <rect x="0" y="92" width="10" height="36" rx="5" fill="#2A302C" />
        <rect x="1" y="0" width="3" height="92" fill="#FFFFFF" opacity="0.25" />
      </g>
    </>
  );
}

/* --------------------------------- MAGGI --------------------------------- */

function Maggi({ t }) {
  const ns = cleanId(useId());
  const clip = `${ns}-g`;

  return (
    <>
      <Studio ns={ns} t={t} />
      <defs>
        <clipPath id={clip}>
          <ellipse cx="200" cy="208" rx="108" ry="30" />
        </clipPath>
        <linearGradient id={`${ns}-bowl`} gradientUnits="userSpaceOnUse" x1="0" y1="206" x2="0" y2="324">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F7F3EB" />
          <stop offset="100%" stopColor="#DED6C8" />
        </linearGradient>
        <linearGradient id={`${ns}-noodle`} gradientUnits="userSpaceOnUse" x1="0" y1="178" x2="0" y2="240">
          <stop offset="0%" stopColor={lit(t.breadTop ?? t.bread, 0.35)} />
          <stop offset="100%" stopColor={shd(t.bread, 0.2)} />
        </linearGradient>
      </defs>

      <Steam ns={ns} x={200} top={92} spread={34} />
      <Shadow ns={ns} cx={200} cy={330} rx={116} ry={18} />

      <path
        d="M92 208h216l-24 88a36 36 0 0 1-34 26h-100a36 36 0 0 1-34-26l-24-88Z"
        fill={`url(#${ns}-bowl)`}
        stroke="#16281D"
        strokeOpacity="0.14"
        strokeWidth="3"
      />
      <path d="M92 208h216l-4 12H96l-4-12Z" fill={t.breadTop ?? t.bread} opacity="0.5" />
      <ellipse cx="200" cy="208" rx="108" ry="30" fill={t.bread} />
      <g clipPath={`url(#${clip})`}>
        <rect x="80" y="176" width="240" height="64" fill={`url(#${ns}-noodle)`} />
        <g stroke={lit(t.breadTop ?? t.bread, 0.3)} strokeWidth="9" fill="none" strokeLinecap="round">
          <path d="M100 214c24-16 52 8 76-2s54 12 84-2" />
          <path d="M110 196c26 12 48-8 74 2s50 12 78-2" />
          <path d="M96 228c26-8 50 8 74 2s56 6 84-4" />
        </g>
        <g stroke={shd(t.bread, 0.28)} strokeOpacity="0.45" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M104 220c24-12 52 6 76-4" />
          <path d="M140 204c22 8 44-6 66 2" />
        </g>
        <circle cx="160" cy="200" r="5" fill="#5BAE3F" />
        <circle cx="236" cy="218" r="5" fill="#5BAE3F" />
        <circle cx="204" cy="230" r="4" fill="#D9553F" />
        <ellipse cx="150" cy="194" rx="20" ry="8" fill="#FFFFFF" opacity="0.3" transform="rotate(-14 150 194)" />
      </g>
      <ellipse cx="200" cy="208" rx="108" ry="30" fill="none" stroke="#16281D" strokeOpacity="0.14" strokeWidth="3" />
      <path d="M108 264c14 16 40 28 70 32" fill="none" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="7" strokeLinecap="round" />

      <g transform="rotate(24 262 150)">
        <rect x="250" y="56" width="9" height="176" rx="4.5" fill="#C99B6A" />
        <rect x="265" y="50" width="9" height="180" rx="4.5" fill="#B5885A" />
        <rect x="252" y="56" width="3" height="176" fill="#FFFFFF" opacity="0.35" />
      </g>
    </>
  );
}

/* --------------------------------- COMBO --------------------------------- */

const MiniGlass = ({ liquid = "#FF9A4D", deep = "#F2661F" }) => (
  <g>
    <path d="M-24 -54h48l-7 78a10 10 0 0 1-10 9h-14a10 10 0 0 1-10-9l-7-78Z" fill="#FFFFFF" opacity=".72" />
    <path d="M-20 -16h40l-5 40a9 9 0 0 1-9 8h-12a9 9 0 0 1-9-8l-5-40Z" fill={liquid} />
    <path d="M-20 -16h40l-1 8h-38l-1-8Z" fill={deep} opacity=".55" />
    <path
      d="M-24 -54h48l-7 78a10 10 0 0 1-10 9h-14a10 10 0 0 1-10-9l-7-78Z"
      fill="none"
      stroke="#16281D"
      strokeOpacity=".16"
      strokeWidth="3"
    />
    <ellipse cx="0" cy="-54" rx="24" ry="5" fill="#FFFFFF" opacity=".85" />
    <rect x="-18" y="-46" width="5" height="52" rx="2.5" fill="#FFFFFF" opacity=".6" />
    <rect x="7" y="-100" width="6" height="58" rx="3" transform="rotate(10 10 -71)" fill="#FDE047" />
  </g>
);

const MiniCup = ({ coffee = "#4A3226" }) => (
  <g>
    <path
      d="M-30 -34h60v30a26 26 0 0 1-26 26h-8a26 26 0 0 1-26-26v-30Z"
      fill="#FFFFFF"
      stroke="#16281D"
      strokeOpacity=".14"
      strokeWidth="3"
    />
    <path
      d="M30 -26h10a16 16 0 0 1 0 32H30v-7h8a9 9 0 0 0 0-18h-8v-7Z"
      fill="#FFFFFF"
      stroke="#16281D"
      strokeOpacity=".14"
      strokeWidth="3"
    />
    <ellipse cx="0" cy="-34" rx="30" ry="8" fill={coffee} />
    <ellipse cx="0" cy="-35" rx="21" ry="5" fill="#B98A5F" opacity=".75" />
    <rect x="-24" y="-24" width="5" height="42" rx="2.5" fill="#FFFFFF" opacity=".7" />
    <g stroke="#7C8878" strokeOpacity=".38" strokeWidth="4" fill="none" strokeLinecap="round">
      <path d="M-12 -48c-6-8 6-12 0-20" />
      <path d="M10 -50c-6-8 6-14 0-22" />
    </g>
  </g>
);

const MiniMomos = ({ dough = "#E9B573", filling = "#F0D3A0" }) => (
  <g>
    <path d="M-34 6c0-20 14-32 30-32S26-14 26 6 12 26-4 26s-30-6-30-20Z" fill={dough} />
    <g stroke="#16281D" strokeOpacity=".18" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M-4 -24V0" />
      <path d="M-16 -22c-4 10-6 16-6 24" />
      <path d="M8 -22c4 10 6 16 6 24" />
    </g>
    <ellipse cx="-14" cy="-6" rx="10" ry="6" fill="#FFFFFF" opacity=".35" transform="rotate(-24 -14 -6)" />
    <path d="M14 16c0-14 10-22 20-22s20 8 20 22-9 14-20 14-20-2-20-14Z" fill={filling} />
    <g stroke="#16281D" strokeOpacity=".16" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M30 -2v14" />
      <path d="M20 0c-3 7-4 11-4 16" />
    </g>
  </g>
);

function Combo({ t }) {
  const ns = cleanId(useId());
  const c = { ...TONES.combo, ...t };

  return (
    <>
      <Studio ns={ns} t={c} />
      <Shadow ns={ns} cx={200} cy={352} rx={130} ry={22} />
      <circle cx="200" cy="238" r="126" fill="#FFFFFF" />
      <circle cx="200" cy="238" r="126" fill="none" stroke="#16281D" strokeOpacity="0.12" strokeWidth="3" />
      <circle cx="200" cy="238" r="104" fill="none" stroke={c.glass} strokeOpacity="0.4" strokeWidth="3" />
      <path
        d="M112 206a126 126 0 0 1 62-62"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.9"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <ellipse cx="200" cy="326" rx="86" ry="14" fill="#16281D" opacity="0.06" />

      <g transform="translate(120 200) scale(0.94)">
        <MiniGlass liquid={c.glass} deep={c.glassDeep} />
      </g>
      <g transform="translate(198 206)">
        <path d="M0 -54 56 24H-56Z" fill={c.bread} stroke="#16281D" strokeOpacity="0.14" strokeWidth="3" />
        <path d="M-45 8h90l-4 12h-82l-4-12Z" fill="#5BAE3F" />
        <path d="M-52 20h104l-3 10H-49l-3-10Z" fill="#F5C948" />
        <path d="M-30 -34 0 -54l14 20Z" fill="#FFFFFF" opacity="0.35" />
      </g>
      <g transform="translate(270 202)">
        <MiniCup coffee={c.cup} />
      </g>
      <g transform="translate(152 292) scale(0.94)">
        <MiniMomos dough={c.bread} />
      </g>
      <g transform="translate(258 294)">
        <circle r="22" fill="#4CC24A" />
        <path d="M-10 0a10 10 0 0 1 10-10c-2 8-4 10-10 10Z" fill="#16281D" opacity=".16" />
        <ellipse cx="-7" cy="-7" rx="7" ry="4" fill="#FFFFFF" opacity=".45" transform="rotate(-30 -7 -7)" />
      </g>
    </>
  );
}

/* ----------------------------- STOREFRONT --------------------------- */

const SCENE = { bg: "#EFF3EA" };

function Storefront() {
  const ns = cleanId(useId());
  return (
    <>
      <Studio ns={ns} t={SCENE} />
      <rect x="52" y="118" width="296" height="212" rx="8" fill="#F6F1E4" />
      <rect x="52" y="118" width="296" height="212" rx="8" fill="none" stroke="#16281D" strokeOpacity=".1" strokeWidth="3" />
      <g>
        {Array.from({ length: 7 }).map((_, i) => (
          <path
            key={i}
            d={`M${60 + i * 42} 118h21a26 26 0 0 1 0 40H${60 + i * 42}a26 26 0 0 1 0-40Z`}
            fill={i % 2 === 0 ? "#4CC24A" : "#FFFBF3"}
          />
        ))}
        <rect x="52" y="158" width="296" height="12" fill="#16281D" opacity=".08" />
      </g>
      <rect x="118" y="60" width="164" height="58" rx="10" fill="#083D29" />
      <text
        x="200"
        y="99"
        textAnchor="middle"
        fontFamily="Poppins, Segoe UI, sans-serif"
        fontSize="34"
        fontWeight="800"
        fill="#A7D46F"
        letterSpacing="2"
      >
        JOC
      </text>
      <rect x="140" y="186" width="146" height="112" rx="10" fill="#D8E7DA" />
      <g stroke="#16281D" strokeOpacity=".12" strokeWidth="4">
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
      <circle cx="326" cy="262" r="5" fill="#16281D" opacity=".45" />
      <ellipse cx="200" cy="334" rx="150" ry="14" fill="#16281D" opacity=".08" />
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
  const ns = cleanId(useId());
  return (
    <>
      <Studio ns={ns} t={{ bg: "#F1F2EA" }} />
      <rect x="60" y="76" width="150" height="150" rx="10" fill="#DCEBF3" />
      <g stroke="#16281D" strokeOpacity=".14" strokeWidth="5">
        <path d="M60 151h150" />
        <path d="M135 76v150" />
      </g>
      <rect x="60" y="76" width="150" height="150" rx="10" fill="none" stroke="#16281D" strokeOpacity=".14" strokeWidth="5" />
      <g fill="#FFFFFF" opacity=".55">
        <ellipse cx="92" cy="110" rx="18" ry="10" />
        <ellipse cx="120" cy="96" rx="13" ry="8" />
      </g>
      <g transform="translate(268 96)">
        <path d="M0 0v34" stroke="#16281D" strokeOpacity=".4" strokeWidth="4" />
        <path d="M-22 34h44l-8 26h-28l-8-26Z" fill="#FDE047" />
        <circle cx="0" cy="0" r="7" fill="#16281D" opacity=".3" />
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
        <path d="M-30 -34h60v30a26 26 0 0 1-26 26h-8a26 26 0 0 1-26-26v-30Z" fill="#FFFFFF" stroke="#16281D" strokeOpacity=".14" strokeWidth="3" />
        <ellipse cx="0" cy="-34" rx="30" ry="8" fill="#4A3226" />
        <ellipse cx="0" cy="22" rx="30" ry="8" fill="#FFFFFF" stroke="#16281D" strokeOpacity=".1" strokeWidth="3" />
      </g>
      <g transform="translate(238 250)">
        <path d="M-24 18h48l-8 18h-32l-8-18Z" fill="#FFFFFF" stroke="#16281D" strokeOpacity=".1" strokeWidth="3" />
        <path d="M-20 18c4-16 8-24 20-24s16 8 20 24Z" fill="#F5C948" />
      </g>
      <rect x="60" y="336" width="286" height="10" rx="5" fill="#16281D" opacity=".08" />
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
        alt={decorative ? "" : alt}
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
      <Variant t={t} k={toneKey} />
    </svg>
  );
}
