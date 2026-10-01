/**
 * Searchable delivery-area picker.
 *
 * JOC publishes a list of areas (src/data/deliveryAreas.js) and the customer picks
 * one from it. There is no map, no pin, no coordinates and no request to any
 * mapping provider on this screen — the component only reads the local list and
 * reports the choice upward.
 *
 * Built as a searchable list rather than a `<select>` because a native select on a
 * phone scrolls a 22-item menu off the top of the screen, and because it gives no
 * room to show the confirmation sentence that goes with the choice. The list is
 * rendered as real buttons so each target is finger-sized and keyboard-reachable.
 *
 * The chosen area is reported as an id from the configured list. The label shown
 * beside it is resolved from that same list, so the customer, the server, the admin
 * dashboard and the order email all read from one definition of an area's name.
 */

import { useId, useMemo, useState } from "react";

import { DELIVERY_AREA_HINT, DELIVERY_AREA_LABEL, deliveryAreaFor, searchDeliveryAreas } from "../../../shared/delivery.js";
import styles from "./AreaSelector.module.css";

/**
 * @param {object} props
 * @param {string|null} props.value        selected area id, or null
 * @param {(id: string|null) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string|null} [props.error]      server- or client-side error message
 * @param {string} [props.search]          visible search text, when lifted by the form
 */
export default function AreaSelector({
  value = null,
  onChange,
  disabled = false,
  error = null,
  search: searchProp = undefined,
}) {
  // An uncontrolled search box keeps this component usable on its own; the form
  // lifts the value when it needs to clear it on submit failure.
  const [ownSearch, setOwnSearch] = useState("");
  const search = searchProp ?? ownSearch;
  const setSearch = searchProp === undefined ? setOwnSearch : () => {};

  const listId = useId();
  const matches = useMemo(() => searchDeliveryAreas(search), [search]);
  // Read back from the list rather than trusting the id we were handed, so a value
  // restored from a stale session cannot display an area the list no longer has.
  const selectedName = value ? deliveryAreaFor(value)?.name ?? null : null;

  const invalid = Boolean(error);

  return (
    <div className={styles.field} data-testid="area-selector">
      <label className={styles.label} htmlFor="area-selector-search">
        {DELIVERY_AREA_LABEL}
        <span className={styles.required} aria-hidden="true">
          *
        </span>
      </label>

      <input
        // A fixed id, not useId output: the checkout moves focus here by id when
        // validation refuses the order for a missing area, and a generated id
        // could not be found from outside the component.
        id="area-selector-search"
        type="search"
        className={styles.search}
        value={search}
        placeholder="Search your area"
        autoComplete="off"
        // Never ask the browser to remember a delivery area: it would offer areas
        // JOC may have since removed, and the value is re-validated server-side
        // anyway. Keeping it off also avoids a saved suggestion being submitted
        // for a different customer on a shared device.
        autoCorrect="off"
        spellCheck="false"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${listId}-error` : `${listId}-hint`}
        onChange={(event) => {
          setSearch(event.target.value);
          // Editing the search means the customer is changing their mind. Clearing
          // the selection stops them from ordering into an area they were only
          // reading about — they have to choose again, deliberately.
          onChange(null);
        }}
      />

      <p id={`${listId}-hint`} className={styles.hint}>
        {DELIVERY_AREA_HINT}
      </p>

      {selectedName ? (
        <p className={styles.selected}>
          <span className={styles.selectedLabel}>Area:</span> {selectedName}
        </p>
      ) : null}

      <ul className={styles.list} aria-label={`${DELIVERY_AREA_LABEL} options`}>
        {matches.length === 0 ? (
          <li className={styles.empty}>
            No area matches “{search.trim()}”. Please choose an area from the list, or
            contact JOC.
          </li>
        ) : (
          matches.map((area) => {
            const isSelected = area.id === value;
            return (
              <li key={area.id}>
                <button
                  type="button"
                  className={styles.option}
                  // aria-pressed rather than a radio: this is a single choice from a
                  // list the customer can page through, and a pressed state is what
                  // a screen reader announces for "this one is chosen".
                  aria-pressed={isSelected}
                  disabled={disabled}
                  onClick={() => onChange(area.id)}
                >
                  {area.name}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {invalid ? (
        <p id={`${listId}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}