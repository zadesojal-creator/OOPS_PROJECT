import { CSSProperties, MouseEvent, ReactNode, useEffect } from 'react';
import { Icon } from './Icon';

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled = false,
  className = '',
  size = 'md',
  title,
  style,
}: {
  children: ReactNode;
  onClick?: (e?: MouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'teal';
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`btn ${variant} ${size !== 'md' ? `btn-${size}` : ''} ${className}`}
      title={title}
      style={style}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  title,
  subtitle,
  action,
  className = '',
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {typeof title === 'string' ? <h3>{title}</h3> : title}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {action && <div className="card-actions">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: string;
  className?: string;
}) {
  return <span className={`badge ${tone} ${className}`}>{children}</span>;
}

export function StatCard({
  label,
  value,
  subvalue,
  icon,
  tone = 'primary',
  onClick,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  subvalue?: string;
  icon?: string;
  tone?: 'primary' | 'teal' | 'success' | 'warning' | 'danger' | 'purple';
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <div className={`stat-card tone-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        {loading ? (
          <div className="stat-skeleton" />
        ) : (
          <div className="stat-value stat-value-transition">{value}</div>
        )}
        {subvalue && <span className="stat-sub">{subvalue}</span>}
      </div>
      {icon && (
        <div className={`stat-icon-wrap icon-${tone}`}>
          <Icon name={icon} size={22} />
        </div>
      )}
    </div>
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = '580px',
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          <button className="btn-icon close-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = '480px',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer-panel"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="drawer-header">
          <div>
            {typeof title === 'string' ? <h3>{title}</h3> : title}
            {subtitle && <p className="drawer-subtitle">{subtitle}</p>}
          </div>
          <button className="btn-icon close-btn" onClick={onClose} aria-label="Close drawer">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </div>
  );
}

export function EmptyState({
  icon = 'calendar',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon-wrap">
        <Icon name={icon} size={36} />
      </div>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="skeleton-row">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="skeleton-box" style={{ width: i === 0 ? '60%' : '80%' }} />
        </td>
      ))}
    </tr>
  );
}
