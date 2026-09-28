import styles from "./Field.module.css";

/**
 * Labelled form control. The label is always a real <label for>, the error is
 * linked with aria-describedby and announced through role="alert", and the
 * input is marked aria-invalid — so the validation is not colour-only.
 */
export default function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  error,
  inputMode,
  autoComplete,
  maxLength,
  multiline = false,
  rows = 3,
  required = false,
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  const shared = {
    id,
    name: id,
    value,
    onChange,
    placeholder,
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": describedBy || undefined,
    "aria-required": required || undefined,
    autoComplete,
    inputMode,
    maxLength,
    className: error ? `${styles.input} ${styles.invalid}` : styles.input,
  };

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : (
          <span className={styles.optional}>optional</span>
        )}
      </label>

      {multiline ? (
        <textarea {...shared} rows={rows} />
      ) : (
        <input {...shared} type={type} />
      )}

      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
