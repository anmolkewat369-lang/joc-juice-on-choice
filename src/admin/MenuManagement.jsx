import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { formatPrice } from "../data/menu.js";
import { getMenuItems, updateMenuAvailability } from "./api.js";
import styles from "./MenuManagement.module.css";

const FILTERS = [
  ["all", "All items"],
  ["available", "Available"],
  ["out_of_stock", "Out of Stock"],
  ["coming_soon", "Coming Soon"],
];

const STATUS_LABELS = {
  available: "Available",
  out_of_stock: "Out of Stock",
  coming_soon: "Coming Soon",
};

export default function MenuManagement({ onSessionExpired }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getMenuItems();
      setItems(data.items);
      setError(null);
      return true;
    } catch (caught) {
      if (caught.status === 401) {
        onSessionExpired?.();
        return false;
      }
      setError(caught.message);
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    // The initial API response is asynchronous; it cannot be derived from render
    // state. The narrow suppression avoids hiding this rule elsewhere.
    // oxlint-disable-next-line react/set-state-in-effect
    load();
  }, [load]);

  const counts = useMemo(
    () => ({
      all: items.length,
      available: items.filter((item) => item.availability === "available").length,
      out_of_stock: items.filter((item) => item.availability === "out_of_stock").length,
      coming_soon: items.filter((item) => item.availability === "coming_soon").length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (filter === "all" || item.availability === filter) &&
        (!term || item.name.toLowerCase().includes(term)),
    );
  }, [filter, items, search]);

  const update = async (itemId, status) => {
    if (savingId) return;
    setSavingId(itemId);
    setError(null);
    setSuccess(null);
    try {
      const result = await updateMenuAvailability(itemId, status);
      setItems((current) =>
        current.map((item) => (item.id === itemId ? result.item : item)),
      );
      setSuccess(`${result.item.name} is now ${STATUS_LABELS[result.item.availability]}.`);
    } catch (caught) {
      if (caught.status === 401) {
        onSessionExpired?.();
        return;
      }
      setError(caught.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="menu-management-title">
      <div className={styles.heading}>
        <div>
          <h2 id="menu-management-title">Menu Management</h2>
          <p>Change item availability without editing or redeploying the menu.</p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => load(true)}
          disabled={refreshing || loading || savingId !== null}
        >
          <RefreshCw className={refreshing ? styles.spin : undefined} size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {success ? <p className={styles.success} role="status">{success}</p> : null}

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter menu items by availability">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`${styles.filter} ${filter === value ? styles.filterActive : ""}`}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {label} <span>{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Search menu items by name</span>
          <input
            type="search"
            placeholder="Search items…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <p className={styles.loading} role="status">
          <Loader2 className={styles.spin} size={17} aria-hidden="true" /> Loading menu items…
        </p>
      ) : visible.length === 0 ? (
        <p className={styles.loading}>
          {search ? "No menu item matches your search." : "No menu items match this filter."}
        </p>
      ) : (
        <ul className={styles.list}>
          {visible.map((item) => (
            <li className={styles.item} key={item.id}>
              <img className={styles.image} src={item.image} alt="" loading="lazy" />
              <div className={styles.details}>
                <h3>{item.name}</h3>
                <p>{item.category} <span aria-hidden="true">·</span> {formatPrice(item.price)}</p>
              </div>
              <span className={`${styles.status} ${styles[`status${item.availability}`]}`}>
                {STATUS_LABELS[item.availability]}
              </span>
              <label className={styles.selectorLabel} htmlFor={`availability-${item.id}`}>
                Change status
              </label>
              <select
                id={`availability-${item.id}`}
                className={styles.selector}
                value={item.availability}
                disabled={savingId !== null}
                onChange={(event) => update(item.id, event.target.value)}
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              {savingId === item.id ? (
                <span className={styles.saving} role="status">
                  <Loader2 className={styles.spin} size={15} aria-hidden="true" />
                  Updating…
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
