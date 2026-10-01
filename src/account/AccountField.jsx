import styles from "./account.module.css";

/**
 * A labelled text input with hint and error wiring.
 *
 * Small on purpose: the account forms need the same accessible error copy the
 * checkout's <Field> gives, without the checkout-only props (multiline, area
 * picker, limits). The error is an id-referenced, role="alert" paragraph so a
 * screen reader announces it and points at the input it belongs to.
 */
export default function AccountField({ id, label, error, hint, className, ...props }) {
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`${styles.input} ${error ? styles.inputInvalid : ""} ${className ?? ""}`}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
