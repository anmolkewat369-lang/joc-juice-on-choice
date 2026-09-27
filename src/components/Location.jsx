import { Copy, MapPin, Navigation } from "lucide-react";
import { useState } from "react";
import { ADDRESS, BRAND, LINKS } from "../data/business";
import styles from "./Location.module.css";

const FULL_ADDRESS = `${ADDRESS.line1}, ${ADDRESS.line2}, ${ADDRESS.country}`;

export default function Location() {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(FULL_ADDRESS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="section" id="location" aria-labelledby="location-title">
      <div className="container">
        <div className={styles.wrap}>
          <div className={styles.info}>
            <p className="eyebrow">Location</p>
            <h2 id="location-title">Find Your JOC</h2>
            <p className={styles.lead}>
              {BRAND.name} is at Dixit Colony, Marhatal — a short hop from Shri Ram College
              road, Jabalpur.
            </p>

            <address className={styles.card}>
              <span className={styles.pin} aria-hidden="true">
                <MapPin size={20} />
              </span>
              <span className={styles.cardBody}>
                <strong>{BRAND.name}</strong>
                <span>{ADDRESS.line1}</span>
                <span>{ADDRESS.line2}</span>
                <span>{ADDRESS.country}</span>
              </span>
            </address>

            <div className={styles.actions}>
              <a
                className="btn btn--primary"
                href={LINKS.maps}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={18} aria-hidden="true" />
                Get Directions
              </a>
              <button type="button" className="btn btn--ghost" onClick={copyAddress}>
                <Copy size={17} aria-hidden="true" />
                {copied ? "Address copied" : "Copy address"}
              </button>
            </div>

            <p className={styles.hint} role="status" aria-live="polite">
              {copied ? "Address copied to your clipboard." : "Opens Google Maps in a new tab."}
            </p>
          </div>

          <div className={styles.mapCard}>
            <div className={styles.mapArt} aria-hidden="true">
              <svg viewBox="0 0 400 400" focusable="false" role="presentation">
                <rect width="400" height="400" fill="#EEF3EA" />
                <g stroke="#FFFFFF" strokeWidth="14" fill="none" strokeLinecap="round">
                  <path d="M-20 250h180a60 60 0 0 0 60-60v-40" />
                  <path d="M240 150h180" />
                  <path d="M60 -20v440" />
                  <path d="M330 -20v440" />
                </g>
                <g fill="#DCEAD8">
                  <rect x="86" y="30" width="90" height="80" rx="10" />
                  <rect x="210" y="30" width="90" height="80" rx="10" />
                  <rect x="86" y="280" width="90" height="80" rx="10" />
                  <rect x="210" y="280" width="90" height="80" rx="10" />
                </g>
                <circle cx="200" cy="150" r="46" fill="#0F1A12" opacity=".08" />
                <path d="M200 96c-16 0-29 13-29 29 0 22 29 55 29 55s29-33 29-55c0-16-13-29-29-29Z" fill="#4CC24A" />
                <circle cx="200" cy="125" r="11" fill="#0F1A12" />
                <text x="200" y="232" textAnchor="middle" fontFamily="Poppins, Segoe UI, sans-serif" fontSize="26" fontWeight="700" fill="#16301F">
                  JOC
                </text>
                <text x="200" y="256" textAnchor="middle" fontFamily="Inter, Segoe UI, sans-serif" fontSize="14" fill="#62705F">
                  Dixit Colony, Marhatal
                </text>
              </svg>
            </div>
            <p className={styles.mapNote}>
              Schematic map for the concept demo. Use Get Directions for the live location.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
