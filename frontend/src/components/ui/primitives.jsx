import { Check, CircleAlert, Info, Inbox, TriangleAlert } from "lucide-react";

// Small, dependency-free primitives shared by the redesigned guardian and Field Officer pages.
// They are styled entirely by src/styles/sbms-ui.css, which is scoped to `.sbms-ui`, so the Admin
// interface (never mounted inside `.sbms-ui`) is unaffected.

const TONE_ICON = { success: Check, warning: TriangleAlert, error: CircleAlert, info: Info };

export function Button({ variant = "secondary", size, block = false, className = "", type = "button", children, ...props }) {
  const classes = [
    "sb-btn",
    variant !== "secondary" ? `sb-btn--${variant}` : "",
    size ? `sb-btn--${size}` : "",
    block ? "sb-btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", dot = false, className = "", children }) {
  return (
    <span className={`sb-badge sb-badge--${tone} ${className}`.trim()}>
      {dot && <span className="sb-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Card({ title, action, children, footer, className = "", bodyClassName = "sb-card__body", as: Tag = "section" }) {
  return (
    <Tag className={`sb-card ${className}`.trim()}>
      {(title || action) && (
        <div className="sb-card__head">
          {title && <h2 className="sb-card__title">{title}</h2>}
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
      {footer && <div className="sb-card__foot">{footer}</div>}
    </Tag>
  );
}

export function Field({ label, htmlFor, hint, error, required = false, optional = false, className = "", children }) {
  return (
    <div className={`sb-field ${className}`.trim()}>
      {label && (
        <label className="sb-label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="sb-required" aria-hidden="true">
              *
            </span>
          )}
          {optional && <span className="sb-optional">Optional</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="sb-hint">{hint}</p>}
      {error && (
        <p className="sb-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Alert({ tone = "info", title, children, icon }) {
  const Icon = icon || TONE_ICON[tone] || Info;
  const classes = tone === "info" ? "sb-alert sb-alert--info" : `sb-alert sb-alert--${tone}`;
  return (
    <div className={classes} role={tone === "error" ? "alert" : "status"}>
      <Icon size={16} className="sb-alert__icon" aria-hidden="true" />
      <div>
        {title && <strong className="sb-alert__title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, note, tone = "accent" }) {
  return (
    <div className={`sb-stat sb-stat--${tone}`}>
      <span className="sb-stat__label">{label}</span>
      <span className="sb-stat__value">{value}</span>
      {note && <span className="sb-stat__note">{note}</span>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label = "Sections" }) {
  return (
    <div className="sb-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={value === tab.id}
          aria-controls={`panel-${tab.id}`}
          className="sb-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Timeline({ items }) {
  return (
    <ol className="sb-timeline">
      {items.map((item) => (
        <li key={item.key} className={`sb-timeline__item sb-timeline__item--${item.state || "pending"}`}>
          <span className="sb-timeline__marker" aria-hidden="true">
            {item.state === "done" ? <Check size={13} strokeWidth={3} /> : item.index || ""}
          </span>
          <div className="sb-timeline__body">
            <span className="sb-timeline__title">{item.title}</span>
            {item.detail && <span className="sb-timeline__meta">{item.detail}</span>}
            {item.meta && <span className="sb-timeline__meta">{item.meta}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Stepper({ steps, current }) {
  return (
    <ol className="sb-stepper">
      {steps.map((step, index) => {
        const state = index === current ? "current" : index < current ? "done" : "pending";
        return (
          <li key={step} className={`sb-stepper__item sb-stepper__item--${state}`}>
            <span className="sb-stepper__index" aria-hidden="true">
              {state === "done" ? <Check size={13} strokeWidth={3} /> : index + 1}
            </span>
            <span className="sb-stepper__label">{step}</span>
            {index < steps.length - 1 && <span className="sb-stepper__bar" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyState({ title, children, icon: Icon = Inbox }) {
  return (
    <div className="sb-empty">
      <span className="sb-empty__icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="sb-empty__title">{title}</span>
      {children && (
        <p className="sb-meta" style={{ maxWidth: 360 }}>
          {children}
        </p>
      )}
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div aria-hidden="true">
      <div className="sb-skeleton sb-skeleton--title" />
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="sb-skeleton sb-skeleton--line" style={{ width: `${88 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function Modal({ open, title, children, actions, onClose }) {
  if (!open) return null;
  return (
    <div className="sb-modal-backdrop" onClick={onClose}>
      <div className="sb-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="sb-modal__body">
          <h2 className="sb-title--sm">{title}</h2>
          {children}
        </div>
        <div className="sb-modal__actions">{actions}</div>
      </div>
    </div>
  );
}

export function DataRow({ label, value, mono = false }) {
  return (
    <div className="sb-dl__row">
      <dt>{label}</dt>
      <dd className={mono ? "sb-code" : undefined}>{value || "Not provided"}</dd>
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="sb-page-head">
      <div className="sb-page-head__text">
        {eyebrow && <span className="sb-eyebrow">{eyebrow}</span>}
        <h1 className="sb-title">{title}</h1>
        {subtitle && <p className="sb-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="sb-row">{actions}</div>}
    </header>
  );
}

